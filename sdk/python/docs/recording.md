# Recording agent runs

This guide covers WizardFlow's recording model and Python API. WizardFlow writes
portable WizardFlow JSONL files; OpenTelemetry export is an optional projection
described in [opentelemetry.md](opentelemetry.md).

## Basic recording

`wizardflow.init()` returns a `Client`. Instance-style calls are the clearest
choice, especially when an application may record more than one flow:

```python
import wizardflow

trace = wizardflow.init(
    output_dir="traces",
    file_prefix="run",
    nodes=["router", "generator"],
    edges=[("router", "generator")],
)

message_id = "msg-1"

with trace.node(message_id, "generator") as node:
    node.log_input(prompt)
    node.log_output(response)

trace_path = trace.end_message(message_id)
print(trace_path)
```

`end_message()` is the operation that persists the completed message. There is
no separate `save()` call.

`init()` also installs the returned client as the module default, so an
equivalent module-level style remains available:

```python
wizardflow.init(nodes=["generator"])

with wizardflow.node("msg-1", "generator") as node:
    node.log_input(prompt)
    node.log_output(response)

wizardflow.end_message("msg-1")
```

Do not mix module-level calls with several clients: module-level calls always
target the most recently initialized client.

### Strict and resilient error handling

WizardFlow is strict by default: invalid recording calls raise a
`WizardFlowError`. Applications that must never be interrupted by instrumentation
can opt into warning-and-continue behavior:

```python
trace = wizardflow.init(silent=True)
```

With `silent=True`, suppressed WizardFlow recording errors are emitted through
Python's `wizardflow` logger at warning level and the invalid operation is
ignored. Exceptions raised by the application itself, including inside
`with trace.node(...)`, are never swallowed.

## Messages and node executions

A message is one unit of work, usually one user turn through the graph. Its ID
must be unique until `end_message()` completes it. A fresh UUID is a good
default; do not use a long-lived session or user ID as the message ID.

The node context manager records a resolved execution interval and closes the
node even when its body raises:

```python
with trace.node(message_id, "researcher") as node:
    node.log("query_count", 3)
```

For lower-level integrations, the equivalent lifecycle is:

```python
trace.start_node(message_id, "researcher")
try:
    trace.log(message_id, "researcher", "query_count", 3)
finally:
    trace.end_node(message_id, "researcher")
```

The step's `timestamp` is its start and `endTimestamp` is its resolved end.
`timingMode` records whether both boundaries were explicit, inferred from log
activity, or automatically closed by `end_message()`; older traces omit it.
Calling `end_message()` automatically closes any node executions still open for
that message.

## Semantic records

The scoped methods record stable WizardFlow meanings without embedding OTel
attribute names in the file:

```python
with trace.node(message_id, "generator") as node:
    node.log_input(messages)
    node.log_model_parameters(
        model="gpt-5",
        temperature=0.7,
        max_tokens=500,
        reasoning_effort="high",
    )
    node.log_output(response)
    node.log_usage(input_tokens=120, output_tokens=30)
```

- `log_input(value)` and `log_output(value)` preserve any JSON-compatible value.
- `log_usage()` accepts non-negative integer token counts.
- `log_model_parameters()` preserves both recognized and provider-specific
  parameters. Known snake-case names such as `max_tokens` receive stable
  camel-case JSONL names such as `maxTokens`.

These meanings are generic. `log_input()` does not by itself declare an LLM
operation; the node kind controls whether an OTel projection may use GenAI
semantic conventions.

## Node kinds

An optional kind describes what the execution represents:

```python
with trace.node(message_id, "model", kind="llm") as node:
    ...
```

Accepted kinds are:

- `agent`
- `llm`
- `tool`
- `retriever`
- `embedding`
- `reranker`

Omitting the kind means a generic node and omits `kind` from JSONL. Kind belongs
to the execution step rather than the declared graph node, so the same node ID
can be used differently across executions.

## Generic logs

Use `log()` for developer-defined data that has no first-class WizardFlow
meaning:

```python
with trace.node(message_id, "retriever") as node:
    node.log("confidence", 0.91)
    node.log("retrieval", documents)
```

WizardFlow never infers semantics from labels such as `temperature`,
`llm_input`, or `output`. Generic values remain complete in JSONL.

The unscoped form remains useful in callback-style integrations:

```python
trace.log(message_id, "router", "decision", "research")
```

Consecutive labeled logs to the same node fold into one inferred step. Use the
context manager when exact execution boundaries matter.

### Custom OpenTelemetry attribute key

Generic logs normally export as `wizardflow.log.<normalized_label>`. When an
application needs an exact, application-owned OTel key, keep the readable trace
label and set the export key separately:

```python
node.log(
    "retrieval_results",
    documents,
    otel_attribute="app.main.retrieval",
)
```

The JSONL/UI label remains `retrieval_results`; live and later offline OTel
export use `app.main.retrieval` exactly. The optional key is persisted in JSONL
so both export paths agree. Explicit keys may extend or override `gen_ai.*` and
WizardFlow mappings. Only the structural identity keys `wizardflow.node.id`,
`wizardflow.node.kind`, `wizardflow.message.id`, and `wizardflow.trace.name` are
protected. Prefer `log_input()`, `log_output()`, `log_usage()`, and
`log_model_parameters()` whenever the data has one of those known meanings.

## Selecting outputs per record

Every logging method supports explicit output selection:

```python
node.log(
    "debug",
    value,
    export_to_jsonl=True,
    export_to_otel=False,
)
```

- `export_to_jsonl=False` omits the record from the artifact.
- `export_to_otel=False` prevents live export and is persisted as
  `exportToOtel: false` when the record remains in JSONL.
- Client-level `jsonl=False` or `otel=False` overrides per-record enablement.

No label is inspected to decide where a value goes.

## Message metadata and titles

```python
trace.end_message(
    message_id,
    title="First question",
    meta={"outcome": "ok", "latency_ms": 320},
)
```

Keep message metadata flat and scalar. Large or structured values belong in
node payloads.

## LangGraph topology

Topology extraction is duck-typed and does not import LangGraph:

```python
trace = wizardflow.init_from_langgraph(
    compiled_app,
    output_dir="traces",
    node_labels={"generate": "Generate answer"},
    node_descriptions={"generate": "Calls the response model."},
)
```

Call it after `compile()`. WizardFlow reads `app.get_graph()`, retains
conditional edges where available, and keeps `__start__` and `__end__` nodes.

## Long-lived processes

JSONL and OTel run boundaries can be reinitialized independently:

```python
trace.reinit(jsonl=True, otel=False)   # new JSONL run only
trace.reinit(jsonl=False, otel=True)   # new OTel trace only
trace.reinit()                         # both
```

Open messages survive reinitialization and are persisted to whichever JSONL run
is active when they end. See [opentelemetry.md](opentelemetry.md) for the OTel
ownership rules.

## Next guides

- [OpenTelemetry export](opentelemetry.md)
- [WizardFlow JSONL format](jsonl-file-format.md)
- [CLI and local viewer](cli.md)
