"""Live OTLP export with the standard library.

``init(otel=True, otel_endpoint=...)`` sends through the OpenTelemetry SDK
when it is installed. Without it (or with ``otel_exporter="builtin"``) this
module does the same job: the shared :class:`~wizardflow.otel.OTelBridge`
drives a :class:`LiveSpanRecorder`, and each span is handed, when it ends, to
a :class:`LiveExporter` that sends batches from a background thread through
:mod:`wizardflow.otlp_http`.

It runs inside someone else's app, so it never blocks the app's thread on the
network, never raises into it, and never grows without bound:

- the queue holds at most ``MAX_QUEUE_SPANS`` spans; beyond that new spans are
  dropped and counted (the OTel SDK's batch processor does the same);
- an endpoint that is down (say, the dashboard is closed) gives one warning,
  then later batches keep trying quietly;
- at ``close_otel()`` and at process exit, what is queued is sent with a short
  time limit, and anything left is reported as lost.

Spans sent this way start new traces of their own: without the SDK there is
no app tracing for them to join.
"""

from __future__ import annotations

import collections
import logging
import threading
import time
from typing import Any, Callable, Deque, List, Mapping, Optional

from .constants import Logging
from .otlp_http import OtlpSendError, send_trace_requests
from .otlp_writer import RecordedSpan, SpanRecorder, build_trace_requests

logger = logging.getLogger(Logging.LOGGER_NAME)

# The OTel SDK's BatchSpanProcessor defaults for the queue and batch size; a
# shorter delay than its 5 s, since a dashboard is watching.
MAX_QUEUE_SPANS = 2048
BATCH_SPANS = 512
SCHEDULE_DELAY_S = 1.0
# What close_otel() / process exit wait for queued spans to go out.
SHUTDOWN_TIMEOUT_S = 2.0


class _Stopped(Exception):
    """Raised inside a retry wait once shutting down: no more retries."""


