"""Build OTLP requests for a recorded run without the OpenTelemetry packages.

``wizardflow otel export`` (``--out`` and ``--endpoint``) replays a recorded
run offline: no live
context to join, no sampling, no batching. So instead of the OTel SDK, the
shared :class:`~wizardflow.otel.OTelBridge` drives a tiny recorder that
implements the few tracer calls it makes, and the finished spans are
serialized here. The span semantics stay exactly those of live export,
because the bridge and ``otel_mapping`` are the same code.

A file gets the OTel Collector file-exporter format: one
``ExportTraceServiceRequest`` per line (one line per trace here), with
lowercase hex ids and nanosecond times as strings. An endpoint gets the same
requests as protobuf, via :mod:`wizardflow.otlp_http`.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import secrets
import time
import traceback
from pathlib import Path
from typing import Any, Dict, Iterator, List, Mapping, Optional, Sequence

SCOPE_NAME = "wizardflow"

SPAN_KIND_INTERNAL = 1
STATUS_ERROR = 2


class _SpanKind:
    INTERNAL = SPAN_KIND_INTERNAL


class _StatusCode:
    ERROR = STATUS_ERROR


class _Status:
    def __init__(self, status_code: int, description: Optional[str] = None) -> None:
        self.status_code = status_code
        self.description = description


class _Context:
    def __init__(self, span: "RecordedSpan") -> None:
        self.span = span


class RecordedSpan:
    """The subset of an OTel span the bridge uses, kept in memory."""

    def __init__(
        self,
        recorder: "SpanRecorder",
        name: str,
        *,
        trace_id: str,
        parent_span_id: Optional[str],
        kind: int,
        start_time: int,
        attributes: Mapping[str, Any],
    ) -> None:
        self._recorder = recorder
        self.name = name
        self.trace_id = trace_id
        self.span_id = recorder.new_id(8)
        self.parent_span_id = parent_span_id
        self.kind = kind
        self.start_time = start_time
        self.end_time: Optional[int] = None
        self.attributes: Dict[str, Any] = dict(attributes)
        self.events: List[Dict[str, Any]] = []
        self.status_code = 0
        self.status_message: Optional[str] = None

    def set_attribute(self, key: str, value: Any) -> None:
        self.attributes[key] = value

    def add_event(
        self,
        name: str,
        attributes: Optional[Mapping[str, Any]] = None,
        timestamp: Optional[int] = None,
    ) -> None:
        # Offline there is no "now": an event without a time belongs to the
        # span's start (the graph event is added right after starting).
        self.events.append({
            "name": name,
            "time": timestamp if timestamp is not None else self.start_time,
            "attributes": dict(attributes or {}),
        })

    def record_exception(self, exception: BaseException) -> None:
        self.add_event(
            "exception",
            {
                "exception.type": type(exception).__qualname__,
                "exception.message": str(exception),
                "exception.stacktrace": "".join(traceback.format_exception(
                    type(exception), exception, exception.__traceback__
                )),
            },
        )

    def set_status(self, status: _Status) -> None:
        self.status_code = status.status_code
        self.status_message = status.description

    def end(self, end_time: Optional[int] = None) -> None:
        if self.end_time is not None:
            return
        self.end_time = end_time if end_time is not None else self.start_time
        self._recorder.finished.append(self)


class SpanRecorder:
    """Stands in for both ``opentelemetry.trace`` and a tracer for the bridge."""

    SpanKind = _SpanKind
    Status = _Status
    StatusCode = _StatusCode

    def __init__(self, *, id_seed: Optional[str] = None) -> None:
        self.finished: List[RecordedSpan] = []
        self._id_seed = id_seed
        self._ids_made = 0

    def new_id(self, size: int) -> str:
        """A random id; with ``id_seed``, the next one of a fixed sequence, so
        recording the same input again produces the same ids."""
        if self._id_seed is None:
            return _new_id(size)
        self._ids_made += 1
        digest = hashlib.sha256(f"{self._id_seed}:{self._ids_made}".encode("utf-8"))
        return digest.hexdigest()[: size * 2]

    # tracer API
    def start_span(
        self,
        name: str,
        context: Optional[_Context] = None,
        kind: Optional[int] = None,
        attributes: Optional[Mapping[str, Any]] = None,
        start_time: Optional[int] = None,
    ) -> RecordedSpan:
        parent = context.span if isinstance(context, _Context) else None
        return RecordedSpan(
            self,
            name,
            trace_id=parent.trace_id if parent else self.new_id(16),
            parent_span_id=parent.span_id if parent else None,
            kind=kind if kind is not None else SPAN_KIND_INTERNAL,
            start_time=start_time if start_time is not None else time.time_ns(),
            attributes=attributes or {},
        )

    # opentelemetry.trace API
    @staticmethod
    def set_span_in_context(span: RecordedSpan) -> _Context:
        return _Context(span)

    @staticmethod
    def use_span(span: RecordedSpan, **_kwargs: Any) -> "contextlib.nullcontext[Any]":
        return contextlib.nullcontext(span)


def build_trace_requests(
    spans: Sequence[RecordedSpan],
    *,
    resource_attributes: Mapping[str, Any],
    scope_version: str,
    max_spans: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Group ``spans`` into OTLP JSON export requests, a trace never split.

    Without ``max_spans`` there is one request per trace (a file's lines);
    with it, whole traces are packed into requests of up to that many spans
    (an endpoint's batches). A bigger trace goes alone.
    """
    by_trace: Dict[str, List[RecordedSpan]] = {}
    for span in sorted(spans, key=lambda s: (s.start_time, s.parent_span_id is not None)):
        by_trace.setdefault(span.trace_id, []).append(span)
    batches: List[List[RecordedSpan]] = []
    for trace_spans in by_trace.values():
        if (
            max_spans is not None
            and batches
            and len(batches[-1]) + len(trace_spans) <= max_spans
        ):
            batches[-1].extend(trace_spans)
        else:
            batches.append(list(trace_spans))
    resource = {"attributes": encode_attributes(resource_attributes)}
    scope = {"name": SCOPE_NAME, "version": scope_version}
    return [
        {
            "resourceSpans": [{
                "resource": resource,
                "scopeSpans": [{"scope": scope, "spans": [_span(s) for s in batch]}],
            }]
        }
        for batch in batches
    ]


