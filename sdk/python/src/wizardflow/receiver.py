"""``wizardflow serve``'s live OTLP/HTTP receiver into the store.

Apps point their OTel exporter here (``OTEL_EXPORTER_OTLP_ENDPOINT=
http://127.0.0.1:4318``) and their spans and logs land in the database while
the dashboard runs. ``POST /v1/traces`` and ``POST /v1/logs`` take protobuf
(what the OTel SDKs send by default) or JSON, either optionally gzipped; both
go through the same importer as ``wizardflow db import``.

One write connection, one request at a time: SQLite takes a single writer
anyway, and an exporter only gets its success answer once the batch is
committed. The dashboard keeps reading through its own read-only connections.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import zlib
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple
from urllib.parse import urlparse, urlsplit

from .otlp_proto import (
    LOGS_RESPONSE,
    RPC_STATUS,
    TRACES_RESPONSE,
    ProtobufError,
    decode_logs_request,
    decode_traces_request,
    encode,
)
from .store import import_requests
from .store.otlp import OtlpFormatError

DEFAULT_OTLP_PORT = 4318
# The OTel Collector's default limit for an OTLP/HTTP body, before and after
# decompression (the second keeps a small gzip bomb small).
MAX_OTLP_BODY = 20 << 20
PROTOBUF = "application/x-protobuf"
JSON = "application/json"
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")

# path → (request key, protobuf decoder, response schema, rejected-count key)
SIGNALS: Dict[str, Tuple[str, Callable[[bytes], Dict[str, Any]], Dict[int, Any], str]] = {
    "/v1/traces": ("resourceSpans", decode_traces_request, TRACES_RESPONSE, "rejectedSpans"),
    "/v1/logs": ("resourceLogs", decode_logs_request, LOGS_RESPONSE, "rejectedLogRecords"),
}

# google.rpc.Code values for an error body.
_RPC_INVALID_ARGUMENT, _RPC_UNAVAILABLE = 3, 14


class _Rejected(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class ReceiverStats:
    requests: int = 0
    spans: int = 0
    logs: int = 0
    rejected: int = 0
    last_received_ns: Optional[int] = None
    last_error: Optional[str] = None


class Receiver:
    """The receiver's shared state: the write connection and live counters."""

    def __init__(self, db_path: Path, *, host: str, port: int) -> None:
        self.host = host
        self.port = port
        self.stats = ReceiverStats()
        self._lock = threading.Lock()
        # Used by one request at a time (the lock); autocommit mode, because
        # the importer opens its own transaction.
        self._con = sqlite3.connect(str(db_path), isolation_level=None, check_same_thread=False)
        self._con.execute("PRAGMA foreign_keys = ON")
        self._con.execute("PRAGMA busy_timeout = 5000")
        self._import_id: Optional[int] = None

    @property
    def endpoint(self) -> str:
        host = "127.0.0.1" if self.host in ("", "0.0.0.0") else self.host
        if ":" in host:
            host = f"[{host}]"
        return f"http://{host}:{self.port}"

    def ingest(self, signal: str, request: Dict[str, Any]) -> int:
        """Store one export request; returns how many of its items were rejected."""
        key = SIGNALS[signal][0]
        with self._lock:
            result = import_requests(
                self._con,
                [{key: request.get(key) or []}],
                source="otlp_http",
                import_id=self._import_id,
            )
            # All requests of this serve run share one imports row.
            self._import_id = result.import_id
            self.stats.requests += 1
            self.stats.spans += result.spans
            self.stats.logs += result.logs
            self.stats.rejected += result.skipped_spans
            self.stats.last_received_ns = time.time_ns()
            return result.skipped_spans

    def note_error(self, message: str) -> None:
        with self._lock:
            self.stats.last_error = message

    def info(self) -> Dict[str, Any]:
        """The ``receiver`` block of ``/api/meta``."""
        with self._lock:
            stats = self.stats
            return {
                "enabled": True,
                "endpoint": self.endpoint,
                "port": self.port,
                "requests": stats.requests,
                "spans": stats.spans,
                "logs": stats.logs,
                "rejected": stats.rejected,
                "lastReceivedNs": None if stats.last_received_ns is None
                else str(stats.last_received_ns),
                "lastError": stats.last_error,
            }

    def close(self) -> None:
        with self._lock:
            self._con.close()


