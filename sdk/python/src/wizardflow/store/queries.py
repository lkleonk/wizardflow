"""Read queries behind ``/api``: plain dicts, ready for ``json.dumps``.

Contract with the web UI (``web/src/types/otelstore.ts``), so the two change
together:

- keys are camelCase;
- nanosecond timestamps are **strings**: they exceed JavaScript's 2^53, so a
  JSON number would silently lose precision in the browser;
- attribute columns arrive parsed, as objects.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from typing import Any, Dict, List, Optional, Tuple

from .mapping import load_mapping
from .schema import FLAG_GENAI, FLAG_TOPOLOGY, FLAG_WIZARDFLOW, LATEST_VERSION

DEFAULT_PAGE = 50
MAX_PAGE = 500

TRACE_KINDS = ("all", "wizardflow", "genai", "otel")

# Project activity chart: 24 half-hour slots.
ACTIVITY_SLOT_NS = 30 * 60 * 1_000_000_000
ACTIVITY_SLOTS = 24
LOG_CORRELATIONS = ("all", "with", "without")


class QueryError(ValueError):
    """A bad request parameter; the message is user-facing."""


class NotFound(LookupError):
    """The requested project or trace doesn't exist."""


# --------------------------------------------------------------------------- meta


def meta(con: sqlite3.Connection, *, db_path: str, version: str) -> Dict[str, Any]:
    size = 0
    for suffix in ("", "-wal"):
        try:
            size += os.path.getsize(db_path + suffix)
        except OSError:
            pass
    return {
        "schemaVersion": con.execute("PRAGMA user_version").fetchone()[0],
        "latestSchemaVersion": LATEST_VERSION,
        "dbPath": db_path,
        "dbSizeBytes": size,
        "wizardflowVersion": version,
        "capabilities": ["traces", "logs", "settings", "settings-write"],
    }


def data_version(con: sqlite3.Connection) -> Dict[str, str]:
    """A token that changes whenever spans, logs or imports are added.

    The dashboard polls it every few seconds to refresh while the receiver
    or a ``db import`` writes, so it reads only rowid maxima (an index seek
    each). Duplicates that an import skips don't change it, nor need to.
    """
    spans, logs, imports = con.execute(
        "SELECT (SELECT coalesce(max(id), 0) FROM spans), "
        "(SELECT coalesce(max(id), 0) FROM logs), "
        "(SELECT coalesce(max(id), 0) FROM imports)"
    ).fetchone()
    return {"dataVersion": f"{spans}.{logs}.{imports}"}


# --------------------------------------------------------------------------- projects


def list_projects(con: sqlite3.Connection, *, now_ns: Optional[int] = None) -> List[Dict[str, Any]]:
    rows = con.execute(
        """
        SELECT p.id, p.name,
          (SELECT count(*) FROM traces t WHERE t.project_id = p.id),
          (SELECT coalesce(sum(t.span_count), 0) FROM traces t WHERE t.project_id = p.id),
          (SELECT count(*) FROM traces t WHERE t.project_id = p.id AND t.error_count > 0),
          (SELECT count(*) FROM logs l WHERE l.project_id = p.id),
          (SELECT coalesce(sum(coalesce(t.input_tokens, 0) + coalesce(t.output_tokens, 0)), 0)
             FROM traces t WHERE t.project_id = p.id),
          (SELECT coalesce(max(t.end_ns), 0) FROM traces t WHERE t.project_id = p.id),
          (SELECT coalesce(max(l.ts_ns), 0) FROM logs l WHERE l.project_id = p.id),
          (SELECT group_concat(DISTINCT r.service_name) FROM resources r WHERE r.project_id = p.id)
        FROM projects p
        ORDER BY p.name
        """
    ).fetchall()
    projects = []
    for (pid, name, traces, spans, error_traces, logs, tokens, last_trace, last_log,
         services) in rows:
        # OR over the distinct per-trace flag values: which layers occur at all.
        layer_flags = 0
        for (value,) in con.execute(
            "SELECT DISTINCT flags & 3 FROM traces WHERE project_id = ?", (pid,)
        ):
            layer_flags |= value
        projects.append({
            "id": pid,
            "name": name,
            "traceCount": traces,
            "spanCount": spans,
            "errorTraceCount": error_traces,
            "logCount": logs,
            "tokenCount": tokens,
            "lastSeenNs": _ns(max(last_trace, last_log)) if (last_trace or last_log) else None,
            "flags": layer_flags,
            "services": sorted(filter(None, (services or "").split(","))),
            "sources": _sources(con, pid),
            "activity": _activity(con, pid, now_ns or time.time_ns()),
        })
    return projects


