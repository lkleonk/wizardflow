"""`wizardflow dashboard --otlp`: the live OTLP/HTTP receiver, and the built-in
sender of `wizardflow otel export --endpoint` talking to it."""

import gzip
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from otlp_builders import TRACE_A, log_record, logs_request, span, traces_request
from test_otel_out import TRACE, _chain
from wizardflow import otlp_http, otlp_proto
from wizardflow.otel_file_exporter import ExportOptions, export_trace_chain
from wizardflow.otlp_http import OtlpSendError, send_trace_requests
from wizardflow.serve import _route, start_receiver
from wizardflow.store import import_otlp_file, open_store
from wizardflow.store.queries import meta


@pytest.fixture
def receiver(tmp_path):
    db = tmp_path / "wf.db"
    open_store(db).close()
    server, state = start_receiver(db, host="127.0.0.1", port=0)
    state.db = db
    yield state
    server.shutdown()
    server.server_close()
    state.close()


def _post(receiver, path, body, content_type="application/x-protobuf", headers=None):
    request = Request(
        receiver.endpoint + path,
        data=body,
        headers={"Content-Type": content_type, **(headers or {})},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, response.headers.get("Content-Type"), response.read()
    except HTTPError as exc:
        return exc.code, exc.headers.get("Content-Type"), exc.read()


def _rows(db, sql):
    con = open_store(db)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def test_protobuf_traces_are_stored_and_answered_in_protobuf(receiver):
    request = traces_request(
        [span("1" * 16, name="root"), span("2" * 16, parent="1" * 16, name="child")],
        service="live-app",
    )
    status, content_type, body = _post(
        receiver, "/v1/traces", otlp_proto.encode_traces_request(request)
    )
    assert (status, content_type, body) == (200, "application/x-protobuf", b"")
    assert _rows(receiver.db, "SELECT name FROM spans ORDER BY name") == [("child",), ("root",)]
    assert _rows(receiver.db, "SELECT name FROM projects") == [("live-app",)]
    assert receiver.info()["spans"] == 2


def test_gzipped_json_logs(receiver):
    request = logs_request([log_record("hello", trace_id=TRACE_A, span_id="1" * 16)])
    status, content_type, body = _post(
        receiver,
        "/v1/logs",
        gzip.compress(json.dumps(request).encode()),
        content_type="application/json; charset=utf-8",
        headers={"Content-Encoding": "gzip"},
    )
    assert (status, content_type, json.loads(body)) == (200, "application/json", {})
    assert _rows(receiver.db, "SELECT body FROM logs") == [('"hello"',)]


def test_requests_of_one_run_share_one_import_row(receiver):
    for span_id in ("1" * 16, "2" * 16):
        body = otlp_proto.encode_traces_request(traces_request([span(span_id)]))
        assert _post(receiver, "/v1/traces", body)[0] == 200
    assert _rows(receiver.db, "SELECT source, span_count FROM imports") == [("otlp_http", 2)]


def test_resent_spans_are_not_duplicated(receiver):
    body = otlp_proto.encode_traces_request(traces_request([span("1" * 16)]))
    _post(receiver, "/v1/traces", body)
    _post(receiver, "/v1/traces", body)  # an exporter retrying after a lost answer
    assert _rows(receiver.db, "SELECT count(*) FROM spans") == [(1,)]


def test_invalid_spans_come_back_as_partial_success(receiver):
    request = traces_request([span("1" * 16), span("0" * 16)])
    status, _, body = _post(receiver, "/v1/traces", otlp_proto.encode_traces_request(request))
    assert status == 200
    partial = otlp_proto.decode(body, otlp_proto.TRACES_RESPONSE)["partialSuccess"]
    assert partial["rejectedSpans"] == "1"
    status, _, body = _post(receiver, "/v1/traces", json.dumps(request).encode(), "application/json")
    assert json.loads(body)["partialSuccess"]["rejectedSpans"] == "1"


@pytest.mark.parametrize("path, body, content_type, headers, status, message", [
    ("/v1/metrics", b"", "application/x-protobuf", {}, 404, "not metrics"),
    ("/v1/traces", b"{}", "text/plain", {}, 415, "send application/x-protobuf"),
    ("/v1/traces", b"\x0a\x05ab", "application/x-protobuf", {}, 400, "invalid protobuf"),
    ("/v1/traces", b"[1]", "application/json", {}, 400, "must be an object"),
    ("/v1/traces", b'{"resourceSpans": "x"}', "application/json", {}, 400, "not an OTLP request"),
    ("/v1/traces", b"plain", "application/x-protobuf", {"Content-Encoding": "gzip"}, 400, "gzip"),
    ("/v1/traces", b"", "application/x-protobuf", {"Content-Encoding": "br"}, 415, "br"),
    ("/v1/traces", b"", "application/json", {"Origin": "https://evil.example"}, 403, "web pages"),
    ("/v1/traces", b"", "application/json", {"Host": "evil.example:4318"}, 403, "Host"),
    ("/v1/traces", b"", "application/json", {"Content-Length": "-1"}, 400, "Content-Length"),
])
def test_bad_requests_are_refused(receiver, path, body, content_type, headers, status, message):
    got, got_type, answer = _post(receiver, path, body, content_type, headers)
    assert got == status
    if got_type == "application/json":
        text = json.loads(answer)["message"]
    else:
        text = otlp_proto.decode(answer, otlp_proto.RPC_STATUS)["message"]
    assert message in text
    assert _rows(receiver.db, "SELECT count(*) FROM spans") == [(0,)]


def test_a_too_large_body_is_refused_unread(receiver, monkeypatch):
    monkeypatch.setattr("wizardflow.receiver.MAX_OTLP_BODY", 10)
    status, _, _ = _post(receiver, "/v1/traces", b"x" * 11)
    assert status == 413


def test_a_gzip_bomb_is_cut_off(receiver, monkeypatch):
    monkeypatch.setattr("wizardflow.receiver.MAX_OTLP_BODY", 1000)
    status, _, _ = _post(
        receiver, "/v1/traces", gzip.compress(b"\x00" * 5000), headers={"Content-Encoding": "gzip"}
    )
    assert status == 413


def test_meta_reports_the_receiver(receiver):
    _post(receiver, "/v1/traces", otlp_proto.encode_traces_request(traces_request([span("1" * 16)])))
    con = open_store(receiver.db)
    try:
        body = _route(con, "/api/meta", {}, str(receiver.db), "test", receiver)
        assert "otlp-receiver" in body["capabilities"]
        assert body["receiver"]["enabled"] and body["receiver"]["spans"] == 1
        assert body["receiver"]["endpoint"] == receiver.endpoint
        assert _route(con, "/api/meta", {}, str(receiver.db), "test")["receiver"] == {
            "enabled": False
        }
        assert "otlp-receiver" not in meta(con, db_path="x", version="test")["capabilities"]
    finally:
        con.close()


def test_a_taken_port_is_a_clear_error(receiver, tmp_path):
    from wizardflow.serve import ReceiverPortError

    with pytest.raises(ReceiverPortError, match="--otlp-port"):
        start_receiver(receiver.db, host="127.0.0.1", port=receiver.port)


# --------------------------------------------------------------------------- built-in sender


def _stored_spans(db):
    return sorted(
        _rows(db, "SELECT name, kind, start_ns, end_ns, status_code, attributes FROM spans")
    )


def test_builtin_endpoint_export_stores_what_a_file_export_stores(receiver, tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "opentelemetry", None)  # no OTel packages needed
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_COMPRESSION", "gzip")
    options = dict(export_graph=True, content_max_bytes=16_000_000)
    export_trace_chain(_chain(tmp_path), ExportOptions(
        endpoint=receiver.endpoint + "/v1/traces", **options
    ))
    out = tmp_path / "run.otlp.jsonl"
    export_trace_chain(_chain(tmp_path), ExportOptions(out=out, **options))
    file_db = tmp_path / "file.db"
    con = open_store(file_db)
    import_otlp_file(con, out)
    con.close()

    # Fresh ids and times per export run, so compare everything else.
    def shape(rows):
        return sorted((name, kind, end - start, status, attrs) for name, kind, start, end, status, attrs in rows)

    sent = _stored_spans(receiver.db)
    assert len(sent) == 5  # 2 workflow roots + 3 node spans
    assert shape(sent) == shape(_stored_spans(file_db))
    assert _rows(receiver.db, "SELECT name FROM projects") == [(TRACE["name"],)]
    assert _rows(receiver.db, "SELECT count(*) FROM span_events WHERE name = 'wizardflow.graph'") \
        == _rows(file_db, "SELECT count(*) FROM span_events WHERE name = 'wizardflow.graph'")


def test_builtin_and_sdk_exporters_deliver_the_same_spans(tmp_path):
    """Side by side: the same run through the OTel SDK's OTLP/HTTP exporter
    and through the built-in one lands identically in the receiver."""
    pytest.importorskip(
        "opentelemetry.exporter.otlp.proto.http.trace_exporter",
        reason="needs opentelemetry-exporter-otlp-proto-http (test-only)",
    )
    stored = {}
    for exporter in ("otel-sdk", "builtin"):
        db = tmp_path / f"{exporter}.db"
        open_store(db).close()
        server, state = start_receiver(db, host="127.0.0.1", port=0)
        try:
            export_trace_chain(_chain(tmp_path), ExportOptions(
                endpoint=state.endpoint + "/v1/traces", exporter=exporter, export_graph=True
            ))
        finally:
            server.shutdown()
            server.server_close()
            state.close()
        stored[exporter] = sorted(
            (name, kind, end - start, status, attrs)
            for name, kind, start, end, status, attrs in _stored_spans(db)
        )
    assert stored["builtin"] == stored["otel-sdk"]


class _Scripted(BaseHTTPRequestHandler):
    """Answers each POST with the next scripted (status, headers, body)."""

    script = []
    seen = []

    def do_POST(self):  # noqa: N802
        self.seen.append((self.headers, self.rfile.read(int(self.headers["Content-Length"]))))
        status, headers, body = self.script.pop(0)
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def scripted():
    _Scripted.script, _Scripted.seen = [], []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Scripted)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/v1/traces"
    server.shutdown()
    server.server_close()


