"""WizardFlow Python SDK.

Record agent flows and write them to the AgentTrace file format that the
WizardFlow visualizer replays.

    import wizardflow

    wizardflow.init(output_dir="traces", nodes=graph.nodes)

    wizardflow.log("msg-1", "classifier", "input", text)
    wizardflow.log("msg-1", "generator", "output", answer)
    wizardflow.end_message("msg-1")   # <- writes the trace

There is no ``save()`` call and no autosave: ``log`` only accumulates in memory,
and :func:`end_message` is the one thing that writes the trace. The first
argument to ``log`` names the message a step belongs to, so overlapping messages
(common in concurrent multi-agent runs) never collide. ``init`` returns a client
and also stashes it as the module default, so the bare ``wizardflow.log(...)``
form above works.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, Mapping, Optional

from .client import (
    Client,
    EdgeSpec,
    LangGraphExtractionError,
    NodeSpec,
    UnknownNodeError,
    WizardFlowError,
)
from .constants import Defaults, Logging, Output, Rotation

# Library convention: attach a NullHandler so we emit nothing unless the host
# app configures logging. Notices (e.g. part rotation) go to the "wizardflow"
# logger; opt in with logging.getLogger("wizardflow").setLevel(logging.INFO).
logging.getLogger(Logging.LOGGER_NAME).addHandler(logging.NullHandler())

__all__ = [
    "init",
    "init_from_langgraph",
    "reinit",
    "log",
    "end_message",
    "to_dict",
    "to_json",
    "get_default",
    "Client",
    "WizardFlowError",
    "UnknownNodeError",
    "LangGraphExtractionError",
]

_default: Optional[Client] = None


def init(
    output_dir: Optional[str] = None,
    file_prefix: str = Defaults.PREFIX,
    name: Optional[str] = None,
    description: Optional[str] = None,
    nodes: Optional[Iterable[NodeSpec]] = None,
    edges: Optional[Iterable[EdgeSpec]] = None,
    node_labels: Optional[Mapping[str, str]] = None,
    node_colors: Optional[Mapping[str, str]] = None,
    node_descriptions: Optional[Mapping[str, str]] = None,
    meta: Optional[Dict[str, Any]] = None,
    silent: bool = False,
    max_bytes: int = Rotation.DEFAULT_MAX_BYTES,
    max_messages: int = Rotation.DEFAULT_MAX_MESSAGES,
) -> Client:
    """Create a recording client and set it as the module default."""
    global _default
    _default = Client(
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
    return _default


def init_from_langgraph(
    app: Any,
    output_dir: Optional[str] = None,
    file_prefix: str = Defaults.PREFIX,
    name: Optional[str] = None,
    description: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    node_labels: Optional[Mapping[str, str]] = None,
    node_colors: Optional[Mapping[str, str]] = None,
    node_descriptions: Optional[Mapping[str, str]] = None,
    silent: bool = False,
    max_bytes: int = Rotation.DEFAULT_MAX_BYTES,
    max_messages: int = Rotation.DEFAULT_MAX_MESSAGES,
) -> Client:
    """Create a client from a compiled LangGraph ``app`` and set it as default.

    The graph's nodes and edges are extracted automatically; logging is the
    same as with :func:`init`.
    """
    global _default
    _default = Client.from_langgraph(
        app,
        output_dir=output_dir,
        file_prefix=file_prefix,
        name=name,
        description=description,
        meta=meta,
        node_labels=node_labels,
        node_colors=node_colors,
        node_descriptions=node_descriptions,
        silent=silent,
        max_bytes=max_bytes,
        max_messages=max_messages,
    )
    return _default


def get_default() -> Client:
    if _default is None:
        raise WizardFlowError("No default client. Call wizardflow.init(...) first.")
    return _default


# --- module-level delegation to the default client ------------------------

def reinit(
    name: Optional[str] = None,
    description: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> str:
    """Start a new trace file on the default client (see :meth:`Client.reinit`)."""
    return get_default().reinit(name=name, description=description, meta=meta)


def log(
    id: str,
    node: str,
    label: Optional[str] = None,
    content: Any = None,
) -> None:
    get_default().log(id, node, label, content)


def end_message(
    id: str,
    title: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> str:
    return get_default().end_message(id, title=title, meta=meta)


def to_dict() -> Dict[str, Any]:
    return get_default().to_dict()


def to_json(*, indent: Optional[int] = Output.DEFAULT_INDENT) -> str:
    return get_default().to_json(indent=indent)
