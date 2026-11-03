"""OTLP protobuf without the protobuf package.

The OTLP messages are fixed and published (opentelemetry-proto, v1 stable), and
protobuf's wire format is small: varints, fixed 32/64-bit values, and
length-delimited bytes. So instead of depending on ``protobuf`` and the
generated ``opentelemetry-proto`` classes, the few messages WizardFlow reads and
writes are described by the tables below and converted to and from the same
OTLP JSON dicts the rest of the package already speaks (camelCase keys, hex
trace and span ids, 64-bit integers as strings).

- ``decode_*_request`` turns an OTLP/HTTP protobuf body into such a dict, which
  the store importer reads exactly like a line of an OTLP JSON file.
- ``encode_*_request`` turns such a dict into a protobuf body for an OTLP/HTTP
  endpoint.

Forward compatible like protobuf itself: unknown fields are skipped, so a
sender on a newer OTLP version still decodes. Field numbers follow
opentelemetry-proto's ``common``, ``resource``, ``trace`` and ``logs`` protos.
"""

from __future__ import annotations

import base64
import struct
from typing import Any, Dict, List, Mapping, Optional, Tuple

# Field types. ``ID`` is bytes shown as hex (trace and span ids, per OTLP/JSON);
# ``BYTES`` is any other bytes field, shown as base64 (proto3 JSON).
STRING, BOOL, INT64, UINT32, INT32, ENUM, DOUBLE, FIXED64, FIXED32, BYTES, ID, MESSAGE = range(12)

# A field: (json name, type, message schema or None, repeated, oneof).
# A oneof member is written even when it holds its type's default value,
# because there, being set is the information (AnyValue{stringValue: ""}).
Field = Tuple[str, int, Optional[Dict[int, Any]], bool, bool]


def _f(name: str, kind: int, message: Optional[Dict[int, Any]] = None, *,
       repeated: bool = False, oneof: bool = False) -> Field:
    return (name, kind, message, repeated, oneof)


# common.proto. AnyValue, ArrayValue and KeyValueList refer to each other, so
# the dicts are created first and filled in after.
ANY_VALUE: Dict[int, Field] = {}
ARRAY_VALUE: Dict[int, Field] = {}
KEY_VALUE_LIST: Dict[int, Field] = {}
KEY_VALUE: Dict[int, Field] = {1: _f("key", STRING), 2: _f("value", MESSAGE, ANY_VALUE)}
ANY_VALUE.update({
    1: _f("stringValue", STRING, oneof=True),
    2: _f("boolValue", BOOL, oneof=True),
    3: _f("intValue", INT64, oneof=True),
    4: _f("doubleValue", DOUBLE, oneof=True),
    5: _f("arrayValue", MESSAGE, ARRAY_VALUE, oneof=True),
    6: _f("kvlistValue", MESSAGE, KEY_VALUE_LIST, oneof=True),
    7: _f("bytesValue", BYTES, oneof=True),
})
ARRAY_VALUE[1] = _f("values", MESSAGE, ANY_VALUE, repeated=True)
KEY_VALUE_LIST[1] = _f("values", MESSAGE, KEY_VALUE, repeated=True)
SCOPE = {
    1: _f("name", STRING),
    2: _f("version", STRING),
    3: _f("attributes", MESSAGE, KEY_VALUE, repeated=True),
    4: _f("droppedAttributesCount", UINT32),
}

# resource.proto
RESOURCE = {
    1: _f("attributes", MESSAGE, KEY_VALUE, repeated=True),
    2: _f("droppedAttributesCount", UINT32),
}

# trace.proto
STATUS = {2: _f("message", STRING), 3: _f("code", ENUM)}
EVENT = {
    1: _f("timeUnixNano", FIXED64),
    2: _f("name", STRING),
    3: _f("attributes", MESSAGE, KEY_VALUE, repeated=True),
    4: _f("droppedAttributesCount", UINT32),
}
LINK = {
    1: _f("traceId", ID),
    2: _f("spanId", ID),
    3: _f("traceState", STRING),
    4: _f("attributes", MESSAGE, KEY_VALUE, repeated=True),
    5: _f("droppedAttributesCount", UINT32),
    6: _f("flags", FIXED32),
}
SPAN = {
    1: _f("traceId", ID),
    2: _f("spanId", ID),
    3: _f("traceState", STRING),
    4: _f("parentSpanId", ID),
    16: _f("flags", FIXED32),
    5: _f("name", STRING),
    6: _f("kind", ENUM),
    7: _f("startTimeUnixNano", FIXED64),
    8: _f("endTimeUnixNano", FIXED64),
    9: _f("attributes", MESSAGE, KEY_VALUE, repeated=True),
    10: _f("droppedAttributesCount", UINT32),
    11: _f("events", MESSAGE, EVENT, repeated=True),
    12: _f("droppedEventsCount", UINT32),
    13: _f("links", MESSAGE, LINK, repeated=True),
    14: _f("droppedLinksCount", UINT32),
    15: _f("status", MESSAGE, STATUS),
}
SCOPE_SPANS = {
    1: _f("scope", MESSAGE, SCOPE),
    2: _f("spans", MESSAGE, SPAN, repeated=True),
    3: _f("schemaUrl", STRING),
}
RESOURCE_SPANS = {
    1: _f("resource", MESSAGE, RESOURCE),
    2: _f("scopeSpans", MESSAGE, SCOPE_SPANS, repeated=True),
    3: _f("schemaUrl", STRING),
}
TRACES_REQUEST = {1: _f("resourceSpans", MESSAGE, RESOURCE_SPANS, repeated=True)}

