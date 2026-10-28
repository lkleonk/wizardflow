"""Opening the OTel store: version checks, migrations, connection pragmas."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Optional

from .schema import LATEST_VERSION, MIGRATIONS

# Generated columns arrived in 3.31; older SQLite can't create the schema.
MIN_SQLITE_VERSION = (3, 31, 0)

DEFAULT_DIR_NAME = ".wizardflow"
DEFAULT_DB_NAME = "wizardflow.db"

# The db holds prompts and user data, and its default home is inside the
# user's project. A .gitignore of "*" in our own folder keeps it out of git
# without touching the user's files (pytest and mypy caches do the same).
_GITIGNORE = "# Created by wizardflow automatically.\n*\n"


class StoreError(Exception):
    """The store can't be opened or used; the message is user-facing."""


def default_db_path(cwd: Optional[Path] = None) -> Path:
    return (cwd or Path.cwd()) / DEFAULT_DIR_NAME / DEFAULT_DB_NAME


def open_store(path: Path, *, create: bool = True) -> sqlite3.Connection:
    """Open (and migrate) the store at ``path``.

    A brand-new file is created when ``create`` is true. Every open migrates
    an older schema forward, after a ``.vN.bak`` backup copy; a schema newer
    than this wizardflow is refused rather than written to.
    """
    _check_sqlite()
    path = Path(path)
    is_new = not path.exists()
    if is_new and not create:
        raise StoreError(f"no WizardFlow database at {path}")
    if is_new:
        _prepare_new_location(path)

    con = sqlite3.connect(str(path), isolation_level=None)
    try:
        # Per connection, and off by default: without it SQLite silently
        # ignores every ON DELETE action in the schema.
        con.execute("PRAGMA foreign_keys = ON")
        con.execute("PRAGMA busy_timeout = 5000")
        _migrate(con, path)
    except BaseException:
        con.close()
        raise
    return con


def _check_sqlite() -> None:
    if sqlite3.sqlite_version_info < MIN_SQLITE_VERSION:
        raise StoreError(
            f"SQLite {sqlite3.sqlite_version} is too old for the WizardFlow "
            f"database (needs {'.'.join(map(str, MIN_SQLITE_VERSION))}+); "
            "upgrade Python or its sqlite3 library"
        )
    try:
        sqlite3.connect(":memory:").execute("SELECT json('{}')").fetchone()
    except sqlite3.OperationalError:
        raise StoreError(
            "this Python's SQLite has no JSON support, which the WizardFlow "
            "database needs; upgrade Python or its sqlite3 library"
        ) from None


def _prepare_new_location(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Only our own default folder gets a .gitignore; a path the user chose
    # with --db is theirs, and we don't drop files there.
    if path.parent.name == DEFAULT_DIR_NAME:
        gitignore = path.parent / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text(_GITIGNORE, encoding="utf-8")


def _migrate(con: sqlite3.Connection, path: Path) -> None:
    current = con.execute("PRAGMA user_version").fetchone()[0]
    if current > LATEST_VERSION:
        raise StoreError(
            f"{path} uses database schema v{current}, but this wizardflow "
            f"only knows v{LATEST_VERSION}; upgrade wizardflow to open it"
        )
    if current == LATEST_VERSION:
        return
    if current == 0:
        # Only possible before the first table exists; switching later needs
        # a full VACUUM rewrite. Lets deletes give space back to the OS.
        con.execute("PRAGMA auto_vacuum = INCREMENTAL")
    else:
        _backup(con, path.with_name(f"{path.name}.v{current}.bak"))
    # Persistent in the file, and can't run inside a transaction.
    con.execute("PRAGMA journal_mode = WAL")
    for version, sql in MIGRATIONS:
        if version <= current:
            continue
        # executescript() commits any open transaction first, so BEGIN and
        # COMMIT go inside the script; the version bump commits with it.
        con.executescript(
            f"BEGIN IMMEDIATE;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;"
        )
    con.execute(
        "INSERT INTO meta (key, value) VALUES ('last_migrated_ns', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (str(time.time_ns()),),
    )


def _backup(con: sqlite3.Connection, target: Path) -> None:
    backup = sqlite3.connect(str(target))
    try:
        con.backup(backup)
    finally:
        backup.close()
