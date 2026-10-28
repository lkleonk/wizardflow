"""OTel failures stay inside WizardFlow (the OTel error-handling rules).

At run time the OTel side may fail (a bridge bug, a span in an unexpected
state, a flush that doesn't complete); none of that may raise into the app,
replace the app's own exception, or cost the JSONL record.
"""

from types import SimpleNamespace

import pytest

import wizardflow.otel as otel_module
from wizardflow import OTelExportError, WizardFlowError
from wizardflow.otel import OTelBridge
from wizardflow.otel_file_exporter import ExportOptions, export_trace_chain
from wizardflow.reader import TraceChain
from helpers import _FakeOTelBridge, _new, _read_part


def _fake(monkeypatch):
    bridge = _FakeOTelBridge()
    monkeypatch.setattr(
        "wizardflow.client.create_otel_bridge", lambda *args, **kwargs: bridge
    )
    return bridge


def _broken(*args, **kwargs):
    raise RuntimeError("bridge bug")


# --- runtime bridge calls ---------------------------------------------------

def test_node_start_and_end_failures_never_raise(tmp_path, monkeypatch, caplog):
    bridge = _fake(monkeypatch)
    bridge.start_node = _broken
    bridge.end_node = _broken
    trace = _new(tmp_path, nodes=["a"], otel=True, on_error="raise")
    with caplog.at_level("WARNING", logger="wizardflow"):
        with trace.node("m1", "a") as node:
            node.log_output("ok")
    trace.end_message("m1")
    _, messages, _ = _read_part(trace.current_path)
    assert messages[0]["steps"][0]["payloads"][0]["value"] == "ok"
    assert "OTel export failed while starting node 'a'" in caplog.text
    assert "OTel export failed while ending node 'a'" in caplog.text


def test_otel_failure_never_replaces_the_apps_exception(tmp_path, monkeypatch):
    bridge = _fake(monkeypatch)
    bridge.end_node = _broken
    trace = _new(tmp_path, nodes=["a"], otel=True)
    with pytest.raises(ValueError, match="app error"):
        with trace.node("m1", "a"):
            raise ValueError("app error")


def test_log_otel_failure_is_not_reported_as_a_usage_error(tmp_path, monkeypatch):
    bridge = _fake(monkeypatch)
    bridge.start_node = _broken
    trace = _new(tmp_path, nodes=["a"], otel=True, on_error="raise")
    trace.log("m1", "a", "x", 1)          # inferred start -> bridge.start_node
    trace.end_message("m1")
    _, messages, _ = _read_part(trace.current_path)
    assert messages[0]["steps"][0]["payloads"] == [{"label": "x", "value": 1}]


@pytest.mark.parametrize("broken", ["start_run", "reinit_run", "set_root_attributes"])
def test_reinit_otel_failure_never_raises(tmp_path, monkeypatch, caplog, broken):
    bridge = _fake(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True, on_error="raise")
    if broken == "start_run":
        trace.close_otel()
    setattr(bridge, broken, _broken)
    old_path = trace.current_path
    with caplog.at_level("WARNING", logger="wizardflow"):
        new_path = trace.reinit(otel_attributes={"session.id": "s2"})
    assert new_path != old_path           # the JSONL half still happened
    assert "reinitializing the OTel trace" in caplog.text


def test_close_otel_never_raises(tmp_path, monkeypatch):
    bridge = _fake(monkeypatch)
    bridge.close = _broken
    trace = _new(tmp_path, nodes=["a"], otel=True)
    trace.close_otel()


# --- invalid OTel input never blocks JSONL ------------------------------------

def test_bad_end_message_otel_attributes_still_write_the_message(tmp_path, monkeypatch):
    _fake(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True, on_error="raise")
    trace.log("m1", "a", "x", 1)
    with pytest.raises(WizardFlowError, match="protected"):
        trace.end_message("m1", otel_attributes={"wizardflow.message.id": "x"})
    _, messages, _ = _read_part(trace.current_path)
    assert [m["id"] for m in messages] == ["m1"]


@pytest.mark.parametrize("method", ["log", "log_input", "log_output"])
def test_bad_otel_attribute_keeps_the_payload(tmp_path, method):
    trace = _new(tmp_path, nodes=["a"], on_error="raise")
    args = ("m1", "a", "label", 1) if method == "log" else ("m1", "a", 1)
    with pytest.raises(WizardFlowError, match="protected"):
        getattr(trace, method)(*args, otel_attribute="wizardflow.node.id")
    trace.end_message("m1")
    payload = trace.to_dict()["messages"][0]["steps"][0]["payloads"][0]
    assert payload["value"] == 1
    assert "otelAttribute" not in payload


