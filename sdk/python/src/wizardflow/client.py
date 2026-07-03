"""Core client for recording agent flows into the AgentTrace JSONL format.

A trace part is a ``.jsonl`` file: line 1 is a ``header`` record (version, name,
meta, graph — everything but messages), then one ``message`` record per
completed message, and — only on a part that rotated away — a final ``seal``
record naming the next part. Assembling the header plus the message lines yields
an ``AgentTraceFile`` (schema version ``"0.2"``), the exact object the
visualizer loads; see ``src/types/agenttrace.ts`` in the repo for the consuming
type. :meth:`Client.to_dict` returns that assembled form for the active part.

Persistence model: there is no explicit "save" in user code. Each
:meth:`Client.end_message` appends exactly one line — O(1) regardless of how
large the part has grown, so the write lock is held only for one append. When
the active part would grow past ``max_bytes`` (or ``max_messages``) it is sealed
and the message starts a new ``__partN`` file; parts chain forward via the seal
record's ``nextPart`` and backward via ``meta.prevPart``.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple, Union

from .constants import Defaults, Ids, Logging, Output, Records, Rotation, Schema

logger = logging.getLogger(Logging.LOGGER_NAME)

__all__ = [
    "Client",
    "WizardFlowError",
    "UnknownNodeError",
    "LangGraphExtractionError",
]


class WizardFlowError(Exception):
    """Base class for SDK usage errors (raised only when not silenced)."""


class UnknownNodeError(WizardFlowError):
    """Raised when logging to a node id not declared in ``init(nodes=...)``."""


class LangGraphExtractionError(WizardFlowError):
    """Raised when topology can't be read from a LangGraph-like object."""


# --- internal types -------------------------------------------------------

NodeSpec = Union[str, Dict[str, Any]]
EdgeSpec = Union[Tuple[str, str], Dict[str, str]]
NodeColorMap = Mapping[str, str]
NodeDescriptionMap = Mapping[str, str]
NodeLabelMap = Mapping[str, str]


def _now_iso() -> str:
    """UTC timestamp in ISO 8601 with a ``Z`` suffix, matching the sample data."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _run_timestamp() -> str:
    """Filename-safe UTC timestamp captured once when a client is created."""
    now = datetime.now(timezone.utc)
    return (
        now.strftime(Rotation.RUN_TIMESTAMP_FORMAT)
        + f"-{now.microsecond // 1000:03d}Z"
    )


def _resolve_output(output_dir: Optional[str], file_prefix: str) -> Tuple[str, str, str]:
    """Resolve output options into (directory, prefix, suffix) for part naming."""
    return output_dir or "", file_prefix or Defaults.PREFIX, Defaults.SUFFIX


def _normalize_node(node: NodeSpec) -> Dict[str, Any]:
    if isinstance(node, str):
        return {"id": node}
    if isinstance(node, dict) and "id" in node:
        return {k: v for k, v in node.items() if v is not None}
    raise WizardFlowError(f"Invalid node spec: {node!r} (expected str or {{'id': ...}})")


def _normalize_edge(edge: EdgeSpec) -> Dict[str, Any]:
    if isinstance(edge, dict) and "source" in edge and "target" in edge:
        out: Dict[str, Any] = {"source": edge["source"], "target": edge["target"]}
        # A conditional (runtime-branch) edge keeps the flag; deterministic and
        # parallel fan-out edges omit it entirely.
        if edge.get("conditional"):
            out["conditional"] = True
        return out
    if isinstance(edge, (tuple, list)) and len(edge) == 2:
        return {"source": edge[0], "target": edge[1]}
    raise WizardFlowError(
        f"Invalid edge spec: {edge!r} (expected (source, target) or "
        "{'source': ..., 'target': ...})"
    )


def _dedupe_edges(edges: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Collapse edges that share a (source, target) pair.

    An edge is just (source, target, conditional?) in the schema, so a repeated
    pair carries no extra information. LangGraph's ``get_graph().edges`` can list
    the same conditional edge more than once (a router mapping several branch
    keys to one target); without this the viewer would receive duplicate
    ``source->target`` keys and the markdown/json exports would carry redundant
    rows. First-seen order is preserved; the survivor keeps ``conditional`` if
    any of its duplicates was conditional.
    """
    by_key: "Dict[Tuple[Any, Any], Dict[str, Any]]" = {}
    for edge in edges:
        key = (edge["source"], edge["target"])
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = edge
        elif edge.get("conditional") and not existing.get("conditional"):
            existing["conditional"] = True
    return list(by_key.values())


