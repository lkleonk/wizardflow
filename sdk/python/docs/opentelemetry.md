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
  --workflow-name consultation
```

The command discovers a rotated part-chain even when given a middle part and
exports all messages in part order. Use `--current-part-only` to export only
the named file. Input files are never modified.

Offline export creates fresh OTel trace IDs; JSONL cannot reconstruct live OTel
trace IDs or parent contexts. `--trace-scope workflow` (the default) creates one
new trace per message, rooted at an `invoke_workflow` span built exactly like
the live one; pass `--workflow-name` to match a live `otel_workflow_name`.
`--trace-scope recording` creates one new trace rooted at `wizardflow.run`. Both
modes preserve recorded node timestamps and use the same semantic mapper as
live export. Application `otel_attributes` are OTel-only and not stored in
JSONL, so offline roots do not carry them.

Content export is enabled by default so the receiving UI shows useful inputs,
outputs, and structured logs on the first export. Graph export remains opt-in:

```bash
wizardflow otel export run.jsonl --export-graph
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
    nodes=["classifier", "advisor"],
    name="student-advisor",             # project (with otel_endpoint)
    otel=True,
    otel_endpoint="http://localhost:4318/v1/traces",
    otel_trace_scope="workflow",        # default
    otel_workflow_name="consultation",  # stable workflow type, optional
    otel_attributes={"deployment.environment": "prod"},  # on every root
    otel_include_content=True,  # default; set False to omit recorded content
    otel_content_max_bytes=16_384,
    export_graph_to_otel=False,
)

with trace.workflow() as run:
    run.set_info(
        title="Degree consultation",
        otel_attributes={"session.id": chat_id, "user.id": user_id},
    )
    with run.node("classifier") as node:
        node.log_input(question)
```

How WizardFlow concepts map onto what OTel backends show:

| WizardFlow | OTel / backends |
| --- | --- |
| recording `name` | project (`openinference.project.name` resource, with `otel_endpoint`) |
| `otel_workflow_name` | workflow type (`gen_ai.workflow.name`) |
| message = one workflow execution | one trace, rooted at an `invoke_workflow` span |
| node execution | one span under that root |
| `otel_attributes` such as `session.id` | session / user grouping of traces |

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
configuration. A resource is fixed per provider, so `name` then does **not**
become the project: set the project where you configure OTel, for example
`phoenix.otel.register(project_name="student-advisor")`. Langfuse ignores the
resource either way; its project comes from the API key.

Finish OTel output explicitly:

```python
trace.close_otel()
```

`close_otel()` is idempotent. It ends any active WizardFlow roots, flushes and
shuts down only a WizardFlow-owned private provider, and leaves JSONL recording
completely unaffected. After closing, `trace.reinit(otel=True)` can create a
fresh private provider and trace.

## Trace scope, shape, and timestamps

A trace is the collection of spans that share one trace ID. `otel_trace_scope`
controls where WizardFlow draws that boundary:

| Value | Trace boundary |
| --- | --- |
| `"workflow"` (default) | One independent trace per workflow execution (WizardFlow message), rooted at an `invoke_workflow` span |
| `"recording"` | One trace from initialization or OTel reinitialization until the next reinitialization or `close_otel()` |

Workflow scope is the standard request-oriented model used by Phoenix,
Langfuse, and the GenAI semantic conventions, and the only scope that supports
session grouping. Recording scope is a specialized whole-recording view: its
root stays open until `close_otel()` or process exit, and backends show it as
incomplete until then.

In workflow scope, every workflow execution maps to one trace. The root follows
the OTel GenAI `invoke_workflow` span convention (currently marked
Development):

```text
invoke_workflow consultation      INTERNAL root span
├── classifier                    node span
└── advisor                       node span
```

The root span carries:

```text
gen_ai.operation.name = "invoke_workflow"
gen_ai.workflow.name = "consultation"              # only with otel_workflow_name
wizardflow.message.id = <generated or caller-provided message id>
wizardflow.message.title = "Degree consultation"   # when a title is supplied
wizardflow.message.metadata = <deterministic JSON> # when meta is supplied
<otel_attributes>                                  # init-level, then per-workflow
```

The `invoke_workflow` span is the root operation, not a separate trace object.
Without `otel_workflow_name` it is named just `invoke_workflow` and omits
`gen_ai.workflow.name`; WizardFlow never invents a workflow name. The workflow
name is a stable, low-cardinality type, configured once. The per-execution
title never renames the root.

`trace.workflow()` starts the root when the block begins and makes it the
current span, so auto-instrumented calls inside the block (HTTP clients, model
SDKs) are parented under it. Leaving the block ends it. If the block raises,
the root records the exception, sets `error.type`, and gets error status; the
exception still propagates.

The lower-level `message_id` / `end_message()` API produces the same shape: the
root is created lazily from the first node's start time and ended by
`end_message()`. Ending a message that never ran a node still emits a
zero-child root. Overlapping message IDs remain independent traces, each with
its own root and context. `close_otel()` ends roots that were never finished
with unset status, since no failure was observed.

In recording scope, one active WizardFlow OTel recording maps to one trace
rooted at `wizardflow.run`, and `trace.workflow()` does not create extra roots:

```text
wizardflow.run
├── researcher       wizardflow.message.id=m1
├── model            wizardflow.message.id=m1
└── model            wizardflow.message.id=m2
```

Every node span carries:

```text
wizardflow.message.id
wizardflow.node.id
wizardflow.node.kind
```

Node spans use the resolved WizardFlow `timestamp` and `endTimestamp`, rather
than the time at which an exporter happens to process them. Workflow scope and
recording scope only change OTel trace boundaries; JSONL files and rotation are
unaffected.

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

## Application attributes on the workflow root

`otel_attributes` sets exact, application-chosen keys on workflow root spans.
It is the counterpart of `log(otel_attribute=...)` for the execution as a
whole, and the way to make traces groupable by backends:

| Purpose | Phoenix / OpenInference | Langfuse | GenAI semconv |
| --- | --- | --- | --- |
| Session / conversation | `session.id` | `langfuse.session.id` (or `session.id`) | `gen_ai.conversation.id` |
| User | `user.id` | `langfuse.user.id` (or `user.id`) | — |

```python
trace = wizardflow.init(..., otel_attributes={"deployment.environment": "prod"})

