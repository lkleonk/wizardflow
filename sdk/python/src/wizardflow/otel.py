"""Optional OpenTelemetry trace bridge.

OpenTelemetry is imported dynamically only when an application enables this
output. WizardFlow never installs or mutates the application's global tracer
provider.
"""

from __future__ import annotations

import atexit
import contextlib
import logging
import threading
from datetime import datetime
from importlib import import_module
from typing import Any, ContextManager, Dict, Iterable, Mapping, Optional, Tuple

from .constants import Logging
from .otel_mapping import (
    DEFAULT_CONTENT_MAX_BYTES,
    DEFAULT_GRAPH_MAX_BYTES,
    map_graph_event,
    map_node_attributes,
    map_workflow_attributes,
    map_workflow_result_attributes,
    workflow_span_name,
)

OTEL_INSTALL = (
    "pip install opentelemetry-api opentelemetry-sdk "
    "opentelemetry-exporter-otlp-proto-http"
)
logger = logging.getLogger(Logging.LOGGER_NAME)
PROJECT_NAME_RESOURCE = "openinference.project.name"
OTEL_TRACE_SCOPES = frozenset({"workflow", "recording"})
DEFAULT_OTEL_TRACE_SCOPE = "workflow"


class OTelConfigurationError(RuntimeError):
    """Raised when optional OpenTelemetry packages are unavailable."""


def _nanoseconds(timestamp: str) -> int:
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    return int(parsed.timestamp() * 1_000_000_000)


def _error_type(error: BaseException) -> str:
    """Fully qualified exception class name, as ``error.type`` recommends."""
    cls = type(error)
    module = cls.__module__
    if module in ("builtins", "__main__"):
        return cls.__qualname__
    return f"{module}.{cls.__qualname__}"


