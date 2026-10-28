"""The local OTel store: opening/migrating, OTLP JSON parsing, importing."""

import base64
import json
import sqlite3

import pytest

from wizardflow.store import (
    OtlpFormatError,
    StoreError,
    default_db_path,
    import_otlp_file,
    import_otlp_text,
    open_store,
)
from wizardflow.store.otlp import any_value, iter_logs, iter_requests, iter_spans, otel_id
from wizardflow.store.schema import (
    FLAG_CROSS_PROJECT,
    FLAG_GENAI,
    FLAG_MULTI_TOP,
    FLAG_PARENT_OUTSIDE,
    FLAG_TOPOLOGY,
    FLAG_WIZARDFLOW,
    LATEST_VERSION,
)

TRACE_A = "a" * 32
TRACE_B = "b" * 32


# --------------------------------------------------------------------------- builders


def _value(v):
    if isinstance(v, bool):
        return {"boolValue": v}
    if isinstance(v, int):
        return {"intValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [_value(x) for x in v]}}
    if isinstance(v, dict):
        return {"kvlistValue": {"values": _attrs(v)}}
    return {"stringValue": v}


def _attrs(d):
    return [{"key": k, "value": _value(v)} for k, v in d.items()]


def _span(span_id, *, trace_id=TRACE_A, parent=None, name=None, start=100, end=200,
          attrs=None, status=0, events=None):
    span = {
        "traceId": trace_id,
        "spanId": span_id,
        "name": name or span_id,
        "kind": 1,
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(end),
        "attributes": _attrs(attrs or {}),
        "status": {"code": status},
    }
    if parent:
        span["parentSpanId"] = parent
    if events:
        span["events"] = [
            {"timeUnixNano": str(t), "name": n, "attributes": _attrs(a)} for t, n, a in events
        ]
    return span


def _traces_request(spans, *, service="svc", resource_attrs=None):
    attrs = {"service.name": service, **(resource_attrs or {})}
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": _attrs(attrs)},
                "scopeSpans": [{"scope": {"name": "test-scope", "version": "1"}, "spans": spans}],
            }
        ]
    }


def _logs_request(records, *, service="svc"):
    return {
        "resourceLogs": [
            {
                "resource": {"attributes": _attrs({"service.name": service})},
                "scopeLogs": [{"scope": {"name": "logger"}, "logRecords": records}],
            }
        ]
    }


def _lines(*requests):
    return "\n".join(json.dumps(r) for r in requests) + "\n"


@pytest.fixture
def con(tmp_path):
    connection = open_store(tmp_path / "store.db")
    yield connection
    connection.close()


def _trace(con, project, trace_id=TRACE_A):
    row = con.execute(
        "SELECT t.* FROM traces t JOIN projects p ON p.id = t.project_id "
        "WHERE p.name = ? AND t.trace_id = ?",
        (project, trace_id),
    )
    names = [d[0] for d in row.description]
    values = row.fetchone()
    return dict(zip(names, values)) if values else None


# --------------------------------------------------------------------------- db


def test_new_store_has_schema_wal_and_incremental_vacuum(tmp_path):
    con = open_store(tmp_path / "x.db")
    assert con.execute("PRAGMA user_version").fetchone()[0] == LATEST_VERSION
    assert con.execute("PRAGMA auto_vacuum").fetchone()[0] == 2
    assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert con.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert con.execute("SELECT count(*) FROM attribute_mappings").fetchone()[0] == 12
    con.close()


def test_reopening_is_idempotent(tmp_path):
    path = tmp_path / "x.db"
    open_store(path).close()
    con = open_store(path)
    assert con.execute("SELECT count(*) FROM attribute_mappings").fetchone()[0] == 12
    con.close()
    assert not list(tmp_path.glob("*.bak"))


def test_default_folder_gets_a_gitignore_but_custom_paths_do_not(tmp_path):
    default = default_db_path(tmp_path)
    open_store(default).close()
    assert (default.parent / ".gitignore").read_text(encoding="utf-8").strip().endswith("*")

    custom = tmp_path / "elsewhere" / "mine.db"
    open_store(custom).close()
    assert not (custom.parent / ".gitignore").exists()


