"""Pure WizardFlow-record to OpenTelemetry attribute mapping.

This module deliberately imports no OpenTelemetry packages.  Both live export
and a future JSONL exporter can feed the same transport-neutral records into
these functions.

Convention sources (re-check when updating this table):
https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md
https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple


DEFAULT_CONTENT_MAX_BYTES = 16_384
DEFAULT_GRAPH_MAX_BYTES = 65_536

NODE_KINDS = frozenset(
    {"generic", "agent", "llm", "tool", "retriever", "embedding", "reranker"}
)

_MODEL_ATTRIBUTES = {
    "model": "gen_ai.request.model",
    "temperature": "gen_ai.request.temperature",
    "maxTokens": "gen_ai.request.max_tokens",
    "topP": "gen_ai.request.top_p",
    "topK": "gen_ai.request.top_k",
    "seed": "gen_ai.request.seed",
    "frequencyPenalty": "gen_ai.request.frequency_penalty",
    "presencePenalty": "gen_ai.request.presence_penalty",
    "stopSequences": "gen_ai.request.stop_sequences",
}
_MODEL_KEY_ALIASES = {
    "max_tokens": "maxTokens",
    "top_p": "topP",
    "top_k": "topK",
    "frequency_penalty": "frequencyPenalty",
    "presence_penalty": "presencePenalty",
    "stop_sequences": "stopSequences",
}
_MODEL_KEYS_BY_KIND = {
    "llm": frozenset(_MODEL_ATTRIBUTES),
    "agent": frozenset(
        {
            "model",
            "temperature",
            "maxTokens",
            "topP",
            "frequencyPenalty",
            "presencePenalty",
            "stopSequences",
        }
    ),
    "embedding": frozenset({"model"}),
}
_SCALAR_TYPES = (str, bool, int, float)


def _is_otel_sequence(value: Any) -> bool:
    if not isinstance(value, (list, tuple)) or not value:
        return False
    first_type = type(value[0])
    return first_type in _SCALAR_TYPES and all(
        type(item) is first_type for item in value
    )


def canonical_model_key(key: str) -> str:
    """Return WizardFlow's stable JSONL spelling for a model parameter."""
    return _MODEL_KEY_ALIASES.get(key, key)


