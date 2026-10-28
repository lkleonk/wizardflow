"""``wizardflow serve``: the bundled UI plus a read API over the local OTel store."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit, urlparse

from .store import open_store, projection
from .store import queries

API_PREFIX = "/api/"
DASHBOARD_ROUTE = "/otel"


def make_serve_handler(
    *, ui_dir: Path, db_path: Path, version: str
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

        def _api(self, path: str, query: Dict[str, Any]) -> None:
            try:
                con = _read_connection(db_path)
            except sqlite3.Error as exc:
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": f"database unavailable: {exc}"})
                return
            try:
                status, body = HTTPStatus.OK, _route(con, path, query, str(db_path), version)
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
    con: sqlite3.Connection, path: str, query: Dict[str, Any], db_path: str, version: str
) -> Any:
    one: Callable[[str], Optional[str]] = lambda key: (query.get(key) or [None])[0]
    rest = path[len(API_PREFIX):].strip("/")
    if rest == "meta":
        return queries.meta(con, db_path=db_path, version=version)
    if rest == "projects":
        return queries.list_projects(con)
    if rest == "traces":
        return queries.list_traces(
            con,
            one("project") or "",
            from_ns=_int(one("from"), "from"),
            to_ns=_int(one("to"), "to"),
            kind=one("kind") or "all",
            errors_only=one("errors") in ("1", "true"),
            q=one("q"),
            cursor=one("cursor"),
            limit=_int(one("limit"), "limit") or queries.DEFAULT_PAGE,
        )
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
    raise queries.NotFound(f"no API route {path}")


def _is_local_origin(origin: str) -> bool:
    parsed = urlparse(origin)
    return parsed.scheme in ("http", "https") and parsed.hostname in ("localhost", "127.0.0.1", "::1")


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
) -> int:
    # Creates and migrates the store up front, so requests only ever read.
    open_store(db_path).close()
    handler = make_serve_handler(ui_dir=ui_dir, db_path=db_path, version=version)
    with ThreadingHTTPServer((host, port), handler) as server:
        url = dashboard_url(host=host, port=server.server_port, project=project)
        print(f"Database: {db_path}")
        print(f"WizardFlow dashboard: {url}")
        print("Press Ctrl+C to stop.")
        if open_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
    return 0
