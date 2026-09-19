import pytest

from wizardflow.otel_file_exporter import ExportOptions, export_trace_chain
from wizardflow.reader import TraceChain


class Bridge:
    def __init__(self):
        self.calls = []

    def start_run(self, *args): self.calls.append(("run", args))
    def start_message(self, *args): self.calls.append(("message", args))
    def start_node(self, *args): self.calls.append(("start", args))
    def end_node(self, *args): self.calls.append(("end", args))
    def end_message(self, *args, **kwargs): self.calls.append(("end_message", args, kwargs))
    def close(self, *args): self.calls.append(("close", args))


def test_offline_export_replays_resolved_timestamps_through_shared_bridge(monkeypatch, tmp_path):
    bridge = Bridge()
    created = {}
    def create_bridge(*args, **kwargs):
        created.update(kwargs)
        return bridge
    monkeypatch.setattr(
        "wizardflow.otel_file_exporter.create_otel_bridge",
        create_bridge,
    )
    trace = {
        "name": "demo",
        "graph": {"nodes": [{"id": "model"}], "edges": []},
        "messages": [{
            "id": "m1",
            "title": "Hello",
            "steps": [{
                "nodeId": "model",
                "kind": "llm",
                "timestamp": "2026-09-17T10:00:00Z",
                "endTimestamp": "2026-09-17T10:00:02Z",
                "payloads": [{"label": "output", "value": "hi", "semanticType": "output"}],
            }],
        }],
    }
    summary = export_trace_chain(
        TraceChain(trace, (tmp_path / "run.jsonl",), False),
        ExportOptions(endpoint="http://collector", trace_scope="message"),
    )
    assert summary.node_spans == 1 and summary.traces == 1
    assert created["root_attributes"]["wizardflow.export.mode"] == "offline"
    assert created["root_attributes"]["wizardflow.export.node_span_count"] == 1
    assert ("start", ("m1", "model", "llm", "2026-09-17T10:00:00Z", "demo")) in bridge.calls
    assert bridge.calls[-1] == ("close", ("2026-09-17T10:00:02Z",))


def test_offline_export_rejects_negative_node_interval(monkeypatch, tmp_path):
    bridge = Bridge()
    monkeypatch.setattr(
        "wizardflow.otel_file_exporter.create_otel_bridge",
        lambda *args, **kwargs: bridge,
    )
    trace = {
        "graph": {"nodes": [{"id": "a"}], "edges": []},
        "messages": [{
            "id": "m1",
            "steps": [{
                "nodeId": "a",
                "timestamp": "2026-09-17T10:00:02Z",
                "endTimestamp": "2026-09-17T10:00:01Z",
                "payloads": [],
            }],
        }],
    }
    with pytest.raises(ValueError, match="endTimestamp precedes timestamp"):
        export_trace_chain(
            TraceChain(trace, (tmp_path / "run.jsonl",), False),
            ExportOptions(endpoint="http://collector"),
        )
    assert bridge.calls[-1][0] == "close"
