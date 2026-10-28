"""The OTel store's SQL schema, as an ordered list of migrations.

Forward-only: once a version ships, its migration is frozen and fixes go into
the next one. ``PRAGMA user_version`` holds the applied version; ``db.py``
appends the bump to each migration so it commits atomically with it. The
design rationale (slices per project, mapped columns, cascades) lives in
``internal/wizardflow-v8/schema.html``.
"""

from __future__ import annotations

from typing import List, Tuple

# Bits of ``traces.flags``. Detection runs at import time (and on a re-index),
# so lists can filter and badge without scanning attributes.
FLAG_GENAI = 1           # gen_ai.* / openinference.* spans
FLAG_WIZARDFLOW = 2      # has graph nodes (per the Node mapping): replayable
FLAG_TOPOLOGY = 4        # exact graph from a wizardflow.graph span event
FLAG_PARENT_OUTSIDE = 8  # no parentless span in this slice
FLAG_MULTI_TOP = 16      # several top-level spans
FLAG_CROSS_PROJECT = 32  # other projects hold slices of the same trace

SCHEMA_V1 = """
CREATE TABLE meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  created_ns  INTEGER NOT NULL
);

CREATE TABLE imports (
  id            INTEGER PRIMARY KEY,
  source        TEXT    NOT NULL CHECK (source IN ('file', 'otlp_http')),
  path          TEXT,
  sha256        TEXT    UNIQUE,
  imported_ns   INTEGER NOT NULL,
  span_count    INTEGER NOT NULL DEFAULT 0,
  log_count     INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE resources (
  id            INTEGER PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_name  TEXT,
  attributes    TEXT    NOT NULL DEFAULT '{}',
  hash          TEXT    NOT NULL UNIQUE
);
CREATE INDEX resources_project ON resources(project_id);

CREATE TABLE scopes (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL DEFAULT '',
  version     TEXT    NOT NULL DEFAULT '',
  attributes  TEXT    NOT NULL DEFAULT '{}',
  hash        TEXT    NOT NULL UNIQUE
);

CREATE TABLE traces (
  id              INTEGER PRIMARY KEY,
  trace_id        TEXT    NOT NULL,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root_span_id    TEXT,
  name            TEXT,
  service_name    TEXT,
  start_ns        INTEGER NOT NULL,
  end_ns          INTEGER NOT NULL,
  span_count      INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  log_count       INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  model           TEXT,
  conversation_id TEXT,
  user_id         TEXT,
  flags           INTEGER NOT NULL DEFAULT 0,
  updated_ns      INTEGER NOT NULL,
  UNIQUE (project_id, trace_id)
);
CREATE INDEX traces_list ON traces(project_id, start_ns DESC);
CREATE INDEX traces_otel_id ON traces(trace_id);
CREATE INDEX traces_conversation ON traces(conversation_id, start_ns)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE spans (
  id              INTEGER PRIMARY KEY,
  trace_row       INTEGER NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  trace_id        TEXT    NOT NULL,
  span_id         TEXT    NOT NULL,
  parent_span_id  TEXT,
  resource_id     INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  scope_id        INTEGER NOT NULL REFERENCES scopes(id),
  import_id       INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  name            TEXT    NOT NULL,
  kind            INTEGER NOT NULL DEFAULT 0,
  start_ns        INTEGER NOT NULL,
  end_ns          INTEGER NOT NULL,
  status_code     INTEGER NOT NULL DEFAULT 0,
  status_message  TEXT,
  trace_state     TEXT,
  attributes      TEXT    NOT NULL DEFAULT '{}',
  dropped_attributes_count INTEGER NOT NULL DEFAULT 0,
  operation       TEXT GENERATED ALWAYS AS
                    (json_extract(attributes, '$."gen_ai.operation.name"')) VIRTUAL,
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  node_id         TEXT,
  node_kind       TEXT,
  execution_key   TEXT,
  UNIQUE (trace_id, span_id)
);
CREATE INDEX spans_tree ON spans(trace_row, parent_span_id);
CREATE INDEX spans_resource ON spans(resource_id);
CREATE INDEX spans_scope ON spans(scope_id);
CREATE INDEX spans_import ON spans(import_id) WHERE import_id IS NOT NULL;
CREATE INDEX spans_start ON spans(start_ns);
CREATE INDEX spans_node ON spans(node_id) WHERE node_id IS NOT NULL;
CREATE INDEX spans_exec ON spans(trace_row, execution_key) WHERE execution_key IS NOT NULL;
CREATE INDEX spans_model ON spans(model) WHERE model IS NOT NULL;

CREATE TABLE span_events (
  id          INTEGER PRIMARY KEY,
  span_row    INTEGER NOT NULL REFERENCES spans(id) ON DELETE CASCADE,
  trace_row   INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  time_ns     INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  attributes  TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX span_events_span ON span_events(span_row, seq);
CREATE INDEX span_events_trace ON span_events(trace_row, name);

CREATE TABLE span_links (
  id               INTEGER PRIMARY KEY,
  span_row         INTEGER NOT NULL REFERENCES spans(id) ON DELETE CASCADE,
  linked_trace_id  TEXT    NOT NULL,
  linked_span_id   TEXT    NOT NULL,
  attributes       TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX span_links_span ON span_links(span_row);

CREATE TABLE logs (
  id               INTEGER PRIMARY KEY,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_id      INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  scope_id         INTEGER NOT NULL REFERENCES scopes(id),
  import_id        INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  ts_ns            INTEGER NOT NULL,
  time_ns          INTEGER,
  observed_ns      INTEGER,
  severity_number  INTEGER NOT NULL DEFAULT 0,
  severity_text    TEXT,
  body             TEXT,
  body_text        TEXT GENERATED ALWAYS AS (
                     CASE json_type(body) WHEN 'text' THEN json_extract(body, '$')
                     ELSE body END) VIRTUAL,
  attributes       TEXT    NOT NULL DEFAULT '{}',
  event_name       TEXT,
  trace_id         TEXT,
  span_id          TEXT,
  flags            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX logs_list ON logs(project_id, ts_ns DESC);
CREATE INDEX logs_sev ON logs(project_id, severity_number, ts_ns DESC);
CREATE INDEX logs_trace ON logs(trace_id, span_id) WHERE trace_id IS NOT NULL;
CREATE INDEX logs_resource ON logs(resource_id);
CREATE INDEX logs_scope ON logs(scope_id);
CREATE INDEX logs_import ON logs(import_id) WHERE import_id IS NOT NULL;

CREATE TABLE attribute_mappings (
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  concept     TEXT    NOT NULL,
  keys        TEXT    NOT NULL,
  updated_ns  INTEGER NOT NULL,
  CHECK (concept <> 'project' OR project_id IS NULL)
);
CREATE UNIQUE INDEX attribute_mappings_scope
  ON attribute_mappings(coalesce(project_id, 0), concept);
CREATE INDEX attribute_mappings_project ON attribute_mappings(project_id);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_ns  INTEGER NOT NULL
);

INSERT INTO attribute_mappings (project_id, concept, keys, updated_ns) VALUES
  (NULL, 'project',       '["openinference.project.name","service.name"]', 0),
  (NULL, 'execution',     '["wizardflow.message.id"]', 0),
  (NULL, 'conversation',  '["gen_ai.conversation.id","session.id"]', 0),
  (NULL, 'user',          '["user.id"]', 0),
  (NULL, 'node',          '["wizardflow.node.id"]', 0),
  (NULL, 'node_kind',     '["wizardflow.node.kind","gen_ai.operation.name","openinference.span.kind"]', 0),
  (NULL, 'model',         '["gen_ai.request.model","llm.model_name"]', 0),
  (NULL, 'input_tokens',  '["gen_ai.usage.input_tokens","wizardflow.usage.input_tokens"]', 0),
  (NULL, 'output_tokens', '["gen_ai.usage.output_tokens","wizardflow.usage.output_tokens"]', 0),
  (NULL, 'input',         '["gen_ai.input.messages","gen_ai.tool.call.arguments","gen_ai.retrieval.query.text","wizardflow.input","input.value"]', 0),
  (NULL, 'output',        '["gen_ai.output.messages","gen_ai.tool.call.result","gen_ai.retrieval.documents","wizardflow.output","output.value"]', 0),
  (NULL, 'payloads',      '["wizardflow.payload.*"]', 0);
"""

MIGRATIONS: List[Tuple[int, str]] = [
    (1, SCHEMA_V1),
]
LATEST_VERSION = MIGRATIONS[-1][0]