class OTelBridge:
    """Own workflow/run/node spans while delegating record semantics to the mapper."""

    def __init__(
        self,
        tracer: Any,
        *,
        trace_api: Any = None,
        provider: Any = None,
        trace_scope: str = DEFAULT_OTEL_TRACE_SCOPE,
        workflow_name: Optional[str] = None,
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
        self._workflow_name = workflow_name
        self._include_content = include_content
        self._content_max_bytes = content_max_bytes
        self._export_graph = export_graph
        self._graph_max_bytes = graph_max_bytes
        self._root_attributes = dict(root_attributes or {})
        self._run_span: Any = None
        self._run_context: Any = None
        # One independent root span and parent context per open workflow,
        # keyed by message id. Each keeps the context captured at creation, so
        # a reinitialization never moves an already-open workflow.
        self._workflow_roots: Dict[str, Tuple[Any, Any]] = {}
        self._warned_recording_attributes = False
        self._trace_name: Optional[str] = None
        self._nodes: Tuple[Mapping[str, Any], ...] = ()
        self._edges: Tuple[Mapping[str, Any], ...] = ()
        self._spans: Dict[Tuple[str, str], Any] = {}
        self._lock = threading.RLock()
        self._closed = False
        # Ending a WizardFlow-owned run span is safe in global-provider mode;
        # ``close`` only shuts down the provider when it is our private one.
        atexit.register(self.close)

    def set_root_attributes(self, attributes: Mapping[str, Any]) -> None:
        """Replace the attributes applied to roots started from now on."""
        with self._lock:
            self._root_attributes = dict(attributes)

    def _set_span_in_context(self, span: Any) -> Any:
        set_context = getattr(self._trace_api, "set_span_in_context", None)
        return set_context(span) if callable(set_context) else None

    def _internal_kind(self) -> Dict[str, Any]:
        span_kind = getattr(self._trace_api, "SpanKind", None)
        internal = getattr(span_kind, "INTERNAL", None)
        return {"kind": internal} if internal is not None else {}

    def _add_graph_event(self, span: Any) -> None:
        graph_attributes = map_graph_event(
            self._nodes, self._edges, max_bytes=self._graph_max_bytes
        )
        span.add_event("wizardflow.graph", attributes=graph_attributes)
        if graph_attributes.get("wizardflow.graph.omitted"):
            logger.warning(
                "OTel graph content exceeded %d bytes; emitted summary only",
                self._graph_max_bytes,
            )

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
            if self._trace_scope == "workflow":
                return
            attributes: Dict[str, Any] = dict(self._root_attributes)
            if trace_name is not None:
                attributes["wizardflow.trace.name"] = trace_name
            self._run_span = self._tracer.start_span(
                "wizardflow.run",
                start_time=_nanoseconds(timestamp),
                attributes=attributes,
            )
            self._run_context = self._set_span_in_context(self._run_span)
            if self._export_graph:
                self._add_graph_event(self._run_span)

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

    def _start_workflow_root(self, message_id: str, timestamp: str) -> Any:
        """The single builder for workflow roots (live, low-level and offline)."""
        root = self._workflow_roots.get(message_id)
        if root is not None:
            return root[1]
        attributes: Dict[str, Any] = {
            **self._root_attributes,
            **map_workflow_attributes(
                message_id=message_id,
                workflow_name=self._workflow_name,
                trace_name=self._trace_name,
            ),
        }
        span = self._tracer.start_span(
            workflow_span_name(self._workflow_name),
            start_time=_nanoseconds(timestamp),
            attributes=attributes,
            **self._internal_kind(),
        )
        context = self._set_span_in_context(span)
        self._workflow_roots[message_id] = (span, context)
        if self._export_graph:
            self._add_graph_event(span)
        return context

    def start_workflow(self, message_id: str, timestamp: str) -> None:
        """Start a workflow root at an explicit boundary (context API, offline)."""
        if self._trace_scope != "workflow":
            return
        with self._lock:
            self._start_workflow_root(message_id, timestamp)

    def use_workflow(self, message_id: str) -> ContextManager[Any]:
        """Make a workflow root the current span while the workflow block runs.

        Auto-instrumented operations inside the block (HTTP clients, model
        SDKs) then parent under the workflow. Exceptions are recorded by
        :meth:`end_workflow`, not here.
        """
        with self._lock:
            root = self._workflow_roots.get(message_id)
        use_span = getattr(self._trace_api, "use_span", None)
        if root is None or not callable(use_span):
            return contextlib.nullcontext()
        return use_span(
            root[0],
            end_on_exit=False,
            record_exception=False,
            set_status_on_exception=False,
        )

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
            # A low-level message has no explicit start: its root is created
            # lazily from the first node's start time.
            context = (
                self._start_workflow_root(message_id, timestamp)
                if self._trace_scope == "workflow"
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
        *,
        error: Optional[BaseException] = None,
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
        if error is not None:
            self._mark_error(span, error)
        span.end(end_time=_nanoseconds(timestamp))

    def _mark_error(self, span: Any, error: BaseException) -> None:
        """Record ``error`` on ``span``: ``error.type``, exception event, status."""
        span.set_attribute("error.type", _error_type(error))
        record_exception = getattr(span, "record_exception", None)
        if callable(record_exception):
            record_exception(error)
        status_cls = getattr(self._trace_api, "Status", None)
        status_code = getattr(getattr(self._trace_api, "StatusCode", None), "ERROR", None)
        set_status = getattr(span, "set_status", None)
        if status_cls is not None and status_code is not None and callable(set_status):
            set_status(status_cls(status_code, str(error) or None))

    def end_workflow(
        self,
        message_id: str,
        timestamp: str,
        *,
        title: Optional[str] = None,
        meta: Optional[Mapping[str, Any]] = None,
        attributes: Optional[Mapping[str, Any]] = None,
        error: Optional[BaseException] = None,
    ) -> None:
        """Apply final execution details to a workflow root and end it.

        A message that never started a node still gets a zero-child root, so
        an explicitly ended execution is always represented. In recording
        scope there is no per-workflow root: per-workflow ``attributes`` are
        ignored (with one warning) rather than attached to the recording root,
        because backends treat session/user identity as a whole-trace property.
        """
        if self._trace_scope != "workflow":
            if attributes and not self._warned_recording_attributes:
                self._warned_recording_attributes = True
                logger.warning(
                    "per-workflow otel_attributes are ignored in "
                    "otel_trace_scope='recording' (there is no workflow root); "
                    "use otel_trace_scope='workflow' or init(otel_attributes=...)"
                )
            return
        with self._lock:
            self._start_workflow_root(message_id, timestamp)
            span = self._workflow_roots.pop(message_id)[0]
        final = map_workflow_result_attributes(
            title=title,
            meta=meta,
            include_content=self._include_content,
            content_max_bytes=self._content_max_bytes,
        )
        # Application attributes are applied last: they may override
        # init-level root attributes but never the protected keys (validated
        # before they reach the bridge).
        final.update(attributes or {})
        for name, value in final.items():
            span.set_attribute(name, value)
        if error is not None:
            self._mark_error(span, error)
        span.end(end_time=_nanoseconds(timestamp))

    def _end_run(self, timestamp: str) -> None:
        span = self._run_span
        self._run_span = None
        self._run_context = None
        if span is not None:
            span.end(end_time=_nanoseconds(timestamp))

    def close(self, timestamp: Optional[str] = None) -> None:
        """End the run and open workflows; shut down only a WizardFlow-owned provider."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            if timestamp is None:
                timestamp = datetime.now().astimezone().isoformat()
            self._end_run(timestamp)
            # Unfinished workflows end as incomplete with UNSET status: no
            # failure was observed, the execution simply never ended.
            for span, _context in self._workflow_roots.values():
                span.end(end_time=_nanoseconds(timestamp))
            self._workflow_roots.clear()
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
    trace_scope: str = DEFAULT_OTEL_TRACE_SCOPE,
    workflow_name: Optional[str] = None,
    include_content: bool = True,
    content_max_bytes: int = DEFAULT_CONTENT_MAX_BYTES,
    export_graph: bool = False,
    graph_max_bytes: int = DEFAULT_GRAPH_MAX_BYTES,
    root_attributes: Optional[Mapping[str, Any]] = None,
) -> OTelBridge:
    """Create a bridge using global app config or a private OTLP provider.

    ``project_name`` reaches the backend only with an ``endpoint``: a resource
    belongs to a provider, and WizardFlow never modifies the application's
    global provider.
    """
    options: Dict[str, Any] = {
        "trace_scope": trace_scope,
        "workflow_name": workflow_name,
        "include_content": include_content,
        "content_max_bytes": content_max_bytes,
        "export_graph": export_graph,
        "graph_max_bytes": graph_max_bytes,
        "root_attributes": root_attributes,
    }
    try:
        trace = import_module("opentelemetry.trace")
        if endpoint is None:
            return OTelBridge(trace.get_tracer("wizardflow"), trace_api=trace, **options)
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
        **options,
    )


__all__ = [
    "DEFAULT_OTEL_TRACE_SCOPE",
    "OTelBridge",
    "OTelConfigurationError",
    "OTEL_INSTALL",
    "OTEL_TRACE_SCOPES",
    "create_otel_bridge",
]