def _apply_node_field(
    nodes: List[Dict[str, Any]],
    values: Optional[Mapping[str, Any]],
    *,
    field: str,
    option_name: str,
    silent: bool,
) -> List[Dict[str, Any]]:
    """Attach per-node values (colors, descriptions) keyed by node id.

    Validation runs at init() time, before anything is written — a trace on
    disk is never affected. Unknown ids fail fast so typos surface immediately;
    with ``silent=True`` they are logged as a warning on the ``wizardflow``
    logger and skipped instead. When a mapping targets a node whose dict spec
    already carries the field, the mapping wins.
    """
    if not values:
        return nodes
    if not nodes:
        problem = f"{option_name} was given but no nodes are declared"
        if not silent:
            raise WizardFlowError(f"{problem} (nothing to attach to)")
        logger.warning("%s; ignored", problem)
        return nodes

    known = {n["id"] for n in nodes}
    unknown = sorted(node_id for node_id in values if node_id not in known)
    if unknown:
        if not silent:
            raise WizardFlowError(
                f"{option_name} contains unknown node id(s): "
                f"{unknown}. Declared nodes: {sorted(known)}"
            )
        logger.warning(
            "%s contains unknown node id(s) %s; ignored", option_name, unknown
        )

    return [
        {**node, field: values[node["id"]]}
        if node["id"] in values
        else node
        for node in nodes
    ]


