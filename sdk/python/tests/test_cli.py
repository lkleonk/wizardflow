import json
import os
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

import pytest

from wizardflow.cli import (
    TRACE_ROUTE,
    WizardFlowCliError,
    _is_agent_trace_file,
    _load_trace,
    _make_handler,
    _resolve_trace_path,
    _sibling_part,
    _viewer_url,
    run_json,
)


def _write_trace(path, *, message_id="m1", part=None, next_part=None):
    header = {"type": "header", "version": "0.2", "graph": {"nodes": [], "edges": []}}
    if part is not None:
        header["meta"] = {"part": part}
    lines = [header, {"type": "message", "id": message_id, "steps": []}]
    if next_part is not None:
        lines.append({"type": "seal", "nextPart": next_part})
    path.write_text(
        "".join(json.dumps(line) + "\n" for line in lines),
        encoding="utf-8",
    )


def test_trace_shape_check_matches_minimal_agent_trace():
    assert _is_agent_trace_file(
        {"graph": {"nodes": [], "edges": []}, "messages": []}
    )
    assert not _is_agent_trace_file({"graph": {"nodes": []}, "messages": []})


def test_resolve_trace_path_accepts_positional_or_path(tmp_path):
    trace = tmp_path / "trace.jsonl"
    _write_trace(trace)

    assert _resolve_trace_path(trace=str(trace), path=None) == trace.resolve()
    assert _resolve_trace_path(trace=None, path=str(trace)) == trace.resolve()


def test_resolve_trace_path_latest_picks_most_recently_modified(tmp_path):
    older = tmp_path / "run1.jsonl"
    newer = tmp_path / "run1__part1.jsonl"
    other = tmp_path / "notes.txt"
    _write_trace(older)
    _write_trace(newer)
    other.write_text("not a trace", encoding="utf-8")
    # Deterministic mtimes: the rotated part is the newest file — "literally
    # the latest modified" wins, because during a live run the active part is
    # the one still being written to.
    os.utime(older, (1_000, 1_000))
    os.utime(newer, (2_000, 2_000))

    resolved = _resolve_trace_path(trace=str(tmp_path), path=None, latest=True)
    assert resolved == newer.resolve()


def test_resolve_trace_path_latest_defaults_to_cwd(tmp_path, monkeypatch):
    trace = tmp_path / "run.jsonl"
    _write_trace(trace)
    monkeypatch.chdir(tmp_path)

    resolved = _resolve_trace_path(trace=None, path=None, latest=True)
    assert resolved == trace.resolve()


def test_resolve_trace_path_latest_rejects_files_and_empty_dirs(tmp_path):
    trace = tmp_path / "run.jsonl"
    _write_trace(trace)

    with pytest.raises(WizardFlowCliError, match="expects a directory"):
        _resolve_trace_path(trace=str(trace), path=None, latest=True)

    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(WizardFlowCliError, match="no trace files"):
        _resolve_trace_path(trace=str(empty), path=None, latest=True)


def test_resolve_trace_path_rejects_ambiguous_input(tmp_path):
    trace = tmp_path / "trace.jsonl"
    _write_trace(trace)

    with pytest.raises(WizardFlowCliError):
        _resolve_trace_path(trace=str(trace), path=str(trace))


def test_load_trace_rejects_non_trace_file(tmp_path):
    bad = tmp_path / "bad.jsonl"
    bad.write_text("{}", encoding="utf-8")     # no header record

    with pytest.raises(WizardFlowCliError):
        _load_trace(bad)


def test_load_trace_accepts_single_document_json(tmp_path):
    # The SDK *writes* JSONL only, but the converters read both framings — at
    # parity with the website — so `wizardflow json` output (and old
    # single-document traces) can be fed back into ui/md/html/json.
    doc = tmp_path / "single.json"
    doc.write_text(
        json.dumps(
            {
                "version": "0.2",
                "graph": {"nodes": [], "edges": []},
                "messages": [{"id": "m1", "steps": []}],
            }
        ),
        encoding="utf-8",
    )

    data = _load_trace(doc)
    assert [m["id"] for m in data["messages"]] == ["m1"]


def test_load_trace_assembles_messages(tmp_path):
    trace = tmp_path / "trace.jsonl"
    _write_trace(trace)

    data = _load_trace(trace)
    assert data["version"] == "0.2"
    assert [m["id"] for m in data["messages"]] == ["m1"]


def test_run_json_assembles_and_pretty_prints(tmp_path, capsys):
    trace = tmp_path / "trace.jsonl"
    _write_trace(trace)
    out = tmp_path / "trace.json"

    rc = run_json(trace=str(trace), path=None, output=str(out))
    assert rc == 0
    text = out.read_text(encoding="utf-8")
    assert "\n  " in text                       # indented (not the compact JSONL)
    # Round-trips to the assembled AgentTraceFile.
    assert json.loads(text) == _load_trace(trace)
    assert "Wrote" in capsys.readouterr().out


def test_run_json_writes_stdout(tmp_path, capsys):
    trace = tmp_path / "trace.jsonl"
    _write_trace(trace)

    rc = run_json(trace=str(trace), path=None, output=None)
    assert rc == 0
    assert json.loads(capsys.readouterr().out) == _load_trace(trace)


