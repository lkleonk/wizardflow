"""Live export without the OTel SDK: the built-in background sender
(`wizardflow.otlp_live`) and how `init(otel=True, otel_endpoint=...)` picks it."""

import logging
import socket
import threading
import time

import pytest

from wizardflow import Client, otel
from wizardflow.client import WizardFlowError
from wizardflow.otel import OTelConfigurationError, create_otel_bridge
from wizardflow.otlp_live import LiveExporter, LiveSpanRecorder
from wizardflow.serve import start_receiver
from wizardflow.store import open_store
from wizardflow.store.otlp import iter_spans
from wizardflow.store.schema import FLAG_WIZARDFLOW


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


def _rows(db, sql):
    con = open_store(db)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def _record(client, executions=1):
    for i in range(executions):
        with client.workflow() as run:
            with run.node("model", kind="llm") as node:
                node.log_input(f"question {i}")
                node.log_output(f"answer {i}")
            with run.node("reply") as node:
                node.log_output(f"answer {i}")


def _no_sdk(monkeypatch):
    """Make every OpenTelemetry import fail, as if the packages were missing."""
    real = otel.import_module

    def import_module(name, *args):
        if name.startswith("opentelemetry"):
            raise ImportError(f"No module named {name!r}")
        return real(name, *args)

    monkeypatch.setattr(otel, "import_module", import_module)


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class _Capture:
    """A stand-in for otlp_http.send_trace_requests that keeps the requests."""

    def __init__(self, block=None):
        self.requests = []
        self.block = block

    def __call__(self, requests, endpoint, *, sleep):
        if self.block is not None:
            self.block.wait(5)
        self.requests.extend(requests)
        return len(requests)

    def span_names(self):
        return sorted(
            span["name"]
            for request in self.requests
            for resource in request["resourceSpans"]
            for scope in resource["scopeSpans"]
            for span in scope["spans"]
        )


def _exporter(send, **kwargs):
    return LiveExporter(
        "http://127.0.0.1:1/v1/traces",
        resource_attributes={"service.name": "test"},
        scope_version="test",
        send=send,
        **kwargs,
    )


# --------------------------------------------------------------- end to end


def test_builtin_live_export_reaches_the_dashboard_receiver(receiver):
    client = Client(
        name="live-agent",
        nodes=["model", "reply"],
        jsonl=False,
        otel=True,
        otel_endpoint=receiver.endpoint + "/v1/traces",
        otel_exporter="builtin",
    )
    _record(client, executions=2)
    client.close_otel()

    names = [name for (name,) in _rows(receiver.db, "SELECT name FROM spans ORDER BY name")]
    assert names.count("model") == 2 and names.count("reply") == 2
    assert _rows(receiver.db, "SELECT name FROM projects") == [("live-agent",)]
    # The executions arrive as graph-replayable traces.
    flags = _rows(receiver.db, "SELECT flags FROM traces")
    assert len(flags) == 2 and all(f & FLAG_WIZARDFLOW for (f,) in flags)


def test_auto_falls_back_to_the_builtin_sender_without_the_sdk(monkeypatch, caplog):
    _no_sdk(monkeypatch)
    with caplog.at_level(logging.INFO, logger="wizardflow"):
        bridge = create_otel_bridge(f"http://127.0.0.1:{_free_port()}/v1/traces")
    try:
        assert isinstance(bridge._provider, LiveSpanRecorder)
        assert "built-in sender" in caplog.text and "pip install" in caplog.text
    finally:
        bridge._provider.exporter.shutdown(timeout_s=0.5)


def test_choices_that_cannot_work_are_refused(monkeypatch):
    with pytest.raises(OTelConfigurationError, match="needs an otel_endpoint"):
        create_otel_bridge(None, exporter="builtin")
    with pytest.raises(OTelConfigurationError, match="otel_exporter must be one of"):
        create_otel_bridge("http://127.0.0.1:1/v1/traces", exporter="grpc")
    with pytest.raises(WizardFlowError, match="otel_exporter"):
        Client(nodes=["a"], jsonl=False, otel=True, otel_exporter="grpc")
    # No endpoint means joining the app's tracing: that needs the OTel API.
    _no_sdk(monkeypatch)
    with pytest.raises(OTelConfigurationError, match="pip install"):
        create_otel_bridge(None, exporter="auto")
    with pytest.raises(OTelConfigurationError, match="pip install"):
        create_otel_bridge("http://127.0.0.1:1/v1/traces", exporter="otel-sdk")


# ------------------------------------------------- running inside an app


def test_a_closed_endpoint_never_blocks_or_raises_into_the_app(caplog):
    port = _free_port()  # nothing listens here
    client = Client(
        nodes=["model", "reply"],
        jsonl=False,
        otel=True,
        otel_endpoint=f"http://127.0.0.1:{port}/v1/traces",
        otel_exporter="builtin",
    )
    started = time.monotonic()
    _record(client, executions=3)
    assert time.monotonic() - started < 1.0  # the network is never on the app's thread
    with caplog.at_level(logging.WARNING, logger="wizardflow"):
        started = time.monotonic()
        client.close_otel()  # must not raise
        assert time.monotonic() - started < 3.0
    assert "not sent" in caplog.text or "could not send" in caplog.text
    assert "Traceback" not in caplog.text  # a closed dashboard is routine, not a crash