with trace.workflow() as run:
    run.set_info(otel_attributes={"session.id": chat_id, "user.id": user_id})
    ...

# Low-level form:
trace.end_message(message_id, otel_attributes={"session.id": chat_id})
```

- `init()` / `reinit()` values apply to every workflow root started afterwards
  (in recording scope, to the recording root).
- `set_info()` / `end_message()` values apply to that workflow's root only and
  override init-level values for the same key. Repeated `set_info()` calls
  merge.
- Keys are used exactly, with the same rules as `otel_attribute` (non-empty, no
  surrounding whitespace or control characters). The keys WizardFlow sets on
  the root are protected: `gen_ai.operation.name`, `gen_ai.workflow.name`,
  `wizardflow.message.id`, `wizardflow.message.title`,
  `wizardflow.message.metadata`, plus the node identity keys.
- Values must be `str`, `bool`, `int`, `float`, or a non-empty list of one of
  those types. Invalid entries are dropped with a warning, or raise with
  `on_error="raise"`.
- They are identifiers the application chose, so they are exported even with
  `otel_include_content=False`.
- They are OTel-only: JSONL never stores them, and the offline exporter cannot
  reproduce them.
- In recording scope there is no per-workflow root. Per-workflow
  `otel_attributes` are ignored with one warning rather than attached to the
  recording root, because backends treat session and user as properties of the
  whole trace.
- They are set on the root span only. Langfuse notes that filtering *spans* by
  these attributes requires them on every span; session grouping of traces
  works from the root.

`meta` stays separate: it is exported as one bounded JSON value,
`wizardflow.message.metadata`, and its keys are never turned into attribute
names.

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

## Generic payloads

Arbitrary scalar payloads (generic `log()` records) export by default as custom
span attributes. They are named `payload`, not `log`, because OTel "logs" are
the separate Logs signal:

```text
wizardflow.payload.confidence = 0.91
wizardflow.payload.retrieval = "..."
```

Duplicate normalized labels preserve the first unsuffixed:

```text
wizardflow.payload.retrieval
wizardflow.payload.retrieval.1
wizardflow.payload.retrieval.2
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

### Exact keys for inputs and outputs

`log_input()` and `log_output()` accept `otel_attribute` too. There it is
**additive**: the automatic projection (`gen_ai.input.messages`, tool
arguments, and so on) is kept, and the same value is also exported under the
exact key. The record stays one JSONL payload, with `otelAttribute` persisted
so offline export agrees:

```python
node.log_input(question, otel_attribute="input.value")
node.log_output(answer, otel_attribute="output.value")
```

This is useful for backends that read other keys than `gen_ai.*`. Phoenix, for
example, fills its span Input/Output panels from the OpenInference keys
`input.value` / `output.value`. Because inputs and outputs are content, the
extra key follows `otel_include_content` (even for plain strings) and
`otel_content_max_bytes`. The same key rules, protected keys, and
last-value-wins warning as for generic logs apply.

WizardFlow never guesses GenAI semantics from a generic label. A record with
`export_to_otel=False` is never exported.

## Content privacy and size bounds

Content export is enabled by default once OTel export itself is enabled. This
can include prompts, responses, retrieved documents, and tool results. Use
`otel_include_content=False` for live export or `--no-include-content` for the
CLI when the receiving system should only receive metadata. With content
disabled:

- semantic input/output is omitted;
- structured generic logs are omitted;
- scalar generic logs still export;
- usage and compatible model parameters still export as metadata;
- the workflow root keeps its title, but omits the `meta` JSON
  (`wizardflow.message.metadata`);
- `otel_attributes` still export, since the application chose them.

Only export content to a receiving system appropriate for the data. Exported
content is deterministically serialized and bounded by
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
trace.reinit(otel_attributes={"deployment.environment": "staging"})
```

In workflow scope, reinitialization changes the configuration (trace name,
init-level `otel_attributes`) used for workflows that start afterwards.
Already-open workflows keep the root and context captured when they began and
may finish normally. In recording scope, an OTel reinitialization ends the
current run root and starts a new trace; already-started node spans retain the
trace context captured when they began.

JSONL part/run boundaries cannot reconstruct these independently chosen live
OTel boundaries. The offline exporter therefore creates a fresh projection
using its explicit `--trace-scope` while sharing the live record-to-attribute
mapper.

## Convention references

- [OTel GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)
- [OTel GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- [OTel GenAI attribute registry](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/registry/attributes/gen-ai.md)
