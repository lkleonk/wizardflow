"""Render an AgentTrace JSON object to Markdown.

Pure transform: :func:`render_markdown` takes the same ``AgentTraceFile`` dict
the visualizer loads (see ``src/types/agenttrace.ts``) and returns a Markdown
string. No I/O — the CLI (``wizardflow md``) handles reading and writing.

Payload values are arbitrary JSON (``value: unknown`` in the schema), so they
are rendered by type: scalars inline, multi-line strings and structured values
(dict/list) in fenced code blocks.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ._render import classify_value, meta_text, short_time


def render_markdown(
    trace: Dict[str, Any], *, fallback_title: str = "AgentTrace", mermaid: bool = True
) -> str:
    """Render an AgentTrace dict to a Markdown document.

    ``fallback_title`` is used as the H1 when the trace has no ``name`` (the CLI
    passes the file name). ``mermaid`` controls the graph diagram section.
    """
    blocks: List[str] = []

    title = trace.get("name") or fallback_title
    blocks.append(f"# {title}")

    meta = trace.get("meta") or {}
    description = meta.get("description")
    if isinstance(description, str) and description:
        blocks.append("\n".join(f"> {line}" for line in description.split("\n")))

    blocks.append(_meta_table(trace, meta))

    # The Graph section holds the diagram and the node-description list; the
    # --no-mermaid flag omits only the diagram, and a trace whose nodes carry
    # no descriptions renders exactly as before.
    graph = trace.get("graph") or {}
    graph_parts: List[str] = []
    if mermaid:
        diagram = _mermaid(graph)
        if diagram:
            graph_parts.append(diagram)
    node_list = _node_descriptions(graph)
    if node_list:
        graph_parts.append(node_list)
    if graph_parts:
        blocks.append("## Graph")
        blocks.extend(graph_parts)

    for message in trace.get("messages") or []:
        blocks.extend(_message_blocks(message))

    return "\n\n".join(b for b in blocks if b) + "\n"


def _meta_table(trace: Dict[str, Any], meta: Dict[str, Any]) -> str:
    rows = [("version", trace.get("version", ""))]
    for key, value in meta.items():
        if key == "description":
            continue  # already rendered as the blockquote above
        rows.append((key, value))
    lines = ["| field | value |", "| --- | --- |"]
    lines += [f"| {key} | {value} |" for key, value in rows]
    return "\n".join(lines)


def _node_descriptions(graph: Dict[str, Any]) -> str:
    """Bullet list of the nodes that carry a description; empty when none do."""
    lines = [
        f"- **{node.get('label') or node.get('id')}** — {node['description']}"
        for node in graph.get("nodes") or []
        if isinstance(node.get("description"), str) and node["description"]
    ]
    return "\n".join(lines)


def _message_blocks(message: Dict[str, Any]) -> List[str]:
    title = message.get("label") or message.get("id") or "(message)"
    blocks = [f"## {title}"]
    meta = message.get("meta")
    if isinstance(meta, dict) and meta:
        blocks.append(
            " · ".join(f"**{key}**: {meta_text(value)}" for key, value in meta.items())
        )
    for step in message.get("steps") or []:
        node = step.get("nodeId", "")
        clock = short_time(step.get("timestamp", ""))
        blocks.append(f"### {node} · {clock}" if clock else f"### {node}")
        for payload in step.get("payloads") or []:
            blocks.append(_payload_block(payload.get("label", ""), payload.get("value")))
    return blocks


def _payload_block(label: str, value: Any) -> str:
    kind, text = classify_value(value)
    if kind == "structured":
        return f"**{label}**\n\n{_fence(text, 'json')}"
    # A string with a newline or backtick can't sit in inline code — fence it.
    if kind == "string" and ("\n" in text or "`" in text):
        return f"**{label}**\n\n{_fence(text)}"
    return f"**{label}**: `{text}`"


def _mermaid(graph: Dict[str, Any]) -> str:
    nodes = graph.get("nodes") or []
    if not nodes:
        return ""
    edges = graph.get("edges") or []

    safe_ids: Dict[Any, str] = {}
    lines = ["```mermaid", "flowchart TD"]
    for index, node in enumerate(nodes):
        node_id = node.get("id")
        safe = f"n{index}"
        safe_ids[node_id] = safe
        text = node.get("label") or node_id or safe
        lines.append(f'    {safe}["{_mermaid_text(text)}"]')
    for edge in edges:
        source = safe_ids.get(edge.get("source"))
        target = safe_ids.get(edge.get("target"))
        if source is None or target is None:
            continue  # edge referencing an undeclared node — can't draw it
        arrow = "-.->" if edge.get("conditional") else "-->"
        lines.append(f"    {source} {arrow} {target}")
    lines.append("```")
    return "\n".join(lines)


def _mermaid_text(text: Any) -> str:
    # Mermaid breaks on a literal double quote inside a ["..."] label.
    return str(text).replace('"', "'")


def _fence(text: str, lang: str = "") -> str:
    """Wrap text in a fenced block whose fence outlasts any backticks inside."""
    longest = 0
    run = 0
    for char in text:
        run = run + 1 if char == "`" else 0
        longest = max(longest, run)
    ticks = "`" * max(3, longest + 1)
    return f"{ticks}{lang}\n{text}\n{ticks}"
