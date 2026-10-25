"""node lifecycle tests."""

import pytest
from wizardflow import Client
from helpers import _new


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
