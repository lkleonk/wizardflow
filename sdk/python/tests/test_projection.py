"""Replay projection: stored OTel spans → AgentTraceFile for the existing viewer."""

import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

from otlp_builders import lines, span, traces_request
from wizardflow.otel_file_exporter import ExportOptions, export_trace_chain
from wizardflow.reader import TraceChain
from wizardflow.serve import make_serve_handler
from wizardflow.store import import_otlp_file, import_otlp_text, open_store
from wizardflow.store.projection import list_conversations, project_conversation, project_trace
from wizardflow.store.queries import QueryError, get_trace

GRAPH = {
    "nodes": [{"id": "classifier"}, {"id": "search"}, {"id": "retriever"}, {"id": "advisor"}],
    "edges": [
        {"source": "classifier", "target": "search", "conditional": True},
        {"source": "classifier", "target": "retriever"},
        {"source": "retriever", "target": "advisor"},
    ],
}

TRACE = {
    "name": "student-advisor",
    "graph": GRAPH,
    "messages": [
        {
            "id": "m1",
            "label": "Can I switch majors?",
            "meta": {"outcome": "answered", "latencyMs": 4200},
            "steps": [
                {"id": "m1-s1", "nodeId": "classifier", "kind": "agent",
                 "timestamp": "2026-10-11T10:00:00Z", "endTimestamp": "2026-10-11T10:00:01.250000Z",
                 "payloads": [
                     {"label": "route", "value": "planning"},
                     {"label": "confidence", "value": 0.91},
                 ]},
                {"id": "m1-s2", "nodeId": "search", "kind": "tool",
                 "timestamp": "2026-10-11T10:00:01.250000Z", "endTimestamp": "2026-10-11T10:00:02Z",
                 "payloads": [
                     {"label": "args", "value": {"q": "major switch"}, "semanticType": "input"},
                     {"label": "result", "value": {"hits": 3}, "semanticType": "output"},
                 ]},
                {"id": "m1-s3", "nodeId": "retriever", "kind": "retriever",
                 "timestamp": "2026-10-11T10:00:02Z", "endTimestamp": "2026-10-11T10:00:02.500000Z",
                 "payloads": [
                     {"label": "query", "value": "switching majors", "semanticType": "input"},
                     {"label": "docs", "value": [{"id": "reg-7"}], "semanticType": "output"},
                 ]},
                {"id": "m1-s4", "nodeId": "advisor", "kind": "llm",
                 "timestamp": "2026-10-11T10:00:02.500000Z", "endTimestamp": "2026-10-11T10:00:04Z",
                 "payloads": [
                     {"label": "prompt", "value": "Answer kindly.", "semanticType": "input"},
                     {"label": "answer", "value": "Yes, after semester 2.", "semanticType": "output"},
                     {"label": "params", "value": {"model": "m-1", "temperature": 0.2},
                      "semanticType": "model_parameters"},
                     {"label": "usage", "value": {"inputTokens": 120, "outputTokens": 30},
                      "semanticType": "usage"},
                 ]},
            ],
        },
        {
            "id": "m2",
            "label": "And the thesis?",
            "steps": [
                {"id": "m2-s1", "nodeId": "classifier", "kind": "agent",
                 "timestamp": "2026-10-11T10:05:00Z", "endTimestamp": "2026-10-11T10:05:01Z",
                 "payloads": []},
            ],
        },
    ],
}


def _store_from_export(tmp_path, **options):
    out = tmp_path / "run.otlp.jsonl"
    export_trace_chain(
        TraceChain(TRACE, (tmp_path / "run.jsonl",), True),
        ExportOptions(out=out, export_graph=True, **options),
    )
    con = open_store(tmp_path / "wf.db")
    import_otlp_file(con, out)
    return con


def _trace_ids(con):
    return [t for (t,) in con.execute("SELECT trace_id FROM traces ORDER BY start_ns")]


def _payload(step, label):
    return next(p for p in step["payloads"] if p["label"] == label)


