"""recording tests."""

import os

import pytest
from wizardflow import Client, UnknownNodeError, WizardFlowError
from helpers import _new, _read_part


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

def test_silent_logs_suppressed_errors_as_warnings(tmp_path, caplog):
    trace = _new(tmp_path, nodes=["a"], silent=True)
    with caplog.at_level("WARNING", logger="wizardflow"):
        trace.log("m1", "missing", "value", 1)
        trace.end_message("missing-message")

    assert "Unknown node 'missing'" in caplog.text
    assert "end_message: unknown message 'missing-message'" in caplog.text
    assert caplog.text.count("ignored") == 2


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
