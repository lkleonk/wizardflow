"""Tests for the WizardFlow SDK — pins the emitted AgentTrace shape and the
recording semantics we agreed on (folding, completed-only, id targeting, etc.).

Recording API: ``log(id, node, label=None, content=None)`` names the message in
its first argument; ``end_message(id, title=None)`` is the only thing that writes.
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
    return Client(output_dir=str(tmp_path), file_prefix="trace", **kw)


def _read_part(path):
    """Parse a JSONL part file into (header, messages, seal)."""
    header, messages, seal = None, [], None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec["type"] == "header":
                header = rec
            elif rec["type"] == "message":
                messages.append(rec)
            elif rec["type"] == "seal":
                seal = rec
    return header, messages, seal


# --- output shape ---------------------------------------------------------

def test_emits_schema_0_2_with_graph_and_meta(tmp_path):
    c = _new(tmp_path, name="run.jsonl", description="hi",
             nodes=["a"], edges=[("a", "a")])
    c.log("m1", "a", "Input", "x")
    c.end_message("m1")
    out = c.to_dict()

    assert out["version"] == "0.2"
    assert out["name"] == "run.jsonl"
    assert out["meta"] == {"description": "hi"}          # description -> meta
    assert out["graph"]["nodes"] == [{"id": "a"}]
    assert out["graph"]["edges"] == [{"source": "a", "target": "a"}]


def test_step_ids_and_timestamp_present(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    step = c.to_dict()["messages"][0]["steps"][0]
    assert step["id"] == "m1-s1"
    assert step["nodeId"] == "a"
    assert isinstance(step["timestamp"], str) and step["timestamp"].endswith("Z")


# --- folding & visits -----------------------------------------------------

def test_same_node_logs_fold_into_one_step(tmp_path):
    c = _new(tmp_path, nodes=["router"])
    c.log("m1", "router", "llm_input", "p")
    c.log("m1", "router", "llm_output", "o")
    c.end_message("m1")
    steps = c.to_dict()["messages"][0]["steps"]
    assert len(steps) == 1
    assert [p["label"] for p in steps[0]["payloads"]] == ["llm_input", "llm_output"]


def test_different_node_starts_new_step(tmp_path):
    c = _new(tmp_path, nodes=["a", "b"])
    c.log("m1", "a", "L", 1)
    c.log("m1", "b", "L", 2)
    c.end_message("m1")
    assert [s["nodeId"] for s in c.to_dict()["messages"][0]["steps"]] == ["a", "b"]


def test_bare_log_is_a_visit_with_no_payloads(tmp_path):
    c = _new(tmp_path, nodes=["tool"])
    c.log("m1", "tool")
    c.end_message("m1")
    step = c.to_dict()["messages"][0]["steps"][0]
    assert step["nodeId"] == "tool" and step["payloads"] == []


# --- message targeting ----------------------------------------------------

def test_log_targets_message_by_id(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m2", "a", "L", 1)            # the id is the first positional arg
    c.end_message("m2")
    assert [m["id"] for m in c.to_dict()["messages"]] == ["m2"]


def test_interleaved_messages_stay_separate(tmp_path):
    # Two messages logged in interleaved order (as concurrent agents would) keep
    # their own steps — the id on each log routes it, no ambient state.
    c = _new(tmp_path, nodes=["a", "b"])
    c.log("m1", "a", "L", 1)
    c.log("m2", "b", "L", 2)
    c.log("m1", "b", "L", 3)
    c.end_message("m1")
    c.end_message("m2")
    msgs = {m["id"]: m for m in c.to_dict()["messages"]}
    assert [s["nodeId"] for s in msgs["m1"]["steps"]] == ["a", "b"]
    assert [s["nodeId"] for s in msgs["m2"]["steps"]] == ["b"]


# --- message titles -------------------------------------------------------

def test_end_message_sets_title(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1", title="Weather question")
    assert c.to_dict()["messages"][0]["label"] == "Weather question"


def test_module_end_message_sets_title(tmp_path):
    import wizardflow

    wizardflow.init(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    wizardflow.log("m1", "a", "L", 1)
    wizardflow.end_message("m1", title="Weather question")
    assert wizardflow.to_dict()["messages"][0]["label"] == "Weather question"


def test_no_label_means_no_label_field(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    assert "label" not in c.to_dict()["messages"][0]


# --- completed-only persistence ------------------------------------------

def test_only_completed_messages_are_emitted(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("open", "a", "L", 1)          # never ended
    c.log("done", "a", "L", 2)
    c.end_message("done")
    assert [m["id"] for m in c.to_dict()["messages"]] == ["done"]


def test_end_message_appends_header_then_message(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    written = c.current_path                        # timestamped output filename
    assert os.path.exists(written)
    header, messages, seal = _read_part(written)
    assert header["version"] == "0.2"
    assert header["graph"]["nodes"] == [{"id": "a"}]
    assert [m["id"] for m in messages] == ["m1"]
    assert seal is None                             # active part: no seal line


def test_each_end_message_is_immediately_durable(tmp_path):
    # Append-only: every ended message is on disk the moment end_message
    # returns, without the earlier ones being rewritten.
    c = Client(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    _, first, _ = _read_part(c.current_path)
    c.log("m2", "a", "L", 2)
    c.end_message("m2")
    _, second, _ = _read_part(c.current_path)
    assert [m["id"] for m in first] == ["m1"]
    assert [m["id"] for m in second] == ["m1", "m2"]


def test_log_alone_writes_nothing(tmp_path):
    # end_message is the only thing that touches disk: logging without ending
    # leaves no file on disk.
    c = Client(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    c.log("m1", "a", "L", 1)
    assert not [p for p in os.listdir(tmp_path) if p.endswith(".jsonl")]


def test_output_dir_is_created_on_first_write(tmp_path):
    output_dir = tmp_path / "traces"
    c = Client(output_dir=str(output_dir), file_prefix="trace", nodes=["a"])
    assert not output_dir.exists()
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    assert output_dir.is_dir()
    assert os.path.exists(c.current_path)


def test_part_naming_uses_prefix_and_init_timestamp(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="myrun", nodes=["a"])
    name = os.path.basename(c.current_path)
    assert name.startswith("myrun__")
    assert name.endswith("Z.jsonl")
    assert "__part" not in name
    assert "_001" not in name
    assert name.count(".") == 1


def test_default_prefix_when_file_prefix_omitted():
    c = Client(nodes=["a"])
    assert os.path.basename(c.current_path).startswith("wizardflow__")


def test_end_message_is_idempotent(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")               # ends + writes
    c.end_message("m1")               # second end -> no duplicate
    assert len(c.to_dict()["messages"]) == 1


# --- rotation -------------------------------------------------------------

def _log_one(c, mid, payload):
    c.log(mid, "a", "blob", payload)
    c.end_message(mid)


def test_no_part_meta_for_single_part(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"])
    _log_one(c, "m1", "x")
    meta = c.to_dict().get("meta", {})
    assert "part" not in meta and "nextPart" not in meta


def test_rotation_creates_chained_parts(tmp_path):
    # Tiny cap so each message forces a new part.
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=400)
    for i in range(3):
        _log_one(c, f"m{i}", "X" * 300)

    parts = sorted(p for p in os.listdir(tmp_path) if p.endswith(".jsonl"))
    assert len(parts) >= 3                       # rotated into multiple files
    assert parts[0].startswith("t__") and "__part" not in parts[0]
    assert parts[1].endswith("__part2.jsonl")
    assert parts[2].endswith("__part3.jsonl")
    assert all(p.count(".") == 1 for p in parts)

    first_header, _, first_seal = _read_part(tmp_path / parts[0])
    second_header, _, second_seal = _read_part(tmp_path / parts[1])
    _, _, last_seal = _read_part(tmp_path / parts[2])
    # Each part opens with a full header (version + graph).
    assert first_header["version"] == "0.2"
    assert first_header["graph"]["nodes"] == [{"id": "a"}]
    # Forward chaining lives in the seal line; backward in the header meta.
    # Part 1's header stays clean (no part metadata).
    assert "part" not in first_header.get("meta", {})
    assert first_seal["nextPart"] == parts[1]
    assert second_header["meta"]["part"] == 2
    assert second_header["meta"]["prevPart"] == parts[0]
    assert second_seal["nextPart"] == parts[2]
    assert last_seal is None                     # active part: still unsealed


def test_rotation_by_message_count(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"],
               max_messages=2)
    for i in range(5):
        _log_one(c, f"m{i}", "x")

    parts = sorted(p for p in os.listdir(tmp_path) if p.endswith(".jsonl"))
    assert len(parts) == 3                       # 2 + 2 + 1 messages
    counts = [len(_read_part(tmp_path / p)[1]) for p in parts]
    assert counts == [2, 2, 1]


def test_each_message_lands_in_exactly_one_part(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=400)
    ids = [f"m{i}" for i in range(4)]
    for mid in ids:
        _log_one(c, mid, "X" * 300)

    seen = []
    for p in sorted(os.listdir(tmp_path)):
        if p.endswith(".jsonl"):
            seen.extend(m["id"] for m in _read_part(tmp_path / p)[1])
    assert sorted(seen) == sorted(ids)           # no message lost or duplicated


def test_oversized_single_message_gets_its_own_part(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=100)
    _log_one(c, "huge", "X" * 5000)              # one message alone exceeds cap
    data = c.to_dict()
    assert len(data["messages"]) == 1            # not dropped, just oversized


def test_rotation_logs_notice(tmp_path, caplog):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=400)
    with caplog.at_level("INFO", logger="wizardflow"):
        for i in range(2):
            _log_one(c, f"m{i}", "X" * 300)
    assert any("rotated" in r.message for r in caplog.records)


def test_max_bytes_clamped_to_ceiling(tmp_path):
    from wizardflow.constants import Rotation

    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=999_000_000)
    assert c.max_bytes == Rotation.MAX_MAX_BYTES          # never honored above cap
    # A value within range is left untouched.
    c2 = Client(output_dir=str(tmp_path), file_prefix="t2", nodes=["a"], max_bytes=50_000)
    assert c2.max_bytes == 50_000


def test_concurrent_message_ends_are_safe(tmp_path):
    # Multi-agent setups end messages from many threads at once. The write lock
    # must keep the shared part files race-free: every line stays valid JSON,
    # every message lands exactly once. A tiny cap forces frequent rotation to
    # stress the boundary.
    import threading

    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=2_000)
    n = 100

    def worker(i):
        _log_one(c, f"m{i}", "X" * 100)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    seen = []
    for p in sorted(os.listdir(tmp_path)):
        if p.endswith(".jsonl"):
            header, messages, _ = _read_part(tmp_path / p)
            assert header is not None            # every part opens with a header
            seen.extend(m["id"] for m in messages)
    assert sorted(seen) == sorted(f"m{i}" for i in range(n))  # all once, none lost


# --- validation & silencing ----------------------------------------------

def test_unknown_node_fast_fails_when_nodes_declared(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    with pytest.raises(UnknownNodeError):
        c.log("m1", "typo", "L", 1)


def test_unknown_node_allowed_when_nodes_not_declared(tmp_path):
    c = _new(tmp_path)                # no nodes= -> no gating
    c.log("m1", "anything", "L", 1)
    c.end_message("m1")
    assert c.to_dict()["messages"][0]["steps"][0]["nodeId"] == "anything"


def test_silent_swallows_unknown_node(tmp_path):
    c = _new(tmp_path, nodes=["a"], silent=True)
    c.log("m1", "typo", "L", 1)       # swallowed, no step recorded
    c.end_message("m1")
    assert c.to_dict()["messages"][0]["steps"] == []


def test_logging_to_ended_message_raises(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    with pytest.raises(WizardFlowError):
        c.log("m1", "a", "L", 2)      # already ended


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
    c = Client.from_langgraph(_consultant_app(), output_dir=str(tmp_path), file_prefix="t")
    ids = [n["id"] for n in c.to_dict()["graph"]["nodes"]]
    assert ids == ["__start__", "router", "planner", "retriever",
                   "final_response", "__end__"]


def test_from_langgraph_marks_conditional_edges_only(tmp_path):
    c = Client.from_langgraph(_consultant_app(), output_dir=str(tmp_path), file_prefix="t")
    edges = c.to_dict()["graph"]["edges"]
    cond = {(e["source"], e["target"]) for e in edges if e.get("conditional")}
    plain = {(e["source"], e["target"]) for e in edges if "conditional" not in e}
    assert cond == {("router", "planner"), ("router", "retriever")}
    assert ("planner", "final_response") in plain
    assert ("__start__", "router") in plain


def test_from_langgraph_collapses_duplicate_edges(tmp_path):
    # LangGraph's get_graph() can list the same conditional edge twice when a
    # router maps several branch keys to one target; the viewer keys edges by
    # source->target, so duplicates must collapse to one.
    nodes = {k: object() for k in ["__start__", "router", "target", "__end__"]}
    edges = [
        _FakeEdge("__start__", "router"),
        _FakeEdge("router", "target", conditional=True),
        _FakeEdge("router", "target", conditional=True),
    ]
    c = Client.from_langgraph(_FakeApp(nodes, edges), output_dir=str(tmp_path), file_prefix="t")
    out = c.to_dict()["graph"]["edges"]
    assert out == [
        {"source": "__start__", "target": "router"},
        {"source": "router", "target": "target", "conditional": True},
    ]


def test_dedupe_keeps_conditional_if_any_twin_is(tmp_path):
    # A plain edge and a conditional edge over the same pair collapse to one
    # that keeps the branch flag, regardless of which came first.
    c = _new(tmp_path, nodes=["a", "b"],
             edges=[("a", "b"), {"source": "a", "target": "b", "conditional": True}])
    assert c.to_dict()["graph"]["edges"] == [
        {"source": "a", "target": "b", "conditional": True}
    ]


def test_dedupe_preserves_first_seen_order(tmp_path):
    c = _new(tmp_path, nodes=["a", "b", "c"],
             edges=[("b", "c"), ("a", "b"), ("b", "c")])
    assert c.to_dict()["graph"]["edges"] == [
        {"source": "b", "target": "c"},
        {"source": "a", "target": "b"},
    ]


def test_from_langgraph_applies_node_colors(tmp_path):
    c = Client.from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
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
            output_dir=str(tmp_path),
            file_prefix="t",
            node_colors={"routre": "#A78BFA"},
        )


def test_from_langgraph_unknown_node_color_silent_ignored(tmp_path):
    c = Client.from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
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
    c = Client.from_langgraph(app, output_dir=str(tmp_path), file_prefix="t")
    assert [n["id"] for n in c.to_dict()["graph"]["nodes"]] == ["a", "b"]


def test_from_langgraph_rejects_non_langgraph_object(tmp_path):
    with pytest.raises(LangGraphExtractionError):
        Client.from_langgraph(object(), output_dir=str(tmp_path), file_prefix="t")


def test_from_langgraph_logging_still_works(tmp_path):
    c = Client.from_langgraph(_consultant_app(), output_dir=str(tmp_path), file_prefix="t")
    c.log("m1", "planner", "Input", {"q": "hi"})
    c.end_message("m1")
    assert c.to_dict()["messages"][0]["steps"][0]["nodeId"] == "planner"


def test_module_init_from_langgraph_sets_default(tmp_path):
    import wizardflow

    wizardflow.init_from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
    )
    wizardflow.log("m1", "router", "decision", "planner")
    wizardflow.end_message("m1")
    assert wizardflow.to_dict()["graph"]["nodes"][0]["id"] == "__start__"


# --- non-ascii round-trips ------------------------------------------------

def test_unicode_values_survive(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "Output", "19°C, partly cloudy — Berlin")
    c.end_message("m1")
    val = c.to_dict()["messages"][0]["steps"][0]["payloads"][0]["value"]
    assert val == "19°C, partly cloudy — Berlin"
