"""Render an AgentTrace JSON object to a self-contained HTML document.

Pure transform, mirroring :mod:`wizardflow.markdown`: :func:`render_html` takes
the ``AgentTraceFile`` dict the visualizer loads (see
``src/types/agenttrace.ts``) and returns a standalone HTML string — inline CSS,
no JavaScript, no external assets. The graph is intentionally omitted; this is a
readable transcript of the messages you can open in any browser, offline.

Payload values are classified by :func:`wizardflow._render.classify_value`:
scalars inline, multi-line strings and structured values in ``<pre>`` blocks.
Everything is HTML-escaped.
"""

from __future__ import annotations

from html import escape
from typing import Any, Dict, List

from ._render import classify_value, short_time

# Inline stylesheet — kept here so the output is a single self-contained file.
# System colors + `color-scheme` give a free light/dark mode that follows the OS.
_STYLE = """\
:root { color-scheme: light dark; }
body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  line-height: 1.5; margin: 0; padding: 2rem 1rem;
  background: Canvas; color: CanvasText;
}
main { max-width: 820px; margin: 0 auto; }
h1 { font-size: 1.6rem; border-bottom: 1px solid #8884; padding-bottom: .4rem; }
blockquote {
  margin: 0 0 1rem; padding: .4rem .9rem; border-left: 3px solid #8888;
  color: #8a8a8a; font-style: italic;
}
table.meta { border-collapse: collapse; font-size: .85rem; margin-bottom: 2rem; }
table.meta th, table.meta td {
  border: 1px solid #8884; padding: .25rem .6rem; text-align: left;
}
table.meta th { font-weight: 600; }
section.message {
  border: 1px solid #8883; border-radius: 8px;
  padding: .25rem 1rem 1rem; margin-bottom: 1.5rem;
}
section.message > h2 { font-size: 1.15rem; margin: .8rem 0 .4rem; }
section.step { padding: .9rem 0; }
section.step:first-of-type { padding-top: .2rem; }
/* Divider between consecutive nodes in a message. */
section.step + section.step { border-top: 1px solid #8884; }
section.step > h3 {
  font-size: .95rem; margin: 0 0 .4rem; font-family: ui-monospace, monospace;
}
section.step > h3 .time { color: #8a8a8a; font-weight: 400; }
p.scalar { margin: .3rem 0; }
.label { font-weight: 600; }
.payload { margin: .5rem 0; }
.payload .label { display: block; margin-bottom: .25rem; }
code {
  background: #8881; padding: .1rem .35rem; border-radius: 4px;
  font-family: ui-monospace, monospace; font-size: .9em;
}
pre {
  background: #8881; padding: .7rem .9rem; border-radius: 6px;
  overflow-x: auto; margin: 0;
}
pre code { background: none; padding: 0; }
"""


def render_html(trace: Dict[str, Any], *, fallback_title: str = "AgentTrace") -> str:
    """Render an AgentTrace dict to a complete HTML document string.

    ``fallback_title`` is used as the title when the trace has no ``name`` (the
    CLI passes the file name).
    """
    title = trace.get("name") or fallback_title

    body: List[str] = [f"<h1>{escape(str(title))}</h1>"]

    meta = trace.get("meta") or {}
    description = meta.get("description")
    if isinstance(description, str) and description:
        body.append(f"<blockquote>{escape(description)}</blockquote>")

    body.append(_meta_table(trace, meta))

    for message in trace.get("messages") or []:
        body.append(_message_html(message))

    return _document(str(title), "\n".join(body))


def _document(title: str, body: str) -> str:
    return (
        "<!doctype html>\n"
        '<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{escape(title)}</title>\n"
        f"<style>\n{_STYLE}</style>\n"
        "</head>\n<body>\n<main>\n"
        f"{body}\n"
        "</main>\n</body>\n</html>\n"
    )


def _meta_table(trace: Dict[str, Any], meta: Dict[str, Any]) -> str:
    rows = [("version", trace.get("version", ""))]
    for key, value in meta.items():
        if key == "description":
            continue  # already shown as the blockquote
        rows.append((key, value))
    cells = "\n".join(
        f"<tr><th>{escape(str(key))}</th><td>{escape(str(value))}</td></tr>"
        for key, value in rows
    )
    return f'<table class="meta">\n{cells}\n</table>'


def _message_html(message: Dict[str, Any]) -> str:
    title = message.get("label") or message.get("id") or "(message)"
    parts = ['<section class="message">', f"<h2>{escape(str(title))}</h2>"]
    for step in message.get("steps") or []:
        node = escape(str(step.get("nodeId", "")))
        clock = short_time(step.get("timestamp", ""))
        heading = node + (f' <span class="time">· {escape(clock)}</span>' if clock else "")
        parts.append('<section class="step">')
        parts.append(f"<h3>{heading}</h3>")
        for payload in step.get("payloads") or []:
            parts.append(_payload_html(payload.get("label", ""), payload.get("value")))
        parts.append("</section>")
    parts.append("</section>")
    return "\n".join(parts)


def _payload_html(label: str, value: Any) -> str:
    label_esc = escape(str(label))
    kind, text = classify_value(value)
    if kind == "structured":
        return (
            f'<div class="payload"><span class="label">{label_esc}</span>'
            f"<pre><code>{escape(text)}</code></pre></div>"
        )
    if kind == "string" and "\n" in text:
        return (
            f'<div class="payload"><span class="label">{label_esc}</span>'
            f"<pre>{escape(text)}</pre></div>"
        )
    return (
        f'<p class="scalar"><span class="label">{label_esc}</span> '
        f"<code>{escape(text)}</code></p>"
    )
