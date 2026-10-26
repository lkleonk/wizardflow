"""Workflow-scoped OTel traces: trace.workflow(), set_info(), otel_attributes."""

import asyncio
import logging
import threading
from types import SimpleNamespace

import pytest

import wizardflow
from wizardflow import WizardFlowError
from wizardflow.otel import OTelBridge
from helpers import _FakeOTelBridge, _new, _read_part
from test_otel import Tracer


def _fake(monkeypatch):
    bridge = _FakeOTelBridge()
    monkeypatch.setattr(
        "wizardflow.client.create_otel_bridge", lambda *args, **kwargs: bridge
    )
    return bridge


def _bridge(**kwargs):
    tracer = Tracer()
    trace_api = SimpleNamespace(set_span_in_context=lambda span: ("parent", span))
    bridge = OTelBridge(tracer, trace_api=trace_api, **kwargs)
    bridge.start_run("2026-09-29T10:00:00.000Z", "run", [{"id": "a"}], [])
    return tracer, bridge


# --- context API -----------------------------------------------------------


def test_workflow_generates_id_and_records_unchanged_jsonl(tmp_path):
    trace = _new(tmp_path, nodes=["a", "b"])
    with trace.workflow() as run:
        assert run.message_id.startswith("wf-")
        with run.node("a") as node:
            node.log_input("question")
        with run.node("b") as node:
            node.log_output("answer")
        run.set_info(title="Consultation", meta={"language": "de"})

    _, messages, _ = _read_part(trace.current_path)
    assert len(messages) == 1
    message = messages[0]
    assert message["id"] == run.message_id
    assert message["label"] == "Consultation"
    assert message["meta"] == {"language": "de"}
    assert [step["nodeId"] for step in message["steps"]] == ["a", "b"]
    assert set(message) == {"type", "id", "label", "meta", "steps"}


def test_workflow_ids_are_unique(tmp_path):
    trace = _new(tmp_path, nodes=["a"])
    ids = set()
    for _ in range(50):
        with trace.workflow() as run:
            trace.log(run.message_id, "a", "x", 1)
        ids.add(run.message_id)
    assert len(ids) == 50


def test_context_exit_finalizes_exactly_once(tmp_path, monkeypatch):
    bridge = _fake(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True)
    with trace.workflow() as run:
        with run.node("a"):
            pass
    trace.end_message(run.message_id)  # idempotent, like any ended message
    assert [call[0] for call in bridge.calls].count("end_workflow") == 1
    _, messages, _ = _read_part(trace.current_path)
    assert len(messages) == 1


def test_set_info_replaces_title_and_merges_meta_and_attributes(tmp_path, monkeypatch):
    bridge = _fake(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True)
    with trace.workflow() as run:
        run.set_info(title="first", meta={"a": 1, "b": 1}, otel_attributes={"x": 1})
        run.set_info(meta={"b": 2}, otel_attributes={"session.id": "s1"})
        run.set_info(title="second")
        trace.log(run.message_id, "a", "x", 1)
    end = next(call for call in bridge.calls if call[0] == "end_workflow")
    _, _, _, title, meta, attributes, error = end
    assert title == "second"
    assert meta == {"a": 1, "b": 2}
    assert attributes == {"x": 1, "session.id": "s1"}
    assert error is None


def test_set_info_after_exit_is_rejected(tmp_path):
    trace = _new(tmp_path, on_error="raise", nodes=["a"])
    with trace.workflow() as run:
        pass
    with pytest.raises(WizardFlowError, match="outside an active workflow"):
        run.set_info(title="late")


def test_set_info_after_exit_is_only_logged_when_silent(tmp_path, caplog):
    trace = _new(tmp_path, nodes=["a"], on_error="warn")
    with trace.workflow() as run:
        pass
    run.set_info(title="late")
    assert "outside an active workflow" in caplog.text


