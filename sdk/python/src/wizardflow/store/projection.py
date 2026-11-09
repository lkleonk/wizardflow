"""Project stored OTel spans back into an ``AgentTraceFile`` for the replay viewer.

The inverse of ``otel_mapping``: one message per workflow execution, one step
per node span, payloads decoded from the content attributes. Which attribute
means node, input, output, … comes from the attribute mapping, so traces from
other frameworks replay too once their node key is mapped.

The replay unit is a conversation: every replayable trace slice of a project
that shares a ``conversation_id``, oldest first. A trace without one replays
alone.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..constants import Ids
from ..otel_mapping import NODE_KINDS
from .mapping import Mapping, load_mapping
from .queries import NotFound, QueryError, project_id
from .schema import FLAG_WIZARDFLOW

# Node kinds as other conventions name them → WizardFlow's kinds.
_KIND_ALIASES = {
    "invoke_agent": "agent", "create_agent": "agent",
    "chat": "llm", "text_completion": "llm", "generate_content": "llm",
    "execute_tool": "tool", "retrieval": "retriever", "embeddings": "embedding",
    # OpenInference span kinds
    "agent": "agent", "llm": "llm", "tool": "tool", "retriever": "retriever",
    "embedding": "embedding", "reranker": "reranker",
}

# gen_ai.request.* → the model-parameter keys WizardFlow records.
_MODEL_PARAMETERS = {
    "gen_ai.request.model": "model",
    "gen_ai.request.temperature": "temperature",
    "gen_ai.request.max_tokens": "maxTokens",
    "gen_ai.request.top_p": "topP",
    "gen_ai.request.top_k": "topK",
    "gen_ai.request.seed": "seed",
    "gen_ai.request.frequency_penalty": "frequencyPenalty",
    "gen_ai.request.presence_penalty": "presencePenalty",
    "gen_ai.request.stop_sequences": "stopSequences",
}
_MODEL_PARAMETER_PREFIX = "wizardflow.model_parameter."

# Bookkeeping attributes written next to bounded content, never payloads.
_COMPANIONS = (".encoding", ".truncated", ".original_size")
_DUPLICATE_SUFFIX = re.compile(r"\.\d+$")


def list_conversations(con: sqlite3.Connection, project: str) -> List[Dict[str, Any]]:
    """Replayable conversations of a project, newest activity first."""
    pid = project_id(con, project)
    return [
        {
            "conversationId": conversation,
            "executions": count,
            "firstNs": str(first),
            "lastNs": str(last),
        }
        for conversation, count, first, last in con.execute(
            "SELECT conversation_id, count(*), min(start_ns), max(start_ns) FROM traces "
            "WHERE project_id = ? AND conversation_id IS NOT NULL AND flags & ? "
            "GROUP BY conversation_id ORDER BY max(start_ns) DESC",
            (pid, FLAG_WIZARDFLOW),
        )
    ]


def project_conversation(
    con: sqlite3.Connection, project: str, conversation_id: str
) -> Dict[str, Any]:
    pid = project_id(con, project)
    rows = con.execute(
        "SELECT id, trace_id FROM traces WHERE project_id = ? AND conversation_id = ? "
        "AND flags & ? ORDER BY start_ns, id",
        (pid, conversation_id, FLAG_WIZARDFLOW),
    ).fetchall()
    if not rows:
        raise NotFound(f"no replayable conversation {conversation_id!r} in project {project!r}")
    return _project(con, pid, project, rows, conversation_id=conversation_id)


def project_trace(con: sqlite3.Connection, project: str, trace_id: str) -> Dict[str, Any]:
    pid = project_id(con, project)
    row = con.execute(
        "SELECT id, trace_id, flags FROM traces WHERE project_id = ? AND trace_id = ?",
        (pid, trace_id.lower()),
    ).fetchone()
    if not row:
        raise NotFound(f"no trace {trace_id} in project {project!r}")
    if not row[2] & FLAG_WIZARDFLOW:
        raise QueryError(
            "this trace has no graph nodes, so it cannot open in graph replay; map its "
            "node attribute in Settings → Attribute mapping"
        )
    return _project(con, pid, project, [(row[0], row[1])], conversation_id=None)


# --------------------------------------------------------------------------- core


def _project(
    con: sqlite3.Connection,
    pid: int,
    project: str,
    rows: List[Tuple[int, str]],
    *,
    conversation_id: Optional[str],
) -> Dict[str, Any]:
    mapping = load_mapping(con, pid)
    messages: List[Dict[str, Any]] = []
    trace_name: Optional[str] = None
    graph_event: Optional[Dict[str, Any]] = None
    for trace_row, trace_id in rows:
        spans = con.execute(
            "SELECT span_id, parent_span_id, name, start_ns, end_ns, attributes, node_id, "
            "node_kind, execution_key, input_tokens, output_tokens FROM spans "
            "WHERE trace_row = ? ORDER BY start_ns, id",
            (trace_row,),
        ).fetchall()
        root = next((s for s in spans if s[1] is None), spans[0] if spans else None)
        root_attrs = json.loads(root[5]) if root else {}
        trace_name = trace_name or _text(root_attrs.get("wizardflow.trace.name"))
        for (attrs_json,) in con.execute(
            "SELECT attributes FROM span_events WHERE trace_row = ? AND name = 'wizardflow.graph' "
            "ORDER BY time_ns DESC LIMIT 1",
            (trace_row,),
        ):
            graph_event = json.loads(attrs_json)  # the latest trace's graph wins

        # One message per execution: the mapped execution key, else the trace.
        executions: Dict[str, List[Tuple[Any, ...]]] = {}
        for span in spans:
            if span[6] is None:
                continue
            executions.setdefault(span[8] or trace_id, []).append(span)
        for message_id, node_spans in executions.items():
            messages.append(_message(message_id, trace_id, node_spans, root, root_attrs, mapping))

    messages.sort(key=lambda m: m["steps"][0]["timestamp"] if m["steps"] else "")
    graph, graph_source = _graph(graph_event, messages)
    # Shown in the viewer's trace info: an inferred graph only has the nodes
    # and transitions that actually ran, no unvisited branches, no
    # conditional edges.
    meta: Dict[str, Any] = {
        "source": "opentelemetry",
        "project": project,
        "traces": len(rows),
        "graph": graph_source,
    }
    if conversation_id:
        meta["conversationId"] = conversation_id
    return {
        "version": "0.2",
        "name": trace_name or (f"{project} · {conversation_id}" if conversation_id else project),
        "meta": meta,
        "graph": graph,
        "messages": messages,
    }


def _message(
    message_id: str,
    trace_id: str,
    node_spans: List[Tuple[Any, ...]],
    root: Optional[Tuple[Any, ...]],
    root_attrs: Dict[str, Any],
    mapping: Mapping,
) -> Dict[str, Any]:
    steps = []
    for n, (span_id, _parent, _name, start, end, attrs_json, node_id, node_kind, _exec,
            in_tokens, out_tokens) in enumerate(node_spans, start=1):
        attrs = json.loads(attrs_json)
        step: Dict[str, Any] = {
            "id": Ids.STEP_ID_FORMAT.format(message_id=message_id, n=n),
            "nodeId": node_id,
            "timestamp": _iso(start),
            "endTimestamp": _iso(end),
            "timingMode": "explicit",
            "payloads": _payloads(attrs, mapping, in_tokens, out_tokens),
            # Links the step back to its span: Graph ↔ Spans keeps the position.
            "otelSpanId": span_id,
        }
        kind = _kind(node_kind)
        if kind != "generic":
            step["kind"] = kind
        steps.append(step)
    message: Dict[str, Any] = {"id": message_id, "otelTraceId": trace_id, "steps": steps}
    # The workflow root carries the execution's title and metadata, but only
    # when it is this execution's own root (one trace per execution).
    if root is not None and root_attrs.get("wizardflow.message.id") in (None, message_id):
        title = _decoded(root_attrs, "wizardflow.message.title")
        if title is not None:
            message["label"] = _text(title)
        metadata = _decoded(root_attrs, "wizardflow.message.metadata")
        if isinstance(metadata, dict):
            flat = {k: v for k, v in metadata.items() if isinstance(v, (str, int, float, bool))}
            if flat:
                message["meta"] = flat
        if "label" not in message and root[6] is None:
            message["label"] = root[2]
    return message


def _payloads(
    attrs: Dict[str, Any], mapping: Mapping, in_tokens: Optional[int], out_tokens: Optional[int]
) -> List[Dict[str, Any]]:
    payloads: List[Dict[str, Any]] = []
    for concept in ("input", "output"):
        key = _first_key(attrs, mapping.get(concept, []))
        if key is not None:
            payloads.append({"label": concept, "value": _decoded(attrs, key), "semanticType": concept})

    parameters: Dict[str, Any] = {}
    for key, value in attrs.items():
        if key in _MODEL_PARAMETERS:
            parameters[_MODEL_PARAMETERS[key]] = value
        elif key.startswith(_MODEL_PARAMETER_PREFIX) and not key.endswith(_COMPANIONS):
            parameters[key[len(_MODEL_PARAMETER_PREFIX):]] = _decoded(attrs, key)
    if parameters:
        payloads.append({"label": "model parameters", "value": parameters,
                         "semanticType": "model_parameters"})

    usage = {k: v for k, v in (("inputTokens", in_tokens), ("outputTokens", out_tokens)) if v is not None}
    if usage:
        payloads.append({"label": "usage", "value": usage, "semanticType": "usage"})

    for pattern in mapping.get("payloads", []):
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            for key in attrs:
                if key.startswith(prefix) and not key.endswith(_COMPANIONS):
                    label = _DUPLICATE_SUFFIX.sub("", key[len(prefix):]) or key
                    payloads.append({"label": label, "value": _decoded(attrs, key)})
        elif pattern in attrs:
            payloads.append({"label": pattern, "value": _decoded(attrs, pattern)})
    return payloads


GRAPH_RECORDED = "recorded by WizardFlow"
GRAPH_INFERRED = "inferred from run order"


def _graph(
    event: Optional[Dict[str, Any]], messages: List[Dict[str, Any]]
) -> Tuple[Dict[str, Any], str]:
    """The recorded topology if a wizardflow.graph event has it, else inferred
    from the order nodes ran in. Returns the graph and which of the two it is."""
    if event and not event.get("wizardflow.graph.omitted"):
        try:
            nodes = json.loads(event.get("wizardflow.graph.nodes") or "[]")
            edges = json.loads(event.get("wizardflow.graph.edges") or "[]")
            if isinstance(nodes, list) and isinstance(edges, list):
                return {"nodes": nodes, "edges": edges}, GRAPH_RECORDED
        except (TypeError, json.JSONDecodeError):
            pass
    nodes: List[Dict[str, Any]] = []
    seen_nodes = set()
    edges: List[Dict[str, Any]] = []
    seen_edges = set()
    for message in messages:
        previous = None
        for step in message["steps"]:
            node = step["nodeId"]
            if node not in seen_nodes:
                seen_nodes.add(node)
                nodes.append({"id": node})
            if previous is not None and previous != node and (previous, node) not in seen_edges:
                seen_edges.add((previous, node))
                edges.append({"source": previous, "target": node})
            previous = node
    return {"nodes": nodes, "edges": edges}, GRAPH_INFERRED


# --------------------------------------------------------------------------- values


def _first_key(attrs: Dict[str, Any], keys: List[str]) -> Optional[str]:
    for key in keys:
        if key.endswith("*"):
            prefix = key[:-1]
            for name in attrs:
                if name.startswith(prefix) and not name.endswith(_COMPANIONS):
                    return name
        elif attrs.get(key) is not None:
            return key
    return None


def _decoded(attrs: Dict[str, Any], key: str) -> Any:
    """An attribute's value with WizardFlow's content encoding undone: JSON
    content parsed, and a GenAI message list unwrapped back to its text."""
    value = attrs.get(key)
    if not isinstance(value, str):
        return value
    looks_json = attrs.get(f"{key}.encoding") == "json" or key.endswith(".messages")
    if not looks_json:
        return value
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return value  # truncated content is no longer valid JSON
    if key.endswith(".messages"):
        return _message_text(parsed)
    return parsed


def _message_text(messages: Any) -> Any:
    """``[{role, parts: [{type: text, content}]}]`` → the text, if that's all it is."""
    if not isinstance(messages, list):
        return messages
    texts = []
    for message in messages:
        parts = message.get("parts") if isinstance(message, dict) else None
        if not isinstance(parts, list):
            return messages
        for part in parts:
            if not (isinstance(part, dict) and part.get("type") == "text"):
                return messages
            texts.append(str(part.get("content", "")))
    return "\n".join(texts) if texts else messages


def _kind(raw: Optional[str]) -> str:
    if not raw:
        return "generic"
    value = raw.strip()
    if value in NODE_KINDS:
        return value
    return _KIND_ALIASES.get(value.lower(), "generic")


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def _iso(ns: int) -> str:
    seconds, rest = divmod(int(ns), 1_000_000_000)
    stamp = datetime.fromtimestamp(seconds, tz=timezone.utc).replace(microsecond=rest // 1000)
    return stamp.isoformat().replace("+00:00", "Z")
