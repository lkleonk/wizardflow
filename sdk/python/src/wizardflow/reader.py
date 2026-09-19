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
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .client import WizardFlowError
from .constants import Logging, Records

logger = logging.getLogger(Logging.LOGGER_NAME)

__all__ = ["TraceChain", "TraceFormatError", "load_trace_chain", "load_trace_file"]


@dataclass(frozen=True)
class TraceChain:
    """One transport-neutral run assembled from one or more JSONL parts."""

    trace: Dict[str, Any]
    parts: Tuple[Path, ...]
    sealed: bool
    source_format: str = "jsonl"


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


def load_trace_chain(
    path: "Path | str", *, current_part_only: bool = False
) -> TraceChain:
    """Load a complete, safely linked JSONL rotation chain.

    Single-document traces and ``current_part_only`` inputs are returned as a
    one-file unit. Links are restricted to plain sibling filenames.
    """
    requested = Path(path).resolve()
    first_trace = _stable_load(requested)
    is_jsonl = _is_jsonl_framing(requested)
    if current_part_only or not is_jsonl:
        return TraceChain(
            first_trace,
            (requested,),
            _is_sealed(requested) if is_jsonl else True,
            "jsonl" if is_jsonl else "json",
        )

    current = requested
    seen = set()
    while True:
        if current in seen:
            raise TraceFormatError(f"{requested}: cycle in prevPart links")
        seen.add(current)
        trace = _stable_load(current)
        previous = trace.get("meta", {}).get("prevPart")
        if previous is None:
            break
        current = _safe_sibling(current, previous, "prevPart")

    parts: List[Path] = []
    traces: List[Dict[str, Any]] = []
    seen.clear()
    while True:
        if current in seen:
            raise TraceFormatError(f"{requested}: cycle in nextPart links")
        seen.add(current)
        trace = _stable_load(current)
        parts.append(current)
        traces.append(trace)
        next_name = trace.get("meta", {}).get("nextPart")
        if next_name is None:
            break
        following = _safe_sibling(current, next_name, "nextPart")
        following_trace = _stable_load(following)
        if following_trace.get("meta", {}).get("prevPart") != current.name:
            raise TraceFormatError(
                f"{following}: prevPart does not point back to {current.name}"
            )
        current = following

    _validate_chain(parts, traces)
    assembled = dict(traces[0])
    assembled["messages"] = [
        message for trace in traces for message in trace.get("messages", [])
    ]
    meta = dict(assembled.get("meta", {}))
    for key in ("part", "prevPart", "nextPart"):
        meta.pop(key, None)
    assembled["meta"] = meta
    return TraceChain(assembled, tuple(parts), _is_sealed(parts[-1]))


def _stable_load(path: Path) -> Dict[str, Any]:
    for attempt in range(2):
        before = path.stat()
        trace = load_trace_file(path)
        after = path.stat()
        if (before.st_mtime_ns, before.st_size) == (after.st_mtime_ns, after.st_size):
            return trace
        if attempt == 0:
            continue
    raise TraceFormatError(f"{path}: changed while being read; retry from a snapshot")


def _safe_sibling(path: Path, value: Any, field: str) -> Path:
    if not isinstance(value, str) or not value or Path(value).name != value:
        raise TraceFormatError(f"{path}: unsafe {field} value {value!r}")
    candidate = path.parent / value
    if not candidate.is_file() or candidate.resolve().parent != path.parent.resolve():
        raise TraceFormatError(f"{path}: referenced {field} file is unavailable: {value}")
    return candidate.resolve()


def _is_sealed(path: Path) -> bool:
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    record = _parse_record(lines[-1]) if lines else None
    return bool(record and record.get(Records.TYPE_KEY) == Records.SEAL)


def _is_jsonl_framing(path: Path) -> bool:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            record = _parse_record(line)
            return bool(record and record.get(Records.TYPE_KEY) == Records.HEADER)
    return False


def _validate_chain(parts: List[Path], traces: List[Dict[str, Any]]) -> None:
    baseline = traces[0]
    base_meta = {
        key: value
        for key, value in baseline.get("meta", {}).items()
        if key not in {"part", "prevPart", "nextPart"}
    }
    for index, (path, trace) in enumerate(zip(parts, traces), start=1):
        if trace.get("version") != baseline.get("version"):
            raise TraceFormatError(f"{path}: schema version differs from first part")
        if trace.get("name") != baseline.get("name"):
            raise TraceFormatError(f"{path}: trace name differs from first part")
        if trace.get("graph") != baseline.get("graph"):
            raise TraceFormatError(f"{path}: graph differs from first part")
        meta = {
            key: value
            for key, value in trace.get("meta", {}).items()
            if key not in {"part", "prevPart", "nextPart"}
        }
        if meta != base_meta:
            raise TraceFormatError(f"{path}: run metadata differs from first part")
        part_number = trace.get("meta", {}).get("part", 1)
        if part_number != index:
            raise TraceFormatError(
                f"{path}: expected part number {index}, found {part_number!r}"
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