def test_nested_workflow_is_rejected_and_outer_still_finalizes(tmp_path):
    trace = _new(tmp_path, nodes=["a"])
    with pytest.raises(WizardFlowError, match="nested"):
        with trace.workflow() as outer:
            with trace.workflow():
                pass
    _, messages, _ = _read_part(trace.current_path)
    assert [message["id"] for message in messages] == [outer.message_id]
    # The context was restored, so a new top-level workflow works again.
    with trace.workflow():
        pass


def test_parallel_threads_do_not_share_active_workflows(tmp_path):
    trace = _new(tmp_path, nodes=["a"])
    barrier = threading.Barrier(4)
    errors = []

    def work():
        try:
            with trace.workflow() as run:
                barrier.wait(timeout=5)
                with run.node("a") as node:
                    node.log("thread", threading.get_ident())
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=work) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    _, messages, _ = _read_part(trace.current_path)
    assert len(messages) == 4
    assert len({message["id"] for message in messages}) == 4


def test_parallel_async_tasks_do_not_share_active_workflows(tmp_path):
    trace = _new(tmp_path, nodes=["a"])

    async def work(index):
        with trace.workflow() as run:
            await asyncio.sleep(0)
            with run.node("a") as node:
                node.log("task", index)
            await asyncio.sleep(0)
            return run.message_id

    async def main():
        return await asyncio.gather(*(work(index) for index in range(4)))

    ids = asyncio.run(main())
    assert len(set(ids)) == 4
    _, messages, _ = _read_part(trace.current_path)
    assert sorted(message["id"] for message in messages) == sorted(ids)


def test_exception_is_reraised_and_both_outputs_finalize(tmp_path, monkeypatch):
    bridge = _fake(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True)
    with pytest.raises(RuntimeError, match="boom"):
        with trace.workflow() as run:
            with run.node("a"):
                raise RuntimeError("boom")
    end = next(call for call in bridge.calls if call[0] == "end_workflow")
    assert isinstance(end[6], RuntimeError)
    _, messages, _ = _read_part(trace.current_path)
    assert messages[0]["id"] == run.message_id


def test_otel_failure_never_blocks_jsonl(tmp_path, monkeypatch, caplog):
    bridge = _fake(monkeypatch)

    def broken(*args, **kwargs):
        raise RuntimeError("collector down")

    bridge.end_workflow = broken
    trace = _new(tmp_path, nodes=["a"], otel=True)
    with trace.workflow() as run:
        trace.log(run.message_id, "a", "x", 1)
    _, messages, _ = _read_part(trace.current_path)
    assert messages[0]["id"] == run.message_id
    assert "JSONL is unaffected" in caplog.text


