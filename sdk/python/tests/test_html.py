"""Tests for the AgentTrace -> HTML renderer and the `wizardflow html` CLI."""

import json

import pytest

from wizardflow.cli import WizardFlowCliError, run_html
from wizardflow.html import render_html


def _trace(**overrides):
    base = {
        "version": "0.1",
        "name": "consultant.json",
        "meta": {"description": "a demo run", "framework": "langgraph"},
        "graph": {"nodes": [{"id": "router"}], "edges": []},
        "messages": [
            {
                "id": "m1",
                "label": "First message",
                "steps": [
                    {
                        "id": "m1-s1",
                        "nodeId": "router",
                        "timestamp": "2026-06-08T14:30:22.123Z",
                        "payloads": [
                            {"label": "decision", "value": "planner"},
                            {"label": "ctx", "value": {"q": "hi", "n": 1}},
                            {"label": "ok", "value": True},
                        ],
                    }
                ],
            }
        ],
    }
    base.update(overrides)
    return base


# --- document shape -------------------------------------------------------

def test_renders_standalone_document():
    html = render_html(_trace())
    assert html.startswith("<!doctype html>")
    assert "<title>consultant.json</title>" in html
    assert "<style>" in html and "</style>" in html
    assert html.rstrip().endswith("</html>")


def test_no_javascript_or_external_assets():
    html = render_html(_trace())
    assert "<script" not in html
    assert "http://" not in html and "https://" not in html


def test_no_graph_section():
    # HTML export is messages-only by design — no Mermaid, no graph.
    html = render_html(_trace())
    assert "mermaid" not in html.lower()


def test_title_falls_back_to_filename():
    no_name = _trace()
    del no_name["name"]
    assert "<title>run.json</title>" in render_html(no_name, fallback_title="run.json")


# --- header & meta --------------------------------------------------------

def test_description_blockquote_and_meta_rows():
    html = render_html(_trace())
    assert "<blockquote>a demo run</blockquote>" in html
    assert "<th>version</th><td>0.1</td>" in html
    assert "<th>framework</th><td>langgraph</td>" in html
    assert "<th>description</th>" not in html  # description is the blockquote


# --- messages & payload typing --------------------------------------------

def test_message_and_step_headings():
    html = render_html(_trace())
    assert "<h2>First message</h2>" in html
    assert 'router <span class="time">· 14:30:22</span>' in html


def test_scalar_inline_structured_pre_and_json_spellings():
    html = render_html(_trace())
    assert "<code>planner</code>" in html                 # scalar string inline
    assert "<code>true</code>" in html                    # bool -> JSON spelling
    assert "<pre><code>" in html and "&quot;q&quot;" in html  # dict in escaped <pre>


def test_multiline_string_uses_pre_without_code():
    html = render_html(_trace(messages=[{
        "id": "m", "steps": [{
            "id": "m-s1", "nodeId": "a", "timestamp": "2026-06-08T09:00:00Z",
            "payloads": [{"label": "log", "value": "line one\nline two"}],
        }],
    }]))
    assert "<pre>line one\nline two</pre>" in html


def test_html_in_values_is_escaped_not_executed():
    html = render_html(_trace(messages=[{
        "id": "m", "steps": [{
            "id": "m-s1", "nodeId": "a", "timestamp": "2026-06-08T09:00:00Z",
            "payloads": [{"label": "danger", "value": "<script>alert(1)</script>"}],
        }],
    }]))
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


# --- CLI wiring -----------------------------------------------------------

def test_run_html_writes_file(tmp_path, capsys):
    trace = tmp_path / "t.json"
    trace.write_text(json.dumps(_trace()), encoding="utf-8")
    out = tmp_path / "t.html"

    rc = run_html(trace=str(trace), path=None, output=str(out))
    assert rc == 0
    assert out.read_text(encoding="utf-8").startswith("<!doctype html>")
    assert "Wrote" in capsys.readouterr().out


def test_run_html_writes_stdout(tmp_path, capsys):
    trace = tmp_path / "t.json"
    trace.write_text(json.dumps(_trace()), encoding="utf-8")

    rc = run_html(trace=str(trace), path=None, output=None)
    assert rc == 0
    assert capsys.readouterr().out.startswith("<!doctype html>")


def test_run_html_rejects_non_trace_json(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")
    with pytest.raises(WizardFlowCliError):
        run_html(trace=str(bad), path=None, output=None)
