"""Build OTLP JSON export requests for store, CLI and API tests."""

import json

TRACE_A = "a" * 32
TRACE_B = "b" * 32


def value(v):
    if isinstance(v, bool):
        return {"boolValue": v}
    if isinstance(v, int):
        return {"intValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [value(x) for x in v]}}
    if isinstance(v, dict):
        return {"kvlistValue": {"values": attrs(v)}}
    return {"stringValue": v}


def attrs(d):
    return [{"key": k, "value": value(v)} for k, v in d.items()]


def span(span_id, *, trace_id=TRACE_A, parent=None, name=None, start=100, end=200,
         attributes=None, status=0, events=None):
    out = {
        "traceId": trace_id,
        "spanId": span_id,
        "name": name or span_id,
        "kind": 1,
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(end),
        "attributes": attrs(attributes or {}),
        "status": {"code": status},
    }
    if parent:
        out["parentSpanId"] = parent
    if events:
        out["events"] = [
            {"timeUnixNano": str(t), "name": n, "attributes": attrs(a)} for t, n, a in events
        ]
    return out


def traces_request(spans, *, service="svc", resource_attrs=None):
    resource = {"service.name": service, **(resource_attrs or {})}
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": attrs(resource)},
                "scopeSpans": [{"scope": {"name": "test-scope", "version": "1"}, "spans": spans}],
            }
        ]
    }


def logs_request(records, *, service="svc"):
    return {
        "resourceLogs": [
            {
                "resource": {"attributes": attrs({"service.name": service})},
                "scopeLogs": [{"scope": {"name": "logger"}, "logRecords": records}],
            }
        ]
    }


def log_record(body, *, ts=300, severity=9, trace_id=None, span_id=None):
    record = {"timeUnixNano": str(ts), "severityNumber": severity, "body": {"stringValue": body}}
    if trace_id:
        record["traceId"] = trace_id
    if span_id:
        record["spanId"] = span_id
    return record


def lines(*requests):
    return "\n".join(json.dumps(r) for r in requests) + "\n"
