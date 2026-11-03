"""Settings writes: the attribute mapping, and the re-index a change needs.

Raw attributes are always stored, so a mapping change never loses data: the
re-index re-reads them into the mapped span columns (model, tokens, node, node
kind, execution) and rolls the affected slices up again (conversation, user,
flags). ``project`` is the exception: it decided where spans were filed at
import time, so a change only applies to later imports.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from typing import Any, Dict, List, Optional

from .importer import rollup
from .mapping import Mapping, as_int, as_text, first_value, load_mapping
from .queries import QueryError, project_id
from .schema import FLAG_WIZARDFLOW

# The seeded defaults (schema.py inserts the same rows into a new store).
DEFAULT_MAPPING: Mapping = {
    "project": ["openinference.project.name", "service.name"],
    "execution": ["wizardflow.message.id"],
    "conversation": ["gen_ai.conversation.id", "session.id"],
    "user": ["user.id"],
    "node": ["wizardflow.node.id"],
    "node_kind": ["wizardflow.node.kind", "gen_ai.operation.name", "openinference.span.kind"],
    "model": ["gen_ai.request.model", "llm.model_name"],
    "input_tokens": ["gen_ai.usage.input_tokens", "wizardflow.usage.input_tokens"],
    "output_tokens": ["gen_ai.usage.output_tokens", "wizardflow.usage.output_tokens"],
    "input": ["gen_ai.input.messages", "gen_ai.tool.call.arguments",
              "gen_ai.retrieval.query.text", "wizardflow.input", "input.value"],
    "output": ["gen_ai.output.messages", "gen_ai.tool.call.result",
               "gen_ai.retrieval.documents", "wizardflow.output", "output.value"],
    "payloads": ["wizardflow.payload.*"],
}
CONCEPTS = tuple(DEFAULT_MAPPING)
GLOBAL_ONLY = ("project",)
_KEY = re.compile(r"^[A-Za-z0-9_.\-]+\*?$")
MAX_KEYS = 20


def save_mapping(
    con: sqlite3.Connection, project: Optional[str], mapping: Dict[str, Any]
) -> Dict[str, Any]:
    """Store the given concepts for the defaults (``project`` None) or as one
    project's overrides, then re-index. Concepts left out stay as they are; an
    override equal to the defaults is dropped rather than stored."""
    clean = _validate(mapping, project)
    now = time.time_ns()
    con.execute("BEGIN IMMEDIATE")
    try:
        pid = project_id(con, project) if project is not None else None
        defaults = load_mapping(con, None)
        for concept, keys in clean.items():
            con.execute(
                "DELETE FROM attribute_mappings WHERE coalesce(project_id, 0) = ? AND concept = ?",
                (pid or 0, concept),
            )
            if pid is None or keys != defaults.get(concept):
                con.execute(
                    "INSERT INTO attribute_mappings (project_id, concept, keys, updated_ns) "
                    "VALUES (?, ?, ?, ?)",
                    (pid, concept, json.dumps(keys), now),
                )
        result = reindex(con, None if pid is None else [pid], now)
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    return result


def reset_mapping(con: sqlite3.Connection, project: Optional[str]) -> Dict[str, Any]:
    """Defaults back to the shipped ones, or a project's overrides removed."""
    now = time.time_ns()
    con.execute("BEGIN IMMEDIATE")
    try:
        if project is None:
            con.execute("DELETE FROM attribute_mappings WHERE project_id IS NULL")
            con.executemany(
                "INSERT INTO attribute_mappings (project_id, concept, keys, updated_ns) "
                "VALUES (NULL, ?, ?, ?)",
                [(concept, json.dumps(keys), now) for concept, keys in DEFAULT_MAPPING.items()],
            )
            result = reindex(con, None, now)
        else:
            pid = project_id(con, project)
            con.execute("DELETE FROM attribute_mappings WHERE project_id = ?", (pid,))
            result = reindex(con, [pid], now)
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    return result


def reindex(
    con: sqlite3.Connection, project_ids: Optional[List[int]], now_ns: Optional[int] = None
) -> Dict[str, Any]:
    """Re-read the mapped span columns of these projects (None: all) and roll
    their slices up again. Runs inside the caller's transaction."""
    if project_ids is None:
        project_ids = [pid for (pid,) in con.execute("SELECT id FROM projects")]
    updates = []
    for pid in project_ids:
        mapping = load_mapping(con, pid)
        for span_row, attrs in con.execute(
            "SELECT s.id, s.attributes FROM spans s JOIN traces t ON t.id = s.trace_row "
            "WHERE t.project_id = ?",
            (pid,),
        ):
            values = json.loads(attrs)
            updates.append((
                as_text(first_value(values, mapping.get("model", []))),
                as_int(first_value(values, mapping.get("input_tokens", []))),
                as_int(first_value(values, mapping.get("output_tokens", []))),
                as_text(first_value(values, mapping.get("node", []))),
                as_text(first_value(values, mapping.get("node_kind", []))),
                as_text(first_value(values, mapping.get("execution", []))),
                span_row,
            ))
    con.executemany(
        "UPDATE spans SET model = ?, input_tokens = ?, output_tokens = ?, node_id = ?, "
        "node_kind = ?, execution_key = ? WHERE id = ?",
        updates,
    )
    marks = ",".join("?" * len(project_ids))
    rows = [
        row for (row,) in con.execute(
            f"SELECT id FROM traces WHERE project_id IN ({marks})", project_ids
        )
    ] if project_ids else []
    rollup(con, rows, now_ns)
    replayable = con.execute(
        f"SELECT count(*) FROM traces WHERE project_id IN ({marks}) AND flags & ?",
        [*project_ids, FLAG_WIZARDFLOW],
    ).fetchone()[0] if project_ids else 0
    return {"traces": len(rows), "replayable": replayable}