def test_otel_attribute_without_label_keeps_the_visit(tmp_path):
    trace = _new(tmp_path, nodes=["a"], on_error="raise")
    with pytest.raises(WizardFlowError, match="requires a payload label"):
        trace.log("m1", "a", otel_attribute="app.visit")
    trace.end_message("m1")
    assert trace.to_dict()["messages"][0]["steps"][0]["nodeId"] == "a"


def test_bad_reinit_otel_attributes_still_reinitialize(tmp_path, monkeypatch):
    _fake(monkeypatch)
    trace = _new(tmp_path, nodes=["a"], otel=True, on_error="raise")
    old_path = trace.current_path
    with pytest.raises(WizardFlowError, match="protected"):
        trace.reinit(otel_attributes={"wizardflow.message.id": "x", "ok.key": 1})
    assert trace.current_path != old_path
    assert trace._otel_root_attributes == {"ok.key": 1}


# --- OTelBridge.close ---------------------------------------------------------

class _Tracer:
    def start_span(self, name, **kwargs):
        return SimpleNamespace(
            set_attribute=lambda *a: None,
            add_event=lambda *a, **k: None,
            end=lambda **k: None,
        )


def test_close_shuts_down_even_when_flush_raises(caplog):
    shutdowns = []
    provider = SimpleNamespace(
        force_flush=_broken, shutdown=lambda: shutdowns.append(True)
    )
    bridge = OTelBridge(_Tracer(), provider=provider)
    with caplog.at_level("WARNING", logger="wizardflow"):
        assert bridge.close("2026-09-15T10:00:01.000Z") is False
    assert shutdowns == [True]
    assert "flushing spans" in caplog.text


def test_close_reports_success():
    provider = SimpleNamespace(force_flush=lambda: True, shutdown=lambda: None)
    assert OTelBridge(_Tracer(), provider=provider).close() is True


def test_close_unregisters_its_atexit_hook(monkeypatch):
    registered = []
    monkeypatch.setattr(
        otel_module,
        "atexit",
        SimpleNamespace(register=registered.append, unregister=registered.remove),
    )
    bridge = OTelBridge(_Tracer())
    assert registered == [bridge._close_at_exit]
    bridge.close()
    assert registered == []


def test_close_at_exit_does_not_unregister_during_the_exit_run(monkeypatch):
    unregistered = []
    monkeypatch.setattr(
        otel_module,
        "atexit",
        SimpleNamespace(register=lambda f: None, unregister=unregistered.append),
    )
    OTelBridge(_Tracer())._close_at_exit()
    assert unregistered == []


# --- offline exporter ---------------------------------------------------------

def _export(monkeypatch, tmp_path, bridge, steps):
    monkeypatch.setattr(
        "wizardflow.otel_file_exporter.create_otel_bridge",
        lambda *args, **kwargs: bridge,
    )
    trace = {
        "graph": {"nodes": [{"id": "a"}], "edges": []},
        "messages": [{"id": "m1", "steps": steps}],
    }
    return export_trace_chain(
        TraceChain(trace, (tmp_path / "run.jsonl",), False),
        ExportOptions(endpoint="http://collector"),
    )


_GOOD_STEP = {
    "nodeId": "a",
    "timestamp": "2026-09-17T10:00:00Z",
    "endTimestamp": "2026-09-17T10:00:01Z",
}


def test_offline_export_raises_export_error_when_flush_fails(monkeypatch, tmp_path):
    bridge = _FakeOTelBridge()
    bridge.close = lambda timestamp: False
    with pytest.raises(OTelExportError, match="did not flush"):
        _export(monkeypatch, tmp_path, bridge, [_GOOD_STEP])


def test_offline_export_keeps_the_real_error_when_flush_also_fails(
    monkeypatch, tmp_path
):
    bridge = _FakeOTelBridge()
    bridge.close = lambda timestamp: False
    bad_step = {**_GOOD_STEP, "endTimestamp": "2026-09-17T09:00:00Z"}
    with pytest.raises(ValueError, match="invalid timing"):
        _export(monkeypatch, tmp_path, bridge, [bad_step])
