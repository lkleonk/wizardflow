"""Fixed internal values, grouped by concern.

Nothing here is mutated at runtime. Things a user should be able to tune (e.g.
``max_bytes``) are ``init()`` parameters that *default* to these constants —
they are not global settings.
"""


class Schema:
    VERSION = "0.2"


class Records:
    # The "type" discriminator on every JSONL line.
    TYPE_KEY = "type"
    HEADER = "header"     # line 1: version/name/meta + graph (everything but messages)
    MESSAGE = "message"   # one completed message per line
    SEAL = "seal"         # last line of a rotated-away part; carries nextPart


class Output:
    DEFAULT_INDENT = 2    # for to_json() inspection output, not the trace file


class Rotation:
    # Parts exist purely for the *reader*: a part is what gets dropped into the
    # viewer, so the cap is sized for a smooth load in a browser tab (parse +
    # JS-object inflation + render), not for write cost — appends are O(1)
    # regardless of part size. Tune via ``init(max_bytes=...)``, clamped to
    # ``MAX_MAX_BYTES``.
    DEFAULT_MAX_BYTES = 16_000_000
    # Hard ceiling on ``max_bytes``. Above this, parsed-object inflation makes
    # the viewer sluggish on ordinary (8 GB) machines, so we refuse to honor a
    # larger value and clamp down to it.
    MAX_MAX_BYTES = 64_000_000
    # Bytes underestimate render cost when a part is many tiny messages (the
    # timeline draws a chip per message), so a count cap rotates alongside the
    # byte cap — whichever is hit first.
    DEFAULT_MAX_MESSAGES = 2_000
    RUN_TIMESTAMP_FORMAT = "%Y-%m-%dT%H-%M-%S"  # e.g. 2026-06-08T14-30-22 (no colons)
    RUN_NAME_FORMAT = "{prefix}__{timestamp}{suffix}"
    PART_NAME_FORMAT = "{prefix}__{timestamp}__part{index}{suffix}"


class Ids:
    STEP_ID_FORMAT = "{message_id}-s{n}"


class Logging:
    LOGGER_NAME = "wizardflow"    # rotation notices logged here


class Defaults:
    PREFIX = "wizardflow"         # used when file_prefix is omitted
    SUFFIX = ".jsonl"