# --------------------------------------------------------------------------- coverage


def mapping_coverage(con: sqlite3.Connection, project: Optional[str]) -> Dict[str, Any]:
    """How much of the stored data each concept of the saved mapping matches,
    so Settings can show a key that hits nothing. ``project`` None: all data."""
    pid = project_id(con, project) if project is not None else None
    mapping = load_mapping(con, pid)
    scope = "t.project_id = ?" if pid is not None else "1"
    args: List[Any] = [pid] if pid is not None else []

    def one(sql: str, *extra: Any) -> int:
        return con.execute(sql, [*args, *extra]).fetchone()[0] or 0

    traces = one(f"SELECT count(*) FROM traces t WHERE {scope}")
    spans = one(f"SELECT count(*) FROM spans s JOIN traces t ON t.id = s.trace_row WHERE {scope}")
    node_spans = one(
        f"SELECT count(*) FROM spans s JOIN traces t ON t.id = s.trace_row "
        f"WHERE {scope} AND s.node_id IS NOT NULL"
    )

    def column(name: str) -> int:
        return one(
            f"SELECT count(*) FROM spans s JOIN traces t ON t.id = s.trace_row "
            f"WHERE {scope} AND s.{name} IS NOT NULL"
        )

    def attributes(keys: List[str]) -> int:
        if not keys:
            return 0
        tests, extra = [], []
        for key in keys:
            if key.endswith("*"):
                tests.append(
                    "EXISTS (SELECT 1 FROM json_each(s.attributes) j "
                    "WHERE substr(j.key, 1, ?) = ?)"
                )
                extra += [len(key) - 1, key[:-1]]
            else:
                tests.append("json_extract(s.attributes, ?) IS NOT NULL")
                extra.append(_json_path(key))
        return one(
            f"SELECT count(*) FROM spans s JOIN traces t ON t.id = s.trace_row "
            f"WHERE {scope} AND ({' OR '.join(tests)})",
            *extra,
        )

    executions = one(
        f"SELECT sum(max(1, (SELECT count(DISTINCT s.execution_key) FROM spans s "
        f"WHERE s.trace_row = t.id))) FROM traces t WHERE {scope}"
    )
    projects = (
        1 if pid is not None else one("SELECT count(*) FROM projects")
    )
    return {
        "project": {"matched": projects, "total": None, "unit": "projects"},
        "execution": {"matched": executions, "total": traces, "unit": "executions in traces"},
        "conversation": {
            "matched": one(f"SELECT count(*) FROM traces t WHERE {scope} AND t.conversation_id IS NOT NULL"),
            "total": traces, "unit": "traces",
        },
        "user": {
            "matched": one(f"SELECT count(*) FROM traces t WHERE {scope} AND t.user_id IS NOT NULL"),
            "total": traces, "unit": "traces",
        },
        "node": {
            "matched": one(f"SELECT count(*) FROM traces t WHERE {scope} AND t.flags & {FLAG_WIZARDFLOW}"),
            "total": traces, "unit": "traces",
        },
        "node_kind": {"matched": column("node_kind"), "total": node_spans, "unit": "node spans"},
        "model": {"matched": column("model"), "total": spans, "unit": "spans"},
        "input_tokens": {"matched": column("input_tokens"), "total": spans, "unit": "spans"},
        "output_tokens": {"matched": column("output_tokens"), "total": spans, "unit": "spans"},
        "input": {"matched": attributes(mapping.get("input", [])), "total": spans, "unit": "spans"},
        "output": {"matched": attributes(mapping.get("output", [])), "total": spans, "unit": "spans"},
        "payloads": {"matched": attributes(mapping.get("payloads", [])), "total": spans, "unit": "spans"},
    }


# --------------------------------------------------------------------------- helpers


def _validate(mapping: Any, project: Optional[str]) -> Mapping:
    if not isinstance(mapping, dict) or not mapping:
        raise QueryError("mapping must be an object of concept -> list of keys")
    clean: Mapping = {}
    for concept, keys in mapping.items():
        if concept not in CONCEPTS:
            raise QueryError(f"unknown concept {concept!r}")
        if project is not None and concept in GLOBAL_ONLY:
            raise QueryError(f"{concept!r} is global only: it decides which project a trace belongs to")
        if not isinstance(keys, list) or not all(isinstance(key, str) for key in keys):
            raise QueryError(f"{concept}: keys must be a list of strings")
        keys = [key.strip() for key in keys]
        if len(keys) > MAX_KEYS:
            raise QueryError(f"{concept}: at most {MAX_KEYS} keys")
        for key in keys:
            if not _KEY.match(key):
                raise QueryError(
                    f"{concept}: {key!r} is not an attribute key "
                    "(letters, digits, dots, _ and -, optional trailing *)"
                )
        if len(set(keys)) != len(keys):
            raise QueryError(f"{concept}: a key is listed twice")
        clean[concept] = keys
    return clean


def _json_path(key: str) -> str:
    # Attribute keys contain dots, so quote them as one path member.
    return '$."' + key.replace('"', '\\"') + '"'
