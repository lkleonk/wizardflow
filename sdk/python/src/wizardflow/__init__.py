"""WizardFlow Python SDK.

Record agent flows and write them to the AgentTrace file format that the
WizardFlow visualizer replays.

    import wizardflow

    wizardflow.init(path="run.json", nodes=graph.nodes)

    with wizardflow.message(id="msg-1"):
        wizardflow.log("classifier", "input", text)
        wizardflow.log("generator", "output", answer)
    # message ends here -> trace dumped to run.json automatically

There is no ``save()`` call: the trace is written to ``path`` every time a
message ends. ``init`` returns a client and also stashes it as the module
default, so the bare ``wizardflow.log(...)`` form above works.

Targeting a message:
  - inside a ``with wizardflow.message(id=...)`` block, ``log`` needs no id.
  - anywhere else, pass it: ``wizardflow.log("gen", "out", x, id="msg-1")``.
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
from .constants import Logging, Output, Rotation

# Library convention: attach a NullHandler so we emit nothing unless the host
# app configures logging. Notices (e.g. part rotation) go to the "wizardflow"
# logger; opt in with logging.getLogger("wizardflow").setLevel(logging.INFO).
logging.getLogger(Logging.LOGGER_NAME).addHandler(logging.NullHandler())

__all__ = [
    "init",
    "init_from_langgraph",
    "message",
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
    path: Optional[str] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    nodes: Optional[Iterable[NodeSpec]] = None,
    edges: Optional[Iterable[EdgeSpec]] = None,
    meta: Optional[Dict[str, Any]] = None,
    silent: bool = False,
    max_bytes: int = Rotation.DEFAULT_MAX_BYTES,
) -> Client:
    """Create a recording client and set it as the module default."""
    global _default
    _default = Client(
        path=path,
        name=name,
        description=description,
        nodes=nodes,
        edges=edges,
        meta=meta,
        silent=silent,
        max_bytes=max_bytes,
    )
    return _default


def init_from_langgraph(
    app: Any,
    path: Optional[str] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
    node_colors: Optional[Mapping[str, str]] = None,
    silent: bool = False,
    max_bytes: int = Rotation.DEFAULT_MAX_BYTES,
) -> Client:
    """Create a client from a compiled LangGraph ``app`` and set it as default.

    The graph's nodes and edges are extracted automatically; logging is the
    same as with :func:`init`.
    """
    global _default
    _default = Client.from_langgraph(
        app,
        path=path,
        name=name,
        description=description,
        meta=meta,
        node_colors=node_colors,
        silent=silent,
        max_bytes=max_bytes,
    )
    return _default


def get_default() -> Client:
    if _default is None:
        raise WizardFlowError("No default client. Call wizardflow.init(...) first.")
    return _default


# --- module-level delegation to the default client ------------------------

def message(id: str, label: Optional[str] = None, silent: Optional[bool] = None):
    return get_default().message(id=id, label=label, silent=silent)


def log(
    node: str,
    label: Optional[str] = None,
    content: Any = None,
    *,
    id: Optional[str] = None,
) -> None:
    get_default().log(node, label, content, id=id)


def end_message(id: str) -> str:
    return get_default().end_message(id)


def to_dict() -> Dict[str, Any]:
    return get_default().to_dict()


def to_json(*, indent: Optional[int] = Output.DEFAULT_INDENT) -> str:
    return get_default().to_json(indent=indent)
