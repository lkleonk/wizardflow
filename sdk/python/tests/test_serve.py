"""`wizardflow db …`, `wizardflow serve` and the /api routes over the OTel store."""

import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from otlp_builders import (
    TRACE_A,
    TRACE_B,
    lines,
    log_record,
    logs_request,
    span,
    traces_request,
)
from wizardflow import cli
from wizardflow.cli import _is_otlp_file, _resolve_latest_trace, main
from wizardflow.serve import make_serve_handler
from wizardflow.store import import_otlp_text, open_store


def _write(path, *requests):
    path.write_text(lines(*requests), encoding="utf-8")
    return path


def _sample(tmp_path):
    return _write(
        tmp_path / "run.otlp.jsonl",
        traces_request(
            [
                span("1" * 16, name="invoke_workflow advisor", start=1_760_000_000_000_000_000,
                     end=1_760_000_000_900_000_000,
                     attributes={"gen_ai.operation.name": "invoke_workflow", "session.id": "chat-1"}),
                span("2" * 16, parent="1" * 16, start=1_760_000_000_100_000_000,
                     end=1_760_000_000_400_000_000,
                     attributes={"wizardflow.node.id": "classifier"},
                     events=[(1_760_000_000_150_000_000, "exception", {"exception.type": "E"})]),
            ],
            service="advisor",
        ),
        traces_request([span("3" * 16, trace_id=TRACE_B, name="POST /checkout",
                             start=1_759_000_000_000_000_000, end=1_759_000_000_100_000_000)],
                       service="advisor"),
        logs_request([
            log_record("hello", ts=1_760_000_000_200_000_000, trace_id=TRACE_A, span_id="2" * 16),
            log_record("scheduler tick", ts=1_760_000_001_000_000_000, severity=5),
        ], service="advisor"),
    )


# --------------------------------------------------------------------------- CLI


def test_db_import_info_and_migrate(tmp_path, capsys):
    db = tmp_path / "data" / "wf.db"
    source = _sample(tmp_path)
    assert main(["db", "import", str(source), "--db", str(db)]) == 0
    out = capsys.readouterr().out
    assert "imported 3 spans (2 traces) and 2 logs into advisor" in out

    assert main(["db", "import", str(source), "--db", str(db)]) == 0
    assert "already imported, skipped" in capsys.readouterr().out

    assert main(["db", "info", "--db", str(db)]) == 0
    info = capsys.readouterr().out
    assert "Schema: v1" in info and "advisor: 2 traces, 3 spans, 2 logs" in info

    assert main(["db", "migrate", "--db", str(db)]) == 0
    assert "up to date" in capsys.readouterr().out