def _sources(con: sqlite3.Connection, pid: int) -> List[Dict[str, Any]]:
    """Where a project's spans and logs came from, oldest import first.

    ``upload``: a file sent by the dashboard's "Import a run" (stored under its
    bare file name); ``file``: ``db import`` / ``dashboard FILE`` (stored under
    its absolute path); ``receiver``: sent by an app to the dashboard's OTLP
    receiver, listed once however many dashboard runs received it.
    """
    rows = con.execute(
        """
        SELECT i.source, i.path FROM imports i
         WHERE i.id IN (
           SELECT s.import_id FROM spans s JOIN traces t ON t.id = s.trace_row
            WHERE t.project_id = ? AND s.import_id IS NOT NULL
           UNION
           SELECT l.import_id FROM logs l
            WHERE l.project_id = ? AND l.import_id IS NOT NULL)
         ORDER BY i.imported_ns, i.id
        """,
        (pid, pid),
    ).fetchall()
    sources: List[Dict[str, Any]] = []
    received = False
    for source, path in rows:
        if source == "otlp_http":
            received = True
            continue
        if not path:
            continue
        name = re.split(r"[\\/]", path)[-1]
        uploaded = name == path
        sources.append({"kind": "upload" if uploaded else "file", "name": name, "path": None if uploaded else path})
    if received:
        sources.append({"kind": "receiver", "name": "OTLP receiver", "path": None})
    return sources


