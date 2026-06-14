"""Command-line helpers for the WizardFlow SDK."""

from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional, Sequence
from urllib.parse import urlencode, urlsplit

from .html import render_html
from .markdown import render_markdown
from .reader import TraceFormatError, load_trace_file

# The bundled static UI fetches the assembled trace as plain JSON; the CLI does
# the JSONL assembly server-side, so the UI build never needs to know about
# part files.
TRACE_ROUTE = "/__wizardflow_trace.json"


class WizardFlowCliError(Exception):
    """Raised for user-facing CLI errors."""


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "ui":
            return run_ui(
                trace=args.trace,
                path=args.path,
                host=args.host,
                port=args.port,
                open_browser=not args.no_open,
            )
        if args.command == "md":
            return run_md(
                trace=args.trace,
                path=args.path,
                output=args.output,
                mermaid=args.mermaid,
            )
        if args.command == "html":
            return run_html(
                trace=args.trace,
                path=args.path,
                output=args.output,
            )
        if args.command == "json":
            return run_json(
                trace=args.trace,
                path=args.path,
                output=args.output,
            )
    except WizardFlowCliError as exc:
        parser.exit(2, f"wizardflow: error: {exc}\n")

    parser.print_help()
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wizardflow",
        description="Record and inspect WizardFlow agent traces.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Shared by every subcommand that reads a trace file.
    trace_input = argparse.ArgumentParser(add_help=False)
    trace_input.add_argument(
        "trace",
        nargs="?",
        help="AgentTrace file (.jsonl part or single-document .json).",
    )
    trace_input.add_argument(
        "--path",
        dest="path",
        help="AgentTrace file (.jsonl or .json). Equivalent to the positional path.",
    )

    ui = subparsers.add_parser(
        "ui",
        parents=[trace_input],
        help="Open a local WizardFlow viewer for an AgentTrace file.",
    )
    ui.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host interface to bind. Defaults to 127.0.0.1.",
    )
    ui.add_argument(
        "--port",
        type=int,
        default=0,
        help="Port to bind. Defaults to 0, which asks the OS for a free port.",
    )
    ui.add_argument(
        "--no-open",
        action="store_true",
        help="Print the local URL without opening a browser.",
    )

    md = subparsers.add_parser(
        "md",
        parents=[trace_input],
        help="Render an AgentTrace file to Markdown.",
    )
    md.add_argument(
        "-o",
        "--output",
        dest="output",
        help="Write Markdown to this file instead of stdout.",
    )
    mermaid = md.add_mutually_exclusive_group()
    mermaid.add_argument(
        "--mermaid",
        dest="mermaid",
        action="store_true",
        default=True,
        help="Include a Mermaid graph diagram (default).",
    )
    mermaid.add_argument(
        "--no-mermaid",
        dest="mermaid",
        action="store_false",
        help="Omit the Mermaid graph diagram.",
    )

    html = subparsers.add_parser(
        "html",
        parents=[trace_input],
        help="Render an AgentTrace file to a self-contained HTML document.",
    )
    html.add_argument(
        "-o",
        "--output",
        dest="output",
        help="Write HTML to this file instead of stdout.",
    )

    json_ = subparsers.add_parser(
        "json",
        parents=[trace_input],
        help="Assemble an AgentTrace file into one pretty-printed JSON document.",
    )
    json_.add_argument(
        "-o",
        "--output",
        dest="output",
        help="Write JSON to this file instead of stdout.",
    )
    return parser


def run_ui(
    *,
    trace: Optional[str],
    path: Optional[str],
    host: str,
    port: int,
    open_browser: bool,
) -> int:
    trace_path = _resolve_trace_path(trace=trace, path=path)
    _load_trace(trace_path)  # fail fast on an unreadable trace before serving
    ui_dir = _resolve_ui_dir()

    handler = _make_handler(ui_dir=ui_dir, trace_path=trace_path)
    with ThreadingHTTPServer((host, port), handler) as server:
        url = _viewer_url(host=host, port=server.server_port, trace_name=trace_path.name)
        print(f"WizardFlow UI: {url}")
        print("Press Ctrl+C to stop.")
        if open_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
    return 0


def run_md(
    *,
    trace: Optional[str],
    path: Optional[str],
    output: Optional[str],
    mermaid: bool,
) -> int:
    return _render_to_output(
        trace=trace,
        path=path,
        output=output,
        kind="Markdown",
        render=lambda data, title: render_markdown(
            data, fallback_title=title, mermaid=mermaid
        ),
    )


