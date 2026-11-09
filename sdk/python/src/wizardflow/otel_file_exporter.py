"""Project existing WizardFlow artifacts to fresh OpenTelemetry traces."""

from __future__ import annotations

import importlib.metadata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional

from .otel import (
    DEFAULT_OTEL_TRACE_SCOPE,
    OTEL_TRACE_SCOPES,
    PROJECT_NAME_RESOURCE,
    OTelBridge,
    OTelExportError,
    create_otel_bridge,
)
from .otel_mapping import (
    DEFAULT_CONTENT_MAX_BYTES,
    DEFAULT_GRAPH_MAX_BYTES,
    NODE_KINDS,
)
from .otlp_http import env_resource_attributes, send_trace_requests
from .otlp_writer import SpanRecorder, build_trace_requests, write_otlp_json
from .reader import TraceChain


EXPORTERS = ("builtin", "otel-sdk")
# Spans per request to an endpoint, the OTel SDK's default batch size.
ENDPOINT_BATCH_SPANS = 512


@dataclass(frozen=True)
class ExportOptions:
    """Exactly one target: an OTLP/HTTP ``endpoint`` or an ``out`` file.

    ``exporter`` picks how an endpoint is reached: ``builtin`` (the standard
    library, the default) or ``otel-sdk`` (the OpenTelemetry SDK and its
    OTLP/HTTP exporter, kept to compare the two side by side).
    """

    endpoint: Optional[str] = None
    out: Optional[Path] = None
    trace_scope: str = DEFAULT_OTEL_TRACE_SCOPE
    workflow_name: Optional[str] = None
    include_content: bool = True
    content_max_bytes: int = DEFAULT_CONTENT_MAX_BYTES
    export_graph: bool = False
    graph_max_bytes: int = DEFAULT_GRAPH_MAX_BYTES
    exporter: str = "builtin"


@dataclass(frozen=True)
class ExportSummary:
    parts: int
    messages: int
    node_spans: int
    traces: int
    sealed: bool


def export_trace_chain(unit: TraceChain, options: ExportOptions) -> ExportSummary:
    if options.trace_scope not in OTEL_TRACE_SCOPES:
        raise ValueError(f"unknown OTel trace scope: {options.trace_scope!r}")
    if options.content_max_bytes <= 0 or options.graph_max_bytes <= 0:
        raise ValueError("OTel byte limits must be positive")
    if (options.endpoint is None) == (options.out is None):
        raise ValueError("export needs exactly one target: an endpoint or an output file")
    if options.exporter not in EXPORTERS:
        raise ValueError(f"unknown exporter: {options.exporter!r}")

    trace = unit.trace
    messages = trace.get("messages", [])
    # No OTel packages unless asked for: the same bridge drives a span
    # recorder, whose spans are then written to the file or sent.
    use_sdk = options.out is None and options.exporter == "otel-sdk"
    recorder = None if use_sdk else SpanRecorder()
    if recorder is not None:
        bridge = OTelBridge(recorder, trace_api=recorder, **_bridge_options(unit, options))
    else:
        bridge = create_otel_bridge(
            options.endpoint, project_name=trace.get("name"), **_bridge_options(unit, options)
        )
    span_count = _replay_into(bridge, unit)
    trace_count = len(messages) if options.trace_scope == "workflow" else 1
    if recorder is not None and options.out is not None:
        trace_count = write_otlp_json(
            recorder.finished,
            options.out,
            resource_attributes=_file_resource(trace.get("name")),
            scope_version=_package_version(),
        )
    elif recorder is not None and options.endpoint is not None:
        trace_count = len({span.trace_id for span in recorder.finished})
        send_trace_requests(
            build_trace_requests(
                recorder.finished,
                resource_attributes=_endpoint_resource(trace.get("name")),
                scope_version=_package_version(),
                max_spans=ENDPOINT_BATCH_SPANS,
            ),
            options.endpoint,
        )
    return ExportSummary(
        len(unit.parts), len(messages), span_count, trace_count, unit.sealed
    )


def trace_chain_requests(unit: TraceChain, options: ExportOptions) -> List[Dict[str, Any]]:
    """The run as OTLP JSON requests, for importing into the local store.

    Unlike an export, the ids are derived from the run instead of random, so
    importing it again, or after it has grown, adds only what is new. The
    run's executions also share a conversation, which is what keeps them
    together in the dashboard and in one graph replay.
    """
    recorder = SpanRecorder(id_seed=_run_seed(unit.trace))
    bridge_options = _bridge_options(unit, options)
    bridge_options["root_attributes"].update(_run_conversation(unit.trace))
    _replay_into(OTelBridge(recorder, trace_api=recorder, **bridge_options), unit)
    return build_trace_requests(
        recorder.finished,
        resource_attributes=_file_resource(unit.trace.get("name")),
        scope_version=_package_version(),
    )


def _run_seed(trace: Mapping[str, Any]) -> str:
    """What tells this run from another: messages are only ever appended, so
    the start of the first one stays put as a run grows."""
    messages = trace.get("messages", [])
    first = messages[0] if messages else {}
    steps = first.get("steps", [])
    started = steps[0].get("timestamp") if steps else None
    return "\0".join(str(part) for part in (trace.get("name"), first.get("id"), started))


