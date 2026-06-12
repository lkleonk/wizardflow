"""Fixed internal values, grouped by concern.

Nothing here is mutated at runtime. Things a user should be able to tune (e.g.
``max_bytes``) are ``init()`` parameters that *default* to these constants —
they are not global settings.
"""


class Schema:
    VERSION = "0.1"


class Output:
    DEFAULT_INDENT = 2
    TMP_SUFFIX = ".tmp"          # atomic write: write .tmp, then os.replace


class Rotation:
    # ~256 KB per part. Small on purpose: each message-end rewrites the whole
    # active part while holding the write lock, so a small cap keeps that rewrite
    # (and the lock hold) short — what lets many agents end messages concurrently
    # without stalling each other. Tune via ``init(max_bytes=...)``, clamped to
    # ``MAX_MAX_BYTES``.
    DEFAULT_MAX_BYTES = 256_000
    # Hard ceiling on ``max_bytes``. A larger cap means a bigger per-message
    # rewrite and a longer lock hold, which serializes concurrent writers — so we
    # refuse to honor a value above this and clamp down to it.
    MAX_MAX_BYTES = 1_000_000
    RUN_TIMESTAMP_FORMAT = "%Y-%m-%dT%H-%M-%S"  # e.g. 2026-06-08T14-30-22 (no colons)
    RUN_NAME_FORMAT = "{prefix}__{timestamp}{suffix}"
    PART_NAME_FORMAT = "{prefix}__{timestamp}__part{index}{suffix}"


class Ids:
    STEP_ID_FORMAT = "{message_id}-s{n}"


class Logging:
    LOGGER_NAME = "wizardflow"    # rotation notices logged here


class Defaults:
    PREFIX = "wizardflow"         # used when file_prefix is omitted
    SUFFIX = ".json"
