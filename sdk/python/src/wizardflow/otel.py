"""Optional OpenTelemetry trace bridge.

OpenTelemetry is imported dynamically only when an application enables this
output. WizardFlow never installs or mutates the application's global tracer
provider.
"""

from __future__ import annotations

import atexit
import logging
import threading
from datetime import datetime
from importlib import import_module
from typing import Any, Dict, Iterable, Mapping, Optional, Tuple

from .constants import Logging
from .otel_mapping import (
    DEFAULT_CONTENT_MAX_BYTES,
    DEFAULT_GRAPH_MAX_BYTES,
    map_graph_event,
    map_node_attributes,
)

OTEL_INSTALL = (
    "pip install opentelemetry-api opentelemetry-sdk "
    "opentelemetry-exporter-otlp-proto-http"
)
logger = logging.getLogger(Logging.LOGGER_NAME)
PROJECT_NAME_RESOURCE = "openinference.project.name"
OTEL_TRACE_SCOPES = frozenset({"recording", "message"})


class OTelConfigurationError(RuntimeError):
    """Raised when optional OpenTelemetry packages are unavailable."""


def _nanoseconds(timestamp: str) -> int:
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    return int(parsed.timestamp() * 1_000_000_000)


class OTelBridge:
    """Own run/node spans while delegating record semantics to the mapper."""

    def __init__(
        self,
        tracer: Any,
        *,
        trace_api: Any = None,
        provider: Any = None,
        trace_scope: str = "recording",
        include_content: bool = True,
        content_max_bytes: int = DEFAULT_CONTENT_MAX_BYTES,
        export_graph: bool = False,
        graph_max_bytes: int = DEFAULT_GRAPH_MAX_BYTES,
        root_attributes: Optional[Mapping[str, Any]] = None,
    ):
        self._tracer = tracer
        self._trace_api = trace_api
        self._provider = provider
        self._trace_scope = trace_scope
        self._include_content = include_content
        self._content_max_bytes = content_max_bytes
        self._export_graph = export_graph
        self._graph_max_bytes = graph_max_bytes
        self._root_attributes = dict(root_attributes or {})
        self._run_span: Any = None
        self._run_context: Any = None
        self._message_roots: Dict[str, Tuple[Any, Any]] = {}
        self._trace_name: Optional[str] = None
        self._nodes: Tuple[Mapping[str, Any], ...] = ()
        self._edges: Tuple[Mapping[str, Any], ...] = ()
        self._spans: Dict[Tuple[str, str], Any] = {}
        self._lock = threading.RLock()
        self._closed = False
        # Ending a WizardFlow-owned run span is safe in global-provider mode;
        # ``close`` only shuts down the provider when it is our private one.
        atexit.register(self.close)

    def start_run(
        self,
        timestamp: str,
        trace_name: Optional[str],
        nodes: Iterable[Mapping[str, Any]],
        edges: Iterable[Mapping[str, Any]],
    ) -> None:
        with self._lock:
            self._closed = False
            self._trace_name = trace_name
            self._nodes = tuple(nodes)
            self._edges = tuple(edges)
            if self._trace_scope == "message":
                return
            attributes: Dict[str, Any] = dict(self._root_attributes)
            if trace_name is not None:
                attributes["wizardflow.trace.name"] = trace_name
            self._run_span = self._tracer.start_span(
                "wizardflow.run",
                start_time=_nanoseconds(timestamp),
                attributes=attributes,
            )
            set_context = getattr(self._trace_api, "set_span_in_context", None)
            self._run_context = (
                set_context(self._run_span) if callable(set_context) else None
            )
            if self._export_graph:
                graph_attributes = map_graph_event(
                    self._nodes, self._edges, max_bytes=self._graph_max_bytes
                )
                self._run_span.add_event(
                    "wizardflow.graph", attributes=graph_attributes
                )
                if graph_attributes.get("wizardflow.graph.omitted"):
                    logger.warning(
                        "OTel graph content exceeded %d bytes; emitted summary only",
                        self._graph_max_bytes,
                    )

    def reinit_run(
        self,
        end_timestamp: str,
        start_timestamp: str,
        trace_name: Optional[str],
        nodes: Iterable[Mapping[str, Any]],
        edges: Iterable[Mapping[str, Any]],
    ) -> None:
        with self._lock:
            if self._trace_scope == "recording":
                self._end_run(end_timestamp)
            self.start_run(start_timestamp, trace_name, nodes, edges)

    def _start_message_root(self, message_id: str, timestamp: str) -> Any:
        root = self._message_roots.get(message_id)
        if root is not None:
            return root[1]
        attributes: Dict[str, Any] = {
            **self._root_attributes,
            "wizardflow.message.id": message_id,
        }
        if self._trace_name is not None:
            attributes["wizardflow.trace.name"] = self._trace_name
        span = self._tracer.start_span(
            "wizardflow.message",
            start_time=_nanoseconds(timestamp),
            attributes=attributes,
        )
        set_context = getattr(self._trace_api, "set_span_in_context", None)
        context = set_context(span) if callable(set_context) else None
        self._message_roots[message_id] = (span, context)
        if self._export_graph:
            graph_attributes = map_graph_event(
                self._nodes, self._edges, max_bytes=self._graph_max_bytes
            )
            span.add_event("wizardflow.graph", attributes=graph_attributes)
        return context

    def start_message(self, message_id: str, timestamp: str) -> None:
        """Start a message root explicitly (used by historical export)."""
        if self._trace_scope != "message":
            return
        with self._lock:
            self._start_message_root(message_id, timestamp)

    def start_node(
        self,
        message_id: str,
        node: str,
        kind: str,
        timestamp: str,
        trace_name: Optional[str],
    ) -> None:
        attributes: Dict[str, Any] = {
            "wizardflow.message.id": message_id,
            "wizardflow.node.id": node,
            "wizardflow.node.kind": kind,
        }
        if trace_name is not None:
            attributes["wizardflow.trace.name"] = trace_name
        kwargs: Dict[str, Any] = {
            "start_time": _nanoseconds(timestamp),
            "attributes": attributes,
        }
        with self._lock:
            context = (
                self._start_message_root(message_id, timestamp)
                if self._trace_scope == "message"
                else self._run_context
            )
            if context is not None:
                kwargs["context"] = context
            self._spans[(message_id, node)] = self._tracer.start_span(node, **kwargs)

    def end_node(
        self,
        message_id: str,
        node: str,
        kind: str,
        timestamp: str,
        payloads: Iterable[Mapping[str, Any]],
        message_meta: Optional[Mapping[str, Any]] = None,
    ) -> None:
        with self._lock:
            span = self._spans.pop((message_id, node), None)
        if span is None:
            return
        attributes = map_node_attributes(
            message_id=message_id,
            node_id=node,
            kind=kind,
            payloads=payloads,
            message_meta=message_meta,
            include_content=self._include_content,
            content_max_bytes=self._content_max_bytes,
        )
        for name, value in attributes.items():
            span.set_attribute(name, value)
        span.end(end_time=_nanoseconds(timestamp))

    def end_message(
        self,
        message_id: str,
        timestamp: str,
        title: Optional[str] = None,
        meta: Optional[Mapping[str, Any]] = None,
    ) -> None:
        """End one message root when traces are scoped per message."""
        if self._trace_scope != "message":
            return
        with self._lock:
            root = self._message_roots.pop(message_id, None)
        if root is None:
            return
        span = root[0]
        if title is not None:
            span.set_attribute("wizardflow.message.title", title)
        for key, value in (meta or {}).items():
            if isinstance(value, (bool, int, float, str)):
                span.set_attribute(f"wizardflow.message.meta.{key}", value)
        span.end(end_time=_nanoseconds(timestamp))

    def _end_run(self, timestamp: str) -> None:
        span = self._run_span
        self._run_span = None
        self._run_context = None
        if span is not None:
            span.end(end_time=_nanoseconds(timestamp))

    def close(self, timestamp: Optional[str] = None) -> None:
        """End the run and shut down only a WizardFlow-owned provider."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            if timestamp is None:
                timestamp = datetime.now().astimezone().isoformat()
            self._end_run(timestamp)
            for span, _context in self._message_roots.values():
                span.end(end_time=_nanoseconds(timestamp))
            self._message_roots.clear()
            if self._provider is not None:
                force_flush = getattr(self._provider, "force_flush", None)
                flush_failed = False
                if callable(force_flush):
                    flush_failed = force_flush() is False
                shutdown = getattr(self._provider, "shutdown", None)
                if callable(shutdown):
                    shutdown()
                if flush_failed:
                    raise OTelConfigurationError(
                        "OpenTelemetry provider did not flush all spans"
                    )


def create_otel_bridge(
    endpoint: Optional[str] = None,
    *,
    project_name: Optional[str] = None,
    trace_scope: str = "recording",
    include_content: bool = True,
    content_max_bytes: int = DEFAULT_CONTENT_MAX_BYTES,
    export_graph: bool = False,
    graph_max_bytes: int = DEFAULT_GRAPH_MAX_BYTES,
    root_attributes: Optional[Mapping[str, Any]] = None,
) -> OTelBridge:
    """Create a bridge using global app config or a private OTLP provider."""
    try:
        trace = import_module("opentelemetry.trace")
        if endpoint is None:
            return OTelBridge(
                trace.get_tracer("wizardflow"),
                trace_api=trace,
                trace_scope=trace_scope,
                include_content=include_content,
                content_max_bytes=content_max_bytes,
                export_graph=export_graph,
                graph_max_bytes=graph_max_bytes,
                root_attributes=root_attributes,
            )
        sdk_trace = import_module("opentelemetry.sdk.trace")
        sdk_resources = import_module("opentelemetry.sdk.resources")
        sdk_export = import_module("opentelemetry.sdk.trace.export")
        otlp = import_module(
            "opentelemetry.exporter.otlp.proto.http.trace_exporter"
        )
    except ImportError as exc:
        raise OTelConfigurationError(
            "OpenTelemetry output requires optional packages. Install them with: "
            + OTEL_INSTALL
        ) from exc

    resource = (
        sdk_resources.Resource.create({PROJECT_NAME_RESOURCE: project_name})
        if project_name is not None
        else None
    )
    provider = sdk_trace.TracerProvider(resource=resource)
    exporter = otlp.OTLPSpanExporter(endpoint=endpoint)
    provider.add_span_processor(sdk_export.BatchSpanProcessor(exporter))
    return OTelBridge(
        provider.get_tracer("wizardflow"),
        trace_api=trace,
        provider=provider,
        trace_scope=trace_scope,
        include_content=include_content,
        content_max_bytes=content_max_bytes,
        export_graph=export_graph,
        graph_max_bytes=graph_max_bytes,
        root_attributes=root_attributes,
    )


__all__ = [
    "OTelBridge",
    "OTelConfigurationError",
    "OTEL_INSTALL",
    "OTEL_TRACE_SCOPES",
    "create_otel_bridge",
]
