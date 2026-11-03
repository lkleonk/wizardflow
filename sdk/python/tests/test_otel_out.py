"""`wizardflow otel export --out`: OTLP JSON files without the OTel packages."""

import json
import sys

import pytest

from wizardflow.cli import main
from wizardflow.otel import OTelBridge
from wizardflow.otel_file_exporter import ExportOptions, export_trace_chain
from wizardflow.otlp_writer import iter_written_requests
from wizardflow.reader import TraceChain
from wizardflow.store import import_otlp_file, open_store
from wizardflow.store.otlp import iter_requests, iter_spans
from wizardflow.store.schema import FLAG_TOPOLOGY, FLAG_WIZARDFLOW

TRACE = {
    "name": "student-advisor",
    "graph": {
        "nodes": [{"id": "classifier", "kind": "agent"}, {"id": "advisor", "kind": "llm"}],
        "edges": [{"source": "classifier", "target": "advisor"}],
    },
    "messages": [
        {
            "id": "m1",
            "label": "Can I switch majors?",
            "steps": [
                {"nodeId": "classifier", "kind": "agent",
                 "timestamp": "2026-10-11T10:00:00Z", "endTimestamp": "2026-10-11T10:00:01Z",
                 "payloads": [{"label": "route", "value": "planning"}]},
                {"nodeId": "advisor", "kind": "llm",
                 "timestamp": "2026-10-11T10:00:01Z", "endTimestamp": "2026-10-11T10:00:04Z",
                 "payloads": [{"label": "output", "value": "Yes.", "semanticType": "output"}]},
            ],
        },
        {
            "id": "m2",
            "label": "And the thesis?",
            "steps": [
                {"nodeId": "classifier", "kind": "agent",
                 "timestamp": "2026-10-11T10:05:00Z", "endTimestamp": "2026-10-11T10:05:01Z",
                 "payloads": []},
            ],
        },
    ],
}


def _chain(tmp_path):
    return TraceChain(TRACE, (tmp_path / "run.jsonl",), True)


def _write_jsonl(path):
    header = {"type": "header", "version": "0.2", "name": TRACE["name"], "graph": TRACE["graph"]}
    lines = [header] + [{"type": "message", **m} for m in TRACE["messages"]]
    path.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
    return path


def test_file_export_is_otlp_with_one_line_per_workflow(tmp_path):
    out = tmp_path / "run.otlp.jsonl"
    summary = export_trace_chain(_chain(tmp_path), ExportOptions(out=out, export_graph=True))
    assert (summary.traces, summary.node_spans) == (2, 3)

    requests = list(iter_requests(out.read_text(encoding="utf-8")))
    assert len(requests) == 2  # one ExportTraceServiceRequest per trace
    spans = [span for request in requests for span in iter_spans(request)]
    roots = [s for s in spans if s.parent_span_id is None]
    assert [r.name for r in roots] == ["invoke_workflow", "invoke_workflow"]
    for root in roots:
        children = [s for s in spans if s.parent_span_id == root.span_id]
        assert children and all(c.trace_id == root.trace_id for c in children)
        assert [e.name for e in root.events] == ["wizardflow.graph"]
    resource = spans[0].resource.attributes
    assert resource["openinference.project.name"] == "student-advisor"
    assert resource["service.name"] == "student-advisor"
    classifier = next(s for s in spans if s.name == "classifier")
    assert classifier.attributes["wizardflow.payload.route"] == "planning"
    # 2026-10-11T10:00:00Z / 10:00:01Z as unix nanoseconds
    assert (classifier.start_ns, classifier.end_ns) == (1_791_712_800_000_000_000, 1_791_712_801_000_000_000)


def test_file_export_imports_as_replayable_wizardflow_traces(tmp_path):
    out = tmp_path / "run.otlp.jsonl"
    export_trace_chain(_chain(tmp_path), ExportOptions(out=out, export_graph=True))
    con = open_store(tmp_path / "wf.db")
    result = import_otlp_file(con, out)
    assert (result.spans, result.traces, result.projects) == (5, 2, ["student-advisor"])
    flags = [f for (f,) in con.execute("SELECT flags FROM traces")]
    assert all(f & FLAG_WIZARDFLOW and f & FLAG_TOPOLOGY for f in flags)
    nodes = {n for (n,) in con.execute("SELECT node_id FROM spans WHERE node_id IS NOT NULL")}
    assert nodes == {"classifier", "advisor"}
    con.close()


