"""Shared helpers for the export renderers (``markdown``, ``html``).

These keep the two renderers from drifting: both classify a payload value the
same way and shorten timestamps the same way; only the surface syntax differs.
"""

from __future__ import annotations

import json
from typing import Any, Tuple


def short_time(timestamp: Any) -> str:
    """Reduce an ISO 8601 timestamp to HH:MM:SS; pass anything else through."""
    if not isinstance(timestamp, str) or "T" not in timestamp:
        return timestamp if isinstance(timestamp, str) else ""
    clock = timestamp.split("T", 1)[1].rstrip("Z")
    return clock.split(".", 1)[0] if "." in clock else clock


def meta_text(value: Any) -> str:
    """Render a meta value for display. Meta values are short scalars by
    contract; an out-of-contract dict/list still renders readably as compact
    JSON instead of its Python repr."""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def classify_value(value: Any) -> Tuple[str, str]:
    """Classify a payload value for rendering, returning ``(kind, text)``.

    Payload values are arbitrary JSON (``value: unknown`` in the schema). The
    *kind* tells a renderer how to present the *text*; the inline-vs-block call
    is left to each format (it differs — Markdown can't inline a string with a
    backtick, HTML can):

    - ``"string"`` — a ``str``; ``text`` is the raw string.
    - ``"scalar"`` — ``bool``/``int``/``float``/``None``; ``text`` is its JSON
      spelling (``true``/``false``/``null``/numbers).
    - ``"structured"`` — ``dict``/``list``/anything else; ``text`` is pretty JSON.
    """
    if isinstance(value, str):
        return "string", value
    if value is None or isinstance(value, (bool, int, float)):
        return "scalar", json.dumps(value)
    return "structured", json.dumps(value, indent=2, ensure_ascii=False)