def test_newer_schema_is_refused(tmp_path):
    path = tmp_path / "x.db"
    open_store(path).close()
    raw = sqlite3.connect(str(path))
    raw.execute(f"PRAGMA user_version = {LATEST_VERSION + 1}")
    raw.close()
    with pytest.raises(StoreError, match="upgrade wizardflow"):
        open_store(path)


def test_missing_store_without_create(tmp_path):
    with pytest.raises(StoreError, match="no WizardFlow database"):
        open_store(tmp_path / "nope.db", create=False)


def test_every_foreign_key_column_is_indexed(con):
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
    missing = []
    for table in tables:
        leading = set()
        for index in con.execute(f"PRAGMA index_list('{table}')"):
            cols = [c[2] for c in con.execute(f"PRAGMA index_info('{index[1]}')")]
            if cols and cols[0]:
                leading.add(cols[0])
        for fk in con.execute(f"PRAGMA foreign_key_list('{table}')"):
            if fk[3] not in leading:
                missing.append(f"{table}.{fk[3]}")
    assert missing == []


# --------------------------------------------------------------------------- otlp


def test_ids_accept_hex_and_base64_and_reject_zero_or_wrong_size():
    raw = bytes.fromhex("0af7651916cd43dd8448eb211c80319c")
    assert otel_id(raw.hex().upper(), 16) == raw.hex()
    assert otel_id(base64.b64encode(raw).decode(), 16) == raw.hex()
    assert otel_id("0" * 32, 16) is None
    assert otel_id("abc", 16) is None
    assert otel_id("", 8) is None


def test_any_value_flattens_nested_values():
    assert any_value({"intValue": "42"}) == 42
    assert any_value({"arrayValue": {"values": [{"stringValue": "a"}, {"boolValue": True}]}}) == ["a", True]
    assert any_value({"kvlistValue": {"values": _attrs({"k": 1.5})}}) == {"k": 1.5}
    assert any_value({}) is None


def test_enum_names_and_old_key_names_are_understood():
    request = {
        "resourceSpans": [{
            "resource": {"attributes": []},
            "instrumentationLibrarySpans": [{
                "instrumentationLibrary": {"name": "old"},
                "spans": [{
                    "traceId": TRACE_A, "spanId": "1" * 16, "name": "s",
                    "kind": "SPAN_KIND_SERVER", "status": {"code": "STATUS_CODE_ERROR"},
                    "startTimeUnixNano": 1, "endTimeUnixNano": 2,
                }],
            }],
        }],
        "resourceLogs": [{
            "resource": {"attributes": []},
            "scopeLogs": [{"logRecords": [{"severityNumber": "SEVERITY_NUMBER_WARN2",
                                           "body": {"stringValue": "hi"}}]}],
        }],
    }
    (span,) = list(iter_spans(request))
    assert (span.kind, span.status_code, span.scope.name) == (2, 2, "old")
    (log,) = list(iter_logs(request))
    assert (log.severity_number, log.body, log.trace_id) == (14, "hi", None)


def test_single_pretty_printed_document_is_accepted():
    text = json.dumps(_traces_request([_span("1" * 16)]), indent=2)
    assert len(list(iter_requests(text))) == 1


def test_non_otlp_input_fails_with_a_location():
    with pytest.raises(OtlpFormatError, match="line 2"):
        list(iter_requests('{"resourceSpans": []}\n{"type": "header"}\n'))


# --------------------------------------------------------------------------- importer


