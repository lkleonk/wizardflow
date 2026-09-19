# WizardFlow Python SDK

**A lightweight recorder for Python agents.** WizardFlow turns an agent run
into a portable WizardFlow JSONL file that you can replay as an interactive
graph, inspect with ordinary tools, or attach to a bug report.

Drop the file into [getwizardflow.com](https://getwizardflow.com) and it is
processed entirely in the browserâ€”nothing is uploaded. You can also replay it
locally with `wizardflow ui`.

![WizardFlow replaying an agent run](https://raw.githubusercontent.com/lkleonk/wizardflow/main/sdk/python/assets/demo.gif)

â–¶ **[Watch this run replay](https://getwizardflow.com/?example=doctor-consultation)**

## Why WizardFlow?

- **The trace is a file.** Commit, diff, grep, archive, or share it without an
  observability account.
- **Replay it anywhere.** Use the bundled local viewer or the fully client-side
  hosted viewer.
- **Zero runtime dependencies.** The base SDK is pure Python and requires no
  daemon or framework.
- **Explicit by design.** Your code chooses which node executions and values
  enter the trace.
- **OpenTelemetry is optional.** The same node executions can also be projected
  to OTLP-compatible observability backends.

## Install

```bash
pip install wizardflow
```

## Quickstart

```python
import uuid

import wizardflow

trace = wizardflow.init(
    output_dir="traces",
    file_prefix="run",
    nodes=["generator"],
)

message_id = str(uuid.uuid4())
input_value = ...

with trace.node(message_id, "generator") as node:
    node.log_input(input_value)
    output_value = ...
    node.log_output(output_value)

trace_path = trace.end_message(message_id)
print(trace_path)
```

`trace.node(...)` records the node's execution interval. `log_input()` and
`log_output()` preserve their JSON-compatible values in the trace, and
`end_message()` appends the completed message to JSONL. There is no separate
`save()` call.

Drop `trace_path` into [getwizardflow.com](https://getwizardflow.com), or open
it locally:

```bash
wizardflow ui traces/run__<timestamp>.jsonl
```

The module-level style remains available for applications that use one default
trace:

```python
wizardflow.init(nodes=["generator"])

with wizardflow.node("msg-1", "generator") as node:
    node.log_input(input_value)
    node.log_output(output_value)

wizardflow.end_message("msg-1")
```

## Optional OpenTelemetry export

Install the optional OTel packages directly:

```bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

Then enable OTLP trace export while retaining JSONL as the portable source of
truth:

```python
trace = wizardflow.init(
    nodes=["generator"],
    name="my-agent",
    otel=True,
    otel_endpoint="http://localhost:4318/v1/traces",
    otel_trace_scope="message",
)

with trace.node("msg-1", "generator", kind="llm") as node:
    node.log_input(input_value)
    node.log_output(output_value)

trace.end_message("msg-1")
trace.close_otel()
```

Generic logs can optionally choose an exact application-owned span attribute
without changing their JSONL/UI label:

```python
node.log("quality", 0.92, otel_attribute="app.response.quality")
```

Content export is privacy-conscious and disabled by default. See the
[OpenTelemetry guide](https://github.com/lkleonk/wizardflow/blob/main/sdk/python/docs/opentelemetry.md)
for provider ownership, GenAI mappings, content controls, graph events, and
independent JSONL/OTel lifecycles. Existing artifacts can be exported later:

```bash
wizardflow otel export run.jsonl --endpoint http://localhost:4318/v1/traces
```

## LangGraph topology

WizardFlow can read nodes and edges from a compiled LangGraph application
without importing LangGraph itself:

```python
trace = wizardflow.init_from_langgraph(
    compiled_app,
    output_dir="traces",
    file_prefix="run",
)
```

Runtime recording then uses the same `trace.node(...)` API. Extraction is
duck-typed through `app.get_graph()`.

## Documentation

- **[Recording agent runs](https://github.com/lkleonk/wizardflow/blob/main/sdk/python/docs/recording.md)**
  â€” messages, node scopes, semantic records, generic logs, kinds, output
  selection, multiple clients, and reinitialization.
- **[OpenTelemetry export](https://github.com/lkleonk/wizardflow/blob/main/sdk/python/docs/opentelemetry.md)**
  â€” OTLP setup, provider ownership, GenAI mappings, privacy controls, graph
  events, offline JSONL export, and cleanup.
- **[WizardFlow JSONL format](https://github.com/lkleonk/wizardflow/blob/main/sdk/python/docs/jsonl-file-format.md)**
  â€” record shapes, semantic fields, compatibility, and rotation.
- **[CLI and local viewer](https://github.com/lkleonk/wizardflow/blob/main/sdk/python/docs/cli.md)**
  â€” live local replay and Markdown, HTML, and JSON export.

## CLI at a glance

```bash
wizardflow ui run.jsonl              # interactive local replay
wizardflow ui --latest traces/       # newest trace in a directory
wizardflow md run.jsonl -o run.md    # Markdown export
wizardflow html run.jsonl -o run.html
wizardflow json run.jsonl -o run.json
```

All commands read both WizardFlow JSONL and the single-document JSON form. See
the [CLI guide](https://github.com/lkleonk/wizardflow/blob/main/sdk/python/docs/cli.md)
for flags, live-trace behavior, and rotated-part navigation.

## Examples

Runnable examples live in
[`examples/`](https://github.com/lkleonk/wizardflow/tree/main/sdk/python/examples):

- `quickstart.py` records a small linear flow.
- `multibranch.py` records two messages that take different graph branches.

## Development

See
[CONTRIBUTING.md](https://github.com/lkleonk/wizardflow/blob/main/sdk/python/CONTRIBUTING.md)
for local tests and maintainer workflows.
