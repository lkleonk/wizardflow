# OTel dashboard

`wizardflow serve` opens a local dashboard over your OpenTelemetry data:
projects, traces, logs, and every span with its attributes. A trace that has
graph nodes also opens in **graph replay**, the same viewer `wizardflow ui`
shows for a JSONL run.

Everything stays on your machine. The data lives in one SQLite file, and the
dashboard is served by a standard-library HTTP server bundled with the package.
It needs no extra dependencies, collector, or account.

```bash
wizardflow db import traces.otlp.jsonl   # load OTLP JSON into the database
wizardflow serve                          # open the dashboard
```

## The database

By default the database is `./.wizardflow/wizardflow.db`, relative to the
directory you run the command in. Every command below takes `--db PATH` to use
another file.

```bash
wizardflow db import FILE... [--project NAME] [--db PATH]
wizardflow db info [--db PATH]
wizardflow db migrate [--db PATH]
```

| Command | What it does |
| --- | --- |
| `db import` | Imports OTLP JSON files: spans, span events, links, and logs. |
| `db info` | Prints the schema version, file size, number of imports, and each project's traces, spans, and logs. |
| `db migrate` | Upgrades the schema. Opening a database does this anyway, so you rarely need it. |

### What `db import` accepts

OTLP JSON, as the OpenTelemetry Collector's file exporter writes it: one
export request per line. A single pretty-printed request in one file works
too.

- **Re-importing is safe.** A file whose contents were already imported is
  skipped, and spans already in the database are skipped and counted.
- **Projects:** every span and log is filed under a project. Its name comes
  from the resource: `openinference.project.name`, else `service.name`, else
  `default`. To change these keys, set the **Project** concept in Settings,
  before you import. `--project NAME` puts the whole file into one project
  instead.
- **Your own WizardFlow runs** become OTLP JSON first:

  ```bash
  wizardflow otel export run.jsonl --out run.otlp.jsonl
  wizardflow db import run.otlp.jsonl
  ```

  These traces carry the recorded graph, so they open in graph replay with
  their exact topology.

`wizardflow ui FILE` also accepts an OTLP file: it imports the file into the
default database and opens the dashboard on its project.

## Opening the dashboard

```bash
wizardflow serve [--db PATH] [--host 127.0.0.1] [--port 0] [--no-open]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--db` | `./.wizardflow/wizardflow.db` | Database file; created if missing |
| `--host` | `127.0.0.1` | Interface to bind |
| `--port` | `0` | Port to bind; zero asks the OS for a free port |
| `--no-open` | off | Print the URL instead of opening a browser |

The dashboard is at `http://127.0.0.1:PORT/otel`. You can import while it runs:
reload the page to see the new data.

## Pages

**Projects.** One card per project, showing its traces, spans, logs, error
rate, tokens, services, and an activity chart of traces per half hour.

**Traces.** The project's traces, newest first. You can:

- filter by kind (WizardFlow, GenAI, plain OTel), by errors only, or by time
  range;
- search names, trace ids, conversations, and models;
- group traces by conversation, using the **Conversation** concept
  (`gen_ai.conversation.id` or `session.id` by default).

Each conversation group has an **Open graph replay** button that replays the
whole conversation as one run.

**Trace.** A span tree with a timeline on the left and the selected span on the
right. The span details show attributes (grouped by namespace), chat
messages, events, correlated logs, and the resource.

- The span tree folds away (‹) or resizes by dragging the gap.
- Span dots take the colour their node has in graph replay. Error spans are
  red.
- Pin an attribute with its pin icon to show it first on every span.

**Logs.** The project's log records. You can filter by minimum severity and by
whether a record belongs to a trace, and search their text.

### Badges

| Badge | Meaning |
| --- | --- |
| WizardFlow | The trace has graph nodes (per the **Node** concept), so it opens in graph replay. |
| GenAI | It has `gen_ai.*` or OpenInference spans. |
| OTel | Neither of the above. |
| parent not in db | No span is parentless: the trace continues one from another service, or its root isn't imported yet. |
| several tops | Several top-level spans whose parents aren't in the database. |
| cross-project | Other projects hold spans of the same trace. |

## Graph replay

A trace with graph nodes shows a **Graph replay** button on its root span and
on every node span. Graph replay plays the run back node by node, in the same
viewer as `wizardflow ui`, and the dashboard's sidebar stays beside it.

The graph comes from one of two places, and the trace page says which:

- **Recorded:** a `wizardflow.graph` span event carries the exact topology.
  `wizardflow otel export --out` writes one by default; when sending to an
  endpoint, add `--export-graph`.
- **Inferred:** edges follow the order the nodes ran in.

Spans become graph nodes through the **Node** concept: `wizardflow.node.id` by
default. A trace from another framework opens in graph replay once you map its
node attribute (Settings → Attribute mapping). A trace with no node spans
can't be replayed, and the viewer says so.

## Settings

**Display.** How the dashboard looks, saved in this browser only:

- relative or absolute timestamps;
- theme;
- the default time range;
- pinned and hidden attributes (a trailing `*` matches a prefix, e.g.
  `telemetry.*`);
- attribute order;
- the sidebar folded to a narrow rail or not.

**Attribute mapping.** Which attribute keys mean what. This is stored in the
database, because it describes the data. Each concept lists keys in
priority order, and the first key a span has wins.

| Concept | Default keys |
| --- | --- |
| Project | `openinference.project.name`, `service.name` |
| Workflow execution | `wizardflow.message.id` |
| Conversation | `gen_ai.conversation.id`, `session.id` |
| User | `user.id` |
| Node | `wizardflow.node.id` |
| Node kind | `wizardflow.node.kind`, `gen_ai.operation.name`, `openinference.span.kind` |
| Model | `gen_ai.request.model`, `llm.model_name` |
| Input / output tokens | `gen_ai.usage.*_tokens`, `wizardflow.usage.*_tokens` |
| Input / output payload | `gen_ai.input.messages` / `gen_ai.output.messages`, tool and retrieval keys, `wizardflow.input` / `wizardflow.output`, `input.value` / `output.value` |
| Extra payloads | `wizardflow.payload.*` |

- **Presets:** fill the mapping for WizardFlow, the OTel GenAI semantic
  conventions, OpenInference (Phoenix), or Langfuse. They are starting points
  to review, not guarantees.
- **Coverage:** each concept shows how many spans currently match it.
- **Per project:** the mapping is global, and a project can override single
  concepts. Project is the exception: it is global only.
- **Re-indexing:** saving re-indexes the affected spans at once. Raw attributes
  are always kept, so a change never loses data and can be undone. Project is
  the exception here too: it decides where spans are filed during import, so
  a change applies to later imports only.

**Data and import.** The database path, schema version, contents, size, and
the import commands.

**Live receiver.** Planned: receiving OTLP over HTTP while `wizardflow serve`
runs. Until then, export to a file (for example with the Collector's file
exporter) and import it.

## Safety

The server binds to `127.0.0.1` by default and reads the database through
read-only connections. The only writes are mapping changes from Settings, and
the server accepts them only:

- from a local host name, as `Host` (`localhost`, `127.0.0.1`, `::1`);
- from a local `Origin`, if one is sent;
- as a JSON body up to 1 MB.

This keeps other websites in your browser from changing your settings.

If you bind to another interface with `--host`, anyone who can reach that
interface can read your data. Settings stay changeable only from the machine
itself.
