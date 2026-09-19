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
    assert isinstance(step["endTimestamp"], str) and step["endTimestamp"].endswith("Z")
    assert step["timingMode"] == "inferred"


def test_explicit_node_start_and_end_set_execution_timestamps(tmp_path, monkeypatch):
    timestamps = iter([
        "2026-09-15T10:00:00.000Z",
        "2026-09-15T10:00:01.000Z",
        "2026-09-15T10:00:02.000Z",
    ])
    monkeypatch.setattr("wizardflow.client._now_iso", lambda: next(timestamps))
    c = _new(tmp_path, nodes=["a"])
    c.start_node("m1", "a")
    c.log("m1", "a", "L", 1)
    c.end_node("m1", "a")
    c.end_message("m1")

    step = c.to_dict()["messages"][0]["steps"][0]
    assert step["timestamp"] == "2026-09-15T10:00:00.000Z"
    assert step["endTimestamp"] == "2026-09-15T10:00:02.000Z"
    assert step["timingMode"] == "explicit"


def test_end_message_closes_nodes_using_last_log_or_start(tmp_path, monkeypatch):
    timestamps = iter([
        "2026-09-15T10:00:00.000Z",
        "2026-09-15T10:00:01.000Z",
        "2026-09-15T10:00:02.000Z",
    ])
    monkeypatch.setattr("wizardflow.client._now_iso", lambda: next(timestamps))
    c = _new(tmp_path, nodes=["logged", "empty"])
    c.start_node("m1", "logged")
    c.log("m1", "logged", "L", 1)
    c.start_node("m1", "empty")
    c.end_message("m1")

    logged, empty = c.to_dict()["messages"][0]["steps"]
    assert logged["endTimestamp"] == "2026-09-15T10:00:01.000Z"
    assert empty["endTimestamp"] == empty["timestamp"]
    assert logged["timingMode"] == "auto_closed"
    assert empty["timingMode"] == "auto_closed"


def test_inferred_node_timing_uses_first_and_last_log(tmp_path, monkeypatch):
    timestamps = iter([
        "2026-09-15T10:00:00.000Z",
        "2026-09-15T10:00:02.000Z",
    ])
    monkeypatch.setattr("wizardflow.client._now_iso", lambda: next(timestamps))
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "one", 1)
    c.log("m1", "a", "two", 2)
    c.end_message("m1")

    step = c.to_dict()["messages"][0]["steps"][0]
    assert step["timestamp"] == "2026-09-15T10:00:00.000Z"
    assert step["endTimestamp"] == "2026-09-15T10:00:02.000Z"
    assert step["timingMode"] == "inferred"


def test_duplicate_start_and_unmatched_end_warn_and_are_ignored(
    tmp_path, caplog
):
    c = _new(tmp_path, nodes=["a"])
    with caplog.at_level("WARNING", logger="wizardflow"):
        c.start_node("m1", "a")
        c.start_node("m1", "a")
        c.end_node("m1", "a")
        c.end_node("m1", "a")
    assert "already active" in caplog.text
    assert "is not active" in caplog.text
    assert len(c._messages["m1"].steps) == 1