def canonical_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def normalize_attribute_component(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return normalized or "unnamed"


def _bounded_text(value: Any, max_bytes: int) -> Tuple[str, bool, int, bool]:
    is_json = not isinstance(value, str)
    rendered = value if isinstance(value, str) else canonical_json(value)
    encoded = rendered.encode("utf-8")
    original_size = len(encoded)
    if original_size <= max_bytes:
        return rendered, False, original_size, is_json
    prefix = encoded[:max_bytes]
    while True:
        try:
            return prefix.decode("utf-8"), True, original_size, is_json
        except UnicodeDecodeError:
            prefix = prefix[:-1]


def _put_content(
    attributes: Dict[str, Any], name: str, value: Any, max_bytes: int
) -> None:
    rendered, truncated, original_size, is_json = _bounded_text(value, max_bytes)
    attributes[name] = rendered
    if is_json:
        attributes[f"{name}.encoding"] = "json"
    if truncated:
        attributes[f"{name}.truncated"] = True
        attributes[f"{name}.original_size"] = original_size


def _message_content(value: Any, role: str) -> List[Dict[str, Any]]:
    text = value if isinstance(value, str) else canonical_json(value)
    return [{"role": role, "parts": [{"type": "text", "content": text}]}]


def _put_messages(
    attributes: Dict[str, Any], name: str, value: Any, role: str, max_bytes: int
) -> None:
    """Bound a GenAI message by trimming its text while keeping valid JSON."""
    text = value if isinstance(value, str) else canonical_json(value)
    messages = _message_content(text, role)
    rendered = canonical_json(messages)
    original_size = len(rendered.encode("utf-8"))
    if original_size <= max_bytes:
        attributes[name] = rendered
        attributes[f"{name}.encoding"] = "json"
        return

    encoded = text.encode("utf-8")
    low, high, best = 0, len(encoded), ""
    while low <= high:
        middle = (low + high) // 2
        prefix = encoded[:middle].decode("utf-8", errors="ignore")
        candidate = canonical_json(_message_content(prefix, role))
        if len(candidate.encode("utf-8")) <= max_bytes:
            best = candidate
            low = middle + 1
        else:
            high = middle - 1
    # Extremely small custom bounds may not fit even an empty message. Keep a
    # valid JSON value and make the omission explicit rather than malformed.
    attributes[name] = best or "[]"
    attributes[f"{name}.encoding"] = "json"
    attributes[f"{name}.truncated"] = True
    attributes[f"{name}.original_size"] = original_size


def _export_enabled(payload: Mapping[str, Any]) -> bool:
    return payload.get("_exportToOtel", payload.get("exportToOtel", True)) is not False


def map_node_attributes(
    *,
    message_id: str,
    node_id: str,
    kind: str,
    payloads: Iterable[Mapping[str, Any]],
    message_meta: Optional[Mapping[str, Any]] = None,
    include_content: bool = False,
    content_max_bytes: int = DEFAULT_CONTENT_MAX_BYTES,
) -> Dict[str, Any]:
    """Project one resolved node execution into span attributes."""
    attributes: Dict[str, Any] = {
        "wizardflow.message.id": message_id,
        "wizardflow.node.id": node_id,
        "wizardflow.node.kind": kind,
    }
    if kind == "agent":
        attributes["gen_ai.operation.name"] = "invoke_agent"
        attributes["gen_ai.agent.name"] = node_id
    elif kind == "tool":
        attributes["gen_ai.operation.name"] = "execute_tool"
        attributes["gen_ai.tool.name"] = node_id
    elif kind == "retriever":
        attributes["gen_ai.operation.name"] = "retrieval"
    elif kind == "embedding":
        attributes["gen_ai.operation.name"] = "embeddings"

    semantic: Dict[str, Mapping[str, Any]] = {}
    parameters: Dict[str, Any] = {}
    generic_counts: Dict[str, int] = defaultdict(int)

    for payload in payloads:
        if not _export_enabled(payload):
            continue
        semantic_type = payload.get("semanticType")
        if semantic_type == "model_parameters" and isinstance(payload.get("value"), dict):
            parameters.update(payload["value"])
        elif semantic_type in {"input", "output", "usage"}:
            semantic[str(semantic_type)] = payload
        elif semantic_type is None:
            label = normalize_attribute_component(str(payload.get("label", "")))
            index = generic_counts[label]
            generic_counts[label] += 1
            name = f"wizardflow.log.{label}" + (f".{index}" if index else "")
            value = payload.get("value")
            if isinstance(value, _SCALAR_TYPES):
                if isinstance(value, str):
                    _put_content(attributes, name, value, content_max_bytes)
                else:
                    attributes[name] = value
            elif include_content:
                _put_content(attributes, name, value, content_max_bytes)

    if parameters:
        for raw_key, value in parameters.items():
            key = canonical_model_key(str(raw_key))
            standard = (
                _MODEL_ATTRIBUTES.get(key)
                if key in _MODEL_KEYS_BY_KIND.get(kind, ())
                else None
            )
            supported_value = isinstance(value, _SCALAR_TYPES) or _is_otel_sequence(value)
            name = (standard if supported_value else None) or (
                "wizardflow.model_parameter."
                + normalize_attribute_component(str(raw_key))
            )
            if isinstance(value, (bool, int, float)):
                attributes[name] = value
            elif isinstance(value, str):
                _put_content(attributes, name, value, content_max_bytes)
            elif _is_otel_sequence(value):
                attributes[name] = tuple(value)
            else:
                _put_content(attributes, name, value, content_max_bytes)

    usage = semantic.get("usage", {}).get("value")
    if isinstance(usage, dict):
        if "inputTokens" in usage:
            prefix = (
                "gen_ai.usage"
                if kind in {"llm", "agent", "embedding"}
                else "wizardflow.usage"
            )
            attributes[f"{prefix}.input_tokens"] = usage["inputTokens"]
        if "outputTokens" in usage:
            prefix = (
                "gen_ai.usage"
                if kind in {"llm", "agent"}
                else "wizardflow.usage"
            )
            attributes[f"{prefix}.output_tokens"] = usage["outputTokens"]

    if include_content:
        for semantic_type, role in (("input", "user"), ("output", "assistant")):
            record = semantic.get(semantic_type)
            if record is None:
                continue
            value = record.get("value")
            if kind in {"llm", "agent"}:
                _put_messages(
                    attributes,
                    f"gen_ai.{semantic_type}.messages",
                    value,
                    role,
                    content_max_bytes,
                )
            elif kind == "tool" and isinstance(value, dict):
                name = (
                    "gen_ai.tool.call.arguments"
                    if semantic_type == "input"
                    else "gen_ai.tool.call.result"
                )
                _put_content(attributes, name, value, content_max_bytes)
            elif kind == "retriever" and semantic_type == "input" and isinstance(value, str):
                _put_content(attributes, "gen_ai.retrieval.query.text", value, content_max_bytes)
            elif (
                kind == "retriever"
                and semantic_type == "output"
                and isinstance(value, list)
                and all(isinstance(document, dict) for document in value)
            ):
                _put_content(attributes, "gen_ai.retrieval.documents", value, content_max_bytes)
            else:
                _put_content(attributes, f"wizardflow.{semantic_type}", value, content_max_bytes)

    for name, value in (message_meta or {}).items():
        if isinstance(value, _SCALAR_TYPES):
            attributes[
                "wizardflow.message.meta." + normalize_attribute_component(str(name))
            ] = value
    return attributes


def map_graph_event(
    nodes: Iterable[Mapping[str, Any]],
    edges: Iterable[Mapping[str, Any]],
    *,
    max_bytes: int = DEFAULT_GRAPH_MAX_BYTES,
) -> Dict[str, Any]:
    """Create bounded attributes for the ``wizardflow.graph`` span event."""
    node_list = list(nodes)
    edge_list = list(edges)
    nodes_json = canonical_json(node_list)
    edges_json = canonical_json(edge_list)
    complete = canonical_json({"edges": edge_list, "nodes": node_list})
    size = len(complete.encode("utf-8"))
    attributes: Dict[str, Any] = {
        "wizardflow.graph.node_count": len(node_list),
        "wizardflow.graph.edge_count": len(edge_list),
        "wizardflow.graph.encoding": "json",
    }
    if size <= max_bytes:
        attributes["wizardflow.graph.nodes"] = nodes_json
        attributes["wizardflow.graph.edges"] = edges_json
    else:
        attributes["wizardflow.graph.content_hash"] = hashlib.sha256(
            complete.encode("utf-8")
        ).hexdigest()
        attributes["wizardflow.graph.omitted"] = True
        attributes["wizardflow.graph.original_size"] = size
    return attributes


__all__ = [
    "DEFAULT_CONTENT_MAX_BYTES",
    "DEFAULT_GRAPH_MAX_BYTES",
    "NODE_KINDS",
    "canonical_json",
    "canonical_model_key",
    "map_graph_event",
    "map_node_attributes",
    "normalize_attribute_component",
]
