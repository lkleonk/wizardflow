"""Import OTLP JSON into the store.

One file is one transaction: a crash halfway leaves nothing behind. Spans are
deduplicated by (trace_id, span_id) across imports, and the same file imported
twice (by content hash) is a no-op. After the inserts, every touched trace
slice is rolled up: counts, root span, flags.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from .mapping import Mapping, as_int, as_text, first_value, load_mapping
from .otlp import LogRecord, Resource, Scope, Span, iter_logs, iter_requests, iter_spans

DEFAULT_PROJECT = "default"


@dataclass
class ImportResult:
    path: Optional[str]
    already_imported: bool = False
    spans: int = 0
    logs: int = 0
    duplicate_spans: int = 0
    skipped_spans: int = 0     # invalid trace / span id
    traces: int = 0            # trace slices created or updated
    projects: List[str] = field(default_factory=list)
    import_id: Optional[int] = None


def import_otlp_file(
    con: sqlite3.Connection, path: Path, *, project: Optional[str] = None
) -> ImportResult:
    """Import one OTLP JSON file. ``project`` overrides the resource-derived one."""
    data = Path(path).read_bytes()
    text = data.decode("utf-8-sig")
    return import_otlp_text(
        con,
        text,
        source="file",
        path=str(Path(path).resolve()),
        sha256=hashlib.sha256(data).hexdigest(),
        project=project,
    )


def import_otlp_text(
    con: sqlite3.Connection,
    text: str,
    *,
    source: str = "file",
    path: Optional[str] = None,
    sha256: Optional[str] = None,
    project: Optional[str] = None,
) -> ImportResult:
    if sha256 is not None and con.execute(
        "SELECT 1 FROM imports WHERE sha256 = ?", (sha256,)
    ).fetchone():
        return ImportResult(path=path, already_imported=True)

    # Parse fully first, so a malformed file fails before anything is written.
    requests = list(iter_requests(text))
    return import_requests(
        con, requests, source=source, path=path, sha256=sha256, project=project
    )


def import_requests(
    con: sqlite3.Connection,
    requests: Iterable[Dict[str, Any]],
    *,
    source: str = "file",
    path: Optional[str] = None,
    sha256: Optional[str] = None,
    project: Optional[str] = None,
    import_id: Optional[int] = None,
) -> ImportResult:
    """Import parsed OTLP export requests in one transaction.

    ``import_id`` adds to an existing ``imports`` row instead of creating
    one: the live receiver files all requests of one ``serve`` run under a
    single row rather than one per request.
    """
    importer = _Importer(con, project_override=project)
    con.execute("BEGIN IMMEDIATE")
    try:
        if import_id is None:
            import_id = con.execute(
                "INSERT INTO imports (source, path, sha256, imported_ns) VALUES (?, ?, ?, ?)",
                (source, path, sha256, importer.now_ns),
            ).lastrowid
        importer.import_id = import_id
        for request in requests:
            for span in iter_spans(request):
                importer.add_span(span)
            for log in iter_logs(request):
                importer.add_log(log)
        touched = importer.finish()
        result = importer.result
        result.path = path
        result.import_id = import_id
        result.traces = len(touched)
        con.execute(
            "UPDATE imports SET span_count = span_count + ?, log_count = log_count + ?, "
            "skipped_count = skipped_count + ? WHERE id = ?",
            (result.spans, result.logs, result.skipped_spans, import_id),
        )
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    return result


class _Importer:
    def __init__(self, con: sqlite3.Connection, *, project_override: Optional[str]) -> None:
        self.con = con
        self.now_ns = time.time_ns()
        self.import_id: Optional[int] = None
        self.result = ImportResult(path=None)
        self._project_override = project_override
        self._project_keys = load_mapping(con, None).get("project", [])
        self._projects: Dict[str, int] = {}
        self._mappings: Dict[int, Mapping] = {}
        self._resources: Dict[Tuple[int, str], Tuple[int, int]] = {}
        self._scopes: Dict[str, int] = {}
        self._trace_rows: Dict[Tuple[int, str], int] = {}
        self._touched: Set[int] = set()
        self._log_traces: Set[Tuple[int, str]] = set()
        self._project_names: Set[str] = set()

    # ------------------------------------------------------------------ inserts

    def add_span(self, span: Span) -> None:
        if not span.trace_id or not span.span_id:
            self.result.skipped_spans += 1
            return
        project_id, resource_id = self._resource(span.resource)
        scope_id = self._scope(span.scope)
        trace_row = self._trace_row(project_id, span.trace_id, span.start_ns, span.end_ns)
        mapping = self._mapping(project_id)
        attrs = span.attributes
        cur = self.con.execute(
            "INSERT INTO spans (trace_row, trace_id, span_id, parent_span_id, resource_id, "
            "scope_id, import_id, name, kind, start_ns, end_ns, status_code, status_message, "
            "trace_state, attributes, dropped_attributes_count, model, input_tokens, "
            "output_tokens, node_id, node_kind, execution_key) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (trace_id, span_id) DO NOTHING",
            (
                trace_row, span.trace_id, span.span_id, span.parent_span_id, resource_id,
                scope_id, self.import_id, span.name, span.kind, span.start_ns, span.end_ns,
                span.status_code, span.status_message, span.trace_state, _json(attrs),
                span.dropped_attributes_count,
                as_text(first_value(attrs, mapping.get("model", []))),
                as_int(first_value(attrs, mapping.get("input_tokens", []))),
                as_int(first_value(attrs, mapping.get("output_tokens", []))),
                as_text(first_value(attrs, mapping.get("node", []))),
                as_text(first_value(attrs, mapping.get("node_kind", []))),
                as_text(first_value(attrs, mapping.get("execution", []))),
            ),
        )
        if cur.rowcount != 1:
            self.result.duplicate_spans += 1
            return
        span_row = cur.lastrowid
        self.result.spans += 1
        self._touched.add(trace_row)
        if span.events:
            self.con.executemany(
                "INSERT INTO span_events (span_row, trace_row, seq, time_ns, name, attributes) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (span_row, trace_row, seq, event.time_ns, event.name, _json(event.attributes))
                    for seq, event in enumerate(span.events)
                ],
            )
        if span.links:
            self.con.executemany(
                "INSERT INTO span_links (span_row, linked_trace_id, linked_span_id, attributes) "
                "VALUES (?, ?, ?, ?)",
                [
                    (span_row, link.trace_id, link.span_id, _json(link.attributes))
                    for link in span.links
                ],
            )

    def add_log(self, log: LogRecord) -> None:
        project_id, resource_id = self._resource(log.resource)
        scope_id = self._scope(log.scope)
        ts_ns = log.time_ns or log.observed_ns or self.now_ns
        self.con.execute(
            "INSERT INTO logs (project_id, resource_id, scope_id, import_id, ts_ns, time_ns, "
            "observed_ns, severity_number, severity_text, body, attributes, event_name, "
            "trace_id, span_id, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                project_id, resource_id, scope_id, self.import_id, ts_ns, log.time_ns,
                log.observed_ns, log.severity_number, log.severity_text,
                None if log.body is None else json.dumps(log.body, ensure_ascii=False),
                _json(log.attributes), log.event_name, log.trace_id, log.span_id, log.flags,
            ),
        )
        self.result.logs += 1
        if log.trace_id:
            self._log_traces.add((project_id, log.trace_id))

    # ------------------------------------------------------------------ finish

    def finish(self) -> Set[int]:
        """Roll up every touched slice, plus the slices its logs and other
        projects share a trace id with. Returns the rolled-up trace rows."""
        for project_id, trace_id in self._log_traces:
            row = self.con.execute(
                "SELECT id FROM traces WHERE project_id = ? AND trace_id = ?",
                (project_id, trace_id),
            ).fetchone()
            if row:
                self._touched.add(row[0])
        created = set(self._trace_rows.values())
        # A slice created for spans that all turned out to be duplicates.
        if created:
            self.con.execute(
                "DELETE FROM traces WHERE id IN (SELECT value FROM json_each(?)) "
                "AND NOT EXISTS (SELECT 1 FROM spans s WHERE s.trace_row = traces.id)",
                (json.dumps(sorted(created)),),
            )
        touched = {
            row[0]
            for row in self.con.execute(
                "SELECT id FROM traces WHERE trace_id IN (SELECT trace_id FROM traces "
                "WHERE id IN (SELECT value FROM json_each(?)))",
                (json.dumps(sorted(self._touched)),),
            )
        }
        rollup(self.con, touched, self.now_ns)
        self.result.projects = sorted(self._project_names)
        return touched

    # ------------------------------------------------------------------ lookups

    def _project_id(self, name: str) -> int:
        cached = self._projects.get(name)
        if cached is not None:
            return cached
        self.con.execute(
            "INSERT INTO projects (name, created_ns) VALUES (?, ?) ON CONFLICT (name) DO NOTHING",
            (name, self.now_ns),
        )
        project_id = self.con.execute(
            "SELECT id FROM projects WHERE name = ?", (name,)
        ).fetchone()[0]
        self._projects[name] = project_id
        return project_id

    def _resource(self, resource: Resource) -> Tuple[int, int]:
        """(project_id, resource_id) for a resource, creating both as needed."""
        canonical = _json(resource.attributes)
        name = self._project_override or as_text(
            first_value(resource.attributes, self._project_keys)
        ) or DEFAULT_PROJECT
        project_id = self._project_id(name)
        self._project_names.add(name)
        key = (project_id, canonical)
        cached = self._resources.get(key)
        if cached is not None:
            return cached
        digest = _sha256(f"{project_id}\n{canonical}")
        self.con.execute(
            "INSERT INTO resources (project_id, service_name, attributes, hash) "
            "VALUES (?, ?, ?, ?) ON CONFLICT (hash) DO NOTHING",
            (project_id, as_text(resource.attributes.get("service.name")), canonical, digest),
        )
        resource_id = self.con.execute(
            "SELECT id FROM resources WHERE hash = ?", (digest,)
        ).fetchone()[0]
        self._resources[key] = (project_id, resource_id)
        return project_id, resource_id

    def _scope(self, scope: Scope) -> int:
        canonical = _json(scope.attributes)
        digest = _sha256(f"{scope.name}\n{scope.version}\n{canonical}")
        cached = self._scopes.get(digest)
        if cached is not None:
            return cached
        self.con.execute(
            "INSERT INTO scopes (name, version, attributes, hash) VALUES (?, ?, ?, ?) "
            "ON CONFLICT (hash) DO NOTHING",
            (scope.name, scope.version, canonical, digest),
        )
        scope_id = self.con.execute(
            "SELECT id FROM scopes WHERE hash = ?", (digest,)
        ).fetchone()[0]
        self._scopes[digest] = scope_id
        return scope_id

    def _trace_row(self, project_id: int, trace_id: str, start_ns: int, end_ns: int) -> int:
        key = (project_id, trace_id)
        cached = self._trace_rows.get(key)
        if cached is not None:
            return cached
        # The FK needs the slice before its spans; the roll-up fixes the times.
        self.con.execute(
            "INSERT INTO traces (project_id, trace_id, start_ns, end_ns, updated_ns) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT (project_id, trace_id) DO NOTHING",
            (project_id, trace_id, start_ns, end_ns, self.now_ns),
        )
        row = self.con.execute(
            "SELECT id FROM traces WHERE project_id = ? AND trace_id = ?", key
        ).fetchone()[0]
        self._trace_rows[key] = row
        return row

    def _mapping(self, project_id: int) -> Mapping:
        cached = self._mappings.get(project_id)
        if cached is None:
            cached = self._mappings[project_id] = load_mapping(self.con, project_id)
        return cached


# --------------------------------------------------------------------------- roll-up

# Statement order matters: the second reads root_span_id set by the first.
_ROLLUP_COUNTS = """
UPDATE traces SET
  start_ns      = (SELECT min(start_ns) FROM spans s WHERE s.trace_row = traces.id),
  end_ns        = (SELECT max(end_ns)   FROM spans s WHERE s.trace_row = traces.id),
  span_count    = (SELECT count(*)     FROM spans s WHERE s.trace_row = traces.id),
  error_count   = (SELECT count(*)     FROM spans s WHERE s.trace_row = traces.id AND s.status_code = 2),
  input_tokens  = (SELECT sum(input_tokens)  FROM spans s WHERE s.trace_row = traces.id),
  output_tokens = (SELECT sum(output_tokens) FROM spans s WHERE s.trace_row = traces.id),
  model         = (SELECT model FROM spans s WHERE s.trace_row = traces.id AND s.model IS NOT NULL
                   ORDER BY s.start_ns LIMIT 1),
  log_count     = (SELECT count(*) FROM logs l
                   WHERE l.trace_id = traces.trace_id AND l.project_id = traces.project_id),
  -- the true root if we have it, else the local root: earliest span whose parent isn't here
  root_span_id  = coalesce(
    (SELECT span_id FROM spans s WHERE s.trace_row = traces.id AND s.parent_span_id IS NULL
     ORDER BY s.start_ns LIMIT 1),
    (SELECT span_id FROM spans s WHERE s.trace_row = traces.id AND NOT EXISTS (
       SELECT 1 FROM spans p WHERE p.trace_row = s.trace_row AND p.span_id = s.parent_span_id)
     ORDER BY s.start_ns LIMIT 1)),
  flags =
      (CASE WHEN EXISTS (SELECT 1 FROM spans s WHERE s.trace_row = traces.id AND (
              s.operation IS NOT NULL OR s.model IS NOT NULL
              OR json_extract(s.attributes, '$."openinference.span.kind"') IS NOT NULL))
            THEN 1 ELSE 0 END)
    | (CASE WHEN EXISTS (SELECT 1 FROM spans s WHERE s.trace_row = traces.id AND s.node_id IS NOT NULL)
            THEN 2 ELSE 0 END)
    | (CASE WHEN EXISTS (SELECT 1 FROM span_events e
                         WHERE e.trace_row = traces.id AND e.name = 'wizardflow.graph')
            THEN 4 ELSE 0 END),
  updated_ns = :now