def _run_conversation(trace: Mapping[str, Any]) -> Dict[str, str]:
    """Conversation attributes for a whole run, named after when it started
    (stable as it grows). Both keys, so the mapping presets all pick it up."""
    started = next(iter(_timestamps(trace.get("messages", []))), None)
    if started is None:
        return {}
    conversation = f"run {started}"
    return {"gen_ai.conversation.id": conversation, "session.id": conversation}


def _bridge_options(unit: TraceChain, options: ExportOptions) -> Dict[str, Any]:
    messages = unit.trace.get("messages", [])
    return dict(
        trace_scope=options.trace_scope,
        workflow_name=options.workflow_name,
        include_content=options.include_content,
        content_max_bytes=options.content_max_bytes,
        export_graph=options.export_graph,
        graph_max_bytes=options.graph_max_bytes,
        root_attributes={
            "wizardflow.export.mode": "offline",
            "wizardflow.export.source_format": unit.source_format,
            "wizardflow.export.part_count": len(unit.parts),
            "wizardflow.export.message_count": len(messages),
            "wizardflow.export.node_span_count": sum(
                len(message.get("steps", [])) for message in messages
            ),
            "wizardflow.export.source_sealed": unit.sealed,
        },
    )


def _replay_into(bridge: OTelBridge, unit: TraceChain) -> int:
    """Drive the bridge through the recorded run; returns the node span count."""
    trace = unit.trace
    graph = trace.get("graph", {})
    messages = trace.get("messages", [])
    timestamps = list(_timestamps(messages))
    fallback = trace.get("meta", {}).get("createdAt") or datetime.now(timezone.utc).isoformat()
    start = min(timestamps, key=_timestamp_key) if timestamps else fallback
    end = max(timestamps, key=_timestamp_key) if timestamps else start
    span_count = 0
    try:
        bridge.start_run(
            start,
            trace.get("name"),
            graph.get("nodes", []),
            graph.get("edges", []),
            trace.get("meta"),
        )
        for message in messages:
            message_id = str(message.get("id", ""))
            steps = message.get("steps", [])
            message_start = steps[0].get("timestamp", start) if steps else start
            message_end = message_start
            bridge.start_workflow(message_id, message_start)
            for step in steps:
                node_id = str(step.get("nodeId", ""))
                step_start = step.get("timestamp") or start
                step_end = step.get("endTimestamp") or step_start
                try:
                    if _timestamp_key(step_end) < _timestamp_key(step_start):
                        raise ValueError("endTimestamp precedes timestamp")
                except (AttributeError, TypeError, ValueError) as exc:
                    raise ValueError(
                        f"message {message_id!r}, node {node_id!r}: invalid timing: {exc}"
                    ) from exc
                message_end = max((message_end, step_end), key=_timestamp_key)
                kind = step.get("kind", "generic")
                if kind not in NODE_KINDS:
                    kind = "generic"
                bridge.start_node(
                    message_id,
                    node_id,
                    kind,
                    step_start,
                    trace.get("name"),
                )
                bridge.end_node(
                    message_id,
                    node_id,
                    kind,
                    step_end,
                    step.get("payloads", []),
                    message.get("meta"),
                )
                span_count += 1
            # The persisted message title lives in ``label``. otel_attributes
            # are OTel-only and not persisted, so offline roots lack them.
            bridge.end_workflow(
                message_id,
                message_end,
                title=message.get("label"),
                meta=message.get("meta"),
            )
    except BaseException:
        # Close (and flush what we have) without letting a flush failure
        # replace the error that actually stopped the export.
        bridge.close(end)
        raise
    if bridge.close(end) is False:
        raise OTelExportError(
            "OpenTelemetry provider did not flush all spans; the export may be incomplete"
        )
    return span_count


def _file_resource(trace_name: Optional[str]) -> Dict[str, Any]:
    """The resource of a file export: the run's name is its project, as with
    live export to an endpoint (``openinference.project.name``), and also its
    service, so plain OTel tools group it too."""
    attributes: Dict[str, Any] = {
        "telemetry.sdk.name": "wizardflow",
        "telemetry.sdk.language": "python",
        "service.name": trace_name or "wizardflow",
    }
    if trace_name:
        attributes[PROJECT_NAME_RESOURCE] = trace_name
    return attributes


def _endpoint_resource(trace_name: Optional[str]) -> Dict[str, Any]:
    """The file resource, with ``OTEL_RESOURCE_ATTRIBUTES`` and
    ``OTEL_SERVICE_NAME`` applied as the OTel SDK would. The project name
    still wins: it is what the export was asked to file the run under."""
    attributes = {**_file_resource(trace_name), **env_resource_attributes()}
    if trace_name:
        attributes[PROJECT_NAME_RESOURCE] = trace_name
    return attributes


def _package_version() -> str:
    try:
        return importlib.metadata.version("wizardflow")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def _timestamps(messages: Iterable[Mapping[str, Any]]) -> Iterable[str]:
    for message in messages:
        for step in message.get("steps", []):
            if step.get("timestamp"):
                yield step["timestamp"]
            if step.get("endTimestamp"):
                yield step["endTimestamp"]


def _timestamp_key(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


__all__ = [
    "EXPORTERS",
    "ExportOptions",
    "ExportSummary",
    "export_trace_chain",
    "trace_chain_requests",
]