def test_round_trip_restores_messages_steps_payloads_and_graph(tmp_path):
    con = _store_from_export(tmp_path)
    first, second = _trace_ids(con)
    replay = project_trace(con, "student-advisor", first)

    assert replay["version"] == "0.2" and replay["name"] == "student-advisor"
    assert replay["graph"] == GRAPH
    assert replay["meta"]["graph"] == "recorded by WizardFlow"
    (message,) = replay["messages"]
    original = TRACE["messages"][0]
    assert message["id"] == "m1"
    assert message["label"] == original["label"]
    assert message["meta"] == original["meta"]
    assert [(s["nodeId"], s.get("kind"), s["timestamp"], s["endTimestamp"]) for s in message["steps"]] == [
        (s["nodeId"], s["kind"], s["timestamp"].replace(".000000", ""),
         s["endTimestamp"].replace(".000000", "")) for s in original["steps"]
    ]
    classifier, search, retriever, advisor = message["steps"]
    assert classifier["id"] == "m1-s1"
    assert _payload(classifier, "route")["value"] == "planning"
    assert _payload(classifier, "confidence")["value"] == 0.91
    assert _payload(search, "input")["value"] == {"q": "major switch"}
    assert _payload(search, "output")["value"] == {"hits": 3}
    assert _payload(retriever, "input")["value"] == "switching majors"
    assert _payload(retriever, "output")["value"] == [{"id": "reg-7"}]
    assert _payload(advisor, "input") == {"label": "input", "value": "Answer kindly.", "semanticType": "input"}
    assert _payload(advisor, "output")["value"] == "Yes, after semester 2."
    assert _payload(advisor, "model parameters")["value"] == {"model": "m-1", "temperature": 0.2}
    assert _payload(advisor, "usage")["value"] == {"inputTokens": 120, "outputTokens": 30}

    (message2,) = project_trace(con, "student-advisor", second)["messages"]
    assert (message2["id"], message2["label"]) == ("m2", "And the thesis?")
    con.close()


def _store_with_run_meta(tmp_path, meta, **options):
    out = tmp_path / "run.otlp.jsonl"
    export_trace_chain(
        TraceChain({**TRACE, "meta": meta}, (tmp_path / "run.jsonl",), True),
        ExportOptions(out=out, **options),
    )
    con = open_store(tmp_path / "wf.db")
    import_otlp_file(con, out)
    return con


def _root_attributes(con, trace_id):
    detail = get_trace(con, "student-advisor", trace_id)
    root = next(s for s in detail["spans"] if s["parentSpanId"] is None)
    return root["attributes"]


def test_run_description_and_meta_reach_every_root_and_the_replay(tmp_path):
    meta = {"description": "Nightly eval", "team": "advising", "project": "not-the-store-one"}
    con = _store_with_run_meta(tmp_path, meta)
    first, second = _trace_ids(con)
    for trace_id in (first, second):
        attrs = _root_attributes(con, trace_id)
        assert json.loads(attrs["wizardflow.trace.metadata"]) == meta

    replayed = project_trace(con, "student-advisor", first)["meta"]
    assert replayed["description"] == "Nightly eval"
    assert replayed["team"] == "advising"
    assert replayed["project"] == "student-advisor"  # the viewer's own keys win
    con.close()


def test_run_meta_follows_the_content_switch(tmp_path):
    con = _store_with_run_meta(tmp_path, {"description": "secret"}, include_content=False)
    first = _trace_ids(con)[0]
    assert "wizardflow.trace.metadata" not in _root_attributes(con, first)
    assert "description" not in project_trace(con, "student-advisor", first)["meta"]
    con.close()


def test_recording_scope_splits_one_trace_into_messages(tmp_path):
    con = _store_from_export(tmp_path, trace_scope="recording")
    (trace_id,) = _trace_ids(con)
    replay = project_trace(con, "student-advisor", trace_id)
    assert [m["id"] for m in replay["messages"]] == ["m1", "m2"]
    assert [len(m["steps"]) for m in replay["messages"]] == [4, 1]
    con.close()


