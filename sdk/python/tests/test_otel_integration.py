"""otel integration tests."""

import os
import pytest
from wizardflow import WizardFlowError
from helpers import _FakeOTelBridge, _new


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
    assert [call[0] for call in bridge.calls] == [
        "start_run",
        "start",
        "end",
        "end_workflow",
    ]
    assert os.path.exists(c.current_path) is jsonl


def test_otel_disabled_does_not_load_bridge(tmp_path, monkeypatch):
    def unexpected(endpoint):
        raise AssertionError("OTel bridge loaded while disabled")

    monkeypatch.setattr("wizardflow.client.create_otel_bridge", unexpected)
    c = _new(tmp_path, nodes=["a"], otel=False)
    c.log("m1", "a", "L", 1)
    c.end_message("m1")


def test_workflow_trace_scope_is_default_and_ends_each_message_root(
    tmp_path, monkeypatch
):
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
        name="project",
        otel_workflow_name="consultation",
    )
    c.log("m1", "a", "answer", "one")
    c.end_message("m1", title="First", meta={"outcome": "ok"})
    c.log("m2", "a", "answer", "two")
    c.end_message("m2", title="Second")

    assert received["trace_scope"] == "workflow"
    assert received["project_name"] == "project"
    assert received["workflow_name"] == "consultation"
    ends = [call for call in bridge.calls if call[0] == "end_workflow"]
    assert [call[1] for call in ends] == ["m1", "m2"]
    assert ends[0][3:5] == ("First", {"outcome": "ok"})


@pytest.mark.parametrize("scope", ["request", "message"])
def test_invalid_otel_trace_scope_is_rejected(tmp_path, scope):
    with pytest.raises(WizardFlowError, match="otel_trace_scope"):
        _new(tmp_path, otel_trace_scope=scope)


@pytest.mark.parametrize("name", ["", "  ", " consultation", "consultation ", 3])
def test_invalid_otel_workflow_name_is_rejected(tmp_path, name):
    with pytest.raises(WizardFlowError, match="otel_workflow_name"):
        _new(tmp_path, otel_workflow_name=name)

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


def test_custom_otel_attribute_is_persisted_by_all_generic_log_apis(tmp_path):
    import wizardflow

    trace = wizardflow.init(
        output_dir=str(tmp_path), file_prefix="trace", nodes=["a"]
    )
    trace.log("m1", "a", "score", 0.9, otel_attribute="app.score")
    with trace.node("m1", "a") as execution:
        execution.log("region", "eu", otel_attribute="company.region")
    wizardflow.log(
        "m1", "a", "variant", "b", otel_attribute="experiment.variant"
    )
    trace.end_message("m1")

    payloads = [
        payload
        for step in trace.to_dict()["messages"][0]["steps"]
        for payload in step["payloads"]
    ]
    assert payloads == [
        {"label": "score", "value": 0.9, "otelAttribute": "app.score"},
        {"label": "region", "value": "eu", "otelAttribute": "company.region"},
        {
            "label": "variant",
            "value": "b",
            "otelAttribute": "experiment.variant",
        },
    ]


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("", "must not be empty"),
        (" app.score", "leading or trailing whitespace"),
        ("app.score ", "leading or trailing whitespace"),
        ("app.\nscore", "control characters"),
        ("wizardflow.node.id", "protected"),
        ("WIZARDFLOW.MESSAGE.ID", "protected"),
        (123, "must be a string"),
    ],
)
def test_custom_otel_attribute_validation(tmp_path, value, message):
    trace = _new(tmp_path, nodes=["a"])
    with pytest.raises(WizardFlowError, match=message):
        trace.log("m1", "a", "value", 1, otel_attribute=value)


@pytest.mark.parametrize("method", ["log_input", "log_output"])
def test_semantic_content_persists_one_payload_with_otel_attribute(tmp_path, method):
    trace = _new(tmp_path, nodes=["a"])
    getattr(trace, method)("m1", "a", "direct", otel_attribute="app.direct")
    with trace.node("m1", "a") as node:
        getattr(node, method)("scoped", otel_attribute="app.scoped")
    trace.end_message("m1")
    semantic = method.removeprefix("log_")
    payloads = [
        payload
        for step in trace.to_dict()["messages"][0]["steps"]
        for payload in step["payloads"]
    ]
    # One payload per call: the key rides on the semantic record, it is not
    # duplicated as a generic log.
    assert payloads == [
        {"label": semantic, "value": "direct", "semanticType": semantic,
         "otelAttribute": "app.direct"},
        {"label": semantic, "value": "scoped", "semanticType": semantic,
         "otelAttribute": "app.scoped"},
    ]


@pytest.mark.parametrize("method", ["log_input", "log_output"])
@pytest.mark.parametrize(
    ("value", "message"),
    [("", "must not be empty"), ("wizardflow.node.id", "protected"), (1, "string")],
)
def test_semantic_content_validates_otel_attribute(tmp_path, method, value, message):
    trace = _new(tmp_path, nodes=["a"])
    with pytest.raises(WizardFlowError, match=message):
        getattr(trace, method)("m1", "a", "x", otel_attribute=value)


def test_custom_otel_attribute_requires_a_payload(tmp_path):
    trace = _new(tmp_path, nodes=["a"])
    with pytest.raises(WizardFlowError, match="requires a payload label"):
        trace.log("m1", "a", otel_attribute="app.visit")
