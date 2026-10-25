"""reinit tests."""

import os
from wizardflow import Client
from helpers import _FakeOTelBridge, _log_one, _new, _read_part


# --- reinit ----------------------------------------------------------------

def test_reinit_starts_a_new_file_and_leaves_old_part_unsealed(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    old_path = c.current_path

    new_path = c.reinit()
    assert new_path == c.current_path
    assert new_path != old_path
    assert "__part" not in os.path.basename(new_path)  # a new run, not a part

    # The old file is untouched: its messages intact, and NO seal — a seal
    # means "continue at nextPart", which a reinit is not.
    _, old_messages, old_seal = _read_part(old_path)
    assert [m["id"] for m in old_messages] == ["m1"]
    assert old_seal is None

    # The new file doesn't exist until something is written to it.
    assert not os.path.exists(new_path)
    c.log("m2", "a", "L", 2)
    c.end_message("m2")
    header, messages, _ = _read_part(new_path)
    assert header["graph"]["nodes"] == [{"id": "a"}]    # graph carried over
    assert [m["id"] for m in messages] == ["m2"]


def test_open_message_carries_across_reinit(tmp_path):
    # A message logged before reinit but ended after lands in the new file,
    # with all its steps: a message is written wherever it ends.
    c = _new(tmp_path, nodes=["a", "b"])
    c.log("open", "a", "L", 1)
    c.reinit()
    c.log("open", "b", "L", 2)
    c.end_message("open")
    _, messages, _ = _read_part(c.current_path)
    assert [m["id"] for m in messages] == ["open"]
    assert [s["nodeId"] for s in messages[0]["steps"]] == ["a", "b"]


def test_completed_id_is_reusable_after_reinit(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    c.reinit()
    c.log("m1", "a", "L", 2)          # would raise "already ended" without reinit
    c.end_message("m1")
    _, messages, _ = _read_part(c.current_path)
    assert [m["id"] for m in messages] == ["m1"]
    assert messages[0]["steps"][0]["payloads"][0]["value"] == 2


def test_reinit_overrides_replace_and_omitted_values_persist(tmp_path):
    c = _new(tmp_path, name="first", description="one", nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")

    c.reinit(description="two")       # name/meta not given -> kept
    c.log("m2", "a", "L", 2)
    c.end_message("m2")
    header, _, _ = _read_part(c.current_path)
    assert header["name"] == "first"
    assert header["meta"]["description"] == "two"

    c.reinit(meta={"session": "s2"}, description="three")  # meta replaced whole
    c.log("m3", "a", "L", 3)
    c.end_message("m3")
    header, _, _ = _read_part(c.current_path)
    assert header["meta"] == {"session": "s2", "description": "three"}


def test_reinit_resets_rotation_state(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=400)
    _log_one(c, "m0", "X" * 300)      # active part already past the byte cap
    c.reinit()
    _log_one(c, "m1", "X" * 300)      # would rotate to __part2 without the reset
    assert "__part" not in os.path.basename(c.current_path)
    assert not [p for p in os.listdir(tmp_path) if "__part" in p]


def test_module_reinit_delegates_to_default(tmp_path):
    import wizardflow

    wizardflow.init(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    wizardflow.log("m1", "a", "L", 1)
    first = wizardflow.end_message("m1")
    new_path = wizardflow.reinit()
    assert new_path != first
    wizardflow.log("m1", "a", "L", 2)
    assert wizardflow.end_message("m1") == new_path


def test_reinit_controls_jsonl_and_otel_independently(tmp_path, monkeypatch):
    bridge = _FakeOTelBridge()
    monkeypatch.setattr(
        "wizardflow.client.create_otel_bridge", lambda *args, **kwargs: bridge
    )
    c = _new(tmp_path, nodes=["a"], name="original", otel=True)
    original_path = c.current_path

    c.reinit(name="otel-only", jsonl=False, otel=True)
    assert c.current_path == original_path
    assert c.name == "original"
    assert bridge.calls[-1][3] == "otel-only"
    assert [call[0] for call in bridge.calls].count("reinit_run") == 1

    c.reinit(name="jsonl-only", jsonl=True, otel=False)
    assert c.current_path != original_path
    assert c.name == "jsonl-only"
    assert c._otel_name == "otel-only"
    assert [call[0] for call in bridge.calls].count("reinit_run") == 1


def test_close_otel_does_not_affect_jsonl_and_reinit_reopens_it(
    tmp_path, monkeypatch
):
    bridges = [_FakeOTelBridge(), _FakeOTelBridge()]
    monkeypatch.setattr(
        "wizardflow.client.create_otel_bridge",
        lambda *args, **kwargs: bridges.pop(0),
    )
    c = _new(tmp_path, nodes=["a"], otel=True)
    first = c._otel
    c.close_otel()
    c.close_otel()
    assert [call[0] for call in first.calls].count("close") == 1

    c.log("m1", "a", "still-jsonl", True)
    assert os.path.exists(c.end_message("m1"))

    c.reinit(jsonl=False, otel=True)
    assert c._otel is not None
    assert c._otel is not first