def test_viewer_url_points_at_same_origin_trace_route():
    url = _viewer_url(host="0.0.0.0", port=4321, trace_name="run 1.json")
    parsed = urlparse(url)

    assert parsed.netloc == "127.0.0.1:4321"
    assert parse_qs(parsed.query) == {
        "trace": [TRACE_ROUTE],
        "traceName": ["run 1.json"],
    }


def test_local_handler_serves_ui_and_trace(tmp_path):
    ui_dir = tmp_path / "ui"
    ui_dir.mkdir()
    (ui_dir / "index.html").write_text("WizardFlow local UI", encoding="utf-8")

    trace = tmp_path / "trace.jsonl"
    _write_trace(trace)

    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        _make_handler(ui_dir=ui_dir, trace_path=trace),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"

    try:
        assert (
            urlopen(f"{base_url}/", timeout=5).read().decode("utf-8")
            == "WizardFlow local UI"
        )
        payload = json.loads(
            urlopen(f"{base_url}{TRACE_ROUTE}", timeout=5).read().decode("utf-8")
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    # The route serves the *assembled* AgentTraceFile JSON, not raw JSONL —
    # the bundled static UI only ever sees plain JSON.
    assert payload["graph"] == {"nodes": [], "edges": []}
    assert [m["id"] for m in payload["messages"]] == ["m1"]


def test_handler_serves_a_neighbouring_part_by_name(tmp_path):
    # The viewer walks a rotated run by resolving meta.nextPart / meta.prevPart
    # against the trace URL, so the other parts must be reachable by file name.
    ui_dir = tmp_path / "ui"
    ui_dir.mkdir()
    (ui_dir / "index.html").write_text("ui", encoding="utf-8")

    first = tmp_path / "run.jsonl"
    second = tmp_path / "run__part2.jsonl"
    _write_trace(first, message_id="m1", next_part=second.name)
    _write_trace(second, message_id="m2", part=2)

    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        _make_handler(ui_dir=ui_dir, trace_path=first),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"

    try:
        sealed = json.loads(
            urlopen(f"{base_url}{TRACE_ROUTE}", timeout=5).read().decode("utf-8")
        )
        served = json.loads(
            urlopen(f"{base_url}/{second.name}", timeout=5).read().decode("utf-8")
        )
        with pytest.raises(HTTPError) as excinfo:
            urlopen(f"{base_url}/missing.jsonl", timeout=5)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert sealed["meta"]["nextPart"] == second.name
    assert [m["id"] for m in served["messages"]] == ["m2"]
    assert served["meta"]["part"] == 2
    assert excinfo.value.code == 404


def test_sibling_part_rejects_traversal_and_foreign_files(tmp_path):
    ui_dir = tmp_path / "ui"
    ui_dir.mkdir()
    (ui_dir / "manifest.json").write_text("{}", encoding="utf-8")
    traces = tmp_path / "traces"
    traces.mkdir()
    trace = traces / "run.jsonl"
    _write_trace(trace)
    _write_trace(traces / "run__part2.jsonl", message_id="m2")
    (tmp_path / "outside.jsonl").write_text("{}", encoding="utf-8")

    assert _sibling_part(trace, "/run__part2.jsonl", ui_dir) is not None
    # Escaping the trace's own directory, reading non-traces, and shadowing a
    # bundled UI asset are all refused.
    assert _sibling_part(trace, "/../outside.jsonl", ui_dir) is None
    assert _sibling_part(trace, "/etc/passwd", ui_dir) is None
    assert _sibling_part(trace, "/run.txt", ui_dir) is None
    assert _sibling_part(trace, "/manifest.json", ui_dir) is None
    assert _sibling_part(trace, "/", ui_dir) is None


def test_trace_route_revalidates_with_etag(tmp_path):
    # The UI's live-update poller sends If-None-Match: an unchanged file must
    # answer 304 (no body), and an appended message must produce a new ETag
    # with the fresh assembly.
    ui_dir = tmp_path / "ui"
    ui_dir.mkdir()
    (ui_dir / "index.html").write_text("ui", encoding="utf-8")

    trace = tmp_path / "trace.jsonl"
    _write_trace(trace)

    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        _make_handler(ui_dir=ui_dir, trace_path=trace),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    trace_url = f"http://127.0.0.1:{server.server_port}{TRACE_ROUTE}"

    try:
        first = urlopen(trace_url, timeout=5)
        etag = first.headers["ETag"]
        assert etag
        assert [m["id"] for m in json.loads(first.read())["messages"]] == ["m1"]

        with pytest.raises(HTTPError) as excinfo:
            urlopen(
                Request(trace_url, headers={"If-None-Match": etag}), timeout=5
            )
        assert excinfo.value.code == 304

        with trace.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"type": "message", "id": "m2", "steps": []}) + "\n")

        second = urlopen(
            Request(trace_url, headers={"If-None-Match": etag}), timeout=5
        )
        assert second.headers["ETag"] != etag
        assert [m["id"] for m in json.loads(second.read())["messages"]] == [
            "m1",
            "m2",
        ]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
