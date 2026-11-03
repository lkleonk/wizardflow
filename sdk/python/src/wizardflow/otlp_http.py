"""Send OTLP traces over HTTP with the standard library.

``wizardflow otel export --endpoint`` uses this instead of the OTel SDK's
exporter: the spans of a recorded run are already complete in memory
(:mod:`wizardflow.otlp_writer`), so all that is left is the request itself.
Bodies are protobuf (:mod:`wizardflow.otlp_proto`), the encoding every OTLP
receiver must accept. Configuration follows the OTel SDK's environment
variables, signal-specific first: ``OTEL_EXPORTER_OTLP_TRACES_HEADERS`` /
``OTEL_EXPORTER_OTLP_HEADERS``, ``…_COMPRESSION`` (``gzip`` or ``none``) and
``…_TIMEOUT`` (seconds, as the Python SDK reads it).
"""

from __future__ import annotations

import gzip
import os
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Iterable, Mapping, Optional
from urllib.parse import unquote

from .otlp_proto import RPC_STATUS, TRACES_RESPONSE, ProtobufError, decode, encode_traces_request

DEFAULT_TIMEOUT_S = 10.0
# The OTel SDK's exporter retries these with exponential backoff, too.
RETRYABLE = frozenset({429, 502, 503, 504})
RETRY_DELAYS_S = (1.0, 2.0, 4.0, 8.0)
MAX_RETRY_AFTER_S = 30.0
PROTOBUF = "application/x-protobuf"


class OtlpSendError(RuntimeError):
    """The endpoint did not accept the spans; the message says why."""


def send_trace_requests(
    requests: Iterable[Mapping[str, Any]],
    endpoint: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    compression: Optional[str] = None,
    timeout: Optional[float] = None,
    sleep: Any = time.sleep,
) -> int:
    """POST each OTLP JSON request to ``endpoint`` as protobuf; returns the count sent."""
    all_headers = {**env_headers(), **(headers or {})}
    compression = compression if compression is not None else _env("COMPRESSION", "none")
    if compression not in ("gzip", "none"):
        raise OtlpSendError(f"unsupported OTLP compression {compression!r} (use gzip or none)")
    if timeout is None:
        timeout = _env_float("TIMEOUT", DEFAULT_TIMEOUT_S)
    sent = 0
    for request in requests:
        body = encode_traces_request(request)
        _post(endpoint, body, all_headers, compression, timeout, sleep)
        sent += 1
    return sent


def _post(
    endpoint: str,
    body: bytes,
    headers: Mapping[str, str],
    compression: str,
    timeout: float,
    sleep: Any,
) -> None:
    request_headers = {**headers, "Content-Type": PROTOBUF}
    if compression == "gzip":
        body = gzip.compress(body)
        request_headers["Content-Encoding"] = "gzip"
    for attempt in range(len(RETRY_DELAYS_S) + 1):
        request = urllib.request.Request(
            endpoint, data=body, headers=request_headers, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                _check_partial_success(response.read(), response.headers.get("Content-Type"))
                return
        except urllib.error.HTTPError as exc:
            detail = _error_detail(exc)
            if exc.code not in RETRYABLE or attempt == len(RETRY_DELAYS_S):
                raise OtlpSendError(
                    f"{endpoint} answered HTTP {exc.code}" + (f": {detail}" if detail else "")
                ) from None
            sleep(_retry_after(exc.headers.get("Retry-After"), RETRY_DELAYS_S[attempt]))
        except (urllib.error.URLError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            if attempt == len(RETRY_DELAYS_S):
                raise OtlpSendError(f"could not reach {endpoint}: {reason}") from None
            sleep(RETRY_DELAYS_S[attempt])


def _check_partial_success(body: bytes, content_type: Optional[str]) -> None:
    if not body or not (content_type or "").startswith(PROTOBUF):
        return  # a JSON or empty answer: nothing to read that would change the outcome
    try:
        partial = decode(body, TRACES_RESPONSE).get("partialSuccess") or {}
    except ProtobufError:
        return
    rejected = int(partial.get("rejectedSpans") or 0)
    if rejected:
        message = partial.get("errorMessage") or "no reason given"
        raise OtlpSendError(f"the endpoint rejected {rejected} span(s): {message}")


def _error_detail(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read()
    except OSError:
        return ""
    if (exc.headers.get("Content-Type") or "").startswith(PROTOBUF):
        try:
            return str(decode(body, RPC_STATUS).get("message") or "")
        except ProtobufError:
            return ""
    return body.decode("utf-8", "replace").strip()[:500]


def _retry_after(raw: Optional[str], default: float) -> float:
    try:
        return min(max(float(raw or ""), 0.0), MAX_RETRY_AFTER_S)
    except ValueError:
        return default


def env_headers() -> Dict[str, str]:
    """``key=value,key2=value2`` from the OTel header variables, values URL-decoded."""
    raw = _env("HEADERS", "")
    headers: Dict[str, str] = {}
    for item in raw.split(","):
        key, sep, value = item.partition("=")
        if sep and key.strip():
            headers[unquote(key.strip())] = unquote(value.strip())
    return headers


def env_resource_attributes() -> Dict[str, str]:
    """``OTEL_RESOURCE_ATTRIBUTES`` plus ``OTEL_SERVICE_NAME``, as the OTel SDK reads them."""
    attributes: Dict[str, str] = {}
    for item in os.environ.get("OTEL_RESOURCE_ATTRIBUTES", "").split(","):
        key, sep, value = item.partition("=")
        if sep and key.strip():
            attributes[key.strip()] = unquote(value.strip())
    service = os.environ.get("OTEL_SERVICE_NAME", "").strip()
    if service:
        attributes["service.name"] = service
    return attributes


def _env(name: str, default: str) -> str:
    for key in (f"OTEL_EXPORTER_OTLP_TRACES_{name}", f"OTEL_EXPORTER_OTLP_{name}"):
        value = os.environ.get(key)
        if value is not None and value.strip():
            return value.strip()
    return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


__all__ = ["OtlpSendError", "env_headers", "env_resource_attributes", "send_trace_requests"]
