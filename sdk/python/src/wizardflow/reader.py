"""Read an AgentTrace file into an assembled trace dict.

Accepts either framing, matching the web viewer's ``parseAgentTrace``:

- a **JSONL part** (the SDK's output): a ``header`` record on line 1, then one
  ``message`` record per line, optionally ending in a ``seal`` record. The
  assembled form is the ``AgentTraceFile`` the visualizer loads — the header's
  fields plus a ``messages`` list collected from the message records in file
  order, with a ``seal``'s ``nextPart`` folded into ``meta.nextPart``.
- a **single-document ``AgentTraceFile`` JSON** (what ``wizardflow json``
  emits, and what the website also reads): returned as-is.

JSONL is detected by the first non-empty line being a ``header`` record;
anything else is tried as a single JSON document. The SDK only ever *writes*
JSONL — accepting both here is for *reading*, so the CLI converters stay at
parity with the website.

JSONL tolerance rules (the writer appends without ever rewriting, so a crash
can leave a torn final line):

- an unparseable **final** line is dropped — everything before it is intact;
- an unparseable line anywhere else is skipped with a warning rather than
  failing the whole file — a debugging tool that refuses to show 199 of 200
  messages is failing at its job;
- records with an unknown ``type`` are skipped silently (forward compat);
- duplicate message ids keep the **last** occurrence's content (room for
  future amend semantics) at the first occurrence's position.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict

from .client import WizardFlowError
from .constants import Logging, Records

logger = logging.getLogger(Logging.LOGGER_NAME)

__all__ = ["TraceFormatError", "load_trace_file"]


class TraceFormatError(WizardFlowError):
    """Raised when a file is neither an AgentTrace JSONL part nor a
    single-document AgentTrace JSON."""


def load_trace_file(path: "Path | str") -> Dict[str, Any]:
    """Load ``path`` (a JSONL part or a single-document JSON) into a trace dict."""
    raw = Path(path).read_text(encoding="utf-8")
    lines = [ln for ln in raw.split("\n") if ln.strip()]

    header = _parse_record(lines[0]) if lines else None
    if header is not None and header.get(Records.TYPE_KEY) == Records.HEADER:
        return _assemble_jsonl(header, lines, path)

    # Not JSONL (line 1 is no header) — try a single-document AgentTraceFile,
    # the form `wizardflow json` emits and the website also reads.
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    if _is_agent_trace_file(parsed):
        return parsed

    raise TraceFormatError(
        f"{path}: not an AgentTrace JSONL part (no header line) nor a "
        "single-document AgentTrace JSON"
    )


def _assemble_jsonl(
    header: Dict[str, Any], lines: list, path: "Path | str"
) -> Dict[str, Any]:
    graph = header.get("graph")
    if (
        not isinstance(graph, dict)
        or not isinstance(graph.get("nodes"), list)
        or not isinstance(graph.get("edges"), list)
    ):
        raise TraceFormatError(f"{path}: header record has no graph.nodes/edges")

    messages: Dict[str, Dict[str, Any]] = {}
    next_part = None
    last = len(lines) - 1
    for i, line in enumerate(lines[1:], start=1):
        record = _parse_record(line)
        if record is None:
            if i == last:
                logger.warning("%s: dropping torn final line", path)
            else:
                logger.warning("%s: skipping unparseable line %d", path, i + 1)
            continue
        kind = record.get(Records.TYPE_KEY)
        if kind == Records.MESSAGE:
            record.pop(Records.TYPE_KEY, None)
            message_id = record.get("id")
            if not isinstance(message_id, str):
                logger.warning("%s: skipping message record without id (line %d)", path, i + 1)
                continue
            messages[message_id] = record
        elif kind == Records.SEAL:
            next_part = record.get("nextPart")
        # anything else: a record type from a future writer; ignore.

    trace = {k: v for k, v in header.items() if k != Records.TYPE_KEY}
    if next_part is not None:
        trace["meta"] = {**trace.get("meta", {}), "nextPart": next_part}
    trace["messages"] = list(messages.values())
    return trace


def _is_agent_trace_file(value: Any) -> bool:
    """Minimal shape check for a single-document AgentTraceFile, matching the
    web viewer's ``isAgentTraceFile``."""
    if not isinstance(value, dict):
        return False
    graph = value.get("graph")
    return (
        isinstance(graph, dict)
        and isinstance(graph.get("nodes"), list)
        and isinstance(graph.get("edges"), list)
        and isinstance(value.get("messages"), list)
    )


def _parse_record(line: str) -> "Dict[str, Any] | None":
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        return None
    return record if isinstance(record, dict) else None
