"""persistence tests."""

import json
import os
from wizardflow import Client
from helpers import _new, _read_part


def test_jsonl_false_records_in_memory_without_creating_a_file(tmp_path):
    c = _new(tmp_path, nodes=["a"], jsonl=False)
    c.log("m1", "a", "L", 1)
    path = c.end_message("m1")
    assert not os.path.exists(path)
    assert c.to_dict()["messages"][0]["id"] == "m1"

# --- completed-only persistence ------------------------------------------

def test_only_completed_messages_are_emitted(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("open", "a", "L", 1)          # never ended
    c.log("done", "a", "L", 2)
    c.end_message("done")
    assert [m["id"] for m in c.to_dict()["messages"]] == ["done"]


def test_end_message_appends_header_then_message(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    written = c.current_path                        # timestamped output filename
    assert os.path.exists(written)
    header, messages, seal = _read_part(written)
    assert header["version"] == "0.2"
    assert header["graph"]["nodes"] == [{"id": "a"}]
    assert [m["id"] for m in messages] == ["m1"]
    assert seal is None                             # active part: no seal line


def test_each_end_message_is_immediately_durable(tmp_path):
    # Append-only: every ended message is on disk the moment end_message
    # returns, without the earlier ones being rewritten.
    c = Client(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    _, first, _ = _read_part(c.current_path)
    c.log("m2", "a", "L", 2)
    c.end_message("m2")
    _, second, _ = _read_part(c.current_path)
    assert [m["id"] for m in first] == ["m1"]
    assert [m["id"] for m in second] == ["m1", "m2"]


def test_log_alone_writes_nothing(tmp_path):
    # end_message is the only thing that touches disk: logging without ending
    # leaves no file on disk.
    c = Client(output_dir=str(tmp_path), file_prefix="trace", nodes=["a"])
    c.log("m1", "a", "L", 1)
    assert not [p for p in os.listdir(tmp_path) if p.endswith(".jsonl")]


def test_output_dir_is_created_on_first_write(tmp_path):
    output_dir = tmp_path / "traces"
    c = Client(output_dir=str(output_dir), file_prefix="trace", nodes=["a"])
    assert not output_dir.exists()
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    assert output_dir.is_dir()
    assert os.path.exists(c.current_path)


def test_part_naming_uses_prefix_and_init_timestamp(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="myrun", nodes=["a"])
    name = os.path.basename(c.current_path)
    assert name.startswith("myrun__")
    assert name.endswith("Z.jsonl")
    assert "__part" not in name
    assert "_001" not in name
    assert name.count(".") == 1


def test_default_prefix_when_file_prefix_omitted():
    c = Client(nodes=["a"])
    assert os.path.basename(c.current_path).startswith("wizardflow__")


def test_end_message_is_idempotent(tmp_path):
    c = _new(tmp_path, nodes=["a"])
    c.log("m1", "a", "L", 1)
    c.end_message("m1")               # ends + writes
    c.end_message("m1")               # second end -> no duplicate
    assert len(c.to_dict()["messages"]) == 1

def test_node_description_survives_jsonl_roundtrip(tmp_path):
    # Serialization + backward compat: the description rides on the header
    # record's graph nodes and comes back through the JSONL reader untouched.
    # Nodes without one stay clean — an old trace is simply a trace where no
    # node carries the field.
    from wizardflow.reader import load_trace_file

    c = _new(tmp_path, nodes=["a", "b"], node_descriptions={"a": "does A"})
    c.log("m1", "a", "L", 1)
    c.end_message("m1")
    loaded = load_trace_file(c.current_path)
    nodes = {n["id"]: n for n in loaded["graph"]["nodes"]}
    assert nodes["a"]["description"] == "does A"
    assert "description" not in nodes["b"]
