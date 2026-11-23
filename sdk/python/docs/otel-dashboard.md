# OTel dashboard

`wizardflow dashboard` opens a local dashboard over your OpenTelemetry data:
projects, traces, logs, and every span with its attributes. A trace that has
graph nodes also opens in **graph replay**, the same viewer `wizardflow replay`
shows for a JSONL run.

Everything stays on your machine. The data lives in one SQLite file, and the
dashboard is served by a standard-library HTTP server bundled with the package.
It needs no extra dependencies, collector, or account.

Data gets in two ways: import your WizardFlow runs or OTLP files, or let your
apps send OTLP to the dashboard's receiver while it runs.

```bash
wizardflow dashboard run.jsonl            # import a run or OTLP JSON, then open the dashboard
wizardflow dashboard                      # just open it, receiving OTLP on :4318
wizardflow db import run.jsonl            # import without opening the dashboard
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
| `db import` | Imports WizardFlow runs and OTLP JSON files: spans, span events, links, and logs. |
| `db info` | Prints the schema version, file size, number of imports, and each project's traces, spans, and logs. |
| `db migrate` | Upgrades the schema. Opening a database does this anyway, so you rarely need it. |

### What `db import` accepts

- **Your own WizardFlow runs:** a `.jsonl` run, or the single-document JSON
  form. Each execution becomes a trace, and a run's executions are grouped as
  one conversation named after when it started, so they replay together. They
  carry the recorded graph, so they open in graph replay with their exact
  topology. Naming any part of a rotated run imports all of its parts.
- **OTLP JSON,** as the OpenTelemetry Collector's file exporter writes it: one
  export request per line. A single pretty-printed request in one file works
  too.

The file type is detected from its content, so you can mix both in one command.

- **Re-importing is safe.** A file whose contents were already imported is
  skipped, and spans and logs already in the database are skipped and counted.
  Importing a run again after it has grown adds only the new executions, and
  updates the ones that were still running.
- **Projects:** every span and log is filed under a project. Its name comes
  from the resource: `openinference.project.name`, else `service.name`, else
  `default`. To change these keys, set the **Project** concept in Settings,
  before you import. `--project NAME` puts the whole file into one project
  instead. A WizardFlow run is filed under its own name.

`wizardflow dashboard FILE...` imports the same way, then opens the dashboard
on the first file's project. `--project NAME` works there too. `wizardflow
replay` does not take OTLP files: it shows one WizardFlow run and stores
nothing.

**Import a run** in the dashboard's sidebar does the same for one file you pick
in the browser: the dashboard server imports it, then opens its project. It is
accepted from this machine only. For a rotated run, pick its first part: the
browser sends one file, so that part comes in on its own, and a later part is
refused. `db import` on the first part brings in the whole chain.

## Opening the dashboard

```bash
wizardflow dashboard [FILE...] [--project NAME] [--db PATH] [--host 127.0.0.1]
                     [--port 0] [--no-open] [--otlp | --no-otlp] [--otlp-port 4318]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `FILE...` | none | WizardFlow runs or OTLP JSON files to import first |