# logs.proto
LOG_RECORD = {
    1: _f("timeUnixNano", FIXED64),
    11: _f("observedTimeUnixNano", FIXED64),
    2: _f("severityNumber", ENUM),
    3: _f("severityText", STRING),
    5: _f("body", MESSAGE, ANY_VALUE),
    6: _f("attributes", MESSAGE, KEY_VALUE, repeated=True),
    7: _f("droppedAttributesCount", UINT32),
    8: _f("flags", FIXED32),
    9: _f("traceId", ID),
    10: _f("spanId", ID),
    12: _f("eventName", STRING),
}
SCOPE_LOGS = {
    1: _f("scope", MESSAGE, SCOPE),
    2: _f("logRecords", MESSAGE, LOG_RECORD, repeated=True),
    3: _f("schemaUrl", STRING),
}
RESOURCE_LOGS = {
    1: _f("resource", MESSAGE, RESOURCE),
    2: _f("scopeLogs", MESSAGE, SCOPE_LOGS, repeated=True),
    3: _f("schemaUrl", STRING),
}
LOGS_REQUEST = {1: _f("resourceLogs", MESSAGE, RESOURCE_LOGS, repeated=True)}

# Export responses (collector/*/v1/*_service.proto) and google.rpc.Status,
# which an OTLP/HTTP server returns with an error.
TRACES_PARTIAL_SUCCESS = {1: _f("rejectedSpans", INT64), 2: _f("errorMessage", STRING)}
TRACES_RESPONSE = {1: _f("partialSuccess", MESSAGE, TRACES_PARTIAL_SUCCESS)}
LOGS_PARTIAL_SUCCESS = {1: _f("rejectedLogRecords", INT64), 2: _f("errorMessage", STRING)}
LOGS_RESPONSE = {1: _f("partialSuccess", MESSAGE, LOGS_PARTIAL_SUCCESS)}
RPC_STATUS = {1: _f("code", INT32), 2: _f("message", STRING)}

# Wire types.
_VARINT, _I64, _LEN, _I32 = 0, 1, 2, 5
_WIRE = {
    STRING: _LEN, BOOL: _VARINT, INT64: _VARINT, UINT32: _VARINT, INT32: _VARINT,
    ENUM: _VARINT, DOUBLE: _I64, FIXED64: _I64, FIXED32: _I32, BYTES: _LEN, ID: _LEN,
    MESSAGE: _LEN,
}
# Deeper than any real attribute value; stops a crafted body from recursing
# through nested AnyValues until Python's stack gives out.
MAX_DEPTH = 64


class ProtobufError(ValueError):
    """The bytes are not a valid message of the expected type."""


# --------------------------------------------------------------------------- decode


def decode_traces_request(data: bytes) -> Dict[str, Any]:
    """An ``ExportTraceServiceRequest`` body → ``{"resourceSpans": [...]}``."""
    return decode(data, TRACES_REQUEST)


def decode_logs_request(data: bytes) -> Dict[str, Any]:
    """An ``ExportLogsServiceRequest`` body → ``{"resourceLogs": [...]}``."""
    return decode(data, LOGS_REQUEST)


def decode(data: bytes, schema: Mapping[int, Field]) -> Dict[str, Any]:
    return _decode(memoryview(data), schema, 0)


def _decode(data: memoryview, schema: Mapping[int, Field], depth: int) -> Dict[str, Any]:
    if depth > MAX_DEPTH:
        raise ProtobufError("message nested too deeply")
    out: Dict[str, Any] = {}
    pos, end = 0, len(data)
    while pos < end:
        key, pos = _varint(data, pos)
        number, wire = key >> 3, key & 7
        if number == 0:
            raise ProtobufError("field number 0")
        field = schema.get(number)
        if wire == _VARINT:
            raw, pos = _varint(data, pos)
        elif wire == _I64:
            raw, pos = _take(data, pos, 8)
        elif wire == _I32:
            raw, pos = _take(data, pos, 4)
        elif wire == _LEN:
            size, pos = _varint(data, pos)
            raw, pos = _take(data, pos, size)
        else:
            # Groups (3, 4) were removed in proto3 and OTLP never used them.
            raise ProtobufError(f"unsupported wire type {wire}")
        if field is None:
            continue  # a newer field: skipped, as protobuf does
        name, kind, message, repeated, oneof = field
        if _WIRE[kind] != wire:
            raise ProtobufError(f"field {name!r} has wire type {wire}")
        value = _scalar(kind, raw) if message is None else _decode(raw, message, depth + 1)
        if repeated:
            out.setdefault(name, []).append(value)
        else:
            if oneof:
                for other in schema.values():
                    if other[4]:
                        out.pop(other[0], None)
            out[name] = value  # a repeated non-repeated field: the last wins
    return out


