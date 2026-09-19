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
from .otel import OTEL_TRACE_SCOPES, OTelBridge, create_otel_bridge
from .otel_mapping import (
    DEFAULT_CONTENT_MAX_BYTES,
    NODE_KINDS,
    canonical_model_key,
    custom_otel_attribute_error,
)

logger = logging.getLogger(Logging.LOGGER_NAME)

__all__ = [
    "Client",
    "NodeHandle",
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
        self.meta: Optional[Dict[str, Any]] = None
        self.silent = silent
        self.completed = False
        self.steps: List[Dict[str, Any]] = []
        self._step_seq = 0
        # One active execution per node. The value keeps timing details that
        # are needed while recording but are not part of the serialized shape.
        self._active_nodes: Dict[str, Dict[str, Any]] = {}

    def _new_step(
        self, node_id: str, timestamp: str, kind: str = "generic"
    ) -> Dict[str, Any]:
        self._step_seq += 1
        step = {
            "id": Ids.STEP_ID_FORMAT.format(message_id=self.id, n=self._step_seq),
            "nodeId": node_id,
            "timestamp": timestamp,
            "payloads": [],
        }
        if kind != "generic":
            step["kind"] = kind
        self.steps.append(step)
        return step

    def start_node(self, node: str, timestamp: str, kind: str) -> bool:
        if node in self._active_nodes:
            return False
        step = self._new_step(node, timestamp, kind)
        self._active_nodes[node] = {
            "step": step,
            "explicit_start": True,
            "last_log": None,
        }
        return True

    def end_node(self, node: str, timestamp: str) -> Optional[Dict[str, Any]]:
        active = self._active_nodes.pop(node, None)
        if active is None:
            return None
        active["step"]["endTimestamp"] = timestamp
        active["step"]["timingMode"] = (
            "explicit" if active["explicit_start"] else "inferred"
        )
        return active["step"]

    def log(
        self,
        node: str,
        label: Optional[str],
        content: Any,
        timestamp: str,
        *,
        semantic_type: Optional[str] = None,
        otel_attribute: Optional[str] = None,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
    ) -> Tuple[Dict[str, Any], List[Tuple[str, str, Dict[str, Any]]], bool]:
        # Consecutive logs to the same node fold into one step (multiple
        # payloads), matching the schema where a step carries many payloads.
        active = self._active_nodes.get(node)
        closed: List[Tuple[str, str, Dict[str, Any]]] = []
        if active is not None and not active["explicit_start"] and label is None:
            # Historically a bare log always starts a new visit. Preserve that
            # behavior when no explicit lifecycle groups the calls.
            end_timestamp, closed_step = self._close_inferred(node, active)
            closed.append((node, end_timestamp, closed_step))
            active = None
        started = active is None
        if active is None:
            # An inferred execution ends when the legacy log stream moves to a
            # different node. Explicit executions may overlap other nodes.
            for active_node, state in list(self._active_nodes.items()):
                if not state["explicit_start"]:
                    end_timestamp, closed_step = self._close_inferred(
                        active_node, state
                    )
                    closed.append((active_node, end_timestamp, closed_step))
            step = self._new_step(node, timestamp)
            active = {
                "step": step,
                "explicit_start": False,
                "last_log": None,
            }
            self._active_nodes[node] = active
        else:
            step = active["step"]
        active["last_log"] = timestamp
        if label is not None:
            payload: Dict[str, Any] = {"label": label, "value": content}
            if semantic_type is not None:
                payload["semanticType"] = semantic_type
            if otel_attribute is not None:
                payload["otelAttribute"] = otel_attribute
            if not export_to_jsonl:
                payload["_exportToJsonl"] = False
            if not export_to_otel:
                payload["_exportToOtel"] = False
                if export_to_jsonl:
                    payload["exportToOtel"] = False
            step["payloads"].append(payload)
        return active, closed, started

    def _close_inferred(
        self, node: str, active: Dict[str, Any]
    ) -> Tuple[str, Dict[str, Any]]:
        end_timestamp = (
            active["last_log"] or active["step"]["timestamp"]
        )
        active["step"]["endTimestamp"] = end_timestamp
        active["step"]["timingMode"] = "inferred"
        self._active_nodes.pop(node, None)
        return end_timestamp, active["step"]

    def close_open_nodes(self) -> List[Tuple[str, str, Dict[str, Any]]]:
        closed: List[Tuple[str, str, Dict[str, Any]]] = []
        for node, active in list(self._active_nodes.items()):
            end_timestamp = (
                active["last_log"] or active["step"]["timestamp"]
            )
            active["step"]["endTimestamp"] = end_timestamp
            active["step"]["timingMode"] = (
                "auto_closed" if active["explicit_start"] else "inferred"
            )
            closed.append((node, end_timestamp, active["step"]))
            self._active_nodes.pop(node, None)
        return closed

    def to_dict(self) -> Dict[str, Any]:
        steps: List[Dict[str, Any]] = []
        for step in self.steps:
            serialized = {key: value for key, value in step.items() if key != "payloads"}
            serialized["payloads"] = [
                {
                    key: value
                    for key, value in payload.items()
                    if not key.startswith("_")
                }
                for payload in step["payloads"]
                if payload.get("_exportToJsonl", True)
            ]
            steps.append(serialized)
        message: Dict[str, Any] = {"id": self.id, "steps": steps}
        if self.label is not None:
            message["label"] = self.label
        if self.meta is not None:
            message["meta"] = self.meta
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
        jsonl: bool = True,
        otel: bool = False,
        otel_endpoint: Optional[str] = None,
        otel_trace_scope: str = "recording",
        otel_include_content: bool = True,
        otel_content_max_bytes: int = DEFAULT_CONTENT_MAX_BYTES,
        export_graph_to_otel: bool = False,
    ):
        self.name = name
        self.silent = silent
        self.jsonl = jsonl
        if otel_content_max_bytes <= 0:
            raise WizardFlowError("otel_content_max_bytes must be greater than zero")
        if otel_trace_scope not in OTEL_TRACE_SCOPES:
            raise WizardFlowError(
                "otel_trace_scope must be 'recording' or 'message'"
            )
        self._otel_configured = otel
        self._otel_endpoint = otel_endpoint
        self._otel_trace_scope = otel_trace_scope
        self._otel_name = name
        self._otel_include_content = otel_include_content
        self._otel_content_max_bytes = otel_content_max_bytes
        self._export_graph_to_otel = export_graph_to_otel
        self._otel: Optional[OTelBridge] = None
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

        if self._otel_configured:
            self._otel = self._create_otel_bridge()
            self._otel.start_run(
                _now_iso(), self._otel_name, self._nodes, self._edges
            )

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
        jsonl: bool = True,
        otel: bool = False,
        otel_endpoint: Optional[str] = None,
        otel_trace_scope: str = "recording",
        otel_include_content: bool = True,
        otel_content_max_bytes: int = DEFAULT_CONTENT_MAX_BYTES,
        export_graph_to_otel: bool = False,
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
            jsonl=jsonl,
            otel=otel,
            otel_endpoint=otel_endpoint,
            otel_trace_scope=otel_trace_scope,
            otel_include_content=otel_include_content,
            otel_content_max_bytes=otel_content_max_bytes,
            export_graph_to_otel=export_graph_to_otel,
        )

    def _create_otel_bridge(self) -> OTelBridge:
        return create_otel_bridge(
            self._otel_endpoint,
            project_name=self._otel_name,
            trace_scope=self._otel_trace_scope,
            include_content=self._otel_include_content,
            content_max_bytes=self._otel_content_max_bytes,
            export_graph=self._export_graph_to_otel,
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
        *,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
        otel_attribute: Optional[str] = None,
    ) -> None:
        """Record that ``node`` ran for message ``id``.

        The message is created on first reference. With ``label``/``content`` it
        logs a payload; a bare ``log(id, "node")`` records a visit with no
        payloads. Nothing is written to disk here — :meth:`end_message` is what
        persists the trace.
        """
        if otel_attribute is not None:
            error = custom_otel_attribute_error(otel_attribute)
            if error is not None:
                self._fail(self.silent, WizardFlowError(error))
                return
            if label is None:
                self._fail(
                    self.silent,
                    WizardFlowError("otel_attribute requires a payload label"),
                )
                return
        self._record(
            id,
            node,
            label,
            content,
            otel_attribute=otel_attribute,
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
        )

    def _record(
        self,
        id: str,
        node: str,
        label: Optional[str],
        content: Any,
        *,
        semantic_type: Optional[str] = None,
        otel_attribute: Optional[str] = None,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
    ) -> None:
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
                active, closed, started = msg.log(
                    node,
                    label,
                    content,
                    _now_iso(),
                    semantic_type=semantic_type,
                    otel_attribute=otel_attribute,
                    export_to_jsonl=export_to_jsonl,
                    export_to_otel=export_to_otel,
                )
                if self._otel is not None:
                    for closed_node, end_timestamp, closed_step in closed:
                        self._otel.end_node(
                            id,
                            closed_node,
                            closed_step.get("kind", "generic"),
                            end_timestamp,
                            closed_step["payloads"],
                            msg.meta,
                        )
                    if started:
                        self._otel.start_node(
                            id,
                            node,
                            active["step"].get("kind", "generic"),
                            active["step"]["timestamp"],
                            self._otel_name,
                        )
            except Exception as exc:  # pragma: no cover - defensive
                self._fail(msg.silent, exc)

    def log_input(
        self,
        id: str,
        node: str,
        value: Any,
        *,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
    ) -> None:
        self._record(
            id,
            node,
            "input",
            value,
            semantic_type="input",
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
        )

    def log_output(
        self,
        id: str,
        node: str,
        value: Any,
        *,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
        otel_attribute: Optional[str] = None,
    ) -> None:
        self._record(
            id,
            node,
            "output",
            value,
            semantic_type="output",
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
        )

    def log_usage(
        self,
        id: str,
        node: str,
        *,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
    ) -> None:
        if input_tokens is None and output_tokens is None:
            raise WizardFlowError("log_usage requires at least one token count")
        for name, value in (
            ("input_tokens", input_tokens),
            ("output_tokens", output_tokens),
        ):
            if value is not None and (
                isinstance(value, bool)
                or not isinstance(value, int)
                or value < 0
            ):
                raise WizardFlowError(f"{name} must be a non-negative integer")
        usage: Dict[str, int] = {}
        if input_tokens is not None:
            usage["inputTokens"] = input_tokens
        if output_tokens is not None:
            usage["outputTokens"] = output_tokens
        self._record(
            id,
            node,
            "usage",
            usage,
            semantic_type="usage",
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
        )

    def log_model_parameters(
        self,
        id: str,
        node: str,
        *,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
        **parameters: Any,
    ) -> None:
        canonical = {
            canonical_model_key(key): value for key, value in parameters.items()
        }
        self._record(
            id,
            node,
            "model_parameters",
            canonical,
            semantic_type="model_parameters",
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
        )

    def _normalize_kind(self, kind: Optional[str]) -> str:
        normalized = kind or "generic"
        if normalized in NODE_KINDS:
            return normalized
        problem = WizardFlowError(
            f"Unknown node kind {normalized!r}. Expected one of {sorted(NODE_KINDS)}"
        )
        if not self.silent:
            raise problem
        logger.warning("%s; using 'generic'", problem)
        return "generic"

    def start_node(self, id: str, node: str, kind: Optional[str] = None) -> None:
        """Mark the explicit start of ``node`` execution for message ``id``."""
        resolved_kind = self._normalize_kind(kind)
        msg = self._get_or_create(id)
        with self._lock:
            if msg.completed:
                logger.warning(
                    "start_node: message %r already ended; ignored", id
                )
                return
            if self._known is not None and node not in self._known:
                logger.warning(
                    "start_node: unknown node %r; ignored (declared nodes: %s)",
                    node,
                    sorted(self._known),
                )
                return
            timestamp = _now_iso()
            if not msg.start_node(node, timestamp, resolved_kind):
                logger.warning(
                    "start_node: node %r is already active for message %r; ignored",
                    node,
                    id,
                )
            elif self._otel is not None:
                self._otel.start_node(
                    id, node, resolved_kind, timestamp, self._otel_name
                )

    def node(
        self, message_id: str, node_id: str, kind: Optional[str] = None
    ) -> "NodeHandle":
        """Scope one node execution and close it even when the body raises."""
        return NodeHandle(self, message_id, node_id, kind)

    def end_node(self, id: str, node: str) -> None:
        """Mark the explicit end of ``node`` execution for message ``id``."""
        with self._lock:
            msg = self._messages.get(id)
            timestamp = _now_iso()
            step = (
                None
                if msg is None or msg.completed
                else msg.end_node(node, timestamp)
            )
            if step is None:
                logger.warning(
                    "end_node: node %r is not active for message %r; ignored",
                    node,
                    id,
                )
            elif self._otel is not None:
                self._otel.end_node(
                    id,
                    node,
                    step.get("kind", "generic"),
                    timestamp,
                    step["payloads"],
                    msg.meta,
                )

    def end_message(
        self,
        id: str,
        title: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Finalize message ``id`` and append it to the active part. Returns its path.

        This is the **only** thing that writes to disk; :meth:`log` just
        accumulates in memory. Optional ``title`` sets the message's human title;
        optional ``meta`` attaches flat metadata about the message as a whole
        (outcome, latency, user id, …) — keep values short scalars, like the
        trace-level ``meta``; large structured data belongs in :meth:`log`
        payloads. Exactly one line is appended per ended message — O(1) however
        large the part already is. If the active part would exceed ``max_bytes``
        (or holds ``max_messages`` already), it is sealed and the message starts
        a fresh part (rotation happens only at message boundaries). Idempotent:
        a second end on the same id won't append twice.
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
                if meta is not None:
                    msg.meta = dict(meta)
                closed = msg.close_open_nodes()
                if self._otel is not None:
                    for node, end_timestamp, step in closed:
                        self._otel.end_node(
                            id,
                            node,
                            step.get("kind", "generic"),
                            end_timestamp,
                            step["payloads"],
                            msg.meta,
                        )
                    if self._otel_trace_scope == "message":
                        self._otel.end_message(
                            id, _now_iso(), title=msg.label, meta=msg.meta
                        )
                msg.completed = True
                if self.jsonl:
                    line = self._render_line(
                        {Records.TYPE_KEY: Records.MESSAGE, **msg.to_dict()}
                    )
                    self._rotate_if_needed(len(line.encode("utf-8")))
                self._active_part.append(msg)
                if self.jsonl:
                    self._append_to_part(line)
            return self.current_path

    def reinit(
        self,
        name: Optional[str] = None,
        description: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
        *,
        jsonl: bool = True,
        otel: bool = True,
    ) -> str:
        """Independently start a new JSONL run and/or OTel trace.

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
            if jsonl and self.jsonl:
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
                # filename and append a second header to it; spin until new.
                new_ts = _run_timestamp()
                while new_ts == self._run_ts:
                    new_ts = _run_timestamp()
                self._run_ts = new_ts
                self._active_index = 1
                self._active_part = []
                self._active_part_bytes = 0
                self._part_started = False
                logger.info(
                    "reinitialized JSONL; next trace file is %s",
                    os.path.basename(self.current_path),
                )
            if otel and self._otel_configured:
                if name is not None:
                    self._otel_name = name
                timestamp = _now_iso()
                if self._otel is None:
                    self._otel = self._create_otel_bridge()
                    self._otel.start_run(
                        timestamp, self._otel_name, self._nodes, self._edges
                    )
                else:
                    self._otel.reinit_run(
                        timestamp,
                        timestamp,
                        self._otel_name,
                        self._nodes,
                        self._edges,
                    )
            return self.current_path

    def close_otel(self) -> None:
        """End and flush only WizardFlow's OTel output; JSONL is unaffected."""
        with self._lock:
            bridge = self._otel
            if bridge is None:
                return
            self._otel = None
            bridge.close(_now_iso())

    @staticmethod
    def _fail(silent: bool, exc: Exception) -> None:
        if not silent:
            raise exc
        logger.warning("%s; ignored", exc)

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


class NodeHandle:
    """Logging handle yielded by :meth:`Client.node`."""

    def __init__(
        self,
        client: Client,
        message_id: str,
        node_id: str,
        kind: Optional[str],
    ):
        self._client = client
        self._message_id = message_id
        self._node_id = node_id
        self._kind = kind

    def __enter__(self) -> "NodeHandle":
        self._client.start_node(self._message_id, self._node_id, kind=self._kind)
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self._client.end_node(self._message_id, self._node_id)

    def log(
        self,
        label: str,
        value: Any,
        *,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
        otel_attribute: Optional[str] = None,
    ) -> None:
        self._client.log(
            self._message_id,
            self._node_id,
            label,
            value,
            otel_attribute=otel_attribute,
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
        )

    def log_input(
        self,
        value: Any,
        *,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
    ) -> None:
        self._client.log_input(
            self._message_id,
            self._node_id,
            value,
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
        )

    def log_output(
        self,
        value: Any,
        *,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
    ) -> None:
        self._client.log_output(
            self._message_id,
            self._node_id,
            value,
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
        )

    def log_usage(
        self,
        *,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
    ) -> None:
        self._client.log_usage(
            self._message_id,
            self._node_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
        )

    def log_model_parameters(
        self,
        *,
        export_to_jsonl: bool = True,
        export_to_otel: bool = True,
        **parameters: Any,
    ) -> None:
        self._client.log_model_parameters(
            self._message_id,
            self._node_id,
            export_to_jsonl=export_to_jsonl,
            export_to_otel=export_to_otel,
            **parameters,
        )