def test_module_level_workflow_uses_default_client(tmp_path):
    wizardflow.init(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    with wizardflow.workflow() as run:
        with run.node("a") as node:
            node.log_output("ok")
    _, messages, _ = _read_part(wizardflow.get_default().current_path)
    assert messages[0]["id"] == run.message_id


# --- workflow root shape (bridge) ------------------------------------------


def test_named_root_follows_invoke_workflow_convention():
    tracer, bridge = _bridge(workflow_name="consultation")
    bridge.start_workflow("m1", "2026-09-29T10:00:01.000Z")
    bridge.start_node("m1", "a", "agent", "2026-09-29T10:00:02.000Z", "run")
    bridge.end_node("m1", "a", "agent", "2026-09-29T10:00:03.000Z", [])
    bridge.end_workflow("m1", "2026-09-29T10:00:04.000Z", title="Help me")
    root, node = tracer.spans
    assert root.name == "invoke_workflow consultation"
    assert root.attributes["gen_ai.operation.name"] == "invoke_workflow"
    assert root.attributes["gen_ai.workflow.name"] == "consultation"
    assert root.attributes["wizardflow.message.id"] == "m1"
    assert root.attributes["wizardflow.message.title"] == "Help me"
    # The title never names the root.
    assert "Help me" not in root.name
    assert tracer.calls[1][1]["context"] == ("parent", root)
    assert tracer.calls[0][1]["start_time"] <= tracer.calls[1][1]["start_time"]
    assert node.end_time <= root.end_time


def test_root_uses_internal_span_kind_when_available():
    tracer = Tracer()
    trace_api = SimpleNamespace(
        set_span_in_context=lambda span: span,
        SpanKind=SimpleNamespace(INTERNAL="internal"),
    )
    bridge = OTelBridge(tracer, trace_api=trace_api)
    bridge.start_run("2026-09-29T10:00:00.000Z", None, [], [])
    bridge.start_workflow("m1", "2026-09-29T10:00:01.000Z")
    assert tracer.calls[0][1]["kind"] == "internal"


def test_low_level_root_is_lazy_and_nodes_are_siblings():
    tracer, bridge = _bridge()
    bridge.start_node("m1", "a", "generic", "2026-09-29T10:00:01.000Z", "run")
    bridge.start_node("m1", "b", "generic", "2026-09-29T10:00:02.000Z", "run")
    root, first, second = tracer.spans
    assert root.name == "invoke_workflow"
    assert tracer.calls[0][1]["start_time"] == tracer.calls[1][1]["start_time"]
    assert tracer.calls[1][1]["context"] == tracer.calls[2][1]["context"] == ("parent", root)


def test_ending_an_empty_message_emits_a_zero_child_root():
    tracer, bridge = _bridge()
    bridge.end_workflow("m1", "2026-09-29T10:00:01.000Z")
    (root,) = tracer.spans
    assert root.name == "invoke_workflow"
    assert root.end_time is not None


def test_exception_sets_error_type_status_and_records_it():
    tracer = Tracer()
    statuses = []

    class Status:
        def __init__(self, code, description=None):
            self.code, self.description = code, description

    trace_api = SimpleNamespace(
        set_span_in_context=lambda span: span,
        Status=Status,
        StatusCode=SimpleNamespace(ERROR="error"),
    )
    bridge = OTelBridge(tracer, trace_api=trace_api)
    bridge.start_workflow("m1", "2026-09-29T10:00:01.000Z")
    root = tracer.spans[0]
    root.record_exception = lambda error: statuses.append(("recorded", error))
    root.set_status = lambda status: statuses.append(("status", status.code))
    error = ValueError("bad input")
    bridge.end_workflow("m1", "2026-09-29T10:00:02.000Z", error=error)
    assert root.attributes["error.type"] == "ValueError"
    assert statuses == [("recorded", error), ("status", "error")]


def test_close_ends_unfinished_roots_and_is_idempotent():
    tracer, bridge = _bridge()
    bridge.start_workflow("m1", "2026-09-29T10:00:01.000Z")
    bridge.start_workflow("m2", "2026-09-29T10:00:01.000Z")
    bridge.end_workflow("m2", "2026-09-29T10:00:02.000Z")
    bridge.close("2026-09-29T10:00:03.000Z")
    bridge.close("2026-09-29T10:00:04.000Z")
    root1, root2 = tracer.spans
    assert root1.end_time is not None
    assert "error.type" not in root1.attributes
    assert root2.end_time < root1.end_time


def test_reinit_does_not_move_an_open_workflow():
    tracer, bridge = _bridge()
    bridge.start_workflow("m1", "2026-09-29T10:00:01.000Z")
    bridge.set_root_attributes({"deployment.environment": "next"})
    bridge.reinit_run(
        "2026-09-29T10:00:02.000Z", "2026-09-29T10:00:02.000Z", "renamed", [], []
    )
    bridge.start_node("m1", "a", "generic", "2026-09-29T10:00:03.000Z", "renamed")
    bridge.start_workflow("m2", "2026-09-29T10:00:04.000Z")
    root1, node, root2 = tracer.spans
    assert tracer.calls[1][1]["context"] == ("parent", root1)
    assert "deployment.environment" not in root1.attributes
    assert root2.attributes["deployment.environment"] == "next"
    assert root2.attributes["wizardflow.trace.name"] == "renamed"


def test_graph_event_is_attached_once_per_new_root():
    tracer, bridge = _bridge(export_graph=True)
    bridge.start_workflow("m1", "2026-09-29T10:00:01.000Z")
    bridge.start_node("m1", "a", "generic", "2026-09-29T10:00:02.000Z", "run")
    bridge.start_workflow("m2", "2026-09-29T10:00:03.000Z")
    root1, _node, root2 = tracer.spans
    assert [event[0] for event in root1.events] == ["wizardflow.graph"]
    assert [event[0] for event in root2.events] == ["wizardflow.graph"]


# --- otel_attributes ---------------------------------------------------------


def test_init_attributes_on_every_root_and_workflow_attributes_override():
    tracer, bridge = _bridge(root_attributes={"env": "prod", "session.id": "default"})
    bridge.start_workflow("m1", "2026-09-29T10:00:01.000Z")
    bridge.start_workflow("m2", "2026-09-29T10:00:01.000Z")
    bridge.end_workflow(
        "m1", "2026-09-29T10:00:02.000Z", attributes={"session.id": "s1"}
    )
    bridge.end_workflow("m2", "2026-09-29T10:00:02.000Z")
    root1, root2 = tracer.spans
    assert root1.attributes["env"] == root2.attributes["env"] == "prod"
    assert root1.attributes["session.id"] == "s1"
    assert root2.attributes["session.id"] == "default"


def test_end_message_and_set_info_attributes_reach_the_root_identically(
    tmp_path, monkeypatch
):
    bridge = _fake(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True)
    trace.log("m1", "a", "x", 1)
    trace.end_message("m1", otel_attributes={"session.id": "s1", "tags": ["a", "b"]})
    with trace.workflow() as run:
        run.set_info(otel_attributes={"session.id": "s1", "tags": ["a", "b"]})
    ends = [call for call in bridge.calls if call[0] == "end_workflow"]
    assert ends[0][5] == ends[1][5] == {"session.id": "s1", "tags": ("a", "b")}


def test_init_and_reinit_attributes_feed_root_attributes(tmp_path, monkeypatch):
    received = {}
    bridge = _FakeOTelBridge()

    def create(*args, **kwargs):
        received.update(kwargs)
        return bridge

    monkeypatch.setattr("wizardflow.client.create_otel_bridge", create)
    trace = _new(tmp_path, otel=True, otel_attributes={"env": "prod"})
    assert received["root_attributes"] == {"env": "prod"}
    trace.reinit(otel_attributes={"env": "staging"})
    assert ("set_root_attributes", {"env": "staging"}) in bridge.calls


@pytest.mark.parametrize(
    ("attributes", "message"),
    [
        ({"": 1}, "must not be empty"),
        ({" session.id": 1}, "leading or trailing whitespace"),
        ({"session\n.id": 1}, "control characters"),
        ({"gen_ai.operation.name": "x"}, "protected"),
        ({"GEN_AI.WORKFLOW.NAME": "x"}, "protected"),
        ({"wizardflow.message.id": "x"}, "protected"),
        ({"wizardflow.message.metadata": "x"}, "protected"),
        ({"app.nested": {"x": 1}}, "must be a str"),
        ({"app.none": None}, "must be a str"),
        ({"app.mixed": [1, "a"]}, "must be a str"),
        ({"app.empty": []}, "must be a str"),
        ("session.id", "must be a mapping"),
    ],
)
def test_invalid_otel_attributes_are_rejected(tmp_path, attributes, message):
    trace = _new(tmp_path, on_error="raise", nodes=["a"])
    trace.log("m1", "a", "x", 1)
    with pytest.raises(WizardFlowError, match=message):
        trace.end_message("m1", otel_attributes=attributes)
    with pytest.raises(WizardFlowError, match=message):
        with trace.workflow() as run:
            run.set_info(otel_attributes=attributes)
    with pytest.raises(WizardFlowError, match=message):
        _new(tmp_path, on_error="raise", otel_attributes=attributes)


def test_silent_drops_only_invalid_attribute_entries(tmp_path, monkeypatch, caplog):
    bridge = _fake(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True, on_error="warn")
    trace.log("m1", "a", "x", 1)
    trace.end_message(
        "m1", otel_attributes={"user.id": "u1", "gen_ai.workflow.name": "x"}
    )
    end = next(call for call in bridge.calls if call[0] == "end_workflow")
    assert end[5] == {"user.id": "u1"}
    assert "protected" in caplog.text


def test_recording_scope_ignores_workflow_attributes_with_one_warning(caplog):
    tracer, bridge = _bridge(trace_scope="recording", root_attributes={"env": "prod"})
    bridge.start_workflow("m1", "2026-09-29T10:00:01.000Z")
    bridge.start_node("m1", "a", "generic", "2026-09-29T10:00:01.000Z", "run")
    bridge.end_node("m1", "a", "generic", "2026-09-29T10:00:02.000Z", [])
    with caplog.at_level(logging.WARNING, logger="wizardflow"):
        bridge.end_workflow(
            "m1", "2026-09-29T10:00:02.000Z", attributes={"session.id": "s1"}
        )
        bridge.end_workflow(
            "m2", "2026-09-29T10:00:03.000Z", attributes={"session.id": "s2"}
        )
    run, node = tracer.spans
    assert run.name == "wizardflow.run"
    assert run.attributes["env"] == "prod"
    assert all("session.id" not in span.attributes for span in tracer.spans)
    assert caplog.text.count("ignored in otel_trace_scope='recording'") == 1


def test_recording_scope_workflow_does_not_create_roots(tmp_path, monkeypatch):
    received = {}
    bridge = _FakeOTelBridge()

    def create(*args, **kwargs):
        received.update(kwargs)
        return bridge

    monkeypatch.setattr("wizardflow.client.create_otel_bridge", create)
    trace = _new(tmp_path, nodes=["a"], otel=True, otel_trace_scope="recording")
    with trace.workflow() as run:
        with run.node("a"):
            pass
    assert received["trace_scope"] == "recording"
    _, messages, _ = _read_part(trace.current_path)
    assert messages[0]["id"] == run.message_id


def test_attributes_survive_disabled_content_but_meta_does_not():
    tracer, bridge = _bridge(include_content=False)
    bridge.end_workflow(
        "m1",
        "2026-09-29T10:00:01.000Z",
        title="t",
        meta={"secret": "x"},
        attributes={"session.id": "s1"},
    )
    (root,) = tracer.spans
    assert root.attributes["session.id"] == "s1"
    assert root.attributes["wizardflow.message.title"] == "t"
    assert "wizardflow.message.metadata" not in root.attributes


def test_meta_serialization_is_deterministic_and_bounded():
    tracer, bridge = _bridge(content_max_bytes=12)
    bridge.end_workflow(
        "m1", "2026-09-29T10:00:01.000Z", meta={"z": "long value", "a": 1}
    )
    (root,) = tracer.spans
    value = root.attributes["wizardflow.message.metadata"]
    assert value == '{"a":1,"z":"'
    assert root.attributes["wizardflow.message.metadata.truncated"] is True


def test_jsonl_output_is_unchanged_by_otel_attributes(tmp_path):
    plain = _new(tmp_path / "plain", nodes=["a"])
    tagged = _new(tmp_path / "tagged", nodes=["a"], otel_attributes={"env": "prod"})
    for trace, attributes in ((plain, None), (tagged, {"session.id": "s1"})):
        trace.log("m1", "a", "x", 1)
        trace.end_message("m1", otel_attributes=attributes)
    strip = lambda message: {  # noqa: E731
        **message,
        "steps": [{**step, "timestamp": None, "endTimestamp": None} for step in message["steps"]],
    }
    assert [strip(m) for m in _read_part(plain.current_path)[1]] == [
        strip(m) for m in _read_part(tagged.current_path)[1]
    ]


# --- real OpenTelemetry SDK --------------------------------------------------


def _real_sdk(monkeypatch):
    sdk_trace = pytest.importorskip("opentelemetry.sdk.trace")
    export = pytest.importorskip("opentelemetry.sdk.trace.export")
    memory = pytest.importorskip(
        "opentelemetry.sdk.trace.export.in_memory_span_exporter"
    )
    otel_trace = pytest.importorskip("opentelemetry.trace")
    exporter = memory.InMemorySpanExporter()
    provider = sdk_trace.TracerProvider()
    provider.add_span_processor(export.SimpleSpanProcessor(exporter))

    def create(endpoint=None, **kwargs):
        kwargs.pop("project_name", None)
        return OTelBridge(provider.get_tracer("test"), trace_api=otel_trace, **kwargs)

    monkeypatch.setattr("wizardflow.client.create_otel_bridge", create)
    return exporter, otel_trace


def test_real_sdk_one_trace_per_workflow_with_parented_nodes(tmp_path, monkeypatch):
    exporter, otel_trace = _real_sdk(monkeypatch)
    trace = _new(
        tmp_path, nodes=["a", "b"], otel=True, otel_workflow_name="consultation"
    )
    with trace.workflow() as first:
        # The root is current inside the block, for auto-instrumentation.
        current = otel_trace.get_current_span()
        with first.node("a"):
            pass
        with first.node("b"):
            pass
    with trace.workflow() as second:
        with second.node("a"):
            pass

    spans = exporter.get_finished_spans()
    roots = [span for span in spans if span.name == "invoke_workflow consultation"]
    assert len(roots) == 2
    assert current.get_span_context().span_id == roots[0].context.span_id
    assert roots[0].kind == otel_trace.SpanKind.INTERNAL
    assert roots[0].context.trace_id != roots[1].context.trace_id
    for root in roots:
        children = [
            span
            for span in spans
            if span.parent is not None and span.parent.span_id == root.context.span_id
        ]
        assert children
        assert all(child.context.trace_id == root.context.trace_id for child in children)
        assert root.start_time <= min(child.start_time for child in children)
        assert root.end_time >= max(child.end_time for child in children)
    assert otel_trace.get_current_span() is otel_trace.INVALID_SPAN


def test_real_sdk_exception_marks_root_as_error(tmp_path, monkeypatch):
    exporter, otel_trace = _real_sdk(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True)
    with pytest.raises(KeyError):
        with trace.workflow() as run:
            with run.node("a"):
                raise KeyError("missing")
    root = next(s for s in exporter.get_finished_spans() if s.name == "invoke_workflow")
    assert root.status.status_code == otel_trace.StatusCode.ERROR
    assert root.attributes["error.type"] == "KeyError"
    assert [event.name for event in root.events] == ["exception"]
    assert otel_trace.get_current_span() is otel_trace.INVALID_SPAN


def test_real_sdk_overlapping_low_level_messages_are_independent(tmp_path, monkeypatch):
    exporter, _ = _real_sdk(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True)
    trace.start_node("m1", "a")
    trace.start_node("m2", "a")
    trace.end_message("m2", otel_attributes={"session.id": "s2"})
    trace.end_message("m1", otel_attributes={"session.id": "s1"})
    roots = {
        span.attributes["wizardflow.message.id"]: span
        for span in exporter.get_finished_spans()
        if span.name == "invoke_workflow"
    }
    assert roots["m1"].context.trace_id != roots["m2"].context.trace_id
    assert roots["m1"].attributes["session.id"] == "s1"
    assert roots["m2"].attributes["session.id"] == "s2"
