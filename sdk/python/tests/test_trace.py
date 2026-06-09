"""Tests for the WizardFlow SDK — pins the emitted AgentTrace shape and the
recording semantics we agreed on (folding, completed-only, id targeting, etc.).
"""

import json
import os

import pytest

from wizardflow import (
    Client,
    LangGraphExtractionError,
    UnknownNodeError,
    WizardFlowError,
)


# --- fakes mimicking langchain_core's drawable graph (no langgraph needed) ---

class _FakeEdge:
    def __init__(self, source, target, conditional=False):
        self.source = source
        self.target = target
        self.conditional = conditional


class _FakeGraph:
    def __init__(self, nodes, edges):
        self.nodes = nodes  # dict[id, Node] in the real thing
        self.edges = edges


class _FakeApp:
    """Stands in for a compiled LangGraph app exposing get_graph()."""

    def __init__(self, nodes, edges):
        self._graph = _FakeGraph(nodes, edges)

    def get_graph(self):
        return self._graph


def _new(tmp_path, **kw):
    return Client(path=str(tmp_path / "trace.json"), **kw)


# --- output shape ---------------------------------------------------------

def test_emits_schema_0_1_with_graph_and_meta(tmp_path):
    c = _new(tmp_path, name="run.json", description="hi",
             nodes=["a"], edges=[("a", "a")])
    with c.message(id="m1"):
        c.log("a", "Input", "x")
    out = c.to_dict()

    assert out["version"] == "0.1"
    assert out["name"] == "run.json"
    assert out["meta"] == {"description": "hi"}          # description -> meta
    assert out["graph"]["nodes"] == [{"id": "a"}]
    assert out["graph"]["edges"] == [{"source": "a", "target": "a"}]


