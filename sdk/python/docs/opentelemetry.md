# OpenTelemetry export

WizardFlow JSONL is the durable, transport-neutral source of truth.
OpenTelemetry is an optional projection of the same run for OTLP-compatible
backends such as Phoenix and Langfuse.

WizardFlow emits spans through the traces signal. It does not emit the OTel
Logs signal or duplicate OpenInference span attributes. A private provider uses
the OpenInference project resource attribute for backend grouping.

Existing JSONL artifacts can also be projected later with the offline exporter.

## Installation

The base `wizardflow` package remains dependency-free. Install OTel packages
directly when enabling export:

```bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

## Export an existing JSONL artifact

```bash
wizardflow otel export run.jsonl \
  --endpoint http://localhost:4318/v1/traces \
  --trace-scope message
```

The command discovers a rotated part-chain even when given a middle part and
exports all messages in part order. Use `--current-part-only` to export only
the named file. Input files are never modified.

Offline export creates fresh OTel trace IDs; JSONL cannot reconstruct live OTel
boundaries because `reinit(jsonl=..., otel=...)` controls those lifecycles
independently. `--trace-scope recording` (the default) creates one new trace
rooted at `wizardflow.run`. `--trace-scope message` creates one new trace per
message, rooted at `wizardflow.message`. Both modes preserve recorded node
timestamps and use the same semantic mapper as live export.

Content and graph export remain opt-in:

```bash
wizardflow otel export run.jsonl --include-content --export-graph
```

The endpoint may instead come from `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, or
from `OTEL_EXPORTER_OTLP_ENDPOINT` with `/v1/traces` appended. Standard OTel
header environment variables configure authentication. The offline command
always owns and shuts down a private provider; it never changes the global
tracer provider.

## Configuration

```python
import wizardflow

trace = wizardflow.init(
    nodes=["model"],
    name="my-agent",
    otel=True,
    otel_endpoint="http://localhost:4318/v1/traces",
    otel_trace_scope="message",
    otel_include_content=False,
    otel_content_max_bytes=16_384,
    export_graph_to_otel=False,
)
```

Output modes are independent:

| `jsonl` | `otel` | Result |
| --- | --- | --- |
| `True` | `False` | JSONL only |
| `True` | `True` | JSONL and OTel |
| `False` | `True` | OTel only |
| `False` | `False` | In-memory recording only |

## Provider ownership

Without `otel_endpoint`, WizardFlow obtains a tracer from the application's
global provider. It never calls `set_tracer_provider()`, adds processors to the
global provider, or shuts that provider down.

With an endpoint, WizardFlow creates a private SDK provider, batch processor,
and OTLP/HTTP exporter. This isolates WizardFlow configuration from the host
application. If `name` is set, WizardFlow also uses it as the OpenInference
project resource name. Backends such as Phoenix therefore group successive
WizardFlow traces under that project instead of placing them in `default`.
Without an endpoint, the application owns the global provider and its resource
configuration.

Finish OTel output explicitly:

```python
trace.close_otel()
```

`close_otel()` is idempotent. It ends any active WizardFlow roots, flushes and
shuts down only a WizardFlow-owned private provider, and leaves JSONL recording
completely unaffected. After closing, `trace.reinit(otel=True)` can create a
fresh private provider and trace.

## Trace scope, shape, and timestamps

`otel_trace_scope` controls the trace boundary:

| Value | Trace boundary |
| --- | --- |
| `"recording"` | One trace from initialization or OTel reinitialization until the next reinitialization or `close_otel()` |
| `"message"` | One independent trace per WizardFlow message, ended by `end_message()` |

`"recording"` is the backward-compatible default. `"message"` is generally the
more useful choice for request-oriented backends such as Phoenix. Message scope
keeps a distinct root and context per message id, so overlapping messages remain
independent traces.

In recording scope, one active WizardFlow OTel recording maps to one trace
rooted at `wizardflow.run`:

```text
wizardflow.run
├── researcher       wizardflow.message.id=m1
├── model            wizardflow.message.id=m1
└── model            wizardflow.message.id=m2
```

In message scope, every message maps to a trace rooted at
`wizardflow.message`:

```text
wizardflow.message       wizardflow.message.id=m1
â”œâ”€â”€ researcher
â””â”€â”€ model
```

Every node span carries:

```text
wizardflow.message.id
wizardflow.node.id
wizardflow.node.kind
```

Node spans use the resolved WizardFlow `timestamp` and `endTimestamp`, rather
than the time at which an exporter happens to process them.

### Span granularity

WizardFlow uses one span for each node execution. This is similar to the
operation-oriented model used by GenAI tracing systems such as
Phoenix/OpenInference, where an agent invocation, model call, retrieval, or
tool execution is represented by a span. The boundaries are not necessarily
identical: WizardFlow can only describe the node execution it records.

