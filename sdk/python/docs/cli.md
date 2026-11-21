# CLI and local viewer

The `wizardflow` command has two halves:

| | Commands | Works on |
| --- | --- | --- |
| **Replay** | `replay`, `md`, `html`, `json` | One run file. Nothing is stored. |
| **Dashboard** | `dashboard`, `db import`, `db info`, `db migrate` | A local database of all your runs and OpenTelemetry data. See the [OTel dashboard guide](otel-dashboard.md). |

`otel export` sends a run on to any OpenTelemetry backend.

```bash
wizardflow replay run.jsonl       # watch one run
wizardflow dashboard              # open the dashboard, receiving OTLP on :4318
wizardflow dashboard run.jsonl    # import a run, then open the dashboard
```

The replay commands read both WizardFlow JSONL parts and the legacy
single-document JSON representation. The names before 0.9, `ui` and `serve`,
still work as aliases of `replay` and `dashboard`.

## Selecting a trace

The replay commands (`replay`, `md`, `html`, `json`) accept a trace as a
positional argument or through `--path`. `dashboard`, `db import`, and
`otel export` take plain file arguments only.

```bash
wizardflow replay run.jsonl
wizardflow replay --path run.jsonl
```

Use `--latest` to select the most recently modified `.jsonl` or `.json` file in
a directory:

```bash
wizardflow replay --latest
wizardflow replay --latest traces/
```

## Replay one run

```bash
wizardflow replay run.jsonl [--host 127.0.0.1] [--port 0] [--no-open]
```

This starts a standard-library HTTP server and serves the static WizardFlow UI
bundled in the package.

| Option | Default | Meaning |
| --- | --- | --- |
| `--latest` | off | Treat the path as a directory and choose its newest trace |
| `--host` | `127.0.0.1` | Interface to bind |
| `--port` | `0` | Port to bind; zero asks the OS for a free port |
| `--no-open` | off | Print the URL instead of opening a browser |

The viewer follows a growing active part using ETag revalidation. Polling pauses
while the tab is hidden and stops when the part gains `nextPart`, because a
sealed part no longer grows. Part navigation loads neighboring files rather
than stitching the entire rotation chain into one timeline.

`replay` is for WizardFlow runs only. Given an OTLP JSON file, it stops and
prints the `wizardflow dashboard FILE` command that opens it. When a dashboard
database exists in the current directory, `replay` also prints how to add the
run to it. `wizardflow dashboard` and the `wizardflow db` commands are covered
in the [OTel dashboard guide](otel-dashboard.md).

## Markdown export

```bash
wizardflow md run.jsonl
wizardflow md run.jsonl -o run.md
wizardflow md run.jsonl --no-mermaid
```

Markdown output includes metadata, an optional Mermaid graph, messages, steps,
and payloads.

| Option | Meaning |
| --- | --- |
| `-o`, `--output` | Write to a file instead of stdout |
| `--mermaid` | Include the graph diagram; enabled by default |
| `--no-mermaid` | Omit the graph diagram |

## HTML export

```bash
wizardflow html run.jsonl
wizardflow html run.jsonl -o run.html
```

This produces one self-contained document with inline CSS, no JavaScript, and
no external assets. It renders messages and payloads; use Markdown when a graph
diagram is required.

## Assemble JSONL into JSON

```bash
wizardflow json run.jsonl
wizardflow json run.jsonl -o run.json
```

This assembles the selected part's header and message records into one
pretty-printed WizardFlow trace. A seal's `nextPart` is folded into metadata. It
does not combine an entire rotation chain.

## Export JSONL to OpenTelemetry

```bash
wizardflow otel export run.jsonl --endpoint http://localhost:4318/v1/traces
wizardflow otel export run.jsonl --out run.otlp.jsonl
wizardflow otel export run.jsonl --workflow-name consultation
wizardflow otel export run.jsonl --trace-scope recording
```

This projects an existing artifact to OpenTelemetry using the same semantic
mapping as live export: sent over OTLP/HTTP, or with `--out` written to an
OTLP JSON file in the OpenTelemetry Collector's file format (one export request
per line), which `wizardflow dashboard FILE` and other OTLP tools can read. It creates fresh OTel trace IDs and never modifies the
source file. By default it discovers and exports the complete rotated
part-chain and creates one trace per message, rooted at an `invoke_workflow`
span; `--trace-scope recording` creates one `wizardflow.run` trace for the
whole chain. Live `otel_attributes` are not stored in JSONL, so exported roots
do not carry them.

| Option | Default | Meaning |
| --- | --- | --- |
| `--endpoint` | OTel environment | OTLP/HTTP traces endpoint |
| `--out` | none | Write OTLP JSON to this file instead of sending; excludes `--endpoint` |
| `--trace-scope` | `workflow` | `workflow` (one trace per message) or `recording` trace boundaries |
| `--workflow-name` | none | Stable `gen_ai.workflow.name` for workflow roots; match the live `otel_workflow_name` |
| `--include-content` / `--no-include-content` | on | Export or omit bounded input, output, and structured log content |
| `--content-max-bytes` | `16_384`; `16_000_000` with `--out` | Maximum bytes for each exported content value |
| `--export-graph` / `--no-export-graph` | off; on with `--out` | Add the WizardFlow graph event to each root |
| `--graph-max-bytes` | `65_536` | Maximum full graph-event content size |
| `--current-part-only` | off | Export only the named rotation part |

A file is read locally and replayed in full, so `--out` keeps the graph and
practically all content by default; an endpoint keeps the smaller,
backend-friendly limits. When neither `--endpoint` nor `--out` is given, the
command reads
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, then `OTEL_EXPORTER_OTLP_ENDPOINT`.
Sending needs no OpenTelemetry packages: WizardFlow brings its own OTLP/HTTP
exporter. See [opentelemetry.md](opentelemetry.md) for its environment
variables, privacy, and mapping details.

## Live traces and rotated parts

`end_message()` appends one durable line, so `wizardflow replay` can show messages
while the process is still recording. When the active part rotates, its seal
points to the next filename. The local server resolves only plain sibling part
names from the trace directory; UI assets always take precedence.

See [jsonl-file-format.md](jsonl-file-format.md) for the record and rotation schema.