def test_step_ids_and_timestamp_present(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    with c.message(id="m1"):
        c.log("a", "L", 1)
    step = c.to_dict()["messages"][0]["steps"][0]
    assert step["id"] == "m1-s1"
    assert step["nodeId"] == "a"
    assert isinstance(step["timestamp"], str) and step["timestamp"].endswith("Z")


# --- folding & visits -----------------------------------------------------

def test_same_node_logs_fold_into_one_step(tmp_path):
    c = _new(tmp_path, nodes=["router"])
    with c.message(id="m1"):
        c.log("router", "llm_input", "p")
        c.log("router", "llm_output", "o")
    steps = c.to_dict()["messages"][0]["steps"]
    assert len(steps) == 1
    assert [p["label"] for p in steps[0]["payloads"]] == ["llm_input", "llm_output"]


def test_different_node_starts_new_step(tmp_path):
    c = _new(tmp_path, nodes=["a", "b"])
    with c.message(id="m1"):
        c.log("a", "L", 1)
        c.log("b", "L", 2)
    assert [s["nodeId"] for s in c.to_dict()["messages"][0]["steps"]] == ["a", "b"]


def test_bare_log_is_a_visit_with_no_payloads(tmp_path):
    c = _new(tmp_path, nodes=["tool"])
    with c.message(id="m1"):
        c.log("tool")
    step = c.to_dict()["messages"][0]["steps"][0]
    assert step["nodeId"] == "tool" and step["payloads"] == []


# --- message targeting ----------------------------------------------------

def test_explicit_id_targets_message_without_with_block(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("a", "L", 1, id="m2")
    c.end_message("m2")
    assert [m["id"] for m in c.to_dict()["messages"]] == ["m2"]


def test_log_without_active_message_or_id_raises(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    with pytest.raises(WizardFlowError):
        c.log("a", "L", 1)


# --- completed-only persistence ------------------------------------------

def test_only_completed_messages_are_emitted(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("a", "L", 1, id="open")          # never ended
    with c.message(id="done"):
        c.log("a", "L", 2)
    assert [m["id"] for m in c.to_dict()["messages"]] == ["done"]


def test_end_message_writes_file_atomically(tmp_path):
    c = Client(path=str(tmp_path / "trace.json"), nodes=["a"])
    with c.message(id="m1"):
        c.log("a", "L", 1)
    written = c.current_path                        # timestamped part filename
    assert os.path.exists(written)
    assert not os.path.exists(written + ".tmp")     # tmp cleaned up
    on_disk = json.loads(open(written, encoding="utf-8").read())
    assert on_disk["messages"][0]["id"] == "m1"


def test_part_naming_uses_prefix_timestamp_index(tmp_path):
    c = Client(path=str(tmp_path / "myrun.json"), nodes=["a"])
    name = os.path.basename(c.current_path)
    assert name.startswith("myrun_") and name.endswith("_001.json")


def test_default_prefix_when_path_omitted(tmp_path):
    c = Client(nodes=["a"])                          # no path
    assert os.path.basename(c.current_path).startswith("wizardflow_")


def test_end_message_is_idempotent(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    with c.message(id="m1"):          # ends once on exit
        c.log("a", "L", 1)
    c.end_message("m1")               # manual second end -> no duplicate
    assert len(c.to_dict()["messages"]) == 1


# --- rotation -------------------------------------------------------------

def _log_one(c, mid, payload):
    with c.message(id=mid):
        c.log("a", "blob", payload)


def test_no_part_meta_for_single_part(tmp_path):
    c = Client(path=str(tmp_path / "t.json"), nodes=["a"])
    _log_one(c, "m1", "x")
    meta = c.to_dict().get("meta", {})
    assert "part" not in meta and "nextPart" not in meta


def test_rotation_creates_chained_parts(tmp_path):
    # Tiny cap so each message forces a new part.
    c = Client(path=str(tmp_path / "t.json"), nodes=["a"], max_bytes=400)
    for i in range(3):
        _log_one(c, f"m{i}", "X" * 300)

    parts = sorted(p for p in os.listdir(tmp_path) if p.endswith(".json"))
    assert len(parts) >= 3                       # rotated into multiple files

    first = json.loads((tmp_path / parts[0]).read_text(encoding="utf-8"))
    second = json.loads((tmp_path / parts[1]).read_text(encoding="utf-8"))
    # Each part is a self-contained, valid trace with the full graph.
    assert first["version"] == "0.1" and first["graph"]["nodes"] == [{"id": "a"}]
    # Chain metadata links the parts.
    assert first["meta"]["part"] == 1
    assert first["meta"]["nextPart"] == parts[1]
    assert second["meta"]["part"] == 2
    assert second["meta"]["prevPart"] == parts[0]


def test_each_message_lands_in_exactly_one_part(tmp_path):
    c = Client(path=str(tmp_path / "t.json"), nodes=["a"], max_bytes=400)
    ids = [f"m{i}" for i in range(4)]
    for mid in ids:
        _log_one(c, mid, "X" * 300)

    seen = []
    for p in sorted(os.listdir(tmp_path)):
        if p.endswith(".json"):
            data = json.loads((tmp_path / p).read_text(encoding="utf-8"))
            seen.extend(m["id"] for m in data["messages"])
    assert sorted(seen) == sorted(ids)           # no message lost or duplicated


def test_oversized_single_message_gets_its_own_part(tmp_path):
    c = Client(path=str(tmp_path / "t.json"), nodes=["a"], max_bytes=100)
    _log_one(c, "huge", "X" * 5000)              # one message alone exceeds cap
    data = c.to_dict()
    assert len(data["messages"]) == 1            # not dropped, just oversized


def test_rotation_logs_notice(tmp_path, caplog):
    c = Client(path=str(tmp_path / "t.json"), nodes=["a"], max_bytes=400)
    with caplog.at_level("INFO", logger="wizardflow"):
        for i in range(2):
            _log_one(c, f"m{i}", "X" * 300)
    assert any("rotated" in r.message for r in caplog.records)


# --- validation & silencing ----------------------------------------------

def test_unknown_node_fast_fails_when_nodes_declared(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    with pytest.raises(UnknownNodeError):
        with c.message(id="m1"):
            c.log("typo", "L", 1)


def test_unknown_node_allowed_when_nodes_not_declared(tmp_path):
    c = _new(tmp_path)                # no nodes= -> no gating
    with c.message(id="m1"):
        c.log("anything", "L", 1)
    assert c.to_dict()["messages"][0]["steps"][0]["nodeId"] == "anything"


def test_silent_swallows_unknown_node(tmp_path):
    c = _new(tmp_path, nodes=["a"], silent=True)
    with c.message(id="m1"):
        c.log("typo", "L", 1)        # swallowed, no step recorded
    assert c.to_dict()["messages"][0]["steps"] == []


def test_logging_to_ended_message_raises(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    with c.message(id="m1"):
        c.log("a", "L", 1)
    with pytest.raises(WizardFlowError):
        c.log("a", "L", 2, id="m1")  # already ended


# --- langgraph topology extraction ---------------------------------------

def _consultant_app():
    # __start__/__end__ kept; some conditional (branch) edges, some plain.
    nodes = {k: object() for k in ["__start__", "router", "planner", "retriever",
                                   "final_response", "__end__"]}
    edges = [
        _FakeEdge("__start__", "router"),
        _FakeEdge("router", "planner", conditional=True),
        _FakeEdge("router", "retriever", conditional=True),
        _FakeEdge("planner", "final_response"),
        _FakeEdge("retriever", "final_response"),
        _FakeEdge("final_response", "__end__"),
    ]
    return _FakeApp(nodes, edges)


def test_from_langgraph_extracts_nodes_keeping_start_end(tmp_path):
    c = Client.from_langgraph(_consultant_app(), path=str(tmp_path / "t.json"))
    ids = [n["id"] for n in c.to_dict()["graph"]["nodes"]]
    assert ids == ["__start__", "router", "planner", "retriever",
                   "final_response", "__end__"]


def test_from_langgraph_marks_conditional_edges_only(tmp_path):
    c = Client.from_langgraph(_consultant_app(), path=str(tmp_path / "t.json"))
    edges = c.to_dict()["graph"]["edges"]
    cond = {(e["source"], e["target"]) for e in edges if e.get("conditional")}
    plain = {(e["source"], e["target"]) for e in edges if "conditional" not in e}
    assert cond == {("router", "planner"), ("router", "retriever")}
    assert ("planner", "final_response") in plain
    assert ("__start__", "router") in plain


def test_from_langgraph_applies_node_colors(tmp_path):
    c = Client.from_langgraph(
        _consultant_app(),
        path=str(tmp_path / "t.json"),
        node_colors={
            "router": "#A78BFA",
            "retriever": "#22D3EE",
        },
    )
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["router"]["color"] == "#A78BFA"
    assert nodes["retriever"]["color"] == "#22D3EE"
    assert "color" not in nodes["planner"]


def test_from_langgraph_unknown_node_color_raises(tmp_path):
    with pytest.raises(WizardFlowError, match="node_colors contains unknown"):
        Client.from_langgraph(
            _consultant_app(),
            path=str(tmp_path / "t.json"),
            node_colors={"routre": "#A78BFA"},
        )


def test_from_langgraph_unknown_node_color_silent_ignored(tmp_path):
    c = Client.from_langgraph(
        _consultant_app(),
        path=str(tmp_path / "t.json"),
        node_colors={
            "router": "#A78BFA",
            "routre": "#22D3EE",
        },
        silent=True,
    )
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["router"]["color"] == "#A78BFA"
    assert "routre" not in nodes


def test_from_langgraph_iterable_nodes_supported(tmp_path):
    # Some versions expose nodes as objects with .id rather than a dict.
    class _N:
        def __init__(self, id):
            self.id = id

    app = _FakeApp([_N("a"), _N("b")], [_FakeEdge("a", "b")])
    c = Client.from_langgraph(app, path=str(tmp_path / "t.json"))
    assert [n["id"] for n in c.to_dict()["graph"]["nodes"]] == ["a", "b"]


def test_from_langgraph_rejects_non_langgraph_object(tmp_path):
    with pytest.raises(LangGraphExtractionError):
        Client.from_langgraph(object(), path=str(tmp_path / "t.json"))


def test_from_langgraph_logging_still_works(tmp_path):
    c = Client.from_langgraph(_consultant_app(), path=str(tmp_path / "t.json"))
    with c.message(id="m1"):
        c.log("planner", "Input", {"q": "hi"})
    assert c.to_dict()["messages"][0]["steps"][0]["nodeId"] == "planner"


def test_module_init_from_langgraph_sets_default(tmp_path):
    import wizardflow

    wizardflow.init_from_langgraph(_consultant_app(), path=str(tmp_path / "t.json"))
    with wizardflow.message(id="m1"):
        wizardflow.log("router", "decision", "planner")
    assert wizardflow.to_dict()["graph"]["nodes"][0]["id"] == "__start__"


# --- non-ascii round-trips ------------------------------------------------

def test_unicode_values_survive(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    with c.message(id="m1"):
        c.log("a", "Output", "19°C, partly cloudy — Berlin")
    val = c.to_dict()["messages"][0]["steps"][0]["payloads"][0]["value"]
    assert val == "19°C, partly cloudy — Berlin"
