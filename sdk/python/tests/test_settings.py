"""Settings writes (attribute mapping + re-index), coverage, groups, activity."""

import pytest

from otlp_builders import TRACE_A, TRACE_B, lines, span, traces_request
from wizardflow.store import import_otlp_text, open_store
from wizardflow.store import queries
from wizardflow.store.mapping import load_mapping
from wizardflow.store.queries import QueryError
from wizardflow.store.schema import FLAG_WIZARDFLOW
from wizardflow.store.settings import (
    DEFAULT_MAPPING,
    mapping_coverage,
    reset_mapping,
    save_mapping,
)

TRACE_C = "c" * 32
HOUR = 3600 * 1_000_000_000


@pytest.fixture
def con(tmp_path):
    connection = open_store(tmp_path / "store.db")
    import_otlp_text(connection, lines(
        traces_request([
            span("1" * 16, name="AgentExecutor", start=10 * HOUR, end=10 * HOUR + 5,
                 attributes={"session.id": "conv-1", "openinference.span.kind": "AGENT"}),
            span("2" * 16, parent="1" * 16, start=10 * HOUR + 1, end=10 * HOUR + 2,
                 attributes={"tool.name": "search", "llm.model_name": "gpt-x",
                             "input.value": "hi"}),
        ], service="bot"),
        traces_request([
            span("3" * 16, trace_id=TRACE_B, name="AgentExecutor", start=11 * HOUR, end=11 * HOUR + 5,
                 attributes={"session.id": "conv-1"}, status=2),
        ], service="bot"),
        traces_request([
            span("4" * 16, trace_id=TRACE_C, name="GET /health", start=12 * HOUR, end=12 * HOUR + 5),
        ], service="bot"),
    ))
    yield connection
    connection.close()


def _flags(con, trace_id):
    return con.execute("SELECT flags FROM traces WHERE trace_id = ?", (trace_id,)).fetchone()[0]


def test_default_mapping_matches_the_seeded_rows(con):
    assert load_mapping(con, None) == DEFAULT_MAPPING


def test_project_override_reindexes_existing_spans(con):
    assert not _flags(con, TRACE_A) & FLAG_WIZARDFLOW
    result = save_mapping(con, "bot", {"node": ["tool.name"]})
    assert result == {"traces": 3, "replayable": 1}
    assert _flags(con, TRACE_A) & FLAG_WIZARDFLOW
    node = con.execute("SELECT node_id FROM spans WHERE span_id = ?", ("2" * 16,)).fetchone()[0]
    assert node == "search"
    assert queries.get_settings(con)["mapping"]["overrides"] == {"bot": {"node": ["tool.name"]}}


def test_override_equal_to_defaults_is_dropped(con):
    save_mapping(con, "bot", {"node": ["tool.name"]})
    save_mapping(con, "bot", {"node": list(DEFAULT_MAPPING["node"])})
    assert queries.get_settings(con)["mapping"]["overrides"] == {}


def test_defaults_change_reindexes_conversations_and_reset_restores(con):
    save_mapping(con, None, {"conversation": []})
    assert con.execute("SELECT count(*) FROM traces WHERE conversation_id IS NOT NULL").fetchone()[0] == 0
    reset_mapping(con, None)
    assert load_mapping(con, None) == DEFAULT_MAPPING
    assert con.execute("SELECT count(*) FROM traces WHERE conversation_id = 'conv-1'").fetchone()[0] == 2


def test_reset_of_a_project_removes_its_overrides(con):
    save_mapping(con, "bot", {"node": ["tool.name"]})
    reset_mapping(con, "bot")
    assert not _flags(con, TRACE_A) & FLAG_WIZARDFLOW


@pytest.mark.parametrize("project, mapping, message", [
    (None, {"nope": []}, "unknown concept"),
    ("bot", {"project": ["x"]}, "global only"),
    (None, {"node": "tool.name"}, "list of strings"),
    (None, {"node": ["has space"]}, "not an attribute key"),
    (None, {"node": ["a", "a"]}, "listed twice"),
    (None, {}, "mapping must be"),
])
def test_invalid_mappings_are_refused(con, project, mapping, message):
    with pytest.raises(QueryError, match=message):
        save_mapping(con, project, mapping)


def test_failed_save_changes_nothing(con):
    with pytest.raises(LookupError):
        save_mapping(con, "no-such-project", {"node": ["tool.name"]})
    assert queries.get_settings(con)["mapping"]["overrides"] == {}


def test_coverage_counts_what_the_saved_mapping_matches(con):
    coverage = mapping_coverage(con, "bot")
    assert coverage["conversation"] == {"matched": 2, "total": 3, "unit": "traces"}
    assert coverage["model"]["matched"] == 1
    assert coverage["input"]["matched"] == 1
    assert coverage["node"]["matched"] == 0
    save_mapping(con, None, {"payloads": ["tool.*"]})
    assert mapping_coverage(con, None)["payloads"]["matched"] == 1
    # Node kind counts node spans only: the AGENT root has a kind but no node.
    save_mapping(con, "bot", {"node": ["tool.name"]})
    assert mapping_coverage(con, "bot")["node_kind"] == {"matched": 0, "total": 1, "unit": "node spans"}


def test_conversation_groups_newest_first_with_ungrouped_last(con):
    page = queries.list_conversation_groups(con, "bot")
    conv, loose = page["items"]
    assert conv["conversationId"] == "conv-1"
    assert (conv["traceCount"], conv["errorTraceCount"]) == (2, 1)
    assert loose["conversationId"] is None and loose["traceCount"] == 1
    assert not page["hasMore"]
    members = queries.list_traces(con, "bot", conversation="conv-1")["items"]
    assert [t["traceId"] for t in members] == [TRACE_B, TRACE_A]
    loose_traces = queries.list_traces(con, "bot", no_conversation=True)["items"]
    assert [t["traceId"] for t in loose_traces] == [TRACE_C]


def test_activity_is_anchored_to_the_last_trace_for_old_data(con):
    (project,) = queries.list_projects(con, now_ns=1000 * HOUR)
    activity = project["activity"]
    assert activity["anchor"] == "last"
    assert sum(activity["traces"]) == 3 and sum(activity["errors"]) == 1
    assert activity["traces"][-1] == 1  # the newest trace is in the last slot
    (recent,) = queries.list_projects(con, now_ns=12 * HOUR + 10)
    assert recent["activity"]["anchor"] == "now"


def test_activity_counts_future_traces_in_the_newest_slot(con):
    # The sender's clock runs ahead: every trace starts after "now".
    (project,) = queries.list_projects(con, now_ns=9 * HOUR)
    activity = project["activity"]
    assert activity["anchor"] == "now"
    assert activity["traces"][-1] == 3 and activity["errors"][-1] == 1
    assert sum(activity["traces"]) == 3