def test_a_stalled_endpoint_is_cut_off_at_close(monkeypatch, caplog):
    stalled = socket.socket()
    stalled.bind(("127.0.0.1", 0))
    stalled.listen(8)  # accepts connections, never answers
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TIMEOUT", "0.3")
    try:
        client = Client(
            nodes=["model", "reply"],
            jsonl=False,
            otel=True,
            otel_endpoint=f"http://127.0.0.1:{stalled.getsockname()[1]}/v1/traces",
            otel_exporter="builtin",
        )
        _record(client)
        started = time.monotonic()
        with caplog.at_level(logging.WARNING, logger="wizardflow"):
            client.close_otel()
        assert time.monotonic() - started < 3.0  # about SHUTDOWN_TIMEOUT_S, whatever the endpoint does
        assert "not sent" in caplog.text
    finally:
        stalled.close()


def test_close_sends_what_is_still_queued():
    capture = _Capture()
    exporter = _exporter(capture, delay_s=60)  # would otherwise wait a minute
    recorder = LiveSpanRecorder(exporter)
    for name in ("a", "b", "c"):
        recorder.start_span(name).end()
    assert exporter.shutdown(timeout_s=2)
    assert capture.span_names() == ["a", "b", "c"] and exporter.sent == 3


def test_a_full_queue_drops_new_spans_and_says_so_once(caplog):
    release = threading.Event()
    capture = _Capture(block=release)
    exporter = _exporter(capture, max_queue=5, batch_spans=1, delay_s=0.01)
    recorder = LiveSpanRecorder(exporter)
    with caplog.at_level(logging.WARNING, logger="wizardflow"):
        for i in range(40):
            recorder.start_span(f"s{i}").end()
    assert exporter.dropped > 0
    assert caplog.text.count("dropping spans") == 1
    release.set()
    assert exporter.shutdown(timeout_s=3)
    assert exporter.sent + exporter.dropped == 40


def test_live_spans_end_at_the_time_they_end():
    capture = _Capture()
    exporter = _exporter(capture, delay_s=60)
    recorder = LiveSpanRecorder(exporter)
    span = recorder.start_span("work")
    time.sleep(0.02)
    span.add_event("tick")
    span.end()
    exporter.shutdown(timeout_s=2)
    sent = capture.requests[0]["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
    start, end = int(sent["startTimeUnixNano"]), int(sent["endTimeUnixNano"])
    assert end - start >= 15_000_000
    assert int(sent["events"][0]["timeUnixNano"]) > start


def test_builtin_and_sdk_record_the_same_spans(monkeypatch):
    """The same recording, through the OTel SDK and through the built-in
    sender: the same spans with the same attributes come out."""
    sdk_trace = pytest.importorskip("opentelemetry.sdk.trace")
    export = pytest.importorskip("opentelemetry.sdk.trace.export")
    memory = pytest.importorskip("opentelemetry.sdk.trace.export.in_memory_span_exporter")
    otel_trace = pytest.importorskip("opentelemetry.trace")

    in_memory = memory.InMemorySpanExporter()
    provider = sdk_trace.TracerProvider()
    provider.add_span_processor(export.SimpleSpanProcessor(in_memory))

    def sdk_bridge(endpoint=None, **kwargs):
        kwargs.pop("project_name", None)
        kwargs.pop("exporter", None)
        return otel.OTelBridge(provider.get_tracer("test"), trace_api=otel_trace, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr("wizardflow.client.create_otel_bridge", sdk_bridge)
        client = Client(nodes=["model", "reply"], jsonl=False, otel=True, otel_endpoint="http://x/v1/traces")
        _record(client)
        client.close_otel()
    sdk_spans = {s.name: dict(s.attributes) for s in in_memory.get_finished_spans()}

    capture = _Capture()
    monkeypatch.setattr("wizardflow.otlp_live.send_trace_requests", capture)
    client = Client(
        nodes=["model", "reply"], jsonl=False, otel=True,
        otel_endpoint="http://127.0.0.1:1/v1/traces", otel_exporter="builtin",
    )
    _record(client)
    client.close_otel()
    builtin_spans = {
        span.name: span.attributes for request in capture.requests for span in iter_spans(request)
    }
    assert set(builtin_spans) == set(sdk_spans)
    # Each recording makes its own random message id; everything else matches.
    random = {"wizardflow.message.id"}
    for name, attributes in sdk_spans.items():
        expected = {k: v for k, v in attributes.items() if k not in random}
        actual = {k: v for k, v in builtin_spans[name].items() if k not in random}
        assert actual == expected, name


def test_spans_still_queued_at_process_exit_are_sent(receiver, tmp_path):
    import subprocess
    import sys
    from pathlib import Path

    script = tmp_path / "app.py"
    script.write_text(
        "import sys\n"
        f"sys.path.insert(0, {str(Path(__file__).resolve().parents[1] / 'src')!r})\n"
        "import wizardflow\n"
        "wiz = wizardflow.init(name='exit-app', nodes=['model'], jsonl=False, otel=True,\n"
        f"    otel_endpoint={receiver.endpoint + '/v1/traces'!r}, otel_exporter='builtin')\n"
        "with wiz.workflow() as run:\n"
        "    with run.node('model', kind='llm') as node:\n"
        "        node.log_output('done')\n"
        "# no close_otel(): exiting must still send\n",
        encoding="utf-8",
    )
    subprocess.run([sys.executable, str(script)], check=True, timeout=30)
    assert ("model",) in _rows(receiver.db, "SELECT name FROM spans")