def test_db_import_rejects_a_wizardflow_trace(tmp_path, capsys):
    trace = tmp_path / "run.jsonl"
    trace.write_text('{"type": "header", "version": "0.2"}\n', encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        main(["db", "import", str(trace), "--db", str(tmp_path / "wf.db")])
    assert exc.value.code == 2
    assert "is not OTLP JSON" in capsys.readouterr().err


def test_db_info_on_missing_database_is_an_error(tmp_path, capsys):
    with pytest.raises(SystemExit):
        main(["db", "info", "--db", str(tmp_path / "missing.db")])
    assert "no WizardFlow database" in capsys.readouterr().err


def test_otlp_files_are_recognized_and_skipped_by_the_newest_default(tmp_path):
    trace = tmp_path / "run.jsonl"
    trace.write_text('{"type": "header", "version": "0.2"}\n', encoding="utf-8")
    otlp = _sample(tmp_path)  # written last, so the newest file
    pretty = tmp_path / "pretty.json"
    pretty.write_text(json.dumps(traces_request([span("4" * 16)]), indent=2), encoding="utf-8")
    assert _is_otlp_file(otlp) and _is_otlp_file(pretty) and not _is_otlp_file(trace)
    assert _resolve_latest_trace(str(tmp_path)) == trace


def test_ui_on_an_otlp_file_imports_and_opens_the_dashboard(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    source = _sample(tmp_path)
    calls = []
    monkeypatch.setattr(cli, "run_serve", lambda **kw: calls.append(kw) or 0)
    assert main(["ui", str(source), "--no-open"]) == 0
    (call,) = calls
    assert call["project"] == "advisor"
    assert (tmp_path / ".wizardflow" / "wizardflow.db").exists()
    assert (tmp_path / ".wizardflow" / ".gitignore").exists()
    assert "imported 3 spans" in capsys.readouterr().out


# --------------------------------------------------------------------------- API


@pytest.fixture
def api(tmp_path):
    db = tmp_path / "wf.db"
    con = open_store(db)
    import_otlp_text(con, _sample(tmp_path).read_text(encoding="utf-8"))
    con.close()
    ui_dir = tmp_path / "ui"
    ui_dir.mkdir()
    (ui_dir / "index.html").write_text("viewer", encoding="utf-8")
    (ui_dir / "otel.html").write_text("dashboard", encoding="utf-8")

    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), make_serve_handler(ui_dir=ui_dir, db_path=db, version="test")
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"

    def get(path):
        with urlopen(base + path, timeout=5) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if path.startswith("/api/") else body

    get.base = base
    yield get
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def _status(get, path):
    with pytest.raises(HTTPError) as exc:
        get(path)
    return exc.value.code, json.loads(exc.value.read().decode("utf-8"))["error"]


def test_static_routes_serve_viewer_and_clean_dashboard_url(api):
    assert api("/") == "viewer"
    assert api("/otel") == "dashboard"
    assert api("/otel?project=advisor") == "dashboard"


def test_meta_and_projects(api):
    assert api("/api/meta")["schemaVersion"] == 1
    (project,) = api("/api/projects")
    assert project["name"] == "advisor"
    assert (project["traceCount"], project["spanCount"], project["logCount"]) == (2, 3, 2)
    assert project["errorTraceCount"] == 0
    assert project["lastSeenNs"] == "1760000001000000000"
    assert project["services"] == ["advisor"]


def test_trace_list_is_newest_first_with_string_ns_and_paging(api):
    page = api("/api/traces?project=advisor&limit=1")
    (first,) = page["items"]
    assert first["traceId"] == TRACE_A
    assert first["startNs"] == "1760000000000000000"  # string: exceeds JS 2^53
    assert first["durationNs"] == "900000000"
    assert first["conversationId"] == "chat-1"
    assert page["nextCursor"]
    (second,) = api(f"/api/traces?project=advisor&limit=1&cursor={page['nextCursor']}")["items"]
    assert second["traceId"] == TRACE_B


def test_trace_list_filters(api):
    assert [t["traceId"] for t in api("/api/traces?project=advisor&kind=wizardflow")["items"]] == [TRACE_A]
    assert [t["traceId"] for t in api("/api/traces?project=advisor&kind=otel")["items"]] == [TRACE_B]
    assert [t["traceId"] for t in api("/api/traces?project=advisor&q=checkout")["items"]] == [TRACE_B]
    assert api("/api/traces?project=advisor&q=100%25")["items"] == []  # LIKE wildcards are escaped


def test_trace_detail(api):
    detail = api(f"/api/traces/{TRACE_A}?project=advisor")
    assert detail["trace"]["rootSpanId"] == "1" * 16
    root, child = detail["spans"]
    assert child["parentSpanId"] == root["spanId"]
    assert child["nodeId"] == "classifier"
    assert child["events"][0]["name"] == "exception"
    assert child["events"][0]["timeNs"] == "1760000000150000000"
    assert root["attributes"]["session.id"] == "chat-1"
    assert [log["bodyText"] for log in detail["logs"]] == ["hello"]
    assert detail["otherSlices"] == []
    resource = detail["resources"][str(root["resourceId"])]
    assert resource["serviceName"] == "advisor"


def test_logs_with_correlation_and_severity(api):
    everything = api("/api/logs?project=advisor")["items"]
    assert [log["bodyText"] for log in everything] == ["scheduler tick", "hello"]
    without = api("/api/logs?project=advisor&correlation=without")["items"]
    assert [log["bodyText"] for log in without] == ["scheduler tick"]
    assert [log["bodyText"] for log in api("/api/logs?project=advisor&minSeverity=9")["items"]] == ["hello"]


def test_settings_lists_the_default_mapping(api):
    settings = api("/api/settings")
    assert settings["mapping"]["defaults"]["conversation"] == ["gen_ai.conversation.id", "session.id"]
    assert settings["mapping"]["overrides"] == {}


def test_api_errors(api):
    assert _status(api, "/api/traces?project=nope")[0] == 404
    assert _status(api, "/api/traces")[0] == 400
    assert _status(api, "/api/traces?project=advisor&kind=weird")[0] == 400
    assert _status(api, "/api/traces?project=advisor&cursor=bad")[0] == 400
    assert _status(api, f"/api/traces/{'c' * 32}?project=advisor")[0] == 404
    assert _status(api, "/api/nothing")[0] == 404



def test_cors_only_for_local_origins(api):
    def allowed(origin):
        request = Request(api.base + "/api/meta", headers={"Origin": origin})
        with urlopen(request, timeout=5) as response:
            return response.headers.get("Access-Control-Allow-Origin")

    assert allowed("http://localhost:3000") == "http://localhost:3000"
    assert allowed("http://127.0.0.1:3000") == "http://127.0.0.1:3000"
    assert allowed("https://evil.example") is None


def test_api_answers_unchanged_data_with_304(api):
    # The replay viewer revalidates its trace URL with If-None-Match.
    url = api.base + "/api/projects"
    with urlopen(url, timeout=5) as response:
        etag = response.headers["ETag"]
    assert etag
    with pytest.raises(HTTPError) as exc:
        urlopen(Request(url, headers={"If-None-Match": etag}), timeout=5)
    assert exc.value.code == 304
