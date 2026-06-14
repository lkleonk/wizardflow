"""Tests for the AgentTrace -> Markdown renderer and the `wizardflow md` CLI."""

import json

import pytest

from wizardflow.cli import WizardFlowCliError, run_md
from wizardflow.markdown import render_markdown


def _trace(**overrides):
    base = {
        "version": "0.1",
        "name": "consultant.json",
        "meta": {"description": "a demo run", "framework": "langgraph"},
        "graph": {
            "nodes": [{"id": "router"}, {"id": "planner", "label": "Planner"}],
            "edges": [
                {"source": "router", "target": "planner", "conditional": True},
            ],
        },
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
                        ],
                    }
                ],
            }
        ],
    }
    base.update(overrides)
    return base


def _write_jsonl(path, trace):
    """Write an assembled trace dict as the JSONL part the CLI reads."""
    header = {"type": "header", **{k: v for k, v in trace.items() if k != "messages"}}
    records = [header] + [{"type": "message", **m} for m in trace["messages"]]
    path.write_text(
        "".join(json.dumps(r) + "\n" for r in records), encoding="utf-8"
    )


# --- header & meta --------------------------------------------------------

def test_title_uses_name_then_fallback():
    assert render_markdown(_trace()).startswith("# consultant.json")
    no_name = _trace()
    del no_name["name"]
    assert render_markdown(no_name, fallback_title="run.json").startswith("# run.json")


def test_description_becomes_blockquote_and_leaves_table():
    md = render_markdown(_trace())
    assert "> a demo run" in md
    assert "| version | 0.1 |" in md
    assert "| framework | langgraph |" in md
    assert "| description |" not in md  # description is the blockquote, not a row


# --- graph ----------------------------------------------------------------

def test_mermaid_marks_conditional_edge_dashed_and_uses_labels():
    md = render_markdown(_trace())
    assert "```mermaid" in md
    assert "## Graph" in md
    assert '"Planner"' in md          # node label preferred over id
    assert "-.->" in md               # the conditional edge is dashed

def test_mermaid_omitted_when_disabled():
    md = render_markdown(_trace(), mermaid=False)
    assert "```mermaid" not in md and "## Graph" not in md


def test_mermaid_skipped_for_empty_graph():
    md = render_markdown(_trace(graph={"nodes": [], "edges": []}))
    assert "```mermaid" not in md


# --- messages & payload value typing --------------------------------------

def test_message_and_step_headings():
    md = render_markdown(_trace())
    assert "## First message" in md
    assert "### router · 14:30:22" in md     # timestamp reduced to clock time


def test_scalar_inline_structured_fenced():
    md = render_markdown(_trace())
    assert "**decision**: `planner`" in md          # scalar inline
    assert '**ctx**\n\n```json' in md               # dict in a json fence


def test_multiline_string_uses_fence_not_inline():
    md = render_markdown(_trace(messages=[{
        "id": "m", "steps": [{
            "id": "m-s1", "nodeId": "a", "timestamp": "2026-06-08T09:00:00Z",
            "payloads": [{"label": "log", "value": "line one\nline two"}],
        }],
    }]))
    assert "**log**\n\n```\nline one\nline two\n```" in md


def test_fence_grows_to_outlast_backticks_in_value():
    md = render_markdown(_trace(messages=[{
        "id": "m", "steps": [{
            "id": "m-s1", "nodeId": "a", "timestamp": "2026-06-08T09:00:00Z",
            "payloads": [{"label": "code", "value": "a ``` b"}],
        }],
    }]))
    assert "````\na ``` b\n````" in md  # 4-backtick fence around a 3-backtick run


def test_json_spellings_for_bool_and_none():
    md = render_markdown(_trace(messages=[{
        "id": "m", "steps": [{
            "id": "m-s1", "nodeId": "a", "timestamp": "2026-06-08T09:00:00Z",
            "payloads": [
                {"label": "ok", "value": True},
                {"label": "missing", "value": None},
            ],
        }],
    }]))
    assert "**ok**: `true`" in md and "**missing**: `null`" in md


def test_bare_visit_step_has_heading_no_payloads():
    md = render_markdown(_trace(messages=[{
        "id": "m", "steps": [{
            "id": "m-s1", "nodeId": "tool", "timestamp": "2026-06-08T09:00:00Z",
            "payloads": [],
        }],
    }]))
    assert "### tool · 09:00:00" in md


# --- CLI wiring -----------------------------------------------------------

def test_run_md_writes_file(tmp_path, capsys):
    trace = tmp_path / "t.jsonl"
    _write_jsonl(trace, _trace())
    out = tmp_path / "t.md"

    rc = run_md(trace=str(trace), path=None, output=str(out), mermaid=True)
    assert rc == 0
    assert out.read_text(encoding="utf-8").startswith("# consultant.json")
    assert "Wrote" in capsys.readouterr().out


def test_run_md_writes_stdout(tmp_path, capsys):
    trace = tmp_path / "t.jsonl"
    _write_jsonl(trace, _trace())

    rc = run_md(trace=str(trace), path=None, output=None, mermaid=False)
    assert rc == 0
    assert capsys.readouterr().out.startswith("# consultant.json")


def test_run_md_rejects_non_trace_json(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")
    with pytest.raises(WizardFlowCliError):
        run_md(trace=str(bad), path=None, output=None, mermaid=True)
