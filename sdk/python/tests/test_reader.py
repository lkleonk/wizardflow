"""Tests for the JSONL trace reader — assembly plus the tolerance rules
(torn final line, corrupt middle lines, unknown record types, duplicate ids).
"""

import json

import pytest

from wizardflow.reader import TraceFormatError, load_trace_chain, load_trace_file


def _lines(*records):
    return "".join(json.dumps(r) + "\n" for r in records)


HEADER = {
    "type": "header",
    "version": "0.2",
    "name": "run",
    "meta": {"description": "hi"},
    "graph": {"nodes": [{"id": "a"}], "edges": []},
}


def _msg(mid, **extra):
    return {"type": "message", "id": mid, "steps": [], **extra}


def test_load_trace_chain_discovers_parts_from_middle(tmp_path):
    first = tmp_path / "run.jsonl"
    second = tmp_path / "run__part2.jsonl"
    first.write_text(
        _lines(HEADER, _msg("m1"), {"type": "seal", "nextPart": second.name}),
        encoding="utf-8",
    )
    second_header = {
        **HEADER,
        "meta": {**HEADER["meta"], "part": 2, "prevPart": first.name},
    }
    second.write_text(_lines(second_header, _msg("m2")), encoding="utf-8")

    chain = load_trace_chain(second)
    assert chain.parts == (first.resolve(), second.resolve())
    assert [message["id"] for message in chain.trace["messages"]] == ["m1", "m2"]
    assert chain.sealed is False


def test_load_trace_chain_rejects_link_that_does_not_point_back(tmp_path):
    first = tmp_path / "run.jsonl"
    second = tmp_path / "run__part2.jsonl"
    first.write_text(
        _lines(HEADER, {"type": "seal", "nextPart": second.name}),
        encoding="utf-8",
    )
    second.write_text(
        _lines({**HEADER, "meta": {**HEADER["meta"], "part": 2}}),
        encoding="utf-8",
    )
    with pytest.raises(TraceFormatError, match="does not point back"):
        load_trace_chain(first)


def test_load_trace_chain_detects_single_document_by_content(tmp_path):
    path = tmp_path / "legacy.jsonl"
    path.write_text(
        json.dumps({**{k: v for k, v in HEADER.items() if k != "type"}, "messages": []}),
        encoding="utf-8",
    )
    chain = load_trace_chain(path)
    assert chain.source_format == "json"
    assert chain.sealed is True


def test_assembles_header_and_messages_in_file_order(tmp_path):
    p = tmp_path / "t.jsonl"
    p.write_text(_lines(HEADER, _msg("m1"), _msg("m2")), encoding="utf-8")

    trace = load_trace_file(p)
    assert trace["version"] == "0.2"
    assert trace["name"] == "run"
    assert trace["meta"] == {"description": "hi"}
    assert trace["graph"]["nodes"] == [{"id": "a"}]
    assert [m["id"] for m in trace["messages"]] == ["m1", "m2"]
    assert "type" not in trace and all("type" not in m for m in trace["messages"])


def test_message_meta_passes_through(tmp_path):
    p = tmp_path / "t.jsonl"
    p.write_text(
        _lines(HEADER, _msg("m1", meta={"outcome": "ok", "latency_ms": 320})),
        encoding="utf-8",
    )
    trace = load_trace_file(p)
    assert trace["messages"][0]["meta"] == {"outcome": "ok", "latency_ms": 320}


def test_node_timing_passes_through_and_old_steps_remain_compatible(tmp_path):
    old_step = {
        "id": "m1-s1", "nodeId": "a",
        "timestamp": "2026-09-15T10:00:00.000Z", "payloads": [],
    }
    timed_step = {
        **old_step,
        "id": "m2-s1",
        "endTimestamp": "2026-09-15T10:00:02.000Z",
        "timingMode": "explicit",
    }
    p = tmp_path / "t.jsonl"
    p.write_text(
        _lines(HEADER, _msg("m1", steps=[old_step]), _msg("m2", steps=[timed_step])),
        encoding="utf-8",
    )

    messages = load_trace_file(p)["messages"]
    assert "endTimestamp" not in messages[0]["steps"][0]
    assert "timingMode" not in messages[0]["steps"][0]
    assert messages[1]["steps"][0]["endTimestamp"] == timed_step["endTimestamp"]
    assert messages[1]["steps"][0]["timingMode"] == "explicit"