def test_import_builds_trace_with_root_counts_and_flags(con, tmp_path):
    spans = [
        _span("1" * 16, name="invoke_workflow advisor", start=100, end=900,
              attrs={"gen_ai.operation.name": "invoke_workflow", "session.id": "chat-1"},
              events=[(101, "wizardflow.graph", {"wizardflow.graph.node_count": 2})]),
        _span("2" * 16, parent="1" * 16, start=150, end=400,
              attrs={"wizardflow.node.id": "classifier", "gen_ai.request.model": "m1",
                     "gen_ai.usage.input_tokens": 10, "gen_ai.usage.output_tokens": 3}),
        _span("3" * 16, parent="1" * 16, start=450, end=800, status=2,
              attrs={"wizardflow.node.id": "advisor", "gen_ai.usage.input_tokens": 5}),
    ]
    logs = [{"timeUnixNano": "300", "severityNumber": 9, "body": {"stringValue": "hello"},
             "traceId": TRACE_A, "spanId": "2" * 16},
            {"timeUnixNano": "310", "severityNumber": 13, "body": {"stringValue": "no trace"}}]
    path = tmp_path / "run.otlp.jsonl"
    path.write_text(_lines(_traces_request(spans, service="advisor"), _logs_request(logs, service="advisor")),
                    encoding="utf-8")

    result = import_otlp_file(con, path)
    assert (result.spans, result.logs, result.traces, result.projects) == (3, 2, 1, ["advisor"])

    trace = _trace(con, "advisor")
    assert trace["root_span_id"] == "1" * 16
    assert trace["name"] == "invoke_workflow advisor"
    assert (trace["start_ns"], trace["end_ns"]) == (100, 900)
    assert (trace["span_count"], trace["error_count"], trace["log_count"]) == (3, 1, 1)
    assert (trace["input_tokens"], trace["output_tokens"], trace["model"]) == (15, 3, "m1")
    assert trace["conversation_id"] == "chat-1"
    assert trace["service_name"] == "advisor"
    assert trace["flags"] == FLAG_GENAI | FLAG_WIZARDFLOW | FLAG_TOPOLOGY

    (node_ids,) = zip(*con.execute("SELECT node_id FROM spans WHERE node_id IS NOT NULL ORDER BY node_id"))
    assert node_ids == ("advisor", "classifier")
    assert con.execute("SELECT count(*) FROM logs WHERE trace_id IS NULL").fetchone()[0] == 1


def test_same_file_twice_is_a_no_op(con, tmp_path):
    path = tmp_path / "run.otlp.jsonl"
    path.write_text(_lines(_traces_request([_span("1" * 16)])), encoding="utf-8")
    assert import_otlp_file(con, path).spans == 1
    second = import_otlp_file(con, path)
    assert second.already_imported and second.spans == 0
    assert con.execute("SELECT count(*) FROM imports").fetchone()[0] == 1


def test_overlapping_files_deduplicate_spans(con):
    import_otlp_text(con, _lines(_traces_request([_span("1" * 16), _span("2" * 16, parent="1" * 16)])))
    result = import_otlp_text(con, _lines(_traces_request([_span("2" * 16, parent="1" * 16),
                                                           _span("3" * 16, parent="1" * 16)])))
    assert (result.spans, result.duplicate_spans) == (1, 1)
    assert _trace(con, "svc")["span_count"] == 3


def test_invalid_ids_are_skipped_and_counted(con):
    result = import_otlp_text(con, _lines(_traces_request(
        [_span("1" * 16), _span("0" * 16), _span("2" * 16, trace_id="")])))
    assert (result.spans, result.skipped_spans) == (1, 2)
    assert con.execute("SELECT skipped_count FROM imports").fetchone()[0] == 2


def test_upstream_parent_gives_local_root_and_parent_outside(con):
    import_otlp_text(con, _lines(_traces_request([
        _span("2" * 16, parent="f" * 16, name="POST /checkout", start=10),
        _span("3" * 16, parent="2" * 16, start=20),
    ])))
    trace = _trace(con, "svc")
    assert (trace["root_span_id"], trace["name"]) == ("2" * 16, "POST /checkout")
    assert trace["flags"] & FLAG_PARENT_OUTSIDE
    assert not trace["flags"] & FLAG_MULTI_TOP


