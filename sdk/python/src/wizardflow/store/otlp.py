"""Read OTLP JSON: the OTel Collector's file exporter format, and the body of an
OTLP/HTTP JSON request.

One file holds one ``ExportTraceServiceRequest`` / ``ExportLogsServiceRequest``
per line (``{"resourceSpans": [...]}`` / ``{"resourceLogs": [...]}``), or a
single pretty-printed request. This module only normalizes what real writers
emit; storing is the importer's job.
"""

from __future__ import annotations

import base64
import binascii
import json
import math
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional

# Enum names some JSON writers use instead of numbers (proto3 JSON mapping).
_SPAN_KINDS = {
    "SPAN_KIND_UNSPECIFIED": 0, "SPAN_KIND_INTERNAL": 1, "SPAN_KIND_SERVER": 2,
    "SPAN_KIND_CLIENT": 3, "SPAN_KIND_PRODUCER": 4, "SPAN_KIND_CONSUMER": 5,
}
_STATUS_CODES = {"STATUS_CODE_UNSET": 0, "STATUS_CODE_OK": 1, "STATUS_CODE_ERROR": 2}
_SEVERITY_PREFIX = "SEVERITY_NUMBER_"
# TRACE=1, TRACE2=2 … DEBUG=5 … FATAL4=24.
_SEVERITY_NAMES: Dict[str, int] = {}
for _base, _first in (("TRACE", 1), ("DEBUG", 5), ("INFO", 9), ("WARN", 13),
                      ("ERROR", 17), ("FATAL", 21)):
    for _offset, _suffix in enumerate(("", "2", "3", "4")):
        _SEVERITY_NAMES[f"{_base}{_suffix}"] = _first + _offset


class OtlpFormatError(ValueError):
    """The input is not OTLP JSON; the message says where."""


@dataclass
class Resource:
    attributes: Dict[str, Any]


@dataclass
class Scope:
    name: str
    version: str
    attributes: Dict[str, Any]


@dataclass
class SpanEvent:
    time_ns: int
    name: str
    attributes: Dict[str, Any]


@dataclass
class SpanLink:
    trace_id: str
    span_id: str
    attributes: Dict[str, Any]


@dataclass
class Span:
    resource: Resource
    scope: Scope
    trace_id: Optional[str]          # None = missing / invalid: the span is skipped
    span_id: Optional[str]
    parent_span_id: Optional[str]
    name: str
    kind: int
    start_ns: int
    end_ns: int
    status_code: int
    status_message: Optional[str]
    trace_state: Optional[str]
    attributes: Dict[str, Any]
    dropped_attributes_count: int
    events: List[SpanEvent] = field(default_factory=list)
    links: List[SpanLink] = field(default_factory=list)


@dataclass
class LogRecord:
    resource: Resource
    scope: Scope
    time_ns: Optional[int]           # OTLP 0 / missing → None
    observed_ns: Optional[int]
    severity_number: int
    severity_text: Optional[str]
    body: Any                        # plain JSON value
    attributes: Dict[str, Any]
    event_name: Optional[str]
    trace_id: Optional[str]
    span_id: Optional[str]
    flags: int


def iter_requests(text: str) -> Iterator[Dict[str, Any]]:
    """Yield each export request in ``text``: one per line, or one document."""
    stripped = text.strip()
    if not stripped:
        return
    first_line = stripped.split("\n", 1)[0].strip()
    try:
        json.loads(first_line)
        line_mode = True
    except json.JSONDecodeError:
        line_mode = False  # a pretty-printed single request spans many lines
    if not line_mode:
        try:
            yield _as_request(json.loads(stripped), "file")
        except json.JSONDecodeError as exc:
            raise OtlpFormatError(f"not JSON: {exc}") from None
        return
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise OtlpFormatError(f"line {number} is not JSON: {exc}") from None
        yield _as_request(value, f"line {number}")


def is_otlp_request(value: Any) -> bool:
    return isinstance(value, dict) and (
        "resourceSpans" in value or "resourceLogs" in value
    )


def iter_spans(request: Dict[str, Any]) -> Iterator[Span]:
    for resource_spans in request.get("resourceSpans") or []:
        resource = _resource(resource_spans)
        # "instrumentationLibrary*" is the pre-1.0 name of "scope*".
        groups = resource_spans.get("scopeSpans") or resource_spans.get(
            "instrumentationLibrarySpans"
        ) or []
        for group in groups:
            scope = _scope(group)
            for raw in group.get("spans") or []:
                yield _span(raw, resource, scope)


def iter_logs(request: Dict[str, Any]) -> Iterator[LogRecord]:
    for resource_logs in request.get("resourceLogs") or []:
        resource = _resource(resource_logs)
        groups = resource_logs.get("scopeLogs") or resource_logs.get(
            "instrumentationLibraryLogs"
        ) or []
        for group in groups:
            scope = _scope(group)
            for raw in group.get("logRecords") or []:
                yield _log(raw, resource, scope)


# --------------------------------------------------------------------------- parts


def _as_request(value: Any, where: str) -> Dict[str, Any]:
    if not is_otlp_request(value):
        raise OtlpFormatError(
            f"{where} is not an OTLP export request (no resourceSpans or resourceLogs)"
        )
    return value


def _resource(container: Dict[str, Any]) -> Resource:
    return Resource(attributes=attributes((container.get("resource") or {}).get("attributes")))


def _scope(group: Dict[str, Any]) -> Scope:
    raw = group.get("scope") or group.get("instrumentationLibrary") or {}
    return Scope(
        name=str(raw.get("name") or ""),
        version=str(raw.get("version") or ""),
        attributes=attributes(raw.get("attributes")),
    )


