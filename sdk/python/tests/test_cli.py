import json
import threading
from http.server import ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

import pytest

from wizardflow.cli import (
    TRACE_ROUTE,
    WizardFlowCliError,
    _is_agent_trace_file,
    _load_trace,
    _make_handler,
    _resolve_trace_path,
    _viewer_url,
    run_json,
)


def _write_trace(path):
    lines = [
        {"type": "header", "version": "0.2", "graph": {"nodes": [], "edges": []}},
        {"type": "message", "id": "m1", "steps": []},
    ]
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
