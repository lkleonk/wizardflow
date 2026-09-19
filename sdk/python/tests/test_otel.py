"""Tests for the optional OTel bridge and transport-neutral mapper."""

import json
from types import SimpleNamespace

import pytest

from wizardflow.otel import OTelBridge, OTelConfigurationError, create_otel_bridge
from wizardflow.otel_mapping import map_graph_event, map_node_attributes


class Span:
    def __init__(self, name):
        self.name = name
        self.attributes = {}
        self.events = []
        self.end_time = None

    def set_attribute(self, name, value):
        self.attributes[name] = value

    def add_event(self, name, attributes=None):
        self.events.append((name, attributes))

    def end(self, end_time):
        self.end_time = end_time


class Tracer:
    def __init__(self):
        self.spans = []
        self.calls = []

    def start_span(self, name, **kwargs):
        span = Span(name)
        span.attributes.update(kwargs.get("attributes", {}))
        self.spans.append(span)
        self.calls.append((name, kwargs, span))
        return span


def test_missing_otel_package_has_direct_install_command(monkeypatch):
    def missing(name):
        raise ImportError(name)

    monkeypatch.setattr("wizardflow.otel.import_module", missing)
    with pytest.raises(OTelConfigurationError, match="pip install opentelemetry-api"):
        create_otel_bridge()


def test_existing_configuration_uses_global_tracer_without_sdk(monkeypatch):
    tracer = object()

    def load(name):
        assert name == "opentelemetry.trace"
        return SimpleNamespace(get_tracer=lambda instrument: tracer)

    monkeypatch.setattr("wizardflow.otel.import_module", load)
    bridge = create_otel_bridge()
    assert bridge._tracer is tracer
    assert bridge._provider is None


def test_endpoint_uses_private_provider_without_setting_global(monkeypatch):
    tracer = object()
    exporter = object()
    processor = object()

    class Provider:
        def __init__(self, *, resource=None):
            self.processors = []
            self.resource = resource

        def add_span_processor(self, value):
            self.processors.append(value)

        def get_tracer(self, name):
            return tracer

    global_trace = SimpleNamespace(
        set_tracer_provider=lambda provider: pytest.fail("global provider replaced")
    )
    modules = {
        "opentelemetry.trace": global_trace,
        "opentelemetry.sdk.trace": SimpleNamespace(TracerProvider=Provider),
        "opentelemetry.sdk.resources": SimpleNamespace(
            Resource=SimpleNamespace(create=lambda attributes: attributes)
        ),
        "opentelemetry.sdk.trace.export": SimpleNamespace(
            BatchSpanProcessor=lambda value: processor
        ),
        "opentelemetry.exporter.otlp.proto.http.trace_exporter": SimpleNamespace(
            OTLPSpanExporter=lambda endpoint: exporter
        ),
    }
    monkeypatch.setattr("wizardflow.otel.import_module", modules.__getitem__)
    bridge = create_otel_bridge(
        "http://collector:4318/v1/traces", project_name="consultant"
    )
    assert bridge._tracer is tracer
    assert bridge._provider.processors == [processor]
    assert bridge._provider.resource == {
        "openinference.project.name": "consultant"
    }


def test_mapper_uses_genai_only_for_known_kind_and_semantics():
    payloads = [
        {"label": "input", "value": {"prompt": "hi"}, "semanticType": "input"},
        {
            "label": "model_parameters",
            "value": {"model": "gpt-5", "temperature": 0.7},
            "semanticType": "model_parameters",
        },
        {
            "label": "usage",
            "value": {"inputTokens": 12, "outputTokens": 3},
            "semanticType": "usage",
        },
        {"label": "output", "value": "hello", "semanticType": "output"},
    ]
    attrs = map_node_attributes(
        message_id="m1",
        node_id="model",
        kind="llm",
        payloads=payloads,
        include_content=True,
    )
    assert attrs["gen_ai.request.model"] == "gpt-5"
    assert attrs["gen_ai.request.temperature"] == 0.7
    assert attrs["gen_ai.usage.input_tokens"] == 12
    assert json.loads(attrs["gen_ai.input.messages"])[0]["role"] == "user"
    assert json.loads(attrs["gen_ai.output.messages"])[0]["role"] == "assistant"
    assert "gen_ai.operation.name" not in attrs
    assert not any(name.startswith("input.value") for name in attrs)

    generic = map_node_attributes(
        message_id="m1",
        node_id="python",
        kind="generic",
        payloads=payloads,
        include_content=True,
    )
    assert "gen_ai.request.model" not in generic
    assert generic["wizardflow.model_parameter.model"] == "gpt-5"
    assert generic["wizardflow.usage.input_tokens"] == 12
    assert generic["wizardflow.input.encoding"] == "json"