class LiveExporter:
    """Sends ended spans to an OTLP/HTTP endpoint from a background thread."""

    def __init__(
        self,
        endpoint: str,
        *,
        resource_attributes: Mapping[str, Any],
        scope_version: str,
        max_queue: int = MAX_QUEUE_SPANS,
        batch_spans: int = BATCH_SPANS,
        delay_s: float = SCHEDULE_DELAY_S,
        send: Optional[Callable[..., int]] = None,
    ) -> None:
        self.endpoint = endpoint
        self._resource = dict(resource_attributes)
        self._scope_version = scope_version
        self._max_queue = max_queue
        self._batch = batch_spans
        self._delay = delay_s
        self._send = send
        self._queue: Deque[RecordedSpan] = collections.deque()
        self._cond = threading.Condition()
        self._stopping = threading.Event()
        self._flushes = 0  # callers waiting in flush(): send now, don't gather
        self._busy = False  # a batch is out of the queue and being sent
        self._in_flight = 0  # its size
        self._failing = False
        # Counts, for tests and for the lost-spans warning.
        self.sent = 0
        self.dropped = 0
        self.failed = 0
        self._thread = threading.Thread(target=self._run, name="wizardflow-otlp-export", daemon=True)
        self._thread.start()

    # --- called from the app's threads --------------------------------------

    def submit(self, span: RecordedSpan) -> None:
        """Queue an ended span. Never blocks; drops it when the queue is full."""
        with self._cond:
            if self._stopping.is_set() or len(self._queue) >= self._max_queue:
                self.dropped += 1
                if self.dropped == 1:
                    logger.warning(
                        "OTel export: dropping spans, %s (the endpoint %s is too slow or down)",
                        "already closed" if self._stopping.is_set() else f"{self._max_queue} are waiting",
                        self.endpoint,
                    )
                return
            self._queue.append(span)
            if len(self._queue) >= self._batch:
                self._cond.notify_all()

    def flush(self, timeout_s: float = SHUTDOWN_TIMEOUT_S) -> bool:
        """Send what is queued now; ``True`` if everything went out in time."""
        deadline = time.monotonic() + timeout_s
        with self._cond:
            self._flushes += 1
            self._cond.notify_all()
            try:
                while self._queue or self._busy:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not self._thread.is_alive():
                        return False
                    self._cond.wait(remaining)
            finally:
                self._flushes -= 1
        return True

    def shutdown(self, timeout_s: float = SHUTDOWN_TIMEOUT_S) -> bool:
        """Send what is queued and stop the thread, within ``timeout_s`` in all.

        A request still out when time runs up is abandoned to the (daemon)
        thread: closing never waits longer, whatever the endpoint does.
        """
        deadline = time.monotonic() + timeout_s
        flushed = self.flush(timeout_s)
        with self._cond:
            self._stopping.set()
            self._cond.notify_all()
        self._thread.join(max(deadline - time.monotonic(), 0.05))
        with self._cond:
            # Still queued, plus a request still out if the thread is stuck in it.
            lost = len(self._queue) + (self._in_flight if self._thread.is_alive() else 0)
        if lost:
            logger.warning(
                "OTel export: %d span(s) were not sent to %s before closing (it did not answer in time)",
                lost,
                self.endpoint,
            )
        return flushed and not lost

    # --- the background thread ----------------------------------------------

    def _run(self) -> None:
        while True:
            with self._cond:
                # Gather for up to the delay, unless a batch is full, a flush
                # waits, or we are stopping.
                if not self._stopping.is_set() and not self._flushes and len(self._queue) < self._batch:
                    self._cond.wait(self._delay)
                batch = [self._queue.popleft() for _ in range(min(len(self._queue), self._batch))]
                if not batch and self._stopping.is_set():
                    self._cond.notify_all()
                    return
                self._busy = bool(batch)
                self._in_flight = len(batch)
            try:
                if batch and not self._export(batch):
                    return  # closing cut it short: what is left is reported as lost
            finally:
                with self._cond:
                    self._busy = False
                    self._in_flight = 0
                    self._cond.notify_all()

    def _export(self, batch: List[RecordedSpan]) -> bool:
        """Send one batch; ``False`` once closing has cut its retries short."""
        try:
            requests = build_trace_requests(
                batch,
                resource_attributes=self._resource,
                scope_version=self._scope_version,
                max_spans=self._batch,
            )
            # Looked up per call, so tests can stand in for the network.
            send = self._send or send_trace_requests
            send(requests, self.endpoint, sleep=self._retry_wait)
        except _Stopped:
            # Back in the queue, so shutdown() counts them as not sent.
            with self._cond:
                self._queue.extendleft(reversed(batch))
            return False
        except OtlpSendError as exc:
            self.failed += len(batch)
            if not self._failing:
                self._failing = True
                logger.warning(
                    "OTel export: could not send %d span(s): %s. Later spans keep trying; "
                    "your app is not affected.",
                    len(batch),
                    exc,
                )
            return True
        except Exception:  # noqa: BLE001 - a bug here must never reach the app
            self.failed += len(batch)
            logger.warning("OTel export: sending spans failed", exc_info=True)
            return True
        self.sent += len(batch)
        if self._failing:
            self._failing = False
            logger.info("OTel export: reaching %s again", self.endpoint)
        return True

    def _retry_wait(self, seconds: float) -> None:
        # A retry pause that ends at once when closing: no retries then.
        if self._stopping.wait(seconds):
            raise _Stopped()


class LiveSpanRecorder(SpanRecorder):
    """The bridge's tracer (and provider) for live export without the OTel SDK."""

    def __init__(self, exporter: LiveExporter) -> None:
        super().__init__()
        self.exporter = exporter

    def finish(self, span: RecordedSpan) -> None:
        self.exporter.submit(span)

    def event_time(self, span: RecordedSpan) -> int:
        return time.time_ns()

    # provider API, as OTelBridge.close uses it: close() calls force_flush,
    # then shutdown. The flush happens in shutdown, once, within its time
    # limit, and the sender itself says plainly what did not go out: an
    # endpoint that is down (the dashboard is closed) is routine here, not a
    # failure worth a traceback.
    def force_flush(self, timeout_millis: Optional[int] = None) -> bool:
        return True

    def shutdown(self) -> None:
        self.exporter.shutdown()


__all__ = ["LiveExporter", "LiveSpanRecorder"]
