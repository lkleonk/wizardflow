"""Attribute mapping: which OTel attribute means project, conversation, node, …

Each concept is an ordered list of attribute keys; the first key present wins.
A trailing ``*`` matches a key prefix. Defaults live in ``attribute_mappings``
rows with ``project_id IS NULL``; a row with a project id overrides one concept
for that project. ``project`` itself is global only.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any, Dict, Iterable, List, Optional

Mapping = Dict[str, List[str]]


def load_mapping(con: sqlite3.Connection, project_id: Optional[int]) -> Mapping:
    """The effective mapping for one project (``None``: the defaults)."""
    resolved: Mapping = {}
    overrides: Mapping = {}
    for row_project, concept, keys in con.execute(
        "SELECT project_id, concept, keys FROM attribute_mappings "
        "WHERE project_id IS NULL OR project_id = ?",
        (project_id,),
    ):
        target = resolved if row_project is None else overrides
        target[concept] = _parse_keys(keys)
    resolved.update(overrides)
    return resolved


def first_value(attributes: Dict[str, Any], keys: Iterable[str]) -> Any:
    """The value of the first key in ``keys`` that ``attributes`` has, else None."""
    for key in keys:
        if key.endswith("*"):
            prefix = key[:-1]
            for name, value in attributes.items():
                if name.startswith(prefix) and value is not None:
                    return value
        else:
            value = attributes.get(key)
            if value is not None:
                return value
    return None


def as_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value or None
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def as_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _parse_keys(raw: str) -> List[str]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return [str(key) for key in value] if isinstance(value, list) else []