WHERE id IN (SELECT value FROM json_each(:rows))
"""

_ROLLUP_SHAPE = """
UPDATE traces SET
  flags = flags
    | (CASE WHEN EXISTS (SELECT 1 FROM traces o WHERE o.trace_id = traces.trace_id AND o.id <> traces.id)
            THEN 32 ELSE 0 END)
    | (CASE WHEN NOT EXISTS (SELECT 1 FROM spans s WHERE s.trace_row = traces.id AND s.parent_span_id IS NULL)
            THEN 8 ELSE 0 END)
    | (CASE WHEN (SELECT count(*) FROM spans s WHERE s.trace_row = traces.id AND
                  (s.parent_span_id IS NULL OR NOT EXISTS (SELECT 1 FROM spans p
                     WHERE p.trace_row = s.trace_row AND p.span_id = s.parent_span_id))) > 1
            THEN 16 ELSE 0 END),
  name = (SELECT name FROM spans s WHERE s.trace_row = traces.id AND s.span_id = traces.root_span_id),
  service_name = (SELECT r.service_name FROM spans s JOIN resources r ON r.id = s.resource_id
                  WHERE s.trace_row = traces.id AND s.span_id = traces.root_span_id)
WHERE id IN (SELECT value FROM json_each(:rows))
"""


def rollup(con: sqlite3.Connection, rows: Iterable[int], now_ns: Optional[int] = None) -> None:
    """Recompute counts, root, name and flags for the given trace slices, then
    their mapped conversation and user ids."""
    row_list = sorted(set(rows))
    if not row_list:
        return
    params = {"rows": json.dumps(row_list), "now": now_ns or time.time_ns()}
    con.execute(_ROLLUP_COUNTS, params)
    con.execute(_ROLLUP_SHAPE, params)
    _rollup_mapped(con, row_list)


def _rollup_mapped(con: sqlite3.Connection, rows: List[int]) -> None:
    """Conversation and user ids: mapping-driven, so resolved in Python.

    Any span of the slice counts, the root first (gen_ai.conversation.id
    usually sits on invoke_agent / chat spans, not the root). Within a
    concept, the first key wins across all spans before the next key is tried.
    """
    mappings: Dict[int, Mapping] = {}
    for row, project_id in con.execute(
        "SELECT id, project_id FROM traces WHERE id IN (SELECT value FROM json_each(?))",
        (json.dumps(rows),),
    ).fetchall():
        mapping = mappings.get(project_id)
        if mapping is None:
            mapping = mappings[project_id] = load_mapping(con, project_id)
        span_attrs = [
            json.loads(attrs)
            for (attrs,) in con.execute(
                "SELECT attributes FROM spans WHERE trace_row = ? "
                "ORDER BY (parent_span_id IS NULL) DESC, start_ns",
                (row,),
            )
        ]
        con.execute(
            "UPDATE traces SET conversation_id = ?, user_id = ? WHERE id = ?",
            (
                _first_across(span_attrs, mapping.get("conversation", [])),
                _first_across(span_attrs, mapping.get("user", [])),
                row,
            ),
        )


def _first_across(span_attrs: List[Dict[str, Any]], keys: List[str]) -> Optional[str]:
    for key in keys:
        for attrs in span_attrs:
            value = as_text(first_value(attrs, [key]))
            if value is not None:
                return value
    return None


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