def write_otlp_json(
    spans: Sequence[RecordedSpan],
    path: Path,
    *,
    resource_attributes: Mapping[str, Any],
    scope_version: str,
) -> int:
    """Write ``spans`` as OTLP JSON, one request per trace; returns the trace count.

    Written to a temporary file first, so an interrupted export never leaves a
    half-written file behind for an importer to pick up.
    """
    requests = build_trace_requests(
        spans, resource_attributes=resource_attributes, scope_version=scope_version
    )
    path = Path(path)
    tmp = path.with_name(f".{path.name}.tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as handle:
        for request in requests:
            handle.write(json.dumps(request, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
    os.replace(tmp, path)
    return len(requests)


def _span(span: RecordedSpan) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "traceId": span.trace_id,
        "spanId": span.span_id,
        "name": span.name,
        "kind": span.kind,
        "startTimeUnixNano": str(span.start_time),
        "endTimeUnixNano": str(span.end_time if span.end_time is not None else span.start_time),
        "attributes": encode_attributes(span.attributes),
        "status": _status(span),
    }
    if span.parent_span_id:
        out["parentSpanId"] = span.parent_span_id
    if span.events:
        out["events"] = [
            {
                "timeUnixNano": str(event["time"]),
                "name": event["name"],
                "attributes": encode_attributes(event["attributes"]),
            }
            for event in span.events
        ]
    return out


def _status(span: RecordedSpan) -> Dict[str, Any]:
    status: Dict[str, Any] = {"code": span.status_code}
    if span.status_message:
        status["message"] = span.status_message
    return status


def encode_attributes(attributes: Mapping[str, Any]) -> List[Dict[str, Any]]:
    return [
        {"key": key, "value": encode_value(value)}
        for key, value in attributes.items()
        if value is not None
    ]


def encode_value(value: Any) -> Dict[str, Any]:
    """A plain value → OTLP ``AnyValue`` (int64 as a string, as OTLP/JSON requires)."""
    if isinstance(value, bool):
        return {"boolValue": value}
    if isinstance(value, int):
        return {"intValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, (list, tuple)):
        return {"arrayValue": {"values": [encode_value(v) for v in value]}}
    if isinstance(value, Mapping):
        return {"kvlistValue": {"values": encode_attributes(value)}}
    return {"stringValue": str(value)}


def _new_id(size: int) -> str:
    while True:
        value = secrets.token_hex(size)
        if set(value) != {"0"}:  # all-zero ids are invalid in OTel
            return value


def iter_written_requests(path: Path) -> Iterator[Dict[str, Any]]:
    """Read back a file written here (for tests and quick inspection)."""
    with Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)