def _activity(con: sqlite3.Connection, pid: int, now_ns: int) -> Dict[str, Any]:
    """Traces started per half hour over 12 hours, ending now; or ending at
    the project's last trace when that is older (an imported old dump)."""
    slot, slots = ACTIVITY_SLOT_NS, ACTIVITY_SLOTS
    end = -(-now_ns // slot) * slot
    anchor = "now"
    latest = con.execute(
        "SELECT max(start_ns) FROM traces WHERE project_id = ?", (pid,)
    ).fetchone()[0]
    if latest is not None and latest < end - slots * slot:
        end, anchor = (latest // slot + 1) * slot, "last"
    start = end - slots * slot
    traces, errors = [0] * slots, [0] * slots
    # A start after the window's end (a sender whose clock runs ahead) counts
    # in the newest slot, so the chart never comes out empty beside a count.
    for index, count, failed in con.execute(
        "SELECT min((start_ns - ?) / ?, ?), count(*), sum(error_count > 0) FROM traces "
        "WHERE project_id = ? AND start_ns >= ? GROUP BY 1",
        (start, slot, slots - 1, pid, start),
    ):
        traces[index] += count
        errors[index] += failed
    return {
        "endNs": _ns(end),
        "slotNs": _ns(slot),
        "anchor": anchor,
        "traces": traces,
        "errors": errors,
    }


def project_id(con: sqlite3.Connection, name: Optional[str]) -> int:
    if not name:
        raise QueryError("missing ?project=")
    row = con.execute("SELECT id FROM projects WHERE name = ?", (name,)).fetchone()
    if not row:
        raise NotFound(f"no project named {name!r}")
    return row[0]


# --------------------------------------------------------------------------- traces

_TRACE_COLUMNS = (
    "id, trace_id, name, service_name, start_ns, end_ns, span_count, error_count, "
    "log_count, input_tokens, output_tokens, model, conversation_id, user_id, flags, "
    "root_span_id"
)


def list_traces(
    con: sqlite3.Connection,
    project: str,
    *,
    from_ns: Optional[int] = None,
    to_ns: Optional[int] = None,
    kind: str = "all",
    errors_only: bool = False,
    q: Optional[str] = None,
    conversation: Optional[str] = None,
    no_conversation: bool = False,
    cursor: Optional[str] = None,
    limit: int = DEFAULT_PAGE,
) -> Dict[str, Any]:
    """Newest first, keyset-paged on (start_ns, id)."""
    pid = project_id(con, project)
    limit = _limit(limit)
    where, params = _trace_filters(
        pid, from_ns=from_ns, to_ns=to_ns, kind=kind, errors_only=errors_only, q=q,
        conversation=conversation, no_conversation=no_conversation,
    )
    if cursor:
        start, row_id = _parse_cursor(cursor)
        where.append("(start_ns < ? OR (start_ns = ? AND id < ?))")
        params += [start, start, row_id]
    rows = con.execute(
        f"SELECT {_TRACE_COLUMNS} FROM traces WHERE {' AND '.join(where)} "
        "ORDER BY start_ns DESC, id DESC LIMIT ?",
        [*params, limit + 1],
    ).fetchall()
    items = [_trace_row(row) for row in rows[:limit]]
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = f"{last[4]}:{last[0]}"
    return {"items": items, "nextCursor": next_cursor}


def list_conversation_groups(
    con: sqlite3.Connection,
    project: str,
    *,
    from_ns: Optional[int] = None,
    to_ns: Optional[int] = None,
    kind: str = "all",
    errors_only: bool = False,
    q: Optional[str] = None,
    limit: int = DEFAULT_PAGE,
) -> Dict[str, Any]:
    """The trace list grouped by conversation id, newest activity first; the
    traces without one come last as a single group (``conversationId`` null).
    The same filters as ``list_traces`` pick the traces that are grouped."""
    pid = project_id(con, project)
    limit = _limit(limit)
    where, params = _trace_filters(
        pid, from_ns=from_ns, to_ns=to_ns, kind=kind, errors_only=errors_only, q=q
    )
    rows = con.execute(
        "SELECT conversation_id, count(*), min(start_ns), max(start_ns), max(end_ns), "
        "sum(span_count), sum(log_count), sum(error_count > 0), sum(input_tokens), "
        f"sum(output_tokens), max(model), sum(flags & {FLAG_WIZARDFLOW} > 0), "
        f"max(flags & {FLAG_GENAI}) | max(flags & {FLAG_WIZARDFLOW}) | max(flags & {FLAG_TOPOLOGY}) "
        f"FROM traces WHERE {' AND '.join(where)} GROUP BY conversation_id "
        "ORDER BY conversation_id IS NULL, max(start_ns) DESC LIMIT ?",
        [*params, limit + 1],
    ).fetchall()
    items = [
        {
            "conversationId": conversation,
            "traceCount": count,
            "replayableCount": replayable,
            "firstNs": _ns(first),
            "lastStartNs": _ns(last_start),
            "lastEndNs": _ns(last_end),
            "spanCount": spans,
            "logCount": logs,
            "errorTraceCount": failed,
            "inputTokens": in_tok,
            "outputTokens": out_tok,
            "model": model,
            "flags": flags,
        }
        for (conversation, count, first, last_start, last_end, spans, logs, failed, in_tok,
             out_tok, model, replayable, flags) in rows[:limit]
    ]
    return {"items": items, "hasMore": len(rows) > limit}


def _trace_filters(
    pid: int,
    *,
    from_ns: Optional[int],
    to_ns: Optional[int],
    kind: str,
    errors_only: bool,
    q: Optional[str],
    conversation: Optional[str] = None,
    no_conversation: bool = False,
) -> Tuple[List[str], List[Any]]:
    if kind not in TRACE_KINDS:
        raise QueryError(f"kind must be one of {', '.join(TRACE_KINDS)}")
    where = ["project_id = ?"]
    params: List[Any] = [pid]
    if conversation is not None:
        where.append("conversation_id = ?")
        params.append(conversation)
    elif no_conversation:
        where.append("conversation_id IS NULL")
    if from_ns is not None:
        where.append("start_ns >= ?")
        params.append(from_ns)
    if to_ns is not None:
        where.append("start_ns <= ?")
        params.append(to_ns)
    if kind == "wizardflow":
        where.append(f"flags & {FLAG_WIZARDFLOW}")
    elif kind == "genai":
        where.append(f"flags & {FLAG_GENAI}")
    elif kind == "otel":
        where.append(f"NOT flags & {FLAG_WIZARDFLOW | FLAG_GENAI}")
    if errors_only:
        where.append("error_count > 0")
    if q:
        like = f"%{_escape_like(q)}%"
        where.append(
            "(name LIKE ? ESCAPE '\\' OR trace_id LIKE ? ESCAPE '\\' "
            "OR conversation_id LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\')"
        )
        params += [like] * 4
    return where, params


def get_trace(con: sqlite3.Connection, project: str, trace_id: str) -> Dict[str, Any]:
    """One project's slice of a trace: spans, events, links, logs, other slices."""
    pid = project_id(con, project)
    row = con.execute(
        f"SELECT {_TRACE_COLUMNS} FROM traces WHERE project_id = ? AND trace_id = ?",
        (pid, trace_id.lower()),
    ).fetchone()
    if not row:
        raise NotFound(f"no trace {trace_id} in project {project!r}")
    trace = _trace_row(row)
    trace_row = row[0]

    spans = []
    span_ids: Dict[int, str] = {}
    for (rid, span_id, parent, name, kind, start, end, status, status_msg, attrs,
         dropped, resource_id, node_id, node_kind, execution_key) in con.execute(
        "SELECT id, span_id, parent_span_id, name, kind, start_ns, end_ns, status_code, "
        "status_message, attributes, dropped_attributes_count, resource_id, node_id, "
        "node_kind, execution_key FROM spans WHERE trace_row = ? ORDER BY start_ns, id",
        (trace_row,),
    ):
        span_ids[rid] = span_id
        spans.append({
            "spanId": span_id,
            "parentSpanId": parent,
            "name": name,
            "kind": kind,
            "startNs": _ns(start),
            "endNs": _ns(end),
            "statusCode": status,
            "statusMessage": status_msg,
            "attributes": _obj(attrs),
            "droppedAttributesCount": dropped,
            "resourceId": resource_id,
            "nodeId": node_id,
            "nodeKind": node_kind,
            "executionKey": execution_key,
            "events": [],
            "links": [],
        })
    by_id = {span["spanId"]: span for span in spans}
    for span_row, time_ns, name, attrs in con.execute(
        "SELECT span_row, time_ns, name, attributes FROM span_events "
        "WHERE trace_row = ? ORDER BY span_row, seq",
        (trace_row,),
    ):
        by_id[span_ids[span_row]]["events"].append(
            {"timeNs": _ns(time_ns), "name": name, "attributes": _obj(attrs)}
        )
    for span_row, linked_trace, linked_span, attrs in con.execute(
        "SELECT l.span_row, l.linked_trace_id, l.linked_span_id, l.attributes "
        "FROM span_links l JOIN spans s ON s.id = l.span_row WHERE s.trace_row = ?",
        (trace_row,),
    ):
        by_id[span_ids[span_row]]["links"].append(
            {"traceId": linked_trace, "spanId": linked_span, "attributes": _obj(attrs)}
        )

    resources = {
        rid: {"serviceName": service, "attributes": _obj(attrs)}
        for rid, service, attrs in con.execute(
            "SELECT DISTINCT r.id, r.service_name, r.attributes FROM resources r "
            "JOIN spans s ON s.resource_id = r.id WHERE s.trace_row = ?",
            (trace_row,),
        )
    }
    logs = [
        _log_row(row)
        for row in con.execute(
            f"SELECT {_LOG_COLUMNS} FROM logs WHERE project_id = ? AND trace_id = ? "
            "ORDER BY ts_ns, id",
            (pid, trace["traceId"]),
        )
    ]
    other_slices = [
        {"project": name, "spanCount": count, "rootSpanName": root_name}
        for name, count, root_name in con.execute(
            "SELECT p.name, t.span_count, t.name FROM traces t JOIN projects p "
            "ON p.id = t.project_id WHERE t.trace_id = ? AND t.id <> ? ORDER BY p.name",
            (trace["traceId"], trace_row),
        )
    ]
    return {
        "trace": trace,
        "spans": spans,
        "resources": {str(k): v for k, v in resources.items()},
        "logs": logs,
        "otherSlices": other_slices,
        "conversation": _conversation_position(con, pid, trace),
    }


def _conversation_position(
    con: sqlite3.Connection, pid: int, trace: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """Where a trace sits in its conversation, for "Execution 3 of 7".

    A replayable trace counts only replayable ones, so the number matches its
    chip in graph replay; any other trace counts the whole conversation.
    """
    conversation = trace["conversationId"]
    if conversation is None:
        return None
    required = trace["flags"] & FLAG_WIZARDFLOW
    ids = [
        trace_id
        for (trace_id,) in con.execute(
            "SELECT trace_id FROM traces WHERE project_id = ? AND conversation_id = ? "
            "AND flags & ? = ? ORDER BY start_ns, id",
            (pid, conversation, required, required),
        )
    ]
    index = ids.index(trace["traceId"])
    return {
        "position": index + 1,
        "total": len(ids),
        "prevTraceId": ids[index - 1] if index > 0 else None,
        "nextTraceId": ids[index + 1] if index + 1 < len(ids) else None,
    }


# --------------------------------------------------------------------------- logs

_LOG_COLUMNS = (
    "id, ts_ns, severity_number, severity_text, body, body_text, attributes, "
    "event_name, trace_id, span_id"
)


def list_logs(
    con: sqlite3.Connection,
    project: str,
    *,
    min_severity: int = 0,
    correlation: str = "all",
    q: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: int = DEFAULT_PAGE,
) -> Dict[str, Any]:
    """Newest first, keyset-paged on (ts_ns, id)."""
    pid = project_id(con, project)
    if correlation not in LOG_CORRELATIONS:
        raise QueryError(f"correlation must be one of {', '.join(LOG_CORRELATIONS)}")
    limit = _limit(limit)
    where = ["project_id = ?", "severity_number >= ?"]
    params: List[Any] = [pid, min_severity]
    if correlation == "with":
        where.append("trace_id IS NOT NULL")
    elif correlation == "without":
        where.append("trace_id IS NULL")
    if q:
        where.append("body_text LIKE ? ESCAPE '\\'")
        params.append(f"%{_escape_like(q)}%")
    if cursor:
        ts, row_id = _parse_cursor(cursor)
        where.append("(ts_ns < ? OR (ts_ns = ? AND id < ?))")
        params += [ts, ts, row_id]
    rows = con.execute(
        f"SELECT {_LOG_COLUMNS} FROM logs WHERE {' AND '.join(where)} "
        "ORDER BY ts_ns DESC, id DESC LIMIT ?",
        [*params, limit + 1],
    ).fetchall()
    items = [_log_row(row) for row in rows[:limit]]
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = f"{last[1]}:{last[0]}"
    return {"items": items, "nextCursor": next_cursor}


# --------------------------------------------------------------------------- settings


def get_settings(con: sqlite3.Connection) -> Dict[str, Any]:
    names = dict(con.execute("SELECT id, name FROM projects").fetchall())
    overrides: Dict[str, Dict[str, List[str]]] = {}
    for pid, concept, keys in con.execute(
        "SELECT project_id, concept, keys FROM attribute_mappings "
        "WHERE project_id IS NOT NULL ORDER BY project_id, concept"
    ):
        overrides.setdefault(names[pid], {})[concept] = json.loads(keys)
    return {
        "mapping": {"defaults": load_mapping(con, None), "overrides": overrides},
        "settings": {
            key: json.loads(value)
            for key, value in con.execute("SELECT key, value FROM settings ORDER BY key")
        },
    }


# --------------------------------------------------------------------------- helpers


def _trace_row(row: Tuple[Any, ...]) -> Dict[str, Any]:
    (_rid, trace_id, name, service, start, end, spans, errors, logs, in_tok, out_tok,
     model, conversation, user, flags, root) = row
    return {
        "traceId": trace_id,
        "name": name,
        "serviceName": service,
        "startNs": _ns(start),
        "endNs": _ns(end),
        "durationNs": _ns(end - start),
        "spanCount": spans,
        "errorCount": errors,
        "logCount": logs,
        "inputTokens": in_tok,
        "outputTokens": out_tok,
        "model": model,
        "conversationId": conversation,
        "userId": user,
        "flags": flags,
        "rootSpanId": root,
    }


def _log_row(row: Tuple[Any, ...]) -> Dict[str, Any]:
    (_rid, ts, severity, severity_text, body, body_text, attrs, event_name,
     trace_id, span_id) = row
    return {
        "id": _rid,
        "tsNs": _ns(ts),
        "severityNumber": severity,
        "severityText": severity_text,
        "body": json.loads(body) if body is not None else None,
        "bodyText": body_text,
        "attributes": _obj(attrs),
        "eventName": event_name,
        "traceId": trace_id,
        "spanId": span_id,
    }


def _ns(value: Optional[int]) -> Optional[str]:
    return None if value is None else str(value)


def _obj(text: Optional[str]) -> Any:
    return json.loads(text) if text else {}


def _limit(limit: int) -> int:
    if limit < 1:
        raise QueryError("limit must be at least 1")
    return min(limit, MAX_PAGE)


def _parse_cursor(cursor: str) -> Tuple[int, int]:
    try:
        first, second = cursor.split(":", 1)
        return int(first), int(second)
    except ValueError:
        raise QueryError("malformed cursor") from None


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
