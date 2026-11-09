"""``wizardflow serve``: the bundled UI plus an API over the local OTel store.

Read-only apart from the settings writes (the attribute mapping), which are
accepted from this machine only. A second listener receives OTLP from apps
(:mod:`wizardflow.receiver`): on by default when bound to this machine only."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit, urlparse

from .receiver import Receiver, make_receiver_handler
from .store import open_store, projection
from .store import queries, settings

API_PREFIX = "/api/"
DASHBOARD_ROUTE = "/otel"


def make_serve_handler(
    *, ui_dir: Path, db_path: Path, version: str, receiver: Optional[Receiver] = None
) -> "type[SimpleHTTPRequestHandler]":
    class WizardFlowServeHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(ui_dir), **kwargs)

        def do_GET(self) -> None:  # noqa: N802 - inherited stdlib API name
            parts = urlsplit(self.path)
            if parts.path.startswith(API_PREFIX):
                self._api(unquote(parts.path), parse_qs(parts.query))
                return
            # The static export writes /otel as otel.html; map clean URLs to it.
            name = unquote(parts.path).lstrip("/")
            if name and "." not in Path(name).name and (ui_dir / f"{name}.html").is_file():
                self.path = f"/{quote(name)}.html" + (f"?{parts.query}" if parts.query else "")
            super().do_GET()

        def do_PUT(self) -> None:  # noqa: N802 - inherited stdlib API name
            self._write("PUT")

        def do_DELETE(self) -> None:  # noqa: N802 - inherited stdlib API name
            self._write("DELETE")

        def do_OPTIONS(self) -> None:  # noqa: N802 - inherited stdlib API name
            # CORS preflight for the `npm run dev` dashboard's writes.
            origin = self.headers.get("Origin")
            if not (origin and _is_local_origin(origin)):
                self.send_error(HTTPStatus.FORBIDDEN)
                return
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def _api(self, path: str, query: Dict[str, Any]) -> None:
            try:
                con = _read_connection(db_path)
            except sqlite3.Error as exc:
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": f"database unavailable: {exc}"})
                return
            self._answer(
                con, lambda: _route(con, path, query, str(db_path), version, receiver)
            )

        def _write(self, method: str) -> None:
            parts = urlsplit(self.path)
            path = unquote(parts.path)
            if not path.startswith(API_PREFIX):
                self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
                return
            # Writes come from this machine's own dashboard only: a local Host
            # (no DNS rebinding) and, if the browser sends one, a local Origin
            # (no other website posting here). A JSON body also forces a CORS
            # preflight, which non-local origins never pass.
            origin = self.headers.get("Origin")
            if not _is_local_host(self.headers.get("Host", "")) or (
                origin is not None and not _is_local_origin(origin)
            ):
                self._json(HTTPStatus.FORBIDDEN, {"error": "settings can only be changed from this machine"})
                return
            body: Any = None
            if method == "PUT":
                if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                    self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "send application/json"})
                    return
                length = int(self.headers.get("Content-Length") or 0)
                if length > MAX_BODY:
                    self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "request body too large"})
                    return
                try:
                    body = json.loads(self.rfile.read(length) or b"null")
                except ValueError:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "body is not valid JSON"})
                    return
            try:
                con = _write_connection(db_path)
            except sqlite3.Error as exc:
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": f"database unavailable: {exc}"})
                return
            self._answer(con, lambda: _write_route(con, method, path, parse_qs(parts.query), body))

        def _answer(self, con: sqlite3.Connection, run: Callable[[], Any]) -> None:
            try:
                status, body = HTTPStatus.OK, run()
            except queries.QueryError as exc:
                status, body = HTTPStatus.BAD_REQUEST, {"error": str(exc)}
            except queries.NotFound as exc:
                status, body = HTTPStatus.NOT_FOUND, {"error": str(exc)}
            except sqlite3.Error as exc:
                status, body = HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"database error: {exc}"}
            finally:
                con.close()
            self._json(status, body)

        def _json(self, status: HTTPStatus, body: Any) -> None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            # The replay viewer polls its trace URL for live updates; an ETag
            # lets an unchanged answer go back as a bodiless 304.
            etag = f'"{hashlib.sha1(payload).hexdigest()[:20]}"'
            if status == HTTPStatus.OK and self.headers.get("If-None-Match") == etag:
                self.send_response(HTTPStatus.NOT_MODIFIED)
                self.send_header("ETag", etag)
                self.end_headers()
                return
            self.send_response(status)
            self.send_header("ETag", etag)
            # Lets a local `npm run dev` dashboard read this API from its own
            # port during development. Local origins only: the API serves
            # prompts and user data.
            origin = self.headers.get("Origin")
            if origin and _is_local_origin(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args: Any) -> None:
            return

    return WizardFlowServeHandler


def _route(
    con: sqlite3.Connection,
    path: str,
    query: Dict[str, Any],
    db_path: str,
    version: str,
    receiver: Optional[Receiver] = None,
) -> Any:
    one: Callable[[str], Optional[str]] = lambda key: (query.get(key) or [None])[0]
    rest = path[len(API_PREFIX):].strip("/")
    if rest == "meta":
        meta = queries.meta(con, db_path=db_path, version=version)
        meta["receiver"] = receiver.info() if receiver else {"enabled": False}
        if receiver:
            meta["capabilities"].append("otlp-receiver")
        return meta
    if rest == "version":
        return queries.data_version(con)
    if rest == "projects":
        return queries.list_projects(con)
    filters = lambda: dict(  # noqa: E731 - the trace list's shared filters
        from_ns=_int(one("from"), "from"),
        to_ns=_int(one("to"), "to"),
        kind=one("kind") or "all",
        errors_only=one("errors") in ("1", "true"),
        q=one("q"),
        limit=_int(one("limit"), "limit") or queries.DEFAULT_PAGE,
    )
    if rest == "traces":
        return queries.list_traces(
            con,
            one("project") or "",
            conversation=one("conversation"),
            no_conversation=one("noConversation") in ("1", "true"),
            cursor=one("cursor"),
            **filters(),
        )
    if rest == "traces/groups":
        return queries.list_conversation_groups(con, one("project") or "", **filters())
    segments = rest.split("/")
    if len(segments) == 2 and segments[0] == "traces":
        return queries.get_trace(con, one("project") or "", segments[1])
    # Replay: an AgentTraceFile the existing viewer loads via ?trace=<this URL>.
    if len(segments) == 3 and segments[0] == "traces" and segments[2] == "agenttrace":
        return projection.project_trace(con, one("project") or "", segments[1])
    if rest == "conversations":
        return projection.list_conversations(con, one("project") or "")
    if len(segments) == 3 and segments[0] == "conversations" and segments[2] == "agenttrace":
        return projection.project_conversation(con, one("project") or "", segments[1])
    if rest == "logs":
        return queries.list_logs(
            con,
            one("project") or "",
            min_severity=_int(one("minSeverity"), "minSeverity") or 0,
            correlation=one("correlation") or "all",
            q=one("q"),
            cursor=one("cursor"),
            limit=_int(one("limit"), "limit") or queries.DEFAULT_PAGE,
        )
    if rest == "settings":
        return queries.get_settings(con)
    if rest == "settings/coverage":
        return settings.mapping_coverage(con, one("project"))
    raise queries.NotFound(f"no API route {path}")


def _write_route(
    con: sqlite3.Connection, method: str, path: str, query: Dict[str, Any], body: Any
) -> Any:
    rest = path[len(API_PREFIX):].strip("/")
    if rest != "settings/mapping":
        raise queries.NotFound(f"no API route {method} {path}")
    if method == "PUT":
        if not isinstance(body, dict):
            raise queries.QueryError('send {"project": name or null, "mapping": {...}}')
        result = settings.save_mapping(con, body.get("project"), body.get("mapping"))
    else:
        result = settings.reset_mapping(con, (query.get("project") or [None])[0])
    return {"reindexed": result, **queries.get_settings(con)}


LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")
MAX_BODY = 1 << 20


def _is_local_origin(origin: str) -> bool:
    parsed = urlparse(origin)
    return parsed.scheme in ("http", "https") and parsed.hostname in LOCAL_HOSTS


def _is_local_host(host: str) -> bool:
    return urlparse(f"//{host}").hostname in LOCAL_HOSTS


def _int(raw: Optional[str], name: str) -> Optional[int]:
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except ValueError:
        raise queries.QueryError(f"{name} must be an integer") from None


def _read_connection(db_path: Path) -> sqlite3.Connection:
    # Read-only and per request: safe across the server's threads, and WAL
    # lets reads run while `wizardflow db import` writes.
    con = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    con.execute("PRAGMA busy_timeout = 5000")
    return con


def _write_connection(db_path: Path) -> sqlite3.Connection:
    # Only settings writes use this; run_serve already created and migrated
    # the store. Autocommit mode: the settings functions open their own
    # transactions.
    con = sqlite3.connect(str(db_path), isolation_level=None)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 5000")
    return con


def dashboard_url(*, host: str, port: int, project: Optional[str] = None) -> str:
    display_host = "127.0.0.1" if host in {"", "0.0.0.0"} else host
    query = f"?{urlencode({'project': project})}" if project else ""
    return f"http://{display_host}:{port}{DASHBOARD_ROUTE}{query}"


def run_serve(
    *,
    db_path: Path,
    ui_dir: Path,
    host: str,
    port: int,
    open_browser: bool,
    version: str,
    project: Optional[str] = None,
    otlp_port: Optional[int] = None,
    otlp_required: bool = True,
) -> int:
    # Creates and migrates the store up front, so requests only ever read.
    open_store(db_path).close()
    receiver_server: Optional[ThreadingHTTPServer] = None
    receiver: Optional[Receiver] = None
    if otlp_port is not None:
        try:
            receiver_server, receiver = start_receiver(db_path, host=host, port=otlp_port)
        except ReceiverPortError as exc:
            if otlp_required:
                raise
            print(f"Warning: the dashboard opens without live data: {exc}", file=sys.stderr)
    handler = make_serve_handler(
        ui_dir=ui_dir, db_path=db_path, version=version, receiver=receiver
    )
    try:
        with ThreadingHTTPServer((host, port), handler) as server:
            url = dashboard_url(host=host, port=server.server_port, project=project)
            print(f"Database: {db_path}")
            print(f"WizardFlow dashboard: {url}")
            if receiver is not None:
                print(f"OTLP receiver: {receiver.endpoint}  (/v1/traces, /v1/logs)")
                print(f"  Point your app at it: OTEL_EXPORTER_OTLP_ENDPOINT={receiver.endpoint}")
            print("Press Ctrl+C to stop.")
            if open_browser:
                webbrowser.open(url)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                print()
    finally:
        if receiver_server is not None and receiver is not None:
            receiver_server.shutdown()
            receiver_server.server_close()
            receiver.close()
    return 0


class ReceiverPortError(OSError):
    """The OTLP port is taken; the message says what to do."""


class _ExclusiveServer(ThreadingHTTPServer):
    # A fixed, well-known port must fail when taken. HTTPServer sets
    # SO_REUSEADDR, which on Windows lets a second process bind a port in
    # use, so the receiver would silently share 4318 with a Collector.
    # Elsewhere it only skips TIME_WAIT after a restart, which is wanted.
    allow_reuse_address = sys.platform != "win32"
    allow_reuse_port = False


def start_receiver(
    db_path: Path, *, host: str, port: int
) -> Tuple[ThreadingHTTPServer, Receiver]:
    """Listen for OTLP on ``port`` (0: a free one) in a background thread."""
    receiver = Receiver(db_path, host=host, port=port)
    try:
        server = _ExclusiveServer((host, port), make_receiver_handler(receiver))
    except OSError as exc:
        receiver.close()
        raise ReceiverPortError(
            f"cannot listen for OTLP on {host}:{port} ({exc.strerror or exc}); is an "
            "OTel Collector or another receiver running there? Pass --otlp-port to use "
            "another port"
        ) from None
    receiver.port = server.server_port
    threading.Thread(target=server.serve_forever, name="wizardflow-otlp", daemon=True).start()
    return server, receiver