def _topology_from_langgraph(app: Any) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Best-effort node/edge extraction from a compiled LangGraph object.

    Duck-typed: the only assumption is that ``app`` exposes ``get_graph()``
    returning an object with ``.nodes`` and ``.edges``. Unknown fields are
    ignored; conditional metadata is included only when reliably present, and
    its absence never fails extraction.
    """
    get_graph = getattr(app, "get_graph", None)
    if not callable(get_graph):
        raise LangGraphExtractionError(
            "expected a compiled LangGraph object with a get_graph() method "
            f"(got {type(app).__name__})"
        )
    try:
        graph = get_graph()
    except Exception as exc:  # noqa: BLE001 - surface as a clean SDK error
        raise LangGraphExtractionError(f"app.get_graph() failed: {exc}") from exc

    raw_nodes = getattr(graph, "nodes", None)
    if raw_nodes is None:
        raise LangGraphExtractionError("get_graph() result has no .nodes")
    if hasattr(raw_nodes, "keys"):  # dict[id, Node] in langchain_core
        node_ids = list(raw_nodes.keys())
    else:  # tolerate an iterable of node objects / ids
        node_ids = [getattr(n, "id", n) for n in raw_nodes]
    nodes = [{"id": nid} for nid in node_ids]

    edges: List[Dict[str, Any]] = []
    for e in getattr(graph, "edges", None) or []:
        source = getattr(e, "source", None)
        target = getattr(e, "target", None)
        if source is None or target is None:
            continue  # skip anything we can't read, rather than fail
        edge: Dict[str, Any] = {"source": source, "target": target}
        if getattr(e, "conditional", False):
            edge["conditional"] = True
        edges.append(edge)
    return nodes, edges


class _Message:
    """Accumulates steps for a single message, keyed by id on the client."""

    def __init__(self, message_id: str, label: Optional[str], silent: bool):
        self.id = message_id
        self.label = label
        self.silent = silent
        self.completed = False
        self.steps: List[Dict[str, Any]] = []
        self._step_seq = 0

    def _new_step(self, node_id: str) -> Dict[str, Any]:
        self._step_seq += 1
        step = {
            "id": Ids.STEP_ID_FORMAT.format(message_id=self.id, n=self._step_seq),
            "nodeId": node_id,
            "timestamp": _now_iso(),
            "payloads": [],
        }
        self.steps.append(step)
        return step

    def log(self, node: str, label: Optional[str], content: Any) -> None:
        # Consecutive logs to the same node fold into one step (multiple
        # payloads), matching the schema where a step carries many payloads.
        if self.steps and self.steps[-1]["nodeId"] == node and label is not None:
            step = self.steps[-1]
        else:
            step = self._new_step(node)
        if label is not None:
            step["payloads"].append({"label": label, "value": content})

    def to_dict(self) -> Dict[str, Any]:
        message: Dict[str, Any] = {"id": self.id, "steps": self.steps}
        if self.label is not None:
            message["label"] = self.label
        return message


class Client:
    """A WizardFlow recording session.

    Build one with :func:`wizardflow.init`. Record steps with ``log(id, node,
    ...)`` — the first argument names the message a step belongs to — then call
    :meth:`end_message` to finalize that message and write the trace to
    ``output_dir``. ``end_message`` is the only thing that touches disk.
    """

    def __init__(
        self,
        output_dir: Optional[str] = None,
        file_prefix: str = Defaults.PREFIX,
        name: Optional[str] = None,
        description: Optional[str] = None,
        nodes: Optional[Iterable[NodeSpec]] = None,
        edges: Optional[Iterable[EdgeSpec]] = None,
        node_labels: Optional[NodeLabelMap] = None,
        node_colors: Optional[NodeColorMap] = None,
        node_descriptions: Optional[NodeDescriptionMap] = None,
        meta: Optional[Dict[str, Any]] = None,
        silent: bool = False,
        max_bytes: int = Rotation.DEFAULT_MAX_BYTES,
        max_messages: int = Rotation.DEFAULT_MAX_MESSAGES,
    ):
        self.name = name
        self.silent = silent
        # Clamp to the hard ceiling: parts are sized for the viewer, and a part
        # past the ceiling loads sluggishly in a browser tab on ordinary
        # hardware.
        self.max_bytes = min(max_bytes, Rotation.MAX_MAX_BYTES)
        if max_bytes > Rotation.MAX_MAX_BYTES:
            logger.warning(
                "max_bytes %d exceeds the %d ceiling; clamped to %d",
                max_bytes,
                Rotation.MAX_MAX_BYTES,
                self.max_bytes,
            )
        self.max_messages = max_messages
        self.meta: Dict[str, Any] = dict(meta or {})
        if description is not None:
            self.meta.setdefault("description", description)

        self._nodes: List[Dict[str, Any]] = [_normalize_node(n) for n in (nodes or [])]
        self._nodes = _apply_node_field(
            self._nodes, node_labels,
            field="label", option_name="node_labels", silent=silent,
        )
        self._nodes = _apply_node_field(
            self._nodes, node_colors,
            field="color", option_name="node_colors", silent=silent,
        )
        self._nodes = _apply_node_field(
            self._nodes, node_descriptions,
            field="description", option_name="node_descriptions", silent=silent,
        )
        self._edges: List[Dict[str, str]] = _dedupe_edges(
            [_normalize_edge(e) for e in (edges or [])]
        )
        # Known node ids gate log() when nodes were declared up front.
        self._known: Optional[set] = (
            {n["id"] for n in self._nodes} if nodes is not None else None
        )

        # Guards all mutation of shared recording state (the message registry,
        # the active part, the rotation index) and the file write. Reentrant so
        # a locked public method can call another locked helper. Multi-agent
        # setups end messages concurrently; without this they race on the shared
        # part and the shared temp-file path. Only the log()/end_message()
        # critical sections hold it.
        self._lock = threading.RLock()

        # Insertion-ordered registry of all messages (open + completed).
        self._messages: "Dict[str, _Message]" = {}

        # Output is split into part files. Completed messages of the *active*
        # part stay in memory only to serve to_dict(); writing is append-only
        # and never re-reads them. Sealed parts are fully on disk.
        self._dir, self._prefix, self._suffix = _resolve_output(output_dir, file_prefix)
        self._run_ts = _run_timestamp()
        self._active_index = 1
        self._active_part: List[_Message] = []
        self._active_part_bytes = 0     # bytes appended so far (header included)
        self._part_started = False      # header line written for the active part?

    @classmethod
    def from_langgraph(
        cls,
        app: Any,
        *,
        output_dir: Optional[str] = None,
        file_prefix: str = Defaults.PREFIX,
        name: Optional[str] = None,
        description: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
        node_labels: Optional[NodeLabelMap] = None,
        node_colors: Optional[NodeColorMap] = None,
        node_descriptions: Optional[NodeDescriptionMap] = None,
        silent: bool = False,
        max_bytes: int = Rotation.DEFAULT_MAX_BYTES,
        max_messages: int = Rotation.DEFAULT_MAX_MESSAGES,
    ) -> "Client":
        """Build a client whose graph is read from a compiled LangGraph ``app``.

        Topology (nodes + directed edges, with a ``conditional`` flag on runtime
        branches) is extracted via duck typing — no langgraph dependency.
        Runtime logging is unchanged; you still call :meth:`log`.
        """
        nodes, edges = _topology_from_langgraph(app)
        return cls(
            output_dir=output_dir,
            file_prefix=file_prefix,
            name=name,
            description=description,
            nodes=nodes,
            edges=edges,
            node_labels=node_labels,
            node_colors=node_colors,
            node_descriptions=node_descriptions,
            meta=meta,
            silent=silent,
            max_bytes=max_bytes,
            max_messages=max_messages,
        )

    # --- recording --------------------------------------------------------

    def _get_or_create(self, id: str) -> _Message:
        with self._lock:
            msg = self._messages.get(id)
            if msg is None:
                msg = _Message(id, label=None, silent=self.silent)
                self._messages[id] = msg
            return msg

    def log(
        self,
        id: str,
        node: str,
        label: Optional[str] = None,
        content: Any = None,
    ) -> None:
        """Record that ``node`` ran for message ``id``.

        The message is created on first reference. With ``label``/``content`` it
        logs a payload; a bare ``log(id, "node")`` records a visit with no
        payloads. Nothing is written to disk here — :meth:`end_message` is what
        persists the trace.
        """
        msg = self._get_or_create(id)
        with self._lock:
            if msg.completed:
                self._fail(
                    msg.silent,
                    WizardFlowError(
                        f"message {id!r} already ended; cannot log to it"
                    ),
                )
                return
            if self._known is not None and node not in self._known:
                self._fail(
                    msg.silent,
                    UnknownNodeError(
                        f"Unknown node {node!r}. Declared nodes: {sorted(self._known)}"
                    ),
                )
                return
            try:
                msg.log(node, label, content)
            except Exception as exc:  # pragma: no cover - defensive
                self._fail(msg.silent, exc)

    def end_message(self, id: str, title: Optional[str] = None) -> str:
        """Finalize message ``id`` and append it to the active part. Returns its path.

        This is the **only** thing that writes to disk; :meth:`log` just
        accumulates in memory. Optional ``title`` sets the message's human title.
        Exactly one line is appended per ended message — O(1) however large the
        part already is. If the active part would exceed ``max_bytes`` (or holds
        ``max_messages`` already), it is sealed and the message starts a fresh
        part (rotation happens only at message boundaries). Idempotent: a second
        end on the same id won't append twice.
        """
        with self._lock:
            msg = self._messages.get(id)
            if msg is None:
                self._fail(
                    self.silent, WizardFlowError(f"end_message: unknown message {id!r}")
                )
                return self.current_path
            if not msg.completed:
                if title is not None:
                    msg.label = title
                msg.completed = True
                line = self._render_line({Records.TYPE_KEY: Records.MESSAGE, **msg.to_dict()})
                self._rotate_if_needed(len(line.encode("utf-8")))
                self._active_part.append(msg)
                self._append_to_part(line)
            return self.current_path

    def reinit(
        self,
        name: Optional[str] = None,
        description: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Start a new trace file, keeping the graph and output configuration.

        For natural boundaries in a long-lived process (a new user session, a
        new day): the next ended message opens a fresh timestamped entry file.
        The old file is left exactly as it is — **no seal record**, because this
        is a new run, not a rotation (a seal means "continue at nextPart").

        Open (un-ended) messages carry over: a message is written to whichever
        file is active when its :meth:`end_message` arrives. Completed messages
        are dropped from the registry, so their ids become reusable in the new
        trace. ``name`` / ``description`` / ``meta`` replace the current values
        when given; otherwise the old ones are kept. Returns the new trace path.
        """
        with self._lock:
            if name is not None:
                self.name = name
            if meta is not None:
                self.meta = dict(meta)
            if description is not None:
                self.meta["description"] = description
            self._messages = {
                mid: m for mid, m in self._messages.items() if not m.completed
            }
            # A reinit within the same millisecond would reuse the current
            # filename and append a second header to it; spin until the
            # timestamp (and with it the entry filename) is new.
            new_ts = _run_timestamp()
            while new_ts == self._run_ts:
                new_ts = _run_timestamp()
            self._run_ts = new_ts
            self._active_index = 1
            self._active_part = []
            self._active_part_bytes = 0
            self._part_started = False
            logger.info(
                "reinitialized; next trace file is %s",
                os.path.basename(self.current_path),
            )
            return self.current_path

    @staticmethod
    def _fail(silent: bool, exc: Exception) -> None:
        if not silent:
            raise exc

    # --- output & rotation ------------------------------------------------

    @property
    def current_path(self) -> str:
        """Path of the part currently being written."""
        return self._part_filename(self._active_index)

    def _part_filename(self, index: int) -> str:
        if index == 1:
            name = Rotation.RUN_NAME_FORMAT.format(
                prefix=self._prefix,
                timestamp=self._run_ts,
                suffix=self._suffix,
            )
        else:
            name = Rotation.PART_NAME_FORMAT.format(
                prefix=self._prefix,
                timestamp=self._run_ts,
                index=index,
                suffix=self._suffix,
            )
        return os.path.join(self._dir, name) if self._dir else name

    def _rotate_if_needed(self, incoming_bytes: int) -> None:
        """Seal the active part and start a new one if the next message won't fit.

        Rotation only happens at a message boundary, and never on an empty part
        — a lone message larger than the cap gets its own oversized part rather
        than being split.
        """
        if not self._active_part:
            return
        over_bytes = self._active_part_bytes + incoming_bytes > self.max_bytes
        over_count = len(self._active_part) >= self.max_messages
        if not over_bytes and not over_count:
            return
        sealed = self._active_index
        self._active_index += 1
        # The seal line is the sealed part's last record; its presence is what
        # marks a part as complete (an active part has no seal).
        self._append_line(
            self._part_filename(sealed),
            self._render_line(
                {
                    Records.TYPE_KEY: Records.SEAL,
                    "nextPart": os.path.basename(self.current_path),
                }
            ),
        )
        self._active_part = []
        self._active_part_bytes = 0
        self._part_started = False
        logger.info(
            "part %d reached its cap (%d bytes / %d messages); rotated to %s",
            sealed,
            self.max_bytes,
            self.max_messages,
            os.path.basename(self.current_path),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Return the active part as an assembled ``AgentTraceFile`` dict."""
        with self._lock:
            return self._render_part(self._active_index, self._active_part)

    def to_json(self, *, indent: Optional[int] = Output.DEFAULT_INDENT) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def _header_fields(self, index: int) -> Dict[str, Any]:
        """Everything an ``AgentTraceFile`` carries except ``messages``."""
        fields: Dict[str, Any] = {"version": Schema.VERSION}
        if self.name is not None:
            fields["name"] = self.name
        meta = dict(self.meta)
        # Part metadata appears only once the trace has actually split, so a
        # single-part trace stays clean (no spurious part: 1). Forward chaining
        # lives in the seal record — an append-only writer can't know nextPart
        # when the header is written.
        if index > 1:
            meta["part"] = index
            meta["prevPart"] = os.path.basename(self._part_filename(index - 1))
        if meta:
            fields["meta"] = meta
        fields["graph"] = {"nodes": self._nodes, "edges": self._edges}
        return fields

    def _render_part(self, index: int, messages: List[_Message]) -> Dict[str, Any]:
        trace = self._header_fields(index)
        trace["messages"] = [m.to_dict() for m in messages]
        return trace

    @staticmethod
    def _render_line(record: Dict[str, Any]) -> str:
        # One record per line: compact separators, no indent. json.dumps
        # escapes any newline inside values, so a record can't span lines.
        return json.dumps(record, ensure_ascii=False, separators=(",", ":"))

    def _append_to_part(self, message_line: str) -> None:
        """Append a message line to the active part, opening it with a header
        line first if this is the part's first write."""
        path = self._part_filename(self._active_index)
        if not self._part_started:
            header = self._render_line(
                {Records.TYPE_KEY: Records.HEADER, **self._header_fields(self._active_index)}
            )
            self._append_line(path, header)
            self._active_part_bytes += len(header.encode("utf-8")) + 1
            self._part_started = True
        self._append_line(path, message_line)
        self._active_part_bytes += len(message_line.encode("utf-8")) + 1

    def _append_line(self, path: str, line: str) -> None:
        if self._dir:
            os.makedirs(self._dir, exist_ok=True)
        # newline="\n" so Windows doesn't translate to \r\n; open-per-append so
        # every ended message is durable on disk the moment end_message returns.
        with open(path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(line + "\n")