def run_json(
    *,
    trace: Optional[str],
    path: Optional[str],
    output: Optional[str],
) -> int:
    """Assemble the JSONL part into one pretty-printed AgentTraceFile document.

    The inverse of how the SDK writes: the readable, single-document form for
    inspecting, diffing, or handing someone a canonical JSON. The web UI reads
    this format too.
    """
    return _render_to_output(
        trace=trace,
        path=path,
        output=output,
        kind="JSON",
        # The trace is already the assembled dict; ignore the fallback title.
        render=lambda data, _title: json.dumps(data, indent=2, ensure_ascii=False)
        + "\n",
    )


def run_html(
    *,
    trace: Optional[str],
    path: Optional[str],
    output: Optional[str],
) -> int:
    return _render_to_output(
        trace=trace,
        path=path,
        output=output,
        kind="HTML",
        render=lambda data, title: render_html(data, fallback_title=title),
    )


def _render_to_output(
    *,
    trace: Optional[str],
    path: Optional[str],
    output: Optional[str],
    kind: str,
    render: "Callable[[Any, str], str]",
) -> int:
    """Resolve + load a trace, render it, and write to a file or stdout."""
    trace_path = _resolve_trace_path(trace=trace, path=path)
    data = _load_trace(trace_path)
    rendered = render(data, trace_path.name)

    if output:
        out_path = Path(output).expanduser()
        try:
            out_path.write_text(rendered, encoding="utf-8")
        except OSError as exc:
            raise WizardFlowCliError(f"could not write {kind} file: {exc}") from exc
        print(f"Wrote {out_path}")
    else:
        sys.stdout.write(rendered)
    return 0


def _resolve_trace_path(*, trace: Optional[str], path: Optional[str]) -> Path:
    if trace and path:
        raise WizardFlowCliError("pass either a positional trace path or --path, not both")
    raw = path or trace
    if not raw:
        raise WizardFlowCliError("missing trace path: provide an AgentTrace JSON file")
    trace_path = Path(raw).expanduser().resolve()
    if not trace_path.is_file():
        raise WizardFlowCliError(f"trace file does not exist: {trace_path}")
    return trace_path


def _resolve_ui_dir(ui_dir: Optional[Path] = None) -> Path:
    resolved = ui_dir or Path(__file__).with_name("_ui")
    index = resolved / "index.html"
    if not index.is_file():
        raise WizardFlowCliError(
            "bundled WizardFlow UI is missing. Build the SDK UI before packaging "
            "with `python scripts/build_ui.py` from sdk/python/."
        )
    return resolved


def _load_trace(path: Path) -> Any:
    """Load a trace (JSONL part or single-document JSON) into the AgentTraceFile
    dict, surfacing failures as CLI errors."""
    try:
        value = load_trace_file(path)
    except OSError as exc:
        raise WizardFlowCliError(f"could not read trace file: {exc}") from exc
    except TraceFormatError as exc:
        raise WizardFlowCliError(
            f"trace file is not a WizardFlow AgentTrace file: {exc}"
        ) from exc

    if not _is_agent_trace_file(value):
        raise WizardFlowCliError(
            "trace file does not look like a WizardFlow AgentTrace file"
        )
    return value


def _is_agent_trace_file(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    graph = value.get("graph")
    return (
        isinstance(graph, dict)
        and isinstance(graph.get("nodes"), list)
        and isinstance(graph.get("edges"), list)
        and isinstance(value.get("messages"), list)
    )


def _make_handler(*, ui_dir: Path, trace_path: Path) -> type[SimpleHTTPRequestHandler]:
    class WizardFlowUiHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(ui_dir), **kwargs)

        def do_GET(self) -> None:  # noqa: N802 - inherited stdlib API name
            if urlsplit(self.path).path == TRACE_ROUTE:
                self._serve_trace()
                return
            super().do_GET()

        def _serve_trace(self) -> None:
            # Assemble the JSONL part into a plain AgentTraceFile JSON document
            # per request — the active part may have grown since the last fetch,
            # and the static UI only ever sees assembled JSON.
            try:
                payload = json.dumps(
                    load_trace_file(trace_path), ensure_ascii=False
                ).encode("utf-8")
            except (OSError, TraceFormatError) as exc:
                body = f"Could not read trace file: {exc}\n".encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args: Any) -> None:
            return

    return WizardFlowUiHandler


def _viewer_url(*, host: str, port: int, trace_name: str) -> str:
    display_host = "127.0.0.1" if host in {"", "0.0.0.0"} else host
    query = urlencode({"trace": TRACE_ROUTE, "traceName": trace_name})
    return f"http://{display_host}:{port}/?{query}"


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
