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
    DEFAULT_MAX_BYTES = 5_000_000              # ~5 MB per part
    PART_TIMESTAMP_FORMAT = "%Y-%m-%dT%H-%M-%S"  # e.g. 2026-06-08T14-30-22 (no colons)
    PART_NAME_FORMAT = "{prefix}_{timestamp}_{index:03d}{suffix}"


class Ids:
    STEP_ID_FORMAT = "{message_id}-s{n}"


class Logging:
    LOGGER_NAME = "wizardflow"    # rotation notices logged here


class Defaults:
    PREFIX = "wizardflow"         # used when path is omitted
    SUFFIX = ".json"