| `--project` | none | Put the imported files into this project, and open it |
| `--db` | `./.wizardflow/wizardflow.db` | Database file; created if missing |
| `--host` | `127.0.0.1` | Interface to bind, for the dashboard and the receiver |
| `--port` | `0` | Dashboard port; zero asks the OS for a free port |
| `--no-open` | off | Print the URL instead of opening a browser |
| `--otlp`, `--no-otlp` | on for a loopback `--host`, otherwise off | Run the [live receiver](#live-receiver) or not |
| `--otlp-port` | `4318` | Receiver port, the OTLP/HTTP standard |

The dashboard is at `http://127.0.0.1:PORT/otel`. New data, from the receiver
or a `db import` while it runs, shows up on its own: open pages check for it
every 2 seconds, or every 15 once nothing has arrived for a minute, and pause
while the tab is hidden.

## Live receiver

`wizardflow dashboard` also accepts OTLP over HTTP, so an app sends its traces and
logs straight into the database. This is on by default when the dashboard is
bound to your machine only; `--no-otlp` turns it off, and with another `--host`
you turn it on with `--otlp`. Point the app's OpenTelemetry SDK at it:

```bash
wizardflow dashboard
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 python my_app.py
```

- **Routes:** `POST /v1/traces` and `POST /v1/logs`, each as protobuf (what
  the OTel SDKs send by default) or JSON, optionally gzipped. Metrics are not
  stored and answer 404; set `OTEL_METRICS_EXPORTER=none` if your app exports
  them, to keep its log quiet.
- **Python apps** need the OTel SDK's OTLP/HTTP exporter
  (`opentelemetry-exporter-otlp-proto-http`); gRPC on port 4317 is not
  supported.
- **Same import as files:** projects, dedup, and the attribute mapping work as
  for `db import`. A span or log sent twice is stored once, so exporter
  retries are safe. Spans without a valid trace or span id are refused and reported back
  to the exporter as rejected.
- **A taken port** (a Collector running on 4318, say) gives a warning, and the
  dashboard opens without the receiver; pick another with `--otlp-port`. A port
  you chose with `--otlp-port` that is taken stops `dashboard` with an error.
- **Your own runs** can go there too, with no OTel packages:
  `wizardflow otel export run.jsonl --endpoint http://127.0.0.1:4318/v1/traces`.

Settings → Live receiver shows the endpoint and what arrived since `dashboard`
started, and the sidebar shows a green dot while the receiver runs.

## Pages

**Projects.** One card per project, showing its traces, spans, logs, error
rate, tokens, services, an activity chart of traces per half hour, and where
its data came from: a file uploaded with Import a run, a file imported from
the command line, or the OTLP receiver (whether or not an app is still
sending). Hover that line for each file's name and path.

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

- The header shows the conversation and which execution this is, with ‹ › to
  step through the conversation.
- The span tree folds away («) or resizes by dragging the gap.
- Span dots take the colour their node has in graph replay. Error spans are
  red.
- Pin an attribute with its pin icon to show it first on every span.

**Logs.** The project's log records. You can filter by minimum severity and by
whether a record belongs to a trace, and search their text. Click a row to see
its attributes and ids; its trace link opens the span it was logged in.

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

A trace with graph nodes shows **Show graph** in a strip above the inspector.
That opens the graph right under the strip: it highlights the selected span's
node, and clicking a node selects its latest span in this execution. The
strip's step and play buttons (or `←`, `→`, and Space) walk through this
execution's nodes and stop at the last one.

**Open graph replay**, at the top right of the span page, opens the full view
on that execution and node. Graph replay plays the run back node by node, in
the same viewer as `wizardflow replay`, and the dashboard's sidebar stays beside
it, folded or not as you left it. **Open span timeline**, in the same
corner of the replay, goes the other way, to the span of the current step. In
the inspector, **Span timeline** does the same for one particular node visit.
The back arrow returns to the view you came from.

Search (Ctrl+K) works on both pages. In the replay it covers the whole
conversation's payloads, titles, and meta. On the span page it covers the open
execution's span names, attributes, events, and logs, and a result selects its
span.

The download icon saves runs as WizardFlow JSONL files, to share, open on
getwizardflow.com, or import into another database. On the span page (in the
row under the breadcrumb) you choose what to save: this execution, its
conversation, or the whole project; the icon at the end of the trace list's
filter row opens on the whole project. For a conversation or the project you
can keep only the executions started in the last hour, 24 hours, or 7 days.
One conversation is one `.jsonl`; several are a `.zip` with one file per
conversation. Traces without graph nodes can't be saved as runs: they are left
out, and the dialog says how many.

The files hold the graph, the node steps, and their payloads, but not logs or
spans that aren't graph nodes. A graph inferred from the run order stays
inferred, without unvisited branches.

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

**Live receiver.** The receiver's endpoint, the requests, spans and logs it
received since `dashboard` started, and the last refused request. When the receiver
isn't running, it shows how to start it.

## Safety

The server binds to `127.0.0.1` by default and reads the database through
read-only connections. The dashboard's only writes are mapping changes from
Settings, and the server accepts them only:

- from a local host name, as `Host` (`localhost`, `127.0.0.1`, `::1`);
- from a local `Origin`, if one is sent;
- as a JSON body up to 1 MB.

This keeps other websites in your browser from changing your settings.

The live receiver writes too, by design: it accepts OTLP from any program that
can reach its port. On `127.0.0.1` that is your own machine. It still refuses
requests that come from web pages (an `Origin` header that isn't local), and
on a loopback address also a `Host` that isn't local. A body may be up to
20 MiB, before and after gzip.

If you bind to another interface with `--host`, anyone who can reach that
interface can read your data, and with `--otlp` also send data into it.
Settings stay changeable only from the machine itself.