@pytest.mark.parametrize(
    ("kind", "operation"),
    [
        ("agent", "invoke_agent"),
        ("tool", "execute_tool"),
        ("retriever", "retrieval"),
        ("embedding", "embeddings"),
    ],
)
def test_standard_operations_are_emitted_only_where_defined(kind, operation):
    attrs = map_node_attributes(
        message_id="m1", node_id="node", kind=kind, payloads=[]
    )
    assert attrs["gen_ai.operation.name"] == operation


@pytest.mark.parametrize("kind", ["generic", "llm", "reranker"])
def test_ambiguous_or_unsupported_kinds_do_not_invent_operations(kind):
    attrs = map_node_attributes(
        message_id="m1", node_id="node", kind=kind, payloads=[]
    )
    assert "gen_ai.operation.name" not in attrs


def test_generic_logs_preserve_scalars_duplicates_and_explicit_opt_out():
    attrs = map_node_attributes(
        message_id="m1",
        node_id="a",
        kind="generic",
        payloads=[
            {"label": "Confidence", "value": 0.91},
            {"label": "confidence", "value": 0.92},
            {"label": "nested", "value": {"x": 1}},
            {"label": "private", "value": True, "exportToOtel": False},
        ],
        include_content=False,
    )
    assert attrs["wizardflow.log.confidence"] == 0.91
    assert attrs["wizardflow.log.confidence.1"] == 0.92
    assert "wizardflow.log.nested" not in attrs
    assert "wizardflow.log.private" not in attrs
    assert "wizardflow.log.count" not in attrs


def test_semantic_projection_is_last_write_wins():
    attrs = map_node_attributes(
        message_id="m1",
        node_id="model",
        kind="llm",
        payloads=[
            {"label": "input", "value": "old", "semanticType": "input"},
            {"label": "input", "value": "new", "semanticType": "input"},
            {
                "label": "model_parameters",
                "value": {"model": "old", "temperature": 0.1},
                "semanticType": "model_parameters",
            },
            {
                "label": "model_parameters",
                "value": {"model": "new"},
                "semanticType": "model_parameters",
            },
            {
                "label": "usage",
                "value": {"inputTokens": 1},
                "semanticType": "usage",
            },
            {
                "label": "usage",
                "value": {"inputTokens": 2},
                "semanticType": "usage",
            },
        ],
        include_content=True,
    )
    assert json.loads(attrs["gen_ai.input.messages"])[0]["parts"][0]["content"] == "new"
    assert attrs["gen_ai.request.model"] == "new"
    assert attrs["gen_ai.request.temperature"] == 0.1
    assert attrs["gen_ai.usage.input_tokens"] == 2


def test_content_is_deterministic_and_utf8_bounded():
    attrs = map_node_attributes(
        message_id="m1",
        node_id="a",
        kind="generic",
        payloads=[{"label": "data", "value": {"z": "🙂🙂", "a": 1}}],
        include_content=True,
        content_max_bytes=10,
    )
    value = attrs["wizardflow.log.data"]
    assert len(value.encode("utf-8")) <= 10
    assert attrs["wizardflow.log.data.truncated"] is True
    assert attrs["wizardflow.log.data.encoding"] == "json"


def test_graph_event_is_canonical_and_oversize_is_summarized():
    graph = map_graph_event([{"id": "b"}, {"id": "a"}], [{"target": "b", "source": "a"}])
    assert json.loads(graph["wizardflow.graph.nodes"]) == [{"id": "b"}, {"id": "a"}]
    assert graph["wizardflow.graph.node_count"] == 2

    omitted = map_graph_event([{"id": "long-value"}], [], max_bytes=5)
    assert omitted["wizardflow.graph.omitted"] is True
    assert len(omitted["wizardflow.graph.content_hash"]) == 64
    assert "wizardflow.graph.nodes" not in omitted