def _scalar(kind: int, raw: Any) -> Any:
    if kind == STRING:
        try:
            return bytes(raw).decode("utf-8")
        except UnicodeDecodeError:
            raise ProtobufError("string field is not UTF-8") from None
    if kind == BOOL:
        return raw != 0
    if kind == INT64:
        return str(_signed(raw, 64))  # OTLP/JSON writes 64-bit ints as strings
    if kind in (INT32, ENUM):
        return _signed(raw, 64)  # negative int32 travels sign-extended to 64 bits
    if kind == UINT32:
        return raw & 0xFFFFFFFF
    if kind == DOUBLE:
        return struct.unpack("<d", raw)[0]
    if kind == FIXED64:
        return str(struct.unpack("<Q", raw)[0])
    if kind == FIXED32:
        return struct.unpack("<I", raw)[0]
    if kind == ID:
        return bytes(raw).hex()
    if kind == BYTES:
        return base64.b64encode(bytes(raw)).decode("ascii")
    raise AssertionError(kind)


def _signed(value: int, bits: int) -> int:
    return value - (1 << bits) if value >= 1 << (bits - 1) else value


def _varint(data: memoryview, pos: int) -> Tuple[int, int]:
    result = shift = 0
    while True:
        if pos >= len(data):
            raise ProtobufError("truncated varint")
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7
        if shift >= 70:
            raise ProtobufError("varint too long")


def _take(data: memoryview, pos: int, size: int) -> Tuple[memoryview, int]:
    if pos + size > len(data):
        raise ProtobufError("truncated field")
    return data[pos:pos + size], pos + size


# --------------------------------------------------------------------------- encode


def encode_traces_request(request: Mapping[str, Any]) -> bytes:
    """``{"resourceSpans": [...]}`` (OTLP JSON) → an ``ExportTraceServiceRequest`` body."""
    return encode(request, TRACES_REQUEST)


def encode_logs_request(request: Mapping[str, Any]) -> bytes:
    """``{"resourceLogs": [...]}`` (OTLP JSON) → an ``ExportLogsServiceRequest`` body."""
    return encode(request, LOGS_REQUEST)


def encode(value: Mapping[str, Any], schema: Mapping[int, Field]) -> bytes:
    out = bytearray()
    _encode(out, value, schema)
    return bytes(out)


def _encode(out: bytearray, value: Mapping[str, Any], schema: Mapping[int, Field]) -> None:
    # Field-number order, as protobuf's own serializers write.
    for number in sorted(schema):
        name, kind, message, repeated, oneof = schema[number]
        if name not in value or value[name] is None:
            continue
        items: List[Any] = list(value[name]) if repeated else [value[name]]
        for item in items:
            if message is not None:
                # Written even when empty: unlike scalars, a message field
                # is either set or not, and protobuf's serializers keep that.
                body = encode(item, message)
                _key(out, number, _LEN)
                _write_varint(out, len(body))
                out += body
                continue
            payload = _encode_scalar(kind, item, name, force=repeated or oneof)
            if payload is None:
                continue  # proto3 leaves default values out
            _key(out, number, _WIRE[kind])
            out += payload


def _encode_scalar(kind: int, value: Any, name: str, force: bool = False) -> Optional[bytes]:
    """The field's payload bytes, or None for proto3's default value (unless ``force``)."""
    try:
        if kind == STRING:
            text = str(value)
            if not text and not force:
                return None
            data = text.encode("utf-8")
            return _varint_bytes(len(data)) + data
        if kind in (ID, BYTES):
            data = bytes.fromhex(value) if kind == ID else base64.b64decode(value)
            if not data and not force:
                return None
            return _varint_bytes(len(data)) + data
        if kind == DOUBLE:
            number = float(value)
            if number == 0 and not force:
                return None
            return struct.pack("<d", number)
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ProtobufError(f"field {name!r}: {exc}") from None
    if number == 0 and not force:
        return None
    if kind == FIXED64:
        return struct.pack("<Q", number)
    if kind == FIXED32:
        return struct.pack("<I", number)
    if kind == BOOL:
        return b"\x01" if number else b"\x00"
    if kind == UINT32:
        return _varint_bytes(number & 0xFFFFFFFF)
    return _varint_bytes(number & 0xFFFFFFFFFFFFFFFF)  # two's complement, 10 bytes if negative


def _key(out: bytearray, number: int, wire: int) -> None:
    _write_varint(out, number << 3 | wire)


def _write_varint(out: bytearray, value: int) -> None:
    out += _varint_bytes(value)


def _varint_bytes(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


__all__ = [
    "LOGS_RESPONSE",
    "ProtobufError",
    "RPC_STATUS",
    "TRACES_RESPONSE",
    "decode",
    "decode_logs_request",
    "decode_traces_request",
    "encode",
    "encode_logs_request",
    "encode_traces_request",
]