def test_module_node_lifecycle_delegates_to_default(tmp_path):
    import wizardflow

    wizardflow.init(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    wizardflow.start_node("m1", "a")
    wizardflow.log("m1", "a", "L", 1)
    wizardflow.end_node("m1", "a")
    wizardflow.end_message("m1")
    assert wizardflow.to_dict()["messages"][0]["steps"][0]["endTimestamp"]


def test_end_without_start_uses_log_timing(tmp_path, monkeypatch):
    timestamps = iter([
        "2026-09-15T10:00:00.000Z",
        "2026-09-15T10:00:02.000Z",
    ])
    monkeypatch.setattr("wizardflow.client._now_iso", lambda: next(timestamps))
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_node("m1", "a")
    c.end_message("m1")
    step = c.to_dict()["messages"][0]["steps"][0]
    assert step["timestamp"] == "2026-09-15T10:00:00.000Z"
    assert step["endTimestamp"] == "2026-09-15T10:00:02.000Z"
    assert step["timingMode"] == "inferred"


def test_one_log_resolves_to_zero_duration(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "wizardflow.client._now_iso", lambda: "2026-09-15T10:00:00.000Z"
    )
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    step = c.to_dict()["messages"][0]["steps"][0]
    assert step["timestamp"] == step["endTimestamp"]
    assert step["timingMode"] == "inferred"


def test_jsonl_false_records_in_memory_without_creating_a_file(tmp_path):
    c = _new(tmp_path, nodes=["a"], jsonl=False)
    c.log("m1", "a", "L", 1)
    path = c.end_message("m1")
    assert not os.path.exists(path)
    assert c.to_dict()["messages"][0]["id"] == "m1"


class _FakeOTelBridge:
    def __init__(self):
        self.calls = []

    def start_run(self, timestamp, trace_name, nodes, edges):
        self.calls.append(("start_run", timestamp, trace_name, nodes, edges))

    def start_node(self, message_id, node, kind, timestamp, trace_name):
        self.calls.append(("start", message_id, node, kind, timestamp, trace_name))

    def end_node(
        self, message_id, node, kind, timestamp, payloads, message_meta=None
    ):
        self.calls.append(
            ("end", message_id, node, kind, timestamp, payloads, message_meta)
        )

    def end_message(self, message_id, timestamp, title=None, meta=None):
        self.calls.append(("end_message", message_id, timestamp, title, meta))

    def reinit_run(self, end_timestamp, start_timestamp, trace_name, nodes, edges):
        self.calls.append(
            ("reinit_run", end_timestamp, start_timestamp, trace_name, nodes, edges)
        )

    def close(self, timestamp):
        self.calls.append(("close", timestamp))


@pytest.mark.parametrize("jsonl", [False, True])
def test_otel_output_works_with_or_without_jsonl(tmp_path, monkeypatch, jsonl):
    bridge = _FakeOTelBridge()
    monkeypatch.setattr(
        "wizardflow.client.create_otel_bridge", lambda *args, **kwargs: bridge
    )
    c = _new(tmp_path, nodes=["a"], jsonl=jsonl, otel=True)
    c.start_node("m1", "a")
    c.log("m1", "a", "secret", {"must": "not be exported"})
    c.end_message("m1", meta={"outcome": "ok"})
    assert [call[0] for call in bridge.calls] == ["start_run", "start", "end"]
    assert os.path.exists(c.current_path) is jsonl


def test_otel_disabled_does_not_load_bridge(tmp_path, monkeypatch):
    def unexpected(endpoint):
        raise AssertionError("OTel bridge loaded while disabled")

    monkeypatch.setattr("wizardflow.client.create_otel_bridge", unexpected)
    c = _new(tmp_path, nodes=["a"], otel=False)
    c.log("m1", "a", "L", 1)
    c.end_message("m1")


def test_message_trace_scope_ends_each_message_root(tmp_path, monkeypatch):
    bridge = _FakeOTelBridge()
    received = {}

    def create(*args, **kwargs):
        received.update(kwargs)
        return bridge

    monkeypatch.setattr("wizardflow.client.create_otel_bridge", create)
    c = _new(
        tmp_path,
        nodes=["a"],
        otel=True,
        otel_trace_scope="message",
        name="project",
    )
    c.log("m1", "a", "answer", "one")
    c.end_message("m1", title="First", meta={"outcome": "ok"})
    c.log("m2", "a", "answer", "two")
    c.end_message("m2", title="Second")

    assert received["trace_scope"] == "message"
    assert received["project_name"] == "project"
    assert [call[1] for call in bridge.calls if call[0] == "end_message"] == [
        "m1",
        "m2",
    ]


def test_invalid_otel_trace_scope_is_rejected(tmp_path):
    with pytest.raises(WizardFlowError, match="otel_trace_scope"):
        _new(tmp_path, otel_trace_scope="request")


def test_context_manager_logs_and_closes_on_exception(tmp_path):
    import wizardflow

    wizardflow.init(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    with pytest.raises(ValueError):
        with wizardflow.node("m1", "a") as execution:
            execution.log("input", "value")
            raise ValueError("boom")
    wizardflow.end_message("m1")
    step = wizardflow.to_dict()["messages"][0]["steps"][0]
    assert step["payloads"] == [{"label": "input", "value": "value"}]
    assert step["endTimestamp"] >= step["timestamp"]
    assert step["timingMode"] == "explicit"


def test_client_node_context_manager_supports_instance_style(tmp_path):
    trace = _new(tmp_path, nodes=["a"])
    with trace.node("m1", "a") as execution:
        execution.log_input("question")
        execution.log_output("answer")
    trace.end_message("m1")

    step = trace.to_dict()["messages"][0]["steps"][0]
    assert step["payloads"] == [
        {"label": "input", "value": "question", "semanticType": "input"},
        {"label": "output", "value": "answer", "semanticType": "output"},
    ]
    assert step["endTimestamp"] >= step["timestamp"]
    assert step["timingMode"] == "explicit"


def test_semantic_node_api_preserves_transport_neutral_jsonl(tmp_path):
    import wizardflow

    wizardflow.init(output_dir=str(tmp_path), file_prefix="trace", nodes=["model"])
    with wizardflow.node("m1", "model", kind="llm") as execution:
        execution.log_input({"messages": ["hello"]})
        execution.log_model_parameters(
            model="gpt-5", max_tokens=500, reasoning_effort="high"
        )
        execution.log_output(["answer"])
        execution.log_usage(input_tokens=120, output_tokens=30)
    wizardflow.end_message("m1")

    step = wizardflow.to_dict()["messages"][0]["steps"][0]
    assert step["kind"] == "llm"
    assert step["payloads"] == [
        {
            "label": "input",
            "value": {"messages": ["hello"]},
            "semanticType": "input",
        },
        {
            "label": "model_parameters",
            "value": {
                "model": "gpt-5",
                "maxTokens": 500,
                "reasoning_effort": "high",
            },
            "semanticType": "model_parameters",
        },
        {"label": "output", "value": ["answer"], "semanticType": "output"},
        {
            "label": "usage",
            "value": {"inputTokens": 120, "outputTokens": 30},
            "semanticType": "usage",
        },
    ]


def test_per_record_output_flags_are_explicit_and_independent(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "jsonl-only", 1, export_to_otel=False)
    c.log("m1", "a", "otel-only", 2, export_to_jsonl=False)
    c.log("m1", "a", "both", 3)
    c.end_message("m1")
    payloads = c.to_dict()["messages"][0]["steps"][0]["payloads"]
    assert payloads == [
        {"label": "jsonl-only", "value": 1, "exportToOtel": False},
        {"label": "both", "value": 3},
    ]


def test_kind_validation_and_silent_fallback(tmp_path, caplog):
    c = _new(tmp_path, nodes=["a"])
    with pytest.raises(WizardFlowError, match="Unknown node kind"):
        c.start_node("m1", "a", kind="unknown")

    quiet = _new(tmp_path / "silent", nodes=["a"], silent=True)
    with caplog.at_level("WARNING", logger="wizardflow"):
        quiet.start_node("m1", "a", kind="future-kind")
    quiet.end_message("m1")
    assert "using 'generic'" in caplog.text
    assert "kind" not in quiet.to_dict()["messages"][0]["steps"][0]


def test_usage_rejects_invalid_counts(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    with pytest.raises(WizardFlowError, match="non-negative integer"):
        c.log_usage("m1", "a", input_tokens=-1)
    with pytest.raises(WizardFlowError, match="at least one"):
        c.log_usage("m1", "a")


def test_plain_package_keeps_zero_runtime_dependencies():
    pyproject = os.path.join(os.path.dirname(__file__), "..", "pyproject.toml")
    with open(pyproject, encoding="utf-8") as fh:
        project_text = fh.read().split("[project.scripts]", 1)[0]
    assert "dependencies = []" in project_text


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


def test_repeated_bare_logs_remain_separate_visits(tmp_path):
    c = _new(tmp_path, nodes=["tool"])
    c.log("m1", "tool")
    c.log("m1", "tool")
    c.end_message("m1")
    assert [step["nodeId"] for step in c.to_dict()["messages"][0]["steps"]] == [
        "tool", "tool"
    ]


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


# --- message meta ----------------------------------------------------------

def test_end_message_sets_meta_in_dict_and_written_record(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    path = c.end_message("m1", meta={"outcome": "ok", "latency_ms": 320})
    assert c.to_dict()["messages"][0]["meta"] == {"outcome": "ok", "latency_ms": 320}
    _, messages, _ = _read_part(path)
    assert messages[0]["meta"] == {"outcome": "ok", "latency_ms": 320}


def test_module_end_message_sets_meta(tmp_path):
    import wizardflow

    wizardflow.init(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    wizardflow.log("m1", "a", "L", 1)
    wizardflow.end_message("m1", meta={"user": "u-7"})
    assert wizardflow.to_dict()["messages"][0]["meta"] == {"user": "u-7"}


def test_end_message_copies_meta(tmp_path):
    # Caller mutating the dict after end_message must not change the message.
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    meta = {"outcome": "ok"}
    c.end_message("m1", meta=meta)
    meta["outcome"] = "mutated"
    assert c.to_dict()["messages"][0]["meta"] == {"outcome": "ok"}


def test_no_meta_means_no_meta_field(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    assert "meta" not in c.to_dict()["messages"][0]


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


# --- reinit ----------------------------------------------------------------

def test_reinit_starts_a_new_file_and_leaves_old_part_unsealed(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    old_path = c.current_path

    new_path = c.reinit()
    assert new_path == c.current_path
    assert new_path != old_path
    assert "__part" not in os.path.basename(new_path)  # a new run, not a part

    # The old file is untouched: its messages intact, and NO seal — a seal
    # means "continue at nextPart", which a reinit is not.
    _, old_messages, old_seal = _read_part(old_path)
    assert [m["id"] for m in old_messages] == ["m1"]
    assert old_seal is None

    # The new file doesn't exist until something is written to it.
    assert not os.path.exists(new_path)
    c.log("m2", "a", "L", 2)
    c.end_message("m2")
    header, messages, _ = _read_part(new_path)
    assert header["graph"]["nodes"] == [{"id": "a"}]    # graph carried over
    assert [m["id"] for m in messages] == ["m2"]


def test_open_message_carries_across_reinit(tmp_path):
    # A message logged before reinit but ended after lands in the new file,
    # with all its steps: a message is written wherever it ends.
    c = _new(tmp_path, nodes=["a", "b"])
    c.log("open", "a", "L", 1)
    c.reinit()
    c.log("open", "b", "L", 2)
    c.end_message("open")
    _, messages, _ = _read_part(c.current_path)
    assert [m["id"] for m in messages] == ["open"]
    assert [s["nodeId"] for s in messages[0]["steps"]] == ["a", "b"]


def test_completed_id_is_reusable_after_reinit(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    c.reinit()
    c.log("m1", "a", "L", 2)          # would raise "already ended" without reinit
    c.end_message("m1")
    _, messages, _ = _read_part(c.current_path)
    assert [m["id"] for m in messages] == ["m1"]
    assert messages[0]["steps"][0]["payloads"][0]["value"] == 2


def test_reinit_overrides_replace_and_omitted_values_persist(tmp_path):
    c = _new(tmp_path, name="first", description="one", nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")

    c.reinit(description="two")       # name/meta not given -> kept
    c.log("m2", "a", "L", 2)
    c.end_message("m2")
    header, _, _ = _read_part(c.current_path)
    assert header["name"] == "first"
    assert header["meta"]["description"] == "two"

    c.reinit(meta={"session": "s2"}, description="three")  # meta replaced whole
    c.log("m3", "a", "L", 3)
    c.end_message("m3")
    header, _, _ = _read_part(c.current_path)
    assert header["meta"] == {"session": "s2", "description": "three"}


def test_reinit_resets_rotation_state(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=400)
    _log_one(c, "m0", "X" * 300)      # active part already past the byte cap
    c.reinit()
    _log_one(c, "m1", "X" * 300)      # would rotate to __part2 without the reset
    assert "__part" not in os.path.basename(c.current_path)
    assert not [p for p in os.listdir(tmp_path) if "__part" in p]


def test_module_reinit_delegates_to_default(tmp_path):
    import wizardflow

    wizardflow.init(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    wizardflow.log("m1", "a", "L", 1)
    first = wizardflow.end_message("m1")
    new_path = wizardflow.reinit()
    assert new_path != first
    wizardflow.log("m1", "a", "L", 2)
    assert wizardflow.end_message("m1") == new_path


def test_reinit_controls_jsonl_and_otel_independently(tmp_path, monkeypatch):
    bridge = _FakeOTelBridge()
    monkeypatch.setattr(
        "wizardflow.client.create_otel_bridge", lambda *args, **kwargs: bridge
    )
    c = _new(tmp_path, nodes=["a"], name="original", otel=True)
    original_path = c.current_path

    c.reinit(name="otel-only", jsonl=False, otel=True)
    assert c.current_path == original_path
    assert c.name == "original"
    assert bridge.calls[-1][3] == "otel-only"
    assert [call[0] for call in bridge.calls].count("reinit_run") == 1

    c.reinit(name="jsonl-only", jsonl=True, otel=False)
    assert c.current_path != original_path
    assert c.name == "jsonl-only"
    assert c._otel_name == "otel-only"
    assert [call[0] for call in bridge.calls].count("reinit_run") == 1


def test_close_otel_does_not_affect_jsonl_and_reinit_reopens_it(
    tmp_path, monkeypatch
):
    bridges = [_FakeOTelBridge(), _FakeOTelBridge()]
    monkeypatch.setattr(
        "wizardflow.client.create_otel_bridge",
        lambda *args, **kwargs: bridges.pop(0),
    )
    c = _new(tmp_path, nodes=["a"], otel=True)
    first = c._otel
    c.close_otel()
    c.close_otel()
    assert [call[0] for call in first.calls].count("close") == 1

    c.log("m1", "a", "still-jsonl", True)
    assert os.path.exists(c.end_message("m1"))

    c.reinit(jsonl=False, otel=True)
    assert c._otel is not None
    assert c._otel is not first


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


# --- node descriptions (and per-node kwargs on plain init) ------------------

def test_init_applies_node_descriptions(tmp_path):
    c = _new(tmp_path, nodes=["router", "retriever"],
             node_descriptions={"router": "Chooses the next step."})
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["router"]["description"] == "Chooses the next step."
    assert "description" not in nodes["retriever"]   # no description -> no key


def test_init_applies_node_labels(tmp_path):
    # label is the display name the viewer shows instead of the raw id.
    c = _new(tmp_path, nodes=["tool_node", "router"],
             node_labels={"tool_node": "Tool"})
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["tool_node"]["label"] == "Tool"
    assert "label" not in nodes["router"]


def test_node_labels_unknown_id_raises(tmp_path):
    with pytest.raises(WizardFlowError, match="node_labels contains unknown"):
        _new(tmp_path, nodes=["a"], node_labels={"typo": "X"})


def test_from_langgraph_applies_node_labels(tmp_path):
    # The main use case: extracted LangGraph ids are function names; node_labels
    # renames them for display without touching the ids log() targets.
    c = Client.from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
        node_labels={"final_response": "Final Response"},
    )
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["final_response"]["label"] == "Final Response"
    assert "label" not in nodes["router"]


def test_init_applies_node_colors_kwarg(tmp_path):
    # node_colors exists on plain Client()/init() too, mirroring from_langgraph.
    c = _new(tmp_path, nodes=["a", "b"], node_colors={"a": "#A78BFA"})
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["a"]["color"] == "#A78BFA"
    assert "color" not in nodes["b"]


def test_node_descriptions_unknown_id_raises(tmp_path):
    with pytest.raises(WizardFlowError, match="node_descriptions contains unknown"):
        _new(tmp_path, nodes=["a"], node_descriptions={"typo": "x"})


def test_node_descriptions_silent_warns_and_skips_unknown(tmp_path, caplog):
    with caplog.at_level("WARNING", logger="wizardflow"):
        c = _new(tmp_path, nodes=["a"], silent=True,
                 node_descriptions={"a": "ok", "typo": "x"})
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["a"]["description"] == "ok"         # known ids still applied
    assert any("node_descriptions" in r.message for r in caplog.records)


def test_node_descriptions_without_declared_nodes_raises(tmp_path):
    with pytest.raises(WizardFlowError, match="no nodes are declared"):
        _new(tmp_path, node_descriptions={"router": "x"})


def test_node_descriptions_without_nodes_silent_warns_and_ignores(tmp_path, caplog):
    with caplog.at_level("WARNING", logger="wizardflow"):
        c = _new(tmp_path, silent=True, node_descriptions={"router": "x"})
    assert c.to_dict()["graph"]["nodes"] == []
    assert any("no nodes are declared" in r.message for r in caplog.records)


def test_dict_node_spec_description_kept_and_kwarg_wins(tmp_path):
    c = _new(
        tmp_path,
        nodes=[{"id": "a", "description": "from spec"},
               {"id": "b", "description": "keep"}],
        node_descriptions={"a": "from kwarg"},
    )
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["a"]["description"] == "from kwarg"   # the mapping wins
    assert nodes["b"]["description"] == "keep"         # spec-only untouched


def test_from_langgraph_applies_node_descriptions(tmp_path):
    c = Client.from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
        node_descriptions={"router": "Routes requests."},
    )
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["router"]["description"] == "Routes requests."
    assert "description" not in nodes["planner"]


def test_node_description_survives_jsonl_roundtrip(tmp_path):
    # Serialization + backward compat: the description rides on the header
    # record's graph nodes and comes back through the JSONL reader untouched.
    # Nodes without one stay clean — an old trace is simply a trace where no
    # node carries the field.
    from wizardflow.reader import load_trace_file

    c = _new(tmp_path, nodes=["a", "b"], node_descriptions={"a": "does A"})
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    loaded = load_trace_file(c.current_path)
    nodes = {n["id"]: n for n in loaded["graph"]["nodes"]}
    assert nodes["a"]["description"] == "does A"
    assert "description" not in nodes["b"]


def test_module_init_passes_node_descriptions(tmp_path):
    import wizardflow

    wizardflow.init(output_dir=str(tmp_path), file_prefix="t", nodes=["a"],
                    node_descriptions={"a": "x"})
    assert wizardflow.to_dict()["graph"]["nodes"][0]["description"] == "x"


# --- non-ascii round-trips ------------------------------------------------

def test_unicode_values_survive(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "Output", "19°C, partly cloudy — Berlin")
    c.end_message("m1")
    val = c.to_dict()["messages"][0]["steps"][0]["payloads"][0]["value"]
    assert val == "19°C, partly cloudy — Berlin"