def _conversation_store(tmp_path):
    con = open_store(tmp_path / "wf.db")
    turn = lambda trace_id, n, start, conv: traces_request(  # noqa: E731
        [
            span(f"{n}0" * 8, trace_id=trace_id, name="invoke_workflow", start=start, end=start + 50,
                 attributes={"session.id": conv}),
            span(f"{n}1" * 8, trace_id=trace_id, parent=f"{n}0" * 8, start=start + 1, end=start + 20,
                 attributes={"wizardflow.node.id": "router"}),
            span(f"{n}2" * 8, trace_id=trace_id, parent=f"{n}0" * 8, start=start + 21, end=start + 49,
                 attributes={"wizardflow.node.id": "answer", "openinference.span.kind": "LLM"}),
        ],
        service="bot",
    )
    import_otlp_text(con, lines(
        turn("1" * 32, 1, 1_000, "chat-1"),
        turn("2" * 32, 2, 5_000, "chat-1"),
        turn("3" * 32, 3, 9_000, "chat-2"),
    ))
    return con


def test_an_execution_with_any_failed_span_is_flagged(tmp_path):
    con = open_store(tmp_path / "wf.db")
    turn = lambda trace_id, n, start, status: traces_request(  # noqa: E731
        [
            span(f"{n}0" * 8, trace_id=trace_id, name="invoke_workflow", start=start, end=start + 50,
                 attributes={"session.id": "chat-1"}),
            span(f"{n}1" * 8, trace_id=trace_id, parent=f"{n}0" * 8, start=start + 1, end=start + 20,
                 attributes={"wizardflow.node.id": "router"}),
            # Not a node: the failure still belongs to this execution.
            span(f"{n}2" * 8, trace_id=trace_id, parent=f"{n}1" * 8, name="http call",
                 start=start + 2, end=start + 10, status=status),
        ],
        service="bot",
    )
    import_otlp_text(con, lines(turn("1" * 32, 1, 1_000, 1), turn("2" * 32, 2, 5_000, 2)))
    replay = project_conversation(con, "bot", "chat-1")
    assert [m.get("otelError") for m in replay["messages"]] == [None, True]
    con.close()


def test_conversation_replays_its_executions_as_messages_with_inferred_graph(tmp_path):
    con = _conversation_store(tmp_path)
    assert [(c["conversationId"], c["executions"]) for c in list_conversations(con, "bot")] == [
        ("chat-2", 1), ("chat-1", 2)
    ]
    replay = project_conversation(con, "bot", "chat-1")
    assert replay["meta"]["conversationId"] == "chat-1"
    assert replay["meta"]["graph"] == "inferred from run order"
    assert [m["id"] for m in replay["messages"]] == ["1" * 32, "2" * 32]
    # no wizardflow.graph event: nodes in order of first run, edges from step order
    assert replay["graph"] == {
        "nodes": [{"id": "router"}, {"id": "answer"}],
        "edges": [{"source": "router", "target": "answer"}],
    }
    assert replay["messages"][0]["steps"][1]["kind"] == "llm"  # OpenInference LLM → llm
    assert replay["messages"][0]["label"] == "invoke_workflow"
    con.close()


def test_messages_and_steps_link_back_to_their_trace_and_span(tmp_path):
    con = _conversation_store(tmp_path)
    first, second = project_conversation(con, "bot", "chat-1")["messages"]
    assert (first["otelTraceId"], second["otelTraceId"]) == ("1" * 32, "2" * 32)
    assert [s["otelSpanId"] for s in second["steps"]] == ["21" * 8, "22" * 8]
    con.close()


