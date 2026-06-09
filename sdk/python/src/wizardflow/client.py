"""Core client for recording agent flows into the AgentTrace file format.

The output of :meth:`Client.to_dict` is an ``AgentTraceFile`` (schema version
``"0.1"``) — the exact object the visualizer loads. See
``src/types/agenttrace.ts`` in the repo for the consuming type.

Persistence model: there is no explicit "save" in user code. A trace is dumped
every time a message ends, via :meth:`Client.end_message` — an atomic write
(temp file + os.replace) containing only *completed* messages. When the active
part grows past ``max_bytes`` it rotates to a new numbered part file; each part
is a self-contained trace, chained via ``meta.prevPart`` / ``meta.nextPart``.
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Tuple, Union

from .constants import Defaults, Ids, Logging, Output, Rotation, Schema

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


# The message that ambient ``log()`` calls target, scoped per-thread and
# per-asyncio-task so overlapping messages never collide. An explicit ``id=``
# on ``log`` overrides this.
_current_message: ContextVar[Optional["_Message"]] = ContextVar(
    "wizardflow_current_message", default=None
)


# --- internal types -------------------------------------------------------

NodeSpec = Union[str, Dict[str, Any]]
EdgeSpec = Union[Tuple[str, str], Dict[str, str]]
NodeColorMap = Mapping[str, str]


def _now_iso() -> str:
    """UTC timestamp in ISO 8601 with a ``Z`` suffix, matching the sample data."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _split_path(path: Optional[str]) -> Tuple[str, str, str]:
    """Resolve a user ``path`` into (directory, prefix, suffix) for part naming.

    ``None`` → write ``wizardflow_*.json`` in the current directory.
    """
    if not path:
        return "", Defaults.PREFIX, Defaults.SUFFIX
    directory = os.path.dirname(path)
    stem, ext = os.path.splitext(os.path.basename(path))
    return directory, (stem or Defaults.PREFIX), (ext or Defaults.SUFFIX)


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