def _span(raw: Dict[str, Any], resource: Resource, scope: Scope) -> Span:
    status = raw.get("status") or {}
    return Span(
        resource=resource,
        scope=scope,
        trace_id=otel_id(raw.get("traceId"), 16),
        span_id=otel_id(raw.get("spanId"), 8),
        parent_span_id=otel_id(raw.get("parentSpanId"), 8),
        name=str(raw.get("name") or ""),
        kind=_enum(raw.get("kind"), _SPAN_KINDS),
        start_ns=_int(raw.get("startTimeUnixNano")),
        end_ns=_int(raw.get("endTimeUnixNano")),
        status_code=_enum(status.get("code"), _STATUS_CODES),
        status_message=status.get("message") or None,
        trace_state=raw.get("traceState") or None,
        attributes=attributes(raw.get("attributes")),
        dropped_attributes_count=_int(raw.get("droppedAttributesCount")),
        events=[
            SpanEvent(
                time_ns=_int(event.get("timeUnixNano")),
                name=str(event.get("name") or ""),
                attributes=attributes(event.get("attributes")),
            )
            for event in raw.get("events") or []
        ],
        links=[
            SpanLink(trace_id=trace_id, span_id=span_id,
                     attributes=attributes(link.get("attributes")))
            for link in raw.get("links") or []
            for trace_id, span_id in [(otel_id(link.get("traceId"), 16),
                                       otel_id(link.get("spanId"), 8))]
            if trace_id and span_id
        ],
    )


def _log(raw: Dict[str, Any], resource: Resource, scope: Scope) -> LogRecord:
    return LogRecord(
        resource=resource,
        scope=scope,
        time_ns=_int(raw.get("timeUnixNano")) or None,
        observed_ns=_int(raw.get("observedTimeUnixNano")) or None,
        severity_number=_severity(raw.get("severityNumber")),
        severity_text=raw.get("severityText") or None,
        body=any_value(raw.get("body")) if raw.get("body") is not None else None,
        attributes=attributes(raw.get("attributes")),
        event_name=raw.get("eventName") or None,
        trace_id=otel_id(raw.get("traceId"), 16),
        span_id=otel_id(raw.get("spanId"), 8),
        flags=_int(raw.get("flags")),
    )


# --------------------------------------------------------------------------- values


def attributes(raw: Any) -> Dict[str, Any]:
    """``[{key, value: AnyValue}]`` → a flat dict; a duplicate key: last wins."""
    out: Dict[str, Any] = {}
    for item in raw or []:
        if isinstance(item, dict) and "key" in item:
            out[str(item["key"])] = any_value(item.get("value"))
    return out


def any_value(raw: Any) -> Any:
    """An OTLP ``AnyValue`` → a plain JSON value."""
    if not isinstance(raw, dict) or not raw:
        return None
    if "stringValue" in raw:
        return raw["stringValue"]
    if "boolValue" in raw:
        return bool(raw["boolValue"])
    if "intValue" in raw:
        return _int(raw["intValue"])  # int64 travels as a string in JSON
    if "doubleValue" in raw:
        value = raw["doubleValue"]
        return _finite(float(value) if not isinstance(value, str) else _float(value))
    if "arrayValue" in raw:
        return [any_value(v) for v in (raw["arrayValue"] or {}).get("values") or []]
    if "kvlistValue" in raw:
        return attributes((raw["kvlistValue"] or {}).get("values"))
    if "bytesValue" in raw:
        return raw["bytesValue"]  # kept as its base64 text
    return None


def otel_id(raw: Any, size: int) -> Optional[str]:
    """A trace/span id as lowercase hex, or None if missing or invalid.

    OTLP/JSON specifies hex, but generic proto3-JSON writers emit base64.
    All-zero ids are invalid in OTel and treated as missing.
    """
    if not isinstance(raw, str) or not raw:
        return None
    text = raw.strip().lower()
    if len(text) == size * 2 and all(c in "0123456789abcdef" for c in text):
        value = text
    else:
        try:
            decoded = base64.b64decode(raw.strip(), validate=True)
        except (binascii.Error, ValueError):
            return None
        if len(decoded) != size:
            return None
        value = decoded.hex()
    return None if set(value) == {"0"} else value


def _int(raw: Any) -> int:
    if raw is None or raw == "":
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        try:
            return int(float(raw))
        except (TypeError, ValueError):
            return 0


def _float(raw: str) -> Optional[float]:
    try:
        return float(raw)  # also "NaN" / "Infinity", which proto3 JSON allows
    except ValueError:
        return None


def _finite(value: Optional[float]) -> Any:
    """NaN and ±Infinity as proto3 JSON spells them. JSON has no such numbers:
    stored as floats they would reach the browser as bare ``NaN``, which its
    JSON parser rejects, and break the whole trace page."""
    if value is None or math.isfinite(value):
        return value
    return "NaN" if math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")


def _enum(raw: Any, names: Dict[str, int]) -> int:
    if isinstance(raw, str) and not raw.lstrip("-").isdigit():
        return names.get(raw.upper(), 0)
    return _int(raw)


def _severity(raw: Any) -> int:
    if isinstance(raw, str) and not raw.isdigit():
        name = raw.upper()
        if name.startswith(_SEVERITY_PREFIX):
            name = name[len(_SEVERITY_PREFIX):]
        return _SEVERITY_NAMES.get(name, 0)
    return _int(raw)