def test_fragments_set_multi_top(con):
    import_otlp_text(con, _lines(_traces_request([
        _span("2" * 16, parent="e" * 16, start=50),
        _span("3" * 16, parent="f" * 16, start=10),
    ])))
    trace = _trace(con, "svc")
    assert trace["root_span_id"] == "3" * 16  # the earlier fragment
    assert trace["flags"] & FLAG_PARENT_OUTSIDE and trace["flags"] & FLAG_MULTI_TOP


def test_trace_across_two_projects_gets_a_slice_each(con):
    import_otlp_text(con, _lines(
        _traces_request([_span("1" * 16, name="GET /cart")], service="web-frontend"),
        _traces_request([_span("2" * 16, parent="1" * 16, name="POST /checkout")], service="checkout-api"),
    ))
    web, checkout = _trace(con, "web-frontend"), _trace(con, "checkout-api")
    assert web["root_span_id"] == "1" * 16 and not web["flags"] & FLAG_PARENT_OUTSIDE
    assert checkout["root_span_id"] == "2" * 16 and checkout["flags"] & FLAG_PARENT_OUTSIDE
    assert web["flags"] & FLAG_CROSS_PROJECT and checkout["flags"] & FLAG_CROSS_PROJECT

    # Deleting one project never touches the other project's spans.
    con.execute("DELETE FROM projects WHERE name = 'web-frontend'")
    assert con.execute("SELECT span_id FROM spans").fetchall() == [("2" * 16,)]


def test_later_slice_in_another_project_updates_the_first(con):
    import_otlp_text(con, _lines(_traces_request([_span("1" * 16)], service="a")))
    assert not _trace(con, "a")["flags"] & FLAG_CROSS_PROJECT
    import_otlp_text(con, _lines(_traces_request([_span("2" * 16, parent="1" * 16)], service="b")))
    assert _trace(con, "a")["flags"] & FLAG_CROSS_PROJECT


def test_project_comes_from_openinference_name_then_service_then_override(con):
    import_otlp_text(con, _lines(_traces_request(
        [_span("1" * 16)], service="svc", resource_attrs={"openinference.project.name": "oi-proj"})))
    import_otlp_text(con, _lines(_traces_request([_span("2" * 16, trace_id=TRACE_B)], service="plain")))
    import_otlp_text(con, _lines(_traces_request([_span("3" * 16, trace_id="c" * 32)], service="x")),
                     project="forced")
    names = {r[0] for r in con.execute("SELECT name FROM projects")}
    assert names == {"oi-proj", "plain", "forced"}


def test_conversation_prefers_semconv_key_on_any_span(con):
    import_otlp_text(con, _lines(_traces_request([
        _span("1" * 16, attrs={"session.id": "sess-1"}),
        _span("2" * 16, parent="1" * 16, attrs={"gen_ai.conversation.id": "conv-9"}),
    ])))
    assert _trace(con, "svc")["conversation_id"] == "conv-9"


def test_project_override_of_node_mapping_makes_traces_replayable(con):
    import_otlp_text(con, _lines(_traces_request([_span("1" * 16, attrs={"tool.name": "search"})],
                                                 service="bot")))
    assert not _trace(con, "bot")["flags"] & FLAG_WIZARDFLOW
    project_id = con.execute("SELECT id FROM projects WHERE name = 'bot'").fetchone()[0]
    con.execute("INSERT INTO attribute_mappings VALUES (?, 'node', '[\"tool.name\"]', 1)", (project_id,))
    import_otlp_text(con, _lines(_traces_request([_span("2" * 16, trace_id=TRACE_B,
                                                        attrs={"tool.name": "fetch"})], service="bot")))
    assert _trace(con, "bot", TRACE_B)["flags"] & FLAG_WIZARDFLOW


def test_failed_import_leaves_nothing_behind(con):
    good = json.dumps(_traces_request([_span("1" * 16)]))
    with pytest.raises(OtlpFormatError):
        import_otlp_text(con, good + "\nnot json\n")
    assert con.execute("SELECT count(*) FROM spans").fetchone()[0] == 0
    assert con.execute("SELECT count(*) FROM imports").fetchone()[0] == 0
