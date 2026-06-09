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
    _make_handler,
    _resolve_trace_path,
    _validate_trace_file,
    _viewer_url,
)


def _write_trace(path):
    path.write_text(
        json.dumps(
            {
                "version": "0.1",
                "graph": {"nodes": [], "edges": []},
                "messages": [],
            }
        ),
        encoding="utf-8",
    )


def test_trace_shape_check_matches_minimal_agent_trace():
    assert _is_agent_trace_file(
        {"graph": {"nodes": [], "edges": []}, "messages": []}
    )
    assert not _is_agent_trace_file({"graph": {"nodes": []}, "messages": []})


def test_resolve_trace_path_accepts_positional_or_path(tmp_path):
    trace = tmp_path / "trace.json"
    _write_trace(trace)

    assert _resolve_trace_path(trace=str(trace), path=None) == trace.resolve()
    assert _resolve_trace_path(trace=None, path=str(trace)) == trace.resolve()


def test_resolve_trace_path_rejects_ambiguous_input(tmp_path):
    trace = tmp_path / "trace.json"
    _write_trace(trace)

    with pytest.raises(WizardFlowCliError):
        _resolve_trace_path(trace=str(trace), path=str(trace))


def test_validate_trace_file_rejects_non_trace_json(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")

    with pytest.raises(WizardFlowCliError):
        _validate_trace_file(bad)


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

    trace = tmp_path / "trace.json"
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

    assert payload["graph"] == {"nodes": [], "edges": []}