def test_bridge_creates_root_parent_context_graph_event_and_resolved_times():
    tracer = Tracer()
    trace_api = SimpleNamespace(set_span_in_context=lambda span: ("parent", span))
    bridge = OTelBridge(tracer, trace_api=trace_api, export_graph=True)
    bridge.start_run(
        "2026-09-15T10:00:00.000Z", "run", [{"id": "a"}], []
    )
    bridge.start_node(
        "m1", "a", "agent", "2026-09-15T10:00:01.000Z", "run"
    )
    bridge.end_node(
        "m1",
        "a",
        "agent",
        "2026-09-15T10:00:02.000Z",
        [{"label": "confidence", "value": 1}],
        {"ok": True, "unsafe": {"x": 1}},
    )
    root, node = tracer.spans
    assert root.events[0][0] == "wizardflow.graph"
    assert tracer.calls[1][1]["context"] == ("parent", root)
    assert node.attributes["gen_ai.operation.name"] == "invoke_agent"
    assert node.attributes["wizardflow.log.confidence"] == 1
    assert "wizardflow.message.meta.unsafe" not in node.attributes
    assert node.end_time > tracer.calls[1][1]["start_time"]


def test_message_scope_creates_independent_roots_for_overlapping_messages():
    tracer = Tracer()
    trace_api = SimpleNamespace(set_span_in_context=lambda span: ("parent", span))
    bridge = OTelBridge(tracer, trace_api=trace_api, trace_scope="message")
    bridge.start_run(
        "2026-09-15T10:00:00.000Z", "agent", [{"id": "a"}], []
    )

    bridge.start_node(
        "m1", "a", "agent", "2026-09-15T10:00:01.000Z", "agent"
    )
    bridge.start_node(
        "m2", "a", "agent", "2026-09-15T10:00:02.000Z", "agent"
    )
    root1, node1, root2, node2 = tracer.spans
    assert root1.name == root2.name == "wizardflow.message"
    assert tracer.calls[1][1]["context"] == ("parent", root1)
    assert tracer.calls[3][1]["context"] == ("parent", root2)

    bridge.end_node(
        "m2", "a", "agent", "2026-09-15T10:00:03.000Z", []
    )
    bridge.end_message(
        "m2",
        "2026-09-15T10:00:04.000Z",
        title="Second",
        meta={"outcome": "ok", "nested": {"ignored": True}},
    )
    assert node2.end_time is not None
    assert root2.end_time is not None
    assert root2.attributes["wizardflow.message.title"] == "Second"
    assert root2.attributes["wizardflow.message.meta.outcome"] == "ok"
    assert "wizardflow.message.meta.nested" not in root2.attributes
    assert root1.end_time is None
    assert node1.end_time is None


def test_close_flushes_private_provider_only_and_is_idempotent():
    calls = []
    provider = SimpleNamespace(
        force_flush=lambda: calls.append("flush"),
        shutdown=lambda: calls.append("shutdown"),
    )
    tracer = Tracer()
    bridge = OTelBridge(tracer, provider=provider)
    bridge.start_run("2026-09-15T10:00:00.000Z", None, [], [])
    bridge.close("2026-09-15T10:00:01.000Z")
    bridge.close("2026-09-15T10:00:02.000Z")
    assert calls == ["flush", "shutdown"]
    assert tracer.spans[0].end_time is not None

    global_tracer = Tracer()
    global_bridge = OTelBridge(global_tracer)
    global_bridge.start_run("2026-09-15T10:00:00.000Z", None, [], [])
    global_bridge.close("2026-09-15T10:00:01.000Z")


def test_close_reports_private_provider_flush_failure():
    provider = SimpleNamespace(force_flush=lambda: False, shutdown=lambda: None)
    bridge = OTelBridge(Tracer(), provider=provider)
    bridge.start_run("2026-09-15T10:00:00.000Z", None, [], [])
    with pytest.raises(OTelConfigurationError, match="did not flush"):
        bridge.close("2026-09-15T10:00:01.000Z")
