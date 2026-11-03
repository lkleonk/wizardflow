"""The built-in OTLP protobuf codec, checked against the official generated classes."""

import base64

import pytest

from otlp_builders import TRACE_A, log_record, logs_request, span, traces_request
from wizardflow import otlp_proto
from wizardflow.otlp_proto import ProtobufError

trace_pb2 = pytest.importorskip(
    "opentelemetry.proto.collector.trace.v1.trace_service_pb2",
    reason="the cross-checks need opentelemetry-proto (test-only)",
)
logs_pb2 = pytest.importorskip("opentelemetry.proto.collector.logs.v1.logs_service_pb2")
json_format = pytest.importorskip("google.protobuf.json_format")

ID_KEYS = {"traceId", "spanId", "parentSpanId"}

RICH = traces_request(
    [
        {
            **span("1" * 16, parent="2" * 16, status=2, attributes={
                "s": "text", "empty": "", "no": False, "n": -5, "big": 2**63 - 1,
                "d": 1.5, "zero": 0.0, "list": [1, "a", [True]], "map": {"k": {"deep": 1}},
            }, events=[(150, "exception", {"exception.message": "boom"})]),
            "flags": 257,
            "traceState": "vendor=1",
            "droppedAttributesCount": 3,
            "status": {"code": 2, "message": "failed"},
            "links": [{"traceId": "b" * 32, "spanId": "3" * 16, "attributes": []}],
        },
        span("2" * 16, start=1_700_000_000_000_000_000, end=1_700_000_000_123_456_789),
    ],
    resource_attrs={"bytes": None},
)
# A bytes AnyValue, which the JSON builders don't make.
RICH["resourceSpans"][0]["resource"]["attributes"][1]["value"] = {"bytesValue": "AAEC"}


def _official_dict(message):
    """proto3 JSON of an official message, with ids as hex like OTLP/JSON."""

    def fix(value):
        if isinstance(value, dict):
            return {
                key: base64.b64decode(item).hex() if key in ID_KEYS else fix(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [fix(item) for item in value]
        return value

    return fix(json_format.MessageToDict(message, use_integers_for_enums=True))


def test_encoding_matches_the_official_serializer_byte_for_byte():
    official = trace_pb2.ExportTraceServiceRequest()
    json_format.ParseDict(_as_proto_json(RICH), official)
    assert otlp_proto.encode_traces_request(RICH) == official.SerializeToString()


def test_decoding_an_official_message_gives_its_otlp_json():
    official = trace_pb2.ExportTraceServiceRequest()
    json_format.ParseDict(_as_proto_json(RICH), official)
    decoded = otlp_proto.decode_traces_request(official.SerializeToString())
    assert decoded == _official_dict(official)
    # Defaults that proto3 leaves out stay present inside AnyValue's oneof.
    values = {
        item["key"]: item["value"]
        for item in decoded["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["attributes"]
    }
    assert values["empty"] == {"stringValue": ""}
    assert values["no"] == {"boolValue": False}
    assert values["n"] == {"intValue": "-5"}
    assert values["zero"] == {"doubleValue": 0.0}


def test_logs_round_trip():
    request = logs_request([
        {**log_record("hello", severity=17, trace_id=TRACE_A, span_id="1" * 16),
         "severityText": "ERROR", "eventName": "app.event", "observedTimeUnixNano": "301",
         "flags": 1},
        log_record("no trace"),
    ])
    body = otlp_proto.encode_logs_request(request)
    official = logs_pb2.ExportLogsServiceRequest.FromString(body)
    assert otlp_proto.decode_logs_request(body) == _official_dict(official)
    assert otlp_proto.decode_logs_request(body) == request


def test_unknown_fields_are_skipped():
    known = otlp_proto.encode_traces_request(traces_request([span("1" * 16)]))
    # Field 15 in every wire type, appended to the request: a newer OTLP.
    extra = bytes([15 << 3 | 0, 0x01]) + bytes([15 << 3 | 2, 2, 0xFF, 0xFF])
    extra += bytes([15 << 3 | 1]) + bytes(8) + bytes([15 << 3 | 5]) + bytes(4)
    assert otlp_proto.decode_traces_request(known + extra) == otlp_proto.decode_traces_request(known)


@pytest.mark.parametrize("body, message", [
    (b"\x0a\x05abc", "truncated field"),
    (b"\x0a", "truncated varint"),
    (b"\x0b", "wire type 3"),
    (b"\x08\x01", "wire type 0"),  # resourceSpans must be a message
    (b"\x00", "field number 0"),
])
def test_malformed_bodies_raise(body, message):
    with pytest.raises(ProtobufError, match=message):
        otlp_proto.decode_traces_request(body)


def test_nesting_is_capped():
    value = {"stringValue": "leaf"}
    for _ in range(otlp_proto.MAX_DEPTH):
        value = {"arrayValue": {"values": [value]}}
    body = otlp_proto.encode_traces_request(traces_request([span("1" * 16, attributes={})]))
    request = otlp_proto.decode_traces_request(body)
    request["resourceSpans"][0]["resource"]["attributes"] = [{"key": "deep", "value": value}]
    with pytest.raises(ProtobufError, match="nested too deeply"):
        otlp_proto.decode_traces_request(otlp_proto.encode_traces_request(request))


def test_empty_body_is_an_empty_request():
    assert otlp_proto.decode_traces_request(b"") == {}


def _as_proto_json(request):
    """OTLP/JSON (hex ids) → generic proto3 JSON (base64 ids) for ParseDict."""

    def fix(value):
        if isinstance(value, dict):
            return {
                key: base64.b64encode(bytes.fromhex(item)).decode() if key in ID_KEYS else fix(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [fix(item) for item in value]
        return value

    return fix(request)