def _apply_node_colors(
    nodes: List[Dict[str, Any]],
    node_colors: Optional[NodeColorMap],
    *,
    silent: bool,
) -> List[Dict[str, Any]]:
    if not node_colors:
        return nodes

    known = {n["id"] for n in nodes}
    unknown = sorted(node_id for node_id in node_colors if node_id not in known)
    if unknown and not silent:
        raise WizardFlowError(
            "node_colors contains unknown node id(s): "
            f"{unknown}. Extracted nodes: {sorted(known)}"
        )

    return [
        {**node, "color": node_colors[node["id"]]}
        if node["id"] in node_colors
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

    Build one with :func:`wizardflow.init`. Record steps inside a
    :meth:`message` block (or by passing ``id=`` to :meth:`log`); the trace is
    written to ``path`` automatically whenever a message ends.
    """

    def __init__(
        self,
        path: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        nodes: Optional[Iterable[NodeSpec]] = None,
        edges: Optional[Iterable[EdgeSpec]] = None,
        meta: Optional[Dict[str, Any]] = None,
        silent: bool = False,
        max_bytes: int = Rotation.DEFAULT_MAX_BYTES,
    ):
        self.path = path
        self.name = name
        self.silent = silent
        self.max_bytes = max_bytes
        self.meta: Dict[str, Any] = dict(meta or {})
        if description is not None:
            self.meta.setdefault("description", description)

        self._nodes: List[Dict[str, Any]] = [_normalize_node(n) for n in (nodes or [])]
        self._edges: List[Dict[str, str]] = [_normalize_edge(e) for e in (edges or [])]
        # Known node ids gate log() when nodes were declared up front.
        self._known: Optional[set] = (
            {n["id"] for n in self._nodes} if nodes is not None else None
        )

        # Insertion-ordered registry of all messages (open + completed).
        self._messages: "Dict[str, _Message]" = {}

        # Output is split into part files. We keep only the *active* part in
        # memory; sealed parts have already been written and chained.
        self._dir, self._prefix, self._suffix = _split_path(path)
        self._run_ts = datetime.now().strftime(Rotation.PART_TIMESTAMP_FORMAT)
        self._active_index = 1
        self._active_part: List[_Message] = []

    @classmethod
    def from_langgraph(
        cls,
        app: Any,
        *,
        path: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
        node_colors: Optional[NodeColorMap] = None,
        silent: bool = False,
        max_bytes: int = Rotation.DEFAULT_MAX_BYTES,
    ) -> "Client":
        """Build a client whose graph is read from a compiled LangGraph ``app``.

        Topology (nodes + directed edges, with a ``conditional`` flag on runtime
        branches) is extracted via duck typing — no langgraph dependency.
        Runtime logging is unchanged; you still call :meth:`log`.
        """
        nodes, edges = _topology_from_langgraph(app)
        nodes = _apply_node_colors(nodes, node_colors, silent=silent)
        return cls(
            path=path,
            name=name,
            description=description,
            nodes=nodes,
            edges=edges,
            meta=meta,
            silent=silent,
            max_bytes=max_bytes,
        )

    # --- recording --------------------------------------------------------

    def _get_or_create(
        self, id: str, label: Optional[str] = None, silent: Optional[bool] = None
    ) -> _Message:
        msg = self._messages.get(id)
        if msg is None:
            msg = _Message(
                id, label=label, silent=self.silent if silent is None else silent
            )
            self._messages[id] = msg
        return msg

    @contextmanager
    def message(
        self,
        id: str,
        label: Optional[str] = None,
        silent: Optional[bool] = None,
    ) -> Iterator[_Message]:
        """Open a message scope. ``log()`` calls inside it (without ``id=``)
        target this message; the message ends and the trace is dumped on exit.
        """
        msg = self._get_or_create(id, label=label, silent=silent)
        token = _current_message.set(msg)
        try:
            yield msg
        finally:
            _current_message.reset(token)
            self.end_message(id)

    def log(
        self,
        node: str,
        label: Optional[str] = None,
        content: Any = None,
        *,
        id: Optional[str] = None,
    ) -> None:
        """Record that ``node`` ran for a message.

        ``id`` given → that message (created on first reference). ``id`` omitted
        → the current ``with wiz.message(...)`` message. Neither → error.
        With ``label``/``content`` it logs a payload; bare ``log("node")``
        records a visit with no payloads.
        """
        if id is not None:
            msg = self._get_or_create(id)
        else:
            msg = _current_message.get()
            if msg is None:
                self._fail(
                    self.silent,
                    WizardFlowError(
                        "no active message — pass id= or open a "
                        "`with wiz.message(id=...)` block"
                    ),
                )
                return

        if msg.completed:
            self._fail(
                msg.silent,
                WizardFlowError(f"message {msg.id!r} already ended; cannot log to it"),
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

    def end_message(self, id: str) -> str:
        """Mark a message complete and write the active part. Returns its path.

        If the active part would exceed ``max_bytes``, it is sealed and the
        message starts a fresh part (rotation happens only at message
        boundaries). Idempotent: a `with` block plus a manual end won't dump twice.
        """
        msg = self._messages.get(id)
        if msg is None:
            self._fail(
                self.silent, WizardFlowError(f"end_message: unknown message {id!r}")
            )
            return self.current_path
        if not msg.completed:
            msg.completed = True
            self._active_part.append(msg)
            self._rotate_if_needed()
            self._write_part(self._active_index, self._active_part, has_next=False)
        return self.current_path

    @staticmethod
    def _fail(silent: bool, exc: Exception) -> None:
        if not silent:
            raise exc

    # --- output & rotation ------------------------------------------------

    @property
    def current_path(self) -> str:
        """Path of the part currently being written (timestamped, numbered)."""
        return self._part_filename(self._active_index)

    def _part_filename(self, index: int) -> str:
        name = Rotation.PART_NAME_FORMAT.format(
            prefix=self._prefix,
            timestamp=self._run_ts,
            index=index,
            suffix=self._suffix,
        )
        return os.path.join(self._dir, name) if self._dir else name

    def _rotate_if_needed(self) -> None:
        """Seal the active part and start a new one if it grew past max_bytes."""
        if len(self._active_part) <= 1:
            return  # a lone (possibly oversized) message can't be split out
        payload = self._render_json(self._active_index, self._active_part, has_next=False)
        if len(payload.encode("utf-8")) <= self.max_bytes:
            return
        overflow = self._active_part.pop()  # this message tipped it over
        self._write_part(self._active_index, self._active_part, has_next=True)  # seal
        sealed = self._active_index
        self._active_index += 1
        self._active_part = [overflow]
        logger.info(
            "part %03d exceeded %d bytes; rotated to %s",
            sealed,
            self.max_bytes,
            os.path.basename(self.current_path),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Return the active part as an ``AgentTraceFile`` dict (completed msgs)."""
        return self._render_part(self._active_index, self._active_part, has_next=False)

    def to_json(self, *, indent: Optional[int] = Output.DEFAULT_INDENT) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def _render_part(
        self, index: int, messages: List[_Message], *, has_next: bool
    ) -> Dict[str, Any]:
        trace: Dict[str, Any] = {
            "version": Schema.VERSION,
            "graph": {"nodes": self._nodes, "edges": self._edges},
            "messages": [m.to_dict() for m in messages],
        }
        if self.name is not None:
            trace["name"] = self.name
        meta = dict(self.meta)
        # Part metadata appears only once the trace has actually split, so a
        # single-part trace stays clean (no spurious part: 1).
        if index > 1 or has_next:
            meta["part"] = index
            if index > 1:
                meta["prevPart"] = os.path.basename(self._part_filename(index - 1))
            if has_next:
                meta["nextPart"] = os.path.basename(self._part_filename(index + 1))
        if meta:
            trace["meta"] = meta
        return trace

    def _render_json(self, index: int, messages: List[_Message], *, has_next: bool) -> str:
        return json.dumps(
            self._render_part(index, messages, has_next=has_next),
            indent=Output.DEFAULT_INDENT,
            ensure_ascii=False,
        )

    def _write_part(self, index: int, messages: List[_Message], *, has_next: bool) -> None:
        """Atomically write one part file (write .tmp, then os.replace)."""
        path = self._part_filename(index)
        payload = self._render_json(index, messages, has_next=has_next)
        tmp = path + Output.TMP_SUFFIX
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(tmp, path)  # atomic on the same filesystem