def make_receiver_handler(receiver: Receiver) -> "type[BaseHTTPRequestHandler]":
    # Only check the Host header when listening on loopback: there it stops a
    # DNS-rebinding page from posting here. Bound to another interface, the
    # senders are other machines or containers and use their own host names.
    check_host = receiver.host in LOCAL_HOSTS

    class OtlpReceiverHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self) -> None:  # noqa: N802 - inherited stdlib API name
            path = urlsplit(self.path).path.rstrip("/")
            content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            as_json = content_type == JSON
            try:
                signal = SIGNALS.get(path)
                if signal is None:
                    raise _Rejected(
                        HTTPStatus.NOT_FOUND,
                        f"no OTLP route {path}: WizardFlow receives /v1/traces and /v1/logs"
                        + (" (not metrics)" if path == "/v1/metrics" else ""),
                    )
                self._check_sender()
                if content_type not in (PROTOBUF, JSON):
                    raise _Rejected(
                        HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                        f"send {PROTOBUF} or {JSON}, not {content_type or 'no content type'}",
                    )
                request = self._parse(path, self._body(), as_json)
                try:
                    rejected = receiver.ingest(path, request)
                except (OtlpFormatError, TypeError, AttributeError, ValueError) as exc:
                    raise _Rejected(HTTPStatus.BAD_REQUEST, f"not an OTLP request: {exc}") from None
                except sqlite3.OperationalError as exc:
                    # Locked by a long `db import`, say: the exporter retries 503s.
                    raise _Rejected(HTTPStatus.SERVICE_UNAVAILABLE, f"database busy: {exc}") from None
            except _Rejected as exc:
                if exc.status != HTTPStatus.NOT_FOUND:
                    receiver.note_error(str(exc))
                # The body may be unread; it must not be taken for the next request.
                self.close_connection = True
                self._error(exc.status, str(exc), as_json)
                return
            response: Dict[str, Any] = {}
            if rejected:
                response["partialSuccess"] = {
                    signal[3]: rejected if not as_json else str(rejected),
                    "errorMessage": f"{rejected} span(s) without a valid trace or span id",
                }
            if as_json:
                self._send(HTTPStatus.OK, JSON, json.dumps(response).encode("utf-8"))
            else:
                self._send(HTTPStatus.OK, PROTOBUF, encode(response, signal[2]))

        def _check_sender(self) -> None:
            if check_host and urlparse(f"//{self.headers.get('Host', '')}").hostname not in LOCAL_HOSTS:
                raise _Rejected(HTTPStatus.FORBIDDEN, "unexpected Host header")
            # Browsers send an Origin with a cross-site POST; exporters don't.
            # A JSON or protobuf body would need a CORS preflight, which this
            # server never answers, so this is a second line.
            origin = self.headers.get("Origin")
            if origin is not None and urlparse(origin).hostname not in LOCAL_HOSTS:
                raise _Rejected(HTTPStatus.FORBIDDEN, "OTLP from web pages is not accepted")

        def _body(self) -> bytes:
            if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
                raise _Rejected(HTTPStatus.LENGTH_REQUIRED, "send a Content-Length")
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise _Rejected(HTTPStatus.BAD_REQUEST, "invalid Content-Length") from None
            if length > MAX_OTLP_BODY:
                raise _Rejected(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request body too large")
            body = self.rfile.read(length)
            encoding = (self.headers.get("Content-Encoding") or "identity").strip().lower()
            if encoding == "identity":
                return body
            if encoding != "gzip":
                raise _Rejected(
                    HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                    f"unsupported Content-Encoding {encoding!r} (use gzip or none)",
                )
            inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
            try:
                data = inflater.decompress(body, MAX_OTLP_BODY)
            except zlib.error as exc:
                raise _Rejected(HTTPStatus.BAD_REQUEST, f"invalid gzip body: {exc}") from None
            if inflater.unconsumed_tail:
                raise _Rejected(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "decompressed body too large")
            return data

        def _parse(self, path: str, body: bytes, as_json: bool) -> Dict[str, Any]:
            if not as_json:
                try:
                    return SIGNALS[path][1](body)
                except ProtobufError as exc:
                    raise _Rejected(HTTPStatus.BAD_REQUEST, f"invalid protobuf: {exc}") from None
            try:
                value = json.loads(body or b"{}")
            except ValueError as exc:
                raise _Rejected(HTTPStatus.BAD_REQUEST, f"invalid JSON: {exc}") from None
            if not isinstance(value, dict):
                raise _Rejected(HTTPStatus.BAD_REQUEST, "the JSON body must be an object")
            return value

        def _error(self, status: HTTPStatus, message: str, as_json: bool) -> None:
            # OTLP/HTTP errors carry a google.rpc.Status in the request's encoding.
            code = _RPC_UNAVAILABLE if status == HTTPStatus.SERVICE_UNAVAILABLE else _RPC_INVALID_ARGUMENT
            if as_json:
                self._send(status, JSON, json.dumps({"code": code, "message": message}).encode("utf-8"))
            else:
                self._send(status, PROTOBUF, encode({"code": code, "message": message}, RPC_STATUS))

        def _send(self, status: HTTPStatus, content_type: str, body: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            if status == HTTPStatus.SERVICE_UNAVAILABLE:
                self.send_header("Retry-After", "1")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            return

    return OtlpReceiverHandler


__all__ = [
    "DEFAULT_OTLP_PORT",
    "MAX_OTLP_BODY",
    "Receiver",
    "ReceiverStats",
    "make_receiver_handler",
]