def test_file_export_needs_no_opentelemetry_packages(tmp_path, monkeypatch):
    # None in sys.modules makes any `import opentelemetry…` raise ImportError.
    for name in [m for m in list(sys.modules) if m == "opentelemetry" or m.startswith("opentelemetry.")]:
        monkeypatch.delitem(sys.modules, name)
    monkeypatch.setitem(sys.modules, "opentelemetry", None)
    out = tmp_path / "run.otlp.jsonl"
    export_trace_chain(_chain(tmp_path), ExportOptions(out=out))
    assert sum(1 for _ in iter_written_requests(out)) == 2


def test_cli_out_defaults_to_graph_and_full_content(tmp_path, capsys):
    source = _write_jsonl(tmp_path / "run.jsonl")
    out = tmp_path / "run.otlp.jsonl"
    assert main(["otel", "export", str(source), "--out", str(out)]) == 0
    err = capsys.readouterr().err
    assert f"to {out}" in err and "wizardflow db import" in err
    spans = [s for r in iter_requests(out.read_text(encoding="utf-8")) for s in iter_spans(r)]
    assert any(e.name == "wizardflow.graph" for s in spans for e in s.events)

    bare = tmp_path / "bare.otlp.jsonl"
    assert main(["otel", "export", str(source), "--out", str(bare), "--no-export-graph"]) == 0
    spans = [s for r in iter_requests(bare.read_text(encoding="utf-8")) for s in iter_spans(r)]
    assert not any(s.events for s in spans)


def test_cli_rejects_endpoint_and_out_together(tmp_path):
    source = _write_jsonl(tmp_path / "run.jsonl")
    with pytest.raises(SystemExit) as exc:
        main(["otel", "export", str(source), "--out", "x.jsonl", "--endpoint", "http://c"])
    assert exc.value.code == 2


def test_file_export_matches_the_real_otel_sdk(tmp_path, monkeypatch):
    """Golden check: the recorder and the OTel SDK see the same bridge calls,
    so names, parents, kinds, attributes and events must agree."""
    trace_api = pytest.importorskip("opentelemetry.trace")
    sdk_trace = pytest.importorskip("opentelemetry.sdk.trace")
    in_memory = pytest.importorskip(
        "opentelemetry.sdk.trace.export.in_memory_span_exporter"
    )
    sdk_export = pytest.importorskip("opentelemetry.sdk.trace.export")

    exporter = in_memory.InMemorySpanExporter()
    provider = sdk_trace.TracerProvider()
    provider.add_span_processor(sdk_export.SimpleSpanProcessor(exporter))

    def sdk_bridge(_endpoint, *, project_name=None, **options):
        return OTelBridge(provider.get_tracer("wizardflow"), trace_api=trace_api, **options)

    monkeypatch.setattr("wizardflow.otel_file_exporter.create_otel_bridge", sdk_bridge)
    export_trace_chain(
        _chain(tmp_path),
        ExportOptions(endpoint="http://unused", exporter="otel-sdk", export_graph=True),
    )
    out = tmp_path / "run.otlp.jsonl"
    export_trace_chain(_chain(tmp_path), ExportOptions(out=out, export_graph=True))

    def shape(name, parent_name, kind, attributes, events):
        return (name, parent_name, kind, json.dumps(attributes, sort_keys=True),
                json.dumps(events, sort_keys=True))

    sdk_spans = exporter.get_finished_spans()
    sdk_names = {s.context.span_id: s.name for s in sdk_spans}
    expected = sorted(
        shape(
            s.name,
            sdk_names.get(s.parent.span_id) if s.parent else None,
            int(s.kind.value) + 1 if s.kind.value < 5 else s.kind.value,  # SDK enum is 0-based
            {k: list(v) if isinstance(v, tuple) else v for k, v in s.attributes.items()},
            [(e.name, {k: list(v) if isinstance(v, tuple) else v for k, v in e.attributes.items()})
             for e in s.events],
        )
        for s in sdk_spans
    )
    file_spans = [s for r in iter_requests(out.read_text(encoding="utf-8")) for s in iter_spans(r)]
    file_names = {s.span_id: s.name for s in file_spans}
    actual = sorted(
        shape(s.name, file_names.get(s.parent_span_id), s.kind, s.attributes,
              [(e.name, e.attributes) for e in s.events])
        for s in file_spans
    )
    assert actual == expected
