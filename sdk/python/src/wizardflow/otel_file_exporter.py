"""Project existing WizardFlow artifacts to fresh OpenTelemetry traces."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

from .otel import OTEL_TRACE_SCOPES, create_otel_bridge
from .otel_mapping import (
    DEFAULT_CONTENT_MAX_BYTES,
    DEFAULT_GRAPH_MAX_BYTES,
    NODE_KINDS,
)
from .reader import TraceChain


@dataclass(frozen=True)
class ExportOptions:
    endpoint: str
    trace_scope: str = "recording"
    include_content: bool = False
    content_max_bytes: int = DEFAULT_CONTENT_MAX_BYTES
    export_graph: bool = False
    graph_max_bytes: int = DEFAULT_GRAPH_MAX_BYTES


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

    trace = unit.trace
    graph = trace.get("graph", {})
    messages = trace.get("messages", [])
    timestamps = list(_timestamps(messages))
    fallback = trace.get("meta", {}).get("createdAt") or datetime.now(timezone.utc).isoformat()
    start = min(timestamps, key=_timestamp_key) if timestamps else fallback
    end = max(timestamps, key=_timestamp_key) if timestamps else start
    bridge = create_otel_bridge(
        options.endpoint,
        project_name=trace.get("name"),
        trace_scope=options.trace_scope,
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
    span_count = 0
    try:
        bridge.start_run(
            start,
            trace.get("name"),
            graph.get("nodes", []),
            graph.get("edges", []),
        )
        for message in messages:
            message_id = str(message.get("id", ""))
            steps = message.get("steps", [])
            message_start = steps[0].get("timestamp", start) if steps else start
            message_end = message_start
            bridge.start_message(message_id, message_start)
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
            bridge.end_message(
                message_id,
                message_end,
                title=message.get("title"),
                meta=message.get("meta"),
            )
    finally:
        bridge.close(end)
    trace_count = len(messages) if options.trace_scope == "message" else 1
    return ExportSummary(
        len(unit.parts), len(messages), span_count, trace_count, unit.sealed
    )


def _timestamps(messages: Iterable[Mapping[str, Any]]) -> Iterable[str]:
    for message in messages:
        for step in message.get("steps", []):
            if step.get("timestamp"):
                yield step["timestamp"]
            if step.get("endTimestamp"):
                yield step["endTimestamp"]


def _timestamp_key(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


__all__ = ["ExportOptions", "ExportSummary", "export_trace_chain"]