When one node execution represents one logical operation, the resulting span
has the expected operation-level granularity. When a node internally performs
several model or tool calls, WizardFlow still exports one node span; those
internal calls require their own instrumentation to appear as child spans.
This is a difference in detail, not an OTLP compatibility issue. The receiving
backend can still ingest and display the WizardFlow spans normally.

## GenAI semantic projection

Use an execution kind only when it accurately describes the node:

```python
with trace.node(message_id, "model", kind="llm") as node:
    node.log_input(messages)
    node.log_model_parameters(model="gpt-5", temperature=0.7)
    node.log_output(response)
    node.log_usage(input_tokens=120, output_tokens=30)
```

Current conservative mapping:

| Kind | Standard projection |
| --- | --- |
| generic | Custom `wizardflow.*` attributes only |
| `llm` | GenAI content, compatible request parameters, and usage; no guessed operation name |
| `agent` | `gen_ai.operation.name=invoke_agent`, agent name, compatible content/metadata |
| `tool` | `gen_ai.operation.name=execute_tool`, tool name, valid argument/result objects |
| `retriever` | `gen_ai.operation.name=retrieval`, string query and valid document-list content |
| `embedding` | `gen_ai.operation.name=embeddings`, compatible model and input-token metadata |
| `reranker` | Custom attributes; no current standardized operation is invented |

`log_input()` and `log_output()` do not create GenAI fields on a generic node.
The mapper needs both a compatible node kind and an explicit semantic record.

Recognized model parameters map to compatible `gen_ai.request.*` attributes.
Unknown or unsupported parameters remain readable under
`wizardflow.model_parameter.*`.

## Generic logs

Arbitrary scalar logs export by default as custom span attributes:

```text
wizardflow.log.confidence = 0.91
wizardflow.log.retrieval = "..."
```

Duplicate normalized labels preserve the first unsuffixed:

```text
wizardflow.log.retrieval
wizardflow.log.retrieval.1
wizardflow.log.retrieval.2
```

For an exact application-owned attribute key, generic `log()` accepts
`otel_attribute`:

```python
node.log(
    "retrieval_results",
    documents,
    otel_attribute="app.main.retrieval",
)
```

The developer-facing JSONL/UI label remains `retrieval_results`, while the span
attribute is exactly `app.main.retrieval`. The override is persisted as
`otelAttribute`, so live and offline export agree. Explicit keys are not
normalized. They must be non-empty, contain no surrounding whitespace or
control characters. Explicit values are applied after automatic mappings, so
they may intentionally extend or override `gen_ai.*` and WizardFlow attributes.
Only `wizardflow.node.id`, `wizardflow.node.kind`, `wizardflow.message.id`, and
`wizardflow.trace.name` are protected because changing them would make the span
contradict its recorded execution. If the same explicit key is logged more than
once during one node execution, the last value wins and export emits a warning.

This option does not bypass content controls or truncation. Prefer the semantic
logging helpers for inputs, outputs, usage, model parameters, and compatible
retrieval data; the custom key is an escape hatch for application-specific
attributes.

WizardFlow never guesses GenAI semantics from a generic label. A record with
`export_to_otel=False` is never exported.

## Content privacy and size bounds

Content export is disabled by default. With `otel_include_content=False`:

- semantic input/output is omitted;
- structured generic logs are omitted;
- scalar generic logs still export;
- usage and compatible model parameters still export as metadata.

Set `otel_include_content=True` only when the receiving system is appropriate
for the data. Exported content is deterministically serialized and bounded by
`otel_content_max_bytes`, measured as UTF-8 bytes. JSONL always retains the
original untruncated value.

Strings remain text. Other JSON-compatible input/output values are serialized
as text content without guessing that arbitrary object keys represent chat
messages. For compatible LLM and agent spans, the exporter wraps that text in
the official GenAI input/output message structure.

## Optional graph event

```python
trace = wizardflow.init(
    nodes=[...],
    edges=[...],
    otel=True,
    export_graph_to_otel=True,
)
```

The declared graph is emitted once on each new root as a
`wizardflow.graph` span event. Nodes and edges are canonical JSON strings with
counts. Oversized graphs omit the full content and retain counts, byte size, and
a stable SHA-256 hash.

Graph export is off by default because topology can be sensitive or large. The
event uses the traces signal; it is not an OTel log record.

## Independent reinitialization

```python
trace.reinit(jsonl=True, otel=False)   # retain the current OTel trace
trace.reinit(jsonl=False, otel=True)   # retain the current JSONL run
trace.reinit()                         # start both anew
```

In recording scope, an OTel reinitialization ends the current run root and
starts a new trace. Already-started node spans retain the trace context captured
when they began and may end normally afterward. In message scope, open messages
retain their roots while reinitialization changes the configuration used for
messages that begin afterward.

JSONL part/run boundaries cannot reconstruct these independently chosen live
OTel boundaries. The offline exporter therefore creates a fresh projection
using its explicit `--trace-scope` while sharing the live record-to-attribute
mapper.

## Convention references

- [OTel GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)
- [OTel GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- [OTel GenAI attribute registry](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/registry/attributes/gen-ai.md)
