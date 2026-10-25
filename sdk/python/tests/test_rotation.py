"""rotation tests."""

import json
import os
from wizardflow import Client
from helpers import _log_one, _new, _read_part


# --- rotation -------------------------------------------------------------

def test_no_part_meta_for_single_part(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"])
    _log_one(c, "m1", "x")
    meta = c.to_dict().get("meta", {})
    assert "part" not in meta and "nextPart" not in meta


def test_rotation_creates_chained_parts(tmp_path):
    # Tiny cap so each message forces a new part.
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=400)
    for i in range(3):
        _log_one(c, f"m{i}", "X" * 300)

    parts = sorted(p for p in os.listdir(tmp_path) if p.endswith(".jsonl"))
    assert len(parts) >= 3                       # rotated into multiple files
    assert parts[0].startswith("t__") and "__part" not in parts[0]
    assert parts[1].endswith("__part2.jsonl")
    assert parts[2].endswith("__part3.jsonl")
    assert all(p.count(".") == 1 for p in parts)

    first_header, _, first_seal = _read_part(tmp_path / parts[0])
    second_header, _, second_seal = _read_part(tmp_path / parts[1])
    _, _, last_seal = _read_part(tmp_path / parts[2])
    # Each part opens with a full header (version + graph).
    assert first_header["version"] == "0.2"
    assert first_header["graph"]["nodes"] == [{"id": "a"}]
    # Forward chaining lives in the seal line; backward in the header meta.
    # Part 1's header stays clean (no part metadata).
    assert "part" not in first_header.get("meta", {})
    assert first_seal["nextPart"] == parts[1]
    assert second_header["meta"]["part"] == 2
    assert second_header["meta"]["prevPart"] == parts[0]
    assert second_seal["nextPart"] == parts[2]
    assert last_seal is None                     # active part: still unsealed


def test_rotation_by_message_count(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"],
               max_messages=2)
    for i in range(5):
        _log_one(c, f"m{i}", "x")

    parts = sorted(p for p in os.listdir(tmp_path) if p.endswith(".jsonl"))
    assert len(parts) == 3                       # 2 + 2 + 1 messages
    counts = [len(_read_part(tmp_path / p)[1]) for p in parts]
    assert counts == [2, 2, 1]


def test_each_message_lands_in_exactly_one_part(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=400)
    ids = [f"m{i}" for i in range(4)]
    for mid in ids:
        _log_one(c, mid, "X" * 300)

    seen = []
    for p in sorted(os.listdir(tmp_path)):
        if p.endswith(".jsonl"):
            seen.extend(m["id"] for m in _read_part(tmp_path / p)[1])
    assert sorted(seen) == sorted(ids)           # no message lost or duplicated


def test_oversized_single_message_gets_its_own_part(tmp_path):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=100)
    _log_one(c, "huge", "X" * 5000)              # one message alone exceeds cap
    data = c.to_dict()
    assert len(data["messages"]) == 1            # not dropped, just oversized


def test_rotation_logs_notice(tmp_path, caplog):
    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=400)
    with caplog.at_level("INFO", logger="wizardflow"):
        for i in range(2):
            _log_one(c, f"m{i}", "X" * 300)
    assert any("rotated" in r.message for r in caplog.records)


def test_max_bytes_clamped_to_ceiling(tmp_path):
    from wizardflow.constants import Rotation

    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=999_000_000)
    assert c.max_bytes == Rotation.MAX_MAX_BYTES          # never honored above cap
    # A value within range is left untouched.
    c2 = Client(output_dir=str(tmp_path), file_prefix="t2", nodes=["a"], max_bytes=50_000)
    assert c2.max_bytes == 50_000


def test_concurrent_message_ends_are_safe(tmp_path):
    # Multi-agent setups end messages from many threads at once. The write lock
    # must keep the shared part files race-free: every line stays valid JSON,
    # every message lands exactly once. A tiny cap forces frequent rotation to
    # stress the boundary.
    import threading

    c = Client(output_dir=str(tmp_path), file_prefix="t", nodes=["a"], max_bytes=2_000)
    n = 100

    def worker(i):
        _log_one(c, f"m{i}", "X" * 100)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    seen = []
    for p in sorted(os.listdir(tmp_path)):
        if p.endswith(".jsonl"):
            header, messages, _ = _read_part(tmp_path / p)
            assert header is not None            # every part opens with a header
            seen.extend(m["id"] for m in messages)
    assert sorted(seen) == sorted(f"m{i}" for i in range(n))  # all once, none lost