def test_kind_semantic_type_and_future_values_pass_through(tmp_path):
    step = {
        "id": "m1-s1",
        "nodeId": "a",
        "kind": "future-kind",
        "timestamp": "2026-09-15T10:00:00.000Z",
        "payloads": [
            {
                "label": "future",
                "value": {"x": 1},
                "semanticType": "future-semantic",
                "exportToOtel": False,
            }
        ],
    }
    p = tmp_path / "t.jsonl"
    p.write_text(_lines(HEADER, _msg("m1", steps=[step])), encoding="utf-8")
    loaded = load_trace_file(p)["messages"][0]["steps"][0]
    assert loaded == step


def test_header_only_part_is_a_valid_empty_trace(tmp_path):
    p = tmp_path / "t.jsonl"
    p.write_text(_lines(HEADER), encoding="utf-8")
    assert load_trace_file(p)["messages"] == []


def test_seal_next_part_lands_in_meta(tmp_path):
    p = tmp_path / "t.jsonl"
    p.write_text(
        _lines(HEADER, _msg("m1"), {"type": "seal", "nextPart": "t__part2.jsonl"}),
        encoding="utf-8",
    )
    assert load_trace_file(p)["meta"]["nextPart"] == "t__part2.jsonl"


def test_torn_final_line_is_dropped(tmp_path):
    # A crash mid-append leaves a truncated last line; everything before it
    # must still load.
    p = tmp_path / "t.jsonl"
    p.write_text(
        _lines(HEADER, _msg("m1")) + '{"type":"message","id":"m2","st',
        encoding="utf-8",
    )
    assert [m["id"] for m in load_trace_file(p)["messages"]] == ["m1"]


def test_corrupt_middle_line_is_skipped_not_fatal(tmp_path):
    p = tmp_path / "t.jsonl"
    p.write_text(
        _lines(HEADER, _msg("m1")) + "not json\n" + _lines(_msg("m3")),
        encoding="utf-8",
    )
    assert [m["id"] for m in load_trace_file(p)["messages"]] == ["m1", "m3"]


def test_unknown_record_types_are_ignored(tmp_path):
    # Forward compat: a future writer may add new line types.
    p = tmp_path / "t.jsonl"
    p.write_text(
        _lines(HEADER, {"type": "annotation", "text": "hm"}, _msg("m1")),
        encoding="utf-8",
    )
    assert [m["id"] for m in load_trace_file(p)["messages"]] == ["m1"]


def test_duplicate_message_id_keeps_last_content(tmp_path):
    p = tmp_path / "t.jsonl"
    first = _msg("m1", label="old")
    second = _msg("m1", label="new")
    p.write_text(_lines(HEADER, first, _msg("m2"), second), encoding="utf-8")

    trace = load_trace_file(p)
    by_id = {m["id"]: m for m in trace["messages"]}
    assert by_id["m1"]["label"] == "new"


def test_accepts_single_document_json(tmp_path):
    # Parity with the web viewer: a single-document AgentTraceFile (what
    # `wizardflow json` emits) loads as-is, no header line needed.
    p = tmp_path / "single.json"
    p.write_text(
        json.dumps(
            {
                "version": "0.2",
                "name": "run",
                "graph": {"nodes": [{"id": "a"}], "edges": []},
                "messages": [{"id": "m1", "steps": []}],
            }
        ),
        encoding="utf-8",
    )
    trace = load_trace_file(p)
    assert trace["name"] == "run"
    assert [m["id"] for m in trace["messages"]] == ["m1"]


def test_pretty_printed_single_document_json_loads(tmp_path):
    # `wizardflow json` writes indent=2, so line 1 is just "{" — must not be
    # mistaken for a (failed) JSONL header.
    p = tmp_path / "pretty.json"
    p.write_text(
        json.dumps(
            {"version": "0.2", "graph": {"nodes": [], "edges": []}, "messages": []},
            indent=2,
        ),
        encoding="utf-8",
    )
    assert load_trace_file(p)["messages"] == []


def test_missing_header_raises(tmp_path):
    p = tmp_path / "t.jsonl"
    p.write_text(_lines(_msg("m1")), encoding="utf-8")
    with pytest.raises(TraceFormatError):
        load_trace_file(p)


def test_empty_file_raises(tmp_path):
    p = tmp_path / "t.jsonl"
    p.write_text("", encoding="utf-8")
    with pytest.raises(TraceFormatError):
        load_trace_file(p)


def test_writer_output_round_trips_through_reader(tmp_path):
    from wizardflow import Client

    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"],
               name="roundtrip", description="d")
    c.log("m1", "a", "L", {"k": "v"})
    c.end_message("m1", title="First")

    assert load_trace_file(c.current_path) == c.to_dict()
