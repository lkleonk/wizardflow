"""`wizardflow db …`, `wizardflow dashboard` and the /api routes over the OTel store."""

import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from wizardflow.store.schema import LATEST_VERSION

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
from wizardflow import serve as serve_module
from wizardflow.cli import _resolve_latest_trace, main
from wizardflow.file_import import is_otlp_file as _is_otlp_file
from wizardflow.serve import make_serve_handler
from wizardflow.store import import_otlp_text, open_store
from wizardflow.store.projection import list_conversations, project_conversation, project_trace
from wizardflow.store.queries import get_trace


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
    assert f"Schema: v{LATEST_VERSION}" in info and "advisor: 2 traces, 3 spans, 2 logs" in info

    assert main(["db", "migrate", "--db", str(db)]) == 0
    assert "up to date" in capsys.readouterr().out


def test_db_import_rejects_a_broken_wizardflow_trace(tmp_path, capsys):
    trace = tmp_path / "run.jsonl"
    trace.write_text('{"type": "header", "version": "0.2"}\n', encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        main(["db", "import", str(trace), "--db", str(tmp_path / "wf.db")])
    assert exc.value.code == 2
    assert "is not OTLP JSON or a WizardFlow trace" in capsys.readouterr().err


RUN_GRAPH = {"nodes": [{"id": "router"}, {"id": "answer"}], "edges": [{"source": "router", "target": "answer"}]}


def _message(message_id, minute):
    stamp = f"2026-10-11T10:{minute:02d}:00Z"
    later = f"2026-10-11T10:{minute:02d}:30Z"
    return {
        "id": message_id,
        "label": f"Question {message_id}",
        "steps": [
            {"id": f"{message_id}-s1", "nodeId": "router", "kind": "agent", "timestamp": stamp,
             "endTimestamp": later, "payloads": [{"label": "route", "value": "faq"}]},
            {"id": f"{message_id}-s2", "nodeId": "answer", "kind": "llm", "timestamp": later,
             "endTimestamp": later, "payloads": []},
        ],
    }


def _run(path, messages, *, name="advisor-run", meta=None, seal=None):
    records = [{"type": "header", "version": "0.2", "name": name, "graph": RUN_GRAPH, **({"meta": meta} if meta else {})}]
    records += [{"type": "message", **message} for message in messages]
    if seal:
        records.append({"type": "seal", "nextPart": seal})
    path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
    return path


def _imported(db, *files, project=None):
    args = ["db", "import", *map(str, files), "--db", str(db)]
    return main(args + (["--project", project] if project else []))


def _counts(db):
    con = open_store(db)
    try:
        return (
            con.execute("SELECT count(*) FROM traces").fetchone()[0],
            con.execute("SELECT count(*) FROM spans").fetchone()[0],
        )
    finally:
        con.close()


def test_db_import_takes_a_wizardflow_run_directly(tmp_path, capsys):
    db = tmp_path / "wf.db"
    run = _run(tmp_path / "run.jsonl", [_message("m1", 0), _message("m2", 5)])
    assert _imported(db, run) == 0
    assert "imported 6 spans (2 traces) and 0 logs into advisor-run" in capsys.readouterr().out

    con = open_store(db)
    first = con.execute("SELECT trace_id FROM traces ORDER BY start_ns").fetchone()[0]
    replay = project_trace(con, "advisor-run", first)
    con.close()
    assert replay["graph"] == RUN_GRAPH and replay["meta"]["graph"] == "recorded by WizardFlow"
    (message,) = replay["messages"]
    assert (message["id"], message["label"]) == ("m1", "Question m1")
    assert [step["nodeId"] for step in message["steps"]] == ["router", "answer"]


def test_db_import_of_the_same_run_is_a_no_op(tmp_path, capsys):
    db = tmp_path / "wf.db"
    run = _run(tmp_path / "run.jsonl", [_message("m1", 0)])
    assert _imported(db, run) == 0
    capsys.readouterr()
    assert _imported(db, run) == 0
    assert "already imported, skipped" in capsys.readouterr().out
    assert _counts(db) == (1, 3)


def test_db_import_of_a_grown_run_adds_only_what_is_new(tmp_path, capsys):
    db = tmp_path / "wf.db"
    path = tmp_path / "run.jsonl"
    assert _imported(db, _run(path, [_message("m1", 0)])) == 0
    capsys.readouterr()
    assert _imported(db, _run(path, [_message("m1", 0), _message("m2", 5)])) == 0
    out = capsys.readouterr().out
    assert "imported 3 spans" in out and "3 duplicate spans skipped" in out
    assert _counts(db) == (2, 6)


def test_db_import_keeps_different_runs_apart(tmp_path):
    db = tmp_path / "wf.db"
    # Same name and message id, recorded at another time.
    assert _imported(db, _run(tmp_path / "a.jsonl", [_message("m1", 0)])) == 0
    assert _imported(db, _run(tmp_path / "b.jsonl", [_message("m1", 9)])) == 0
    assert _counts(db) == (2, 6)


def test_db_import_of_a_run_reads_all_its_parts(tmp_path, capsys):
    db = tmp_path / "wf.db"
    first = _run(tmp_path / "run.jsonl", [_message("m1", 0)], seal="run.part2.jsonl")
    second = _run(tmp_path / "run.part2.jsonl", [_message("m2", 5)], meta={"part": 2, "prevPart": "run.jsonl"})
    assert _imported(db, second) == 0
    assert "imported 6 spans (2 traces)" in capsys.readouterr().out
    assert _imported(db, first) == 0
    assert "already imported, skipped" in capsys.readouterr().out
    assert _counts(db) == (2, 6)


def test_db_import_takes_the_single_document_form_and_a_project(tmp_path, capsys):
    db = tmp_path / "wf.db"
    doc = tmp_path / "run.json"
    doc.write_text(
        json.dumps({"version": "0.2", "name": "doc", "graph": RUN_GRAPH, "messages": [_message("m1", 0)]}),
        encoding="utf-8",
    )
    assert _imported(db, doc, project="mine") == 0
    assert "into mine" in capsys.readouterr().out


def test_db_import_groups_a_runs_executions_into_one_conversation(tmp_path):
    db = tmp_path / "wf.db"
    path = tmp_path / "run.jsonl"
    assert _imported(db, _run(path, [_message("m1", 0), _message("m2", 5)])) == 0
    conversation = "run 2026-10-11T10:00:00Z"

    con = open_store(db)
    assert [(c["conversationId"], c["executions"]) for c in list_conversations(con, "advisor-run")] == [
        (conversation, 2)
    ]
    replay = project_conversation(con, "advisor-run", conversation)
    assert [m["id"] for m in replay["messages"]] == ["m1", "m2"]
    assert replay["meta"]["graph"] == "recorded by WizardFlow"
    newest = con.execute("SELECT trace_id FROM traces ORDER BY start_ns DESC").fetchone()[0]
    assert get_trace(con, "advisor-run", newest)["conversation"]["position"] == 2
    con.close()

    # A grown run stays one conversation; another run gets its own.
    assert _imported(db, _run(path, [_message("m1", 0), _message("m2", 5), _message("m3", 9)])) == 0
    assert _imported(db, _run(tmp_path / "other.jsonl", [_message("m1", 30)])) == 0
    con = open_store(db)
    assert sorted((c["conversationId"], c["executions"]) for c in list_conversations(con, "advisor-run")) == [
        (conversation, 3),
        ("run 2026-10-11T10:30:00Z", 1),
    ]
    con.close()


def test_otel_export_does_not_invent_a_conversation(tmp_path):
    run = _run(tmp_path / "run.jsonl", [_message("m1", 0)])
    out = tmp_path / "run.otlp.jsonl"
    assert main(["otel", "export", str(run), "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert "session.id" not in text and "gen_ai.conversation.id" not in text


def test_otel_export_keeps_fresh_random_ids(tmp_path):
    run = _run(tmp_path / "run.jsonl", [_message("m1", 0)])
    a, b = tmp_path / "a.otlp.jsonl", tmp_path / "b.otlp.jsonl"
    assert main(["otel", "export", str(run), "--out", str(a)]) == 0
    assert main(["otel", "export", str(run), "--out", str(b)]) == 0
    ids = [json.loads(p.read_text(encoding="utf-8"))["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["traceId"] for p in (a, b)]
    assert ids[0] != ids[1]


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


def test_dashboard_imports_its_files_and_opens_on_their_project(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    source = _sample(tmp_path)
    calls = []
    monkeypatch.setattr(cli, "run_serve", lambda **kw: calls.append(kw) or 0)
    assert main(["dashboard", str(source), "--no-open"]) == 0
    (call,) = calls
    assert call["project"] == "advisor"
    assert (tmp_path / ".wizardflow" / "wizardflow.db").exists()
    assert (tmp_path / ".wizardflow" / ".gitignore").exists()
    assert "imported 3 spans" in capsys.readouterr().out


def test_dashboard_project_flag_names_the_project_it_opens(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    source = _sample(tmp_path)
    calls = []
    monkeypatch.setattr(cli, "run_serve", lambda **kw: calls.append(kw) or 0)
    assert main(["dashboard", str(source), "--project", "mine", "--no-open"]) == 0
    assert calls[0]["project"] == "mine"


def test_dashboard_on_a_missing_file_is_an_error(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(cli, "run_serve", lambda **kw: 0)
    with pytest.raises(SystemExit):
        main(["dashboard", str(tmp_path / "nope.jsonl"), "--no-open"])
    assert "file does not exist" in capsys.readouterr().err


@pytest.mark.parametrize("command", ["replay", "ui"])
def test_replay_on_an_otlp_file_points_at_the_dashboard(tmp_path, monkeypatch, capsys, command):
    monkeypatch.chdir(tmp_path)
    source = _sample(tmp_path)
    with pytest.raises(SystemExit):
        main([command, str(source), "--no-open"])
    err = capsys.readouterr().err
    assert "OpenTelemetry data" in err and f"wizardflow dashboard {source.name}" in err
    assert not (tmp_path / ".wizardflow").exists()


@pytest.mark.parametrize(
    "flags, expected",
    [
        ([], (4318, False)),
        (["--host", "localhost"], (4318, False)),
        (["--host", "::1"], (4318, False)),
        (["--otlp"], (4318, False)),
        (["--no-otlp"], (None, False)),
        (["--otlp-port", "5000"], (5000, True)),
        (["--otlp-port", "0"], (0, True)),
        # Reachable from the network: never without being asked.
        (["--host", "0.0.0.0"], (None, False)),
        (["--host", "192.168.1.5", "--otlp-port", "5000"], (None, False)),
        (["--host", "0.0.0.0", "--otlp"], (4318, False)),
    ],
)
@pytest.mark.parametrize("command", ["dashboard", "serve"])
def test_dashboard_runs_the_receiver_by_default_on_this_machine_only(
    monkeypatch, flags, expected, command
):
    calls = []
    monkeypatch.setattr(cli, "run_serve", lambda **kw: calls.append(kw) or 0)
    assert main([command, "--no-open", *flags]) == 0
    assert (calls[0]["otlp_port"], calls[0]["otlp_required"]) == expected


class _StoppedServer:
    server_port = 1

    def __init__(self, *_args):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def serve_forever(self):
        raise KeyboardInterrupt


def _serve_with_taken_port(tmp_path, monkeypatch, required):
    def taken(*_args, **_kwargs):
        raise serve_module.ReceiverPortError("cannot listen for OTLP on 127.0.0.1:4318")

    monkeypatch.setattr(serve_module, "start_receiver", taken)
    monkeypatch.setattr(serve_module, "ThreadingHTTPServer", _StoppedServer)
    return serve_module.run_serve(
        db_path=tmp_path / "wf.db",
        ui_dir=tmp_path,
        host="127.0.0.1",
        port=0,
        open_browser=False,
        version="t",
        otlp_port=4318,
        otlp_required=required,
    )


def test_a_taken_default_port_only_warns(tmp_path, monkeypatch, capsys):
    assert _serve_with_taken_port(tmp_path, monkeypatch, required=False) == 0
    captured = capsys.readouterr()
    assert "without live data" in captured.err and "cannot listen" in captured.err
    assert "WizardFlow dashboard:" in captured.out and "OTLP receiver:" not in captured.out


def test_a_taken_chosen_port_is_an_error(tmp_path, monkeypatch):
    with pytest.raises(serve_module.ReceiverPortError):
        _serve_with_taken_port(tmp_path, monkeypatch, required=True)


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
    assert api("/api/meta")["schemaVersion"] == LATEST_VERSION
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


def _send(api, method, path, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(api.base + path, data=data, method=method, headers={
        **({"Content-Type": "application/json"} if data is not None else {}), **(headers or {}),
    })
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def test_mapping_write_reindexes_and_reset_restores(api):
    status, body = _send(api, "PUT", "/api/settings/mapping",
                         {"project": "advisor", "mapping": {"node": ["gen_ai.operation.name"]}})
    assert status == 200
    assert body["reindexed"] == {"traces": 2, "replayable": 1}
    assert body["mapping"]["overrides"] == {"advisor": {"node": ["gen_ai.operation.name"]}}
    assert api("/api/settings/coverage?project=advisor")["node"]["matched"] == 1
    status, body = _send(api, "DELETE", "/api/settings/mapping?project=advisor")
    assert status == 200 and body["mapping"]["overrides"] == {}


def test_mapping_write_errors_and_foreign_origins(api):
    assert _send(api, "PUT", "/api/settings/mapping", {"mapping": {"nope": []}})[0] == 400
    assert _send(api, "PUT", "/api/settings/mapping", {"mapping": {"node": []}},
                 headers={"Origin": "https://evil.example"})[0] == 403
    assert _send(api, "PUT", "/api/settings/mapping", {"mapping": {"node": []}},
                 headers={"Host": "evil.example"})[0] == 403
    request = Request(api.base + "/api/settings/mapping", data=b"{}", method="PUT",
                      headers={"Content-Type": "text/plain"})
    with pytest.raises(HTTPError) as exc:
        urlopen(request, timeout=5)
    assert exc.value.code == 415


def test_trace_groups_and_conversation_filter(api):
    groups = api("/api/traces/groups?project=advisor")["items"]
    assert [g["conversationId"] for g in groups] == ["chat-1", None]
    members = api("/api/traces?project=advisor&conversation=chat-1")["items"]
    assert [t["traceId"] for t in members] == [TRACE_A]
    assert [t["traceId"] for t in api("/api/traces?project=advisor&noConversation=1")["items"]] == [TRACE_B]


def test_api_answers_unchanged_data_with_304(api):
    # The replay viewer revalidates its trace URL with If-None-Match.
    url = api.base + "/api/projects"
    with urlopen(url, timeout=5) as response:
        etag = response.headers["ETag"]
    assert etag
    with pytest.raises(HTTPError) as exc:
        urlopen(Request(url, headers={"If-None-Match": etag}), timeout=5)
    assert exc.value.code == 304


def test_a_foreign_host_header_is_refused(api):
    # DNS rebinding: another site's name pointing at 127.0.0.1.
    for path in ("/api/projects", "/otel"):
        request = Request(api.base + path, headers={"Host": "attacker.example:80"})
        with pytest.raises(HTTPError) as exc:
            urlopen(request, timeout=5)
        assert exc.value.code == 403
    assert api("/api/projects")[0]["name"] == "advisor"  # 127.0.0.1 itself still works


def test_a_negative_content_length_is_refused(api):
    status, body = _send(
        api, "PUT", "/api/settings/mapping",
        headers={"Content-Type": "application/json", "Content-Length": "-1"},
    )
    assert status == 400 and "Content-Length" in body["error"]


def test_db_import_of_a_grown_execution_extends_its_root(tmp_path, capsys):
    db = tmp_path / "wf.db"
    path = tmp_path / "run.jsonl"
    short = _message("m1", 0)
    short["steps"] = short["steps"][:1]  # still running: one node so far
    _imported(db, _run(path, [short]))
    grown = _message("m1", 0)
    grown["steps"][1]["endTimestamp"] = "2026-10-11T10:00:45Z"  # past the old root's end
    _imported(db, _run(path, [grown]))
    assert "1 grown span updated" in capsys.readouterr().out
    con = open_store(db)
    try:
        outliving = con.execute(
            "SELECT count(*) FROM spans c JOIN spans p ON p.span_id = c.parent_span_id "
            "AND p.trace_id = c.trace_id WHERE c.end_ns > p.end_ns"
        ).fetchone()[0]
    finally:
        con.close()
    assert outliving == 0


# ------------------------------------------------------------- Import a run (UI)


def test_import_endpoint_takes_a_run_and_knows_it_on_a_second_send(api, tmp_path):
    run = _run(tmp_path / "run.jsonl", [_message("m1", 1), _message("m2", 2)])
    body = {"name": "run.jsonl", "text": run.read_text(encoding="utf-8")}
    status, first = _send(api, "POST", "/api/import", body)
    assert status == 200
    assert first["alreadyImported"] is False
    assert first["projects"] == ["advisor-run"] and first["spans"] > 0
    status, again = _send(api, "POST", "/api/import", body)
    assert status == 200
    assert again["alreadyImported"] is True and again["projects"] == ["advisor-run"]


def test_a_run_imported_from_the_ui_is_known_to_db_import(api, tmp_path, capsys):
    run = _run(tmp_path / "run.jsonl", [_message("m1", 1)])
    # The bytes as on disk, as a browser sends them (read_text would turn
    # Windows line endings into LF and change the hash).
    _send(api, "POST", "/api/import", {"name": "run.jsonl", "text": run.read_bytes().decode("utf-8")})
    assert _imported(tmp_path / "wf.db", run) == 0
    assert "already imported" in capsys.readouterr().out


def test_import_endpoint_takes_otlp_json(api, tmp_path):
    text = lines(logs_request([log_record("uploaded", ts=1_760_000_002_000_000_000)], service="uploader"))
    status, body = _send(api, "POST", "/api/import", {"name": "logs.otlp.jsonl", "text": text})
    assert status == 200 and body["logs"] == 1 and body["projects"] == ["uploader"]


def test_import_endpoint_refuses_other_files_and_foreign_origins(api):
    status, body = _send(api, "POST", "/api/import", {"name": "notes.json", "text": '{"hello": 1}'})
    assert status == 400 and "not OTLP JSON or a WizardFlow run" in body["error"]
    assert _send(api, "POST", "/api/import", {"name": "x"})[0] == 400
    status, _ = _send(api, "POST", "/api/import", {"name": "x", "text": "{}"},
                      headers={"Origin": "https://evil.example"})
    assert status == 403


def test_import_endpoint_refuses_a_later_part_of_a_rotated_run(api, tmp_path):
    part2 = _run(tmp_path / "run.part2.jsonl", [_message("m2", 2)],
                 meta={"part": 2, "prevPart": "run.jsonl"})
    status, body = _send(api, "POST", "/api/import",
                         {"name": "run.part2.jsonl", "text": part2.read_bytes().decode("utf-8")})
    assert status == 400
    assert "later part of a rotated run" in body["error"] and "db import" in body["error"]


@pytest.mark.parametrize("text", [
    json.dumps({"graph": {"nodes": [], "edges": []}, "messages": [5]}),
    json.dumps({"resourceSpans": "x"}),
    "\ud800",
])
def test_import_endpoint_answers_malformed_files_with_a_400_naming_them(api, text):
    status, body = _send(api, "POST", "/api/import", {"name": "broken.jsonl", "text": text})
    assert status == 400
    assert body["error"].startswith("broken.jsonl") and "Temp" not in body["error"]


def test_writes_need_a_loopback_client():
    from wizardflow.serve import _is_loopback_client

    assert _is_loopback_client("127.0.0.1") and _is_loopback_client("::1")
    assert _is_loopback_client("::ffff:127.0.0.1")
    assert not _is_loopback_client("192.168.1.20") and not _is_loopback_client("::ffff:10.0.0.2")
    assert not _is_loopback_client("not-an-ip")


def test_projects_list_where_their_data_came_from(api, tmp_path):
    run = _run(tmp_path / "run.jsonl", [_message("m1", 1)])
    _send(api, "POST", "/api/import", {"name": "run.jsonl", "text": run.read_bytes().decode("utf-8")})
    projects = {p["name"]: p for p in api("/api/projects")}
    assert projects["advisor-run"]["sources"] == [{"kind": "upload", "name": "run.jsonl", "path": None}]
    # The fixture's file was imported through the importer with no path.
    assert projects["advisor"]["sources"] == []


def test_a_cli_import_is_listed_as_a_file_with_its_path(api, tmp_path):
    run = _run(tmp_path / "other.jsonl", [_message("m9", 9)], name="other-run")
    assert _imported(tmp_path / "wf.db", run) == 0
    sources = {p["name"]: p for p in api("/api/projects")}["other-run"]["sources"]
    assert sources == [{"kind": "file", "name": "other.jsonl", "path": str(run.resolve())}]