def test_one_trace_with_several_executions_links_each_step_to_its_span(tmp_path):
    con = _store_from_export(tmp_path, trace_scope="recording")
    (trace_id,) = _trace_ids(con)
    messages = project_trace(con, "student-advisor", trace_id)["messages"]
    assert {m["otelTraceId"] for m in messages} == {trace_id}
    span_ids = [s["otelSpanId"] for m in messages for s in m["steps"]]
    assert len(span_ids) == len(set(span_ids)) == 5
    con.close()


def test_conversation_position_counts_what_the_replay_shows(tmp_path):
    con = _conversation_store(tmp_path)
    plain = "4" * 32
    import_otlp_text(con, lines(traces_request(
        [span("41" * 8, trace_id=plain, name="GET /health", start=3_000, end=3_010,
              attributes={"session.id": "chat-1"})],
        service="bot",
    )))
    assert get_trace(con, "bot", "1" * 32)["conversation"] == {
        "position": 1, "total": 2, "prevTraceId": None, "nextTraceId": "2" * 32,
    }
    assert get_trace(con, "bot", "2" * 32)["conversation"] == {
        "position": 2, "total": 2, "prevTraceId": "1" * 32, "nextTraceId": None,
    }
    # A trace the replay can't show still steps through its whole conversation.
    assert get_trace(con, "bot", plain)["conversation"] == {
        "position": 2, "total": 3, "prevTraceId": "1" * 32, "nextTraceId": "2" * 32,
    }
    assert get_trace(con, "bot", "3" * 32)["conversation"]["total"] == 1
    con.close()


def test_trace_without_a_conversation_has_no_position(tmp_path):
    con = open_store(tmp_path / "wf.db")
    trace_id = "5" * 32
    import_otlp_text(con, lines(traces_request([span("51" * 8, trace_id=trace_id, name="run")], service="bot")))
    assert get_trace(con, "bot", trace_id)["conversation"] is None
    con.close()


def test_traces_without_nodes_are_not_replayable(tmp_path):
    con = open_store(tmp_path / "wf.db")
    import_otlp_text(con, lines(traces_request([span("1" * 16, name="GET /health")])))
    with pytest.raises(QueryError, match="no graph nodes"):
        project_trace(con, "svc", "a" * 32)
    con.close()


def test_replay_routes(tmp_path):
    con = _conversation_store(tmp_path)
    con.close()
    ui = tmp_path / "ui"
    ui.mkdir()
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), make_serve_handler(ui_dir=ui, db_path=tmp_path / "wf.db", version="t")
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}/api"
    get = lambda path: json.loads(urlopen(base + path, timeout=5).read())  # noqa: E731
    try:
        assert len(get("/conversations?project=bot")) == 2
        assert len(get("/conversations/chat-1/agenttrace?project=bot")["messages"]) == 2
        assert get(f"/traces/{'3' * 32}/agenttrace?project=bot")["messages"][0]["steps"][0]["nodeId"] == "router"
        with pytest.raises(HTTPError) as exc:
            get("/conversations/nope/agenttrace?project=bot")
        assert exc.value.code == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_executions_are_ordered_by_start_even_on_a_whole_second(tmp_path):
    # ISO text sorts "…:10Z" after "…:10.5Z"; the replay must not.
    second = 1_791_712_810_000_000_000
    con = open_store(tmp_path / "wf.db")
    turn = lambda trace_id, n, start: traces_request(  # noqa: E731
        [
            span(f"{n}0" * 8, trace_id=trace_id, name="invoke_workflow", start=start, end=start + 10,
                 attributes={"session.id": "chat"}),
            span(f"{n}1" * 8, trace_id=trace_id, parent=f"{n}0" * 8, start=start, end=start + 10,
                 attributes={"wizardflow.node.id": "router"}),
        ],
        service="bot",
    )
    import_otlp_text(con, lines(turn("2" * 32, 2, second + 500_000_000), turn("1" * 32, 1, second)))
    replay = project_conversation(con, "bot", "chat")
    assert [m["id"] for m in replay["messages"]] == ["1" * 32, "2" * 32]
    con.close()
