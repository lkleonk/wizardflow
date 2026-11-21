"""Import a file into the local store: an OTLP JSON file or a WizardFlow run.

Shared by ``wizardflow db import`` / ``dashboard FILE`` (a path on disk) and
the dashboard's own "Import a run" button (the file's bytes, sent by the
browser). Both hash the same bytes, so a file imported one way is recognised
as already imported the other way.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
from pathlib import Path
from typing import Optional

from .reader import TraceFormatError, load_trace_chain
from .store import ImportResult, import_otlp_file, import_otlp_text, import_requests, is_imported
from .store.otlp import is_otlp_request

# A file is read locally and replayed in full, so it keeps the graph and the
# whole content by default; an endpoint keeps the live, backend-friendly caps.
FILE_EXPORT_CONTENT_MAX_BYTES = 16_000_000


class LaterPartError(TraceFormatError):
    """An uploaded file is part 2 or later of a rotated run."""


def import_trace_file(
    con: sqlite3.Connection, file_path: Path, *, project: Optional[str]
) -> ImportResult:
    """Import an OTLP JSON file, or a WizardFlow run (all of its parts)."""
    if is_otlp_file(file_path):
        return import_otlp_file(con, file_path, project=project)
    unit = load_trace_chain(file_path)
    digest = hashlib.sha256(b"".join(part.read_bytes() for part in unit.parts)).hexdigest()
    return _import_run(con, unit, path=str(file_path.resolve()), digest=digest, project=project)


def import_trace_bytes(
    con: sqlite3.Connection, name: str, data: bytes, *, project: Optional[str] = None
) -> ImportResult:
    """Import one uploaded file.

    Errors name ``name``, never the temp file it is parsed from. A later part
    of a rotated run is refused: its neighbours are not on disk to follow, and
    on its own it would get other span ids than as part of the whole run.
    """
    text = data.decode("utf-8-sig")
    digest = hashlib.sha256(data).hexdigest()
    if is_otlp_text(text):
        return import_otlp_text(con, text, source="file", path=name, sha256=digest, project=project)
    with tempfile.TemporaryDirectory() as folder:
        part = Path(folder) / "upload.jsonl"
        part.write_bytes(data)
        try:
            unit = load_trace_chain(part, current_part_only=True)
        except TraceFormatError as exc:
            raise TraceFormatError(str(exc).replace(str(part.resolve()), name).replace(str(part), name)) from None
    if unit.trace.get("meta", {}).get("prevPart"):
        raise LaterPartError(
            f"{name} is a later part of a rotated run. Import the whole run instead: "
            "wizardflow db import <its first part>"
        )
    return _import_run(con, unit, path=name, digest=digest, project=project)


def _import_run(con, unit, *, path: str, digest: str, project: Optional[str]) -> ImportResult:
    if is_imported(con, digest):
        return ImportResult(path=path, already_imported=True)
    from .otel_file_exporter import ExportOptions, trace_chain_requests

    # The same content and graph as `otel export --out`.
    options = ExportOptions(content_max_bytes=FILE_EXPORT_CONTENT_MAX_BYTES, export_graph=True)
    return import_requests(
        con, trace_chain_requests(unit, options), path=path, sha256=digest, project=project
    )


def is_otlp_file(path: Path) -> bool:
    """Whether ``path`` holds OTLP JSON rather than a WizardFlow trace.

    Line 1 decides: one export request per line (the Collector's format).
    A pretty-printed single request is checked as a whole if it is small.
    """
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            first = handle.readline()
            try:
                return is_otlp_request(json.loads(first))
            except json.JSONDecodeError:
                pass
            if path.stat().st_size > 32_000_000:
                return False
            handle.seek(0)
            return is_otlp_request(json.loads(handle.read()))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return False


def is_otlp_text(text: str) -> bool:
    """:func:`is_otlp_file` for text already in memory."""
    first = text.split("\n", 1)[0]
    for candidate in (first, text):
        try:
            return is_otlp_request(json.loads(candidate))
        except json.JSONDecodeError:
            continue
    return False