REQUEST = traces_request([span("1" * 16)])


def test_sender_uses_the_otel_header_variables(scripted, monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer%20abc, x-team=wf")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "x-team=traces")
    _Scripted.script = [(200, {}, b"")]
    send_trace_requests([REQUEST], scripted)
    headers, body = _Scripted.seen[0]
    # The signal-specific variable replaces the general one, as in the SDK.
    assert headers.get("x-team") == "traces" and "authorization" not in headers
    assert headers["Content-Type"] == "application/x-protobuf"
    assert body == otlp_proto.encode_traces_request(REQUEST)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS")
    assert otlp_http.env_headers() == {"authorization": "Bearer abc", "x-team": "wf"}


def test_sender_retries_unavailable_and_honors_retry_after(scripted):
    _Scripted.script = [
        (503, {"Retry-After": "0"}, b""),
        (429, {}, b""),
        (200, {}, b""),
    ]
    delays = []
    send_trace_requests([REQUEST], scripted, sleep=delays.append)
    assert delays == [0.0, 2.0] and len(_Scripted.seen) == 3


def test_sender_reports_a_refusal_with_its_message(scripted):
    status = otlp_proto.encode({"code": 3, "message": "bad span"}, otlp_proto.RPC_STATUS)
    _Scripted.script = [(400, {"Content-Type": "application/x-protobuf"}, status)]
    with pytest.raises(OtlpSendError, match="HTTP 400: bad span"):
        send_trace_requests([REQUEST], scripted, sleep=lambda _: None)


def test_sender_reports_rejected_spans(scripted):
    answer = otlp_proto.encode(
        {"partialSuccess": {"rejectedSpans": 2, "errorMessage": "too old"}},
        otlp_proto.TRACES_RESPONSE,
    )
    _Scripted.script = [(200, {"Content-Type": "application/x-protobuf"}, answer)]
    with pytest.raises(OtlpSendError, match="rejected 2 span"):
        send_trace_requests([REQUEST], scripted)


def test_sender_gives_up_on_an_unreachable_endpoint(monkeypatch):
    monkeypatch.setattr("wizardflow.otlp_http.RETRY_DELAYS_S", (0.0,))
    with pytest.raises(OtlpSendError, match="could not reach"):
        send_trace_requests(
            [REQUEST], "http://127.0.0.1:9/v1/traces", timeout=1, sleep=lambda _: None
        )


def test_the_data_version_moves_when_data_arrives(receiver):
    def version():
        con = open_store(receiver.db)
        try:
            return _route(con, "/api/version", {}, str(receiver.db), "test")["dataVersion"]
        finally:
            con.close()

    before = version()
    assert version() == before
    _post(receiver, "/v1/logs", otlp_proto.encode_logs_request(logs_request([log_record("x")])))
    after_log = version()
    assert after_log != before
    body = otlp_proto.encode_traces_request(traces_request([span("1" * 16)]))
    _post(receiver, "/v1/traces", body)
    after_span = version()
    assert after_span != after_log
    _post(receiver, "/v1/traces", body)  # only duplicates: nothing new to show
    assert version() == after_span


def test_resent_logs_are_not_duplicated(receiver):
    body = json.dumps(logs_request([log_record("hello")])).encode()
    _post(receiver, "/v1/logs", body, "application/json")
    _post(receiver, "/v1/logs", body, "application/json")  # a retry after a lost answer
    assert _rows(receiver.db, "SELECT count(*) FROM logs") == [(1,)]
