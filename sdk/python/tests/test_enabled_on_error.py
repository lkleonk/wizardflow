"""enabled=False (no-op mode) and on_error (raise vs. warn-once)."""

import os

import pytest

import wizardflow
import wizardflow.client as client_module
from wizardflow import Client, WizardFlowError
from helpers import _new


# --- enabled=False ----------------------------------------------------------

def test_disabled_client_records_and_writes_nothing(tmp_path):
    out = tmp_path / "traces"
    c = Client(output_dir=str(out), nodes=["a"], enabled=False)

    assert c.enabled is False
    c.log("m1", "a", "L", 1)
    c.log_usage("m1", "a", input_tokens=3)
    c.log_model_parameters("m1", "a", temperature=0.2)
    with c.node("m1", "a") as node:
        node.log_input("in")
        node.log_output("out")
    assert c.end_message("m1") is None
    with c.workflow() as run:
        run.set_info(title="t", otel_attributes={"session.id": "s"})
        with run.node("a") as node:
            node.log_input("in")

    assert run.message_id.startswith("wf-")
    assert c.current_path is None
    assert c.reinit(name="next") is None
    c.close_otel()
    assert c.to_dict()["messages"] == []
    assert c._messages == {}          # nothing buffered in memory either
    assert not out.exists()


def test_disabled_skips_usage_errors_it_would_otherwise_report(tmp_path):
    c = _new(tmp_path, nodes=["a"], enabled=False, on_error="raise")
    c.log("m1", "typo", "L", 1)
    c.log_usage("m1", "a")
    c.end_message("never-started")


def test_disabled_never_builds_an_otel_exporter(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("exporter must not be created when disabled")

    monkeypatch.setattr(client_module, "create_otel_bridge", boom)
    c = _new(tmp_path, nodes=["a"], otel=True, enabled=False)
    c.reinit()
    assert c._otel is None


def test_disabled_still_validates_startup_config(tmp_path):
    with pytest.raises(WizardFlowError, match="otel_trace_scope"):
        _new(tmp_path, otel_trace_scope="bogus", enabled=False)


def test_disabled_from_langgraph_does_not_read_the_graph(tmp_path):
    class App:
        def get_graph(self):
            raise AssertionError("get_graph() must not run when disabled")

    c = Client.from_langgraph(
        App(), output_dir=str(tmp_path), node_colors={"x": "#fff"}, enabled=False
    )
    assert c.enabled is False


def test_module_level_api_is_a_no_op_when_disabled(tmp_path):
    wizardflow.init(output_dir=str(tmp_path / "t"), nodes=["a"], enabled=False)
    with wizardflow.node("m1", "a") as node:
        node.log_input("x")
    assert wizardflow.end_message("m1") is None
    assert wizardflow.reinit() is None
    assert not (tmp_path / "t").exists()


# --- WIZARDFLOW_ENABLED -----------------------------------------------------

@pytest.mark.parametrize("value", ["false", "0", "No", " OFF "])
def test_env_var_disables(tmp_path, monkeypatch, value):
    monkeypatch.setenv("WIZARDFLOW_ENABLED", value)
    assert _new(tmp_path).enabled is False


@pytest.mark.parametrize("value", ["true", "1", "yes", ""])
def test_env_var_enables_or_defaults_on(tmp_path, monkeypatch, value):
    monkeypatch.setenv("WIZARDFLOW_ENABLED", value)
    assert _new(tmp_path).enabled is True


def test_enabled_argument_beats_env_var(tmp_path, monkeypatch):
    monkeypatch.setenv("WIZARDFLOW_ENABLED", "false")
    assert _new(tmp_path, enabled=True).enabled is True


def test_unset_env_var_means_enabled(tmp_path, monkeypatch):
    monkeypatch.delenv("WIZARDFLOW_ENABLED", raising=False)
    assert _new(tmp_path).enabled is True


def test_unparseable_env_var_fails_at_startup(tmp_path, monkeypatch):
    monkeypatch.setenv("WIZARDFLOW_ENABLED", "disabled")
    with pytest.raises(WizardFlowError, match="WIZARDFLOW_ENABLED"):
        _new(tmp_path)


# --- on_error ---------------------------------------------------------------

def test_default_warns_instead_of_raising(tmp_path, caplog):
    c = _new(tmp_path, nodes=["a"])
    assert c.on_error == "warn"
    with caplog.at_level("WARNING", logger="wizardflow"):
        c.log("m1", "typo", "L", 1)
    assert "Unknown node 'typo'" in caplog.text


def test_repeated_error_is_logged_once(tmp_path, caplog):
    c = _new(tmp_path, nodes=["a"])
    with caplog.at_level("WARNING", logger="wizardflow"):
        for _ in range(5):
            c.log("m1", "typo", "L", 1)
        c.log("m1", "other", "L", 1)
    messages = [r.getMessage() for r in caplog.records]
    assert sum("'typo'" in m for m in messages) == 1
    assert sum("'other'" in m for m in messages) == 1


def test_invalid_on_error_fails_at_startup(tmp_path):
    with pytest.raises(WizardFlowError, match="on_error"):
        _new(tmp_path, on_error="ignore")


def test_silent_is_a_deprecated_alias(tmp_path):
    with pytest.warns(DeprecationWarning, match="silent is deprecated"):
        quiet = _new(tmp_path, silent=True)
    with pytest.warns(DeprecationWarning):
        strict = _new(tmp_path, silent=False)
    assert (quiet.on_error, quiet.silent) == ("warn", True)
    assert (strict.on_error, strict.silent) == ("raise", False)


def test_silent_and_on_error_together_is_rejected(tmp_path):
    with pytest.raises(WizardFlowError, match="not both"):
        _new(tmp_path, silent=True, on_error="warn")


# --- failed trace writes ----------------------------------------------------

def _unwritable_dir(tmp_path):
    # A regular file where the output directory should be: makedirs fails.
    blocker = tmp_path / "blocked"
    blocker.write_text("not a directory")
    return str(blocker)


def test_write_failure_warns_by_default(tmp_path, caplog):
    c = Client(output_dir=_unwritable_dir(tmp_path), nodes=["a"])
    c.log("m1", "a", "L", 1)
    with caplog.at_level("WARNING", logger="wizardflow"):
        path = c.end_message("m1")
    assert path is not None and not os.path.isfile(path)
    assert "message not written" in caplog.text


def test_write_failure_raises_with_on_error_raise(tmp_path):
    c = Client(output_dir=_unwritable_dir(tmp_path), nodes=["a"], on_error="raise")
    c.log("m1", "a", "L", 1)
    with pytest.raises(OSError):
        c.end_message("m1")
