# CLI and local viewer

The `wizardflow` command reads both WizardFlow JSONL parts and the legacy
single-document JSON representation.

## Selecting a trace

Every subcommand accepts a trace as a positional argument or through `--path`:

```bash
wizardflow ui run.jsonl
wizardflow ui --path run.jsonl
```

Use `--latest` to select the most recently modified `.jsonl` or `.json` file in
a directory:

```bash
wizardflow ui --latest
wizardflow ui --latest traces/
```

## Local interactive viewer

```bash
wizardflow ui run.jsonl [--host 127.0.0.1] [--port 0] [--no-open]
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
wizardflow otel export run.jsonl --trace-scope message
```

This projects an existing artifact through OTLP/HTTP using the same semantic
mapping as live export. It creates fresh OTel trace IDs and never modifies the
source file. By default it discovers and exports the complete rotated
part-chain and creates one `wizardflow.run` trace; `--trace-scope message`
creates one `wizardflow.message` trace per message.

| Option | Default | Meaning |
| --- | --- | --- |
| `--endpoint` | OTel environment | OTLP/HTTP traces endpoint |
| `--trace-scope` | `recording` | `recording` or `message` trace boundaries |
| `--include-content` / `--no-include-content` | on | Export or omit bounded input, output, and structured log content |
| `--content-max-bytes` | `16_384` | Maximum bytes for each exported content value |
| `--export-graph` | off | Add the WizardFlow graph event to each root |
| `--graph-max-bytes` | `65_536` | Maximum full graph-event content size |
| `--current-part-only` | off | Export only the named rotation part |

When `--endpoint` is omitted, the command reads
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, then `OTEL_EXPORTER_OTLP_ENDPOINT`.
See [opentelemetry.md](opentelemetry.md) for installation, privacy, and mapping
details.

## Live traces and rotated parts

`end_message()` appends one durable line, so `wizardflow ui` can show messages
while the process is still recording. When the active part rotates, its seal
points to the next filename. The local server resolves only plain sibling part
names from the trace directory; UI assets always take precedence.

See [jsonl-file-format.md](jsonl-file-format.md) for the record and rotation schema.
