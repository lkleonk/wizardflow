# WizardFlow Python SDK

**A lightweight tracer for Python agents.** Drop three calls into your code —
`init`, `log`, `end_message` — and turn a messy multi-agent run into a portable
trace you can replay as an interactive graph or export to Markdown/HTML. Because
the trace is just a JSONL file, anyone can replay it: hand it to a teammate or PM
and they drop it into **[getwizardflow.com](https://getwizardflow.com)** in the
browser — no Python, no install. Lightweight by design: pure Python, **zero
runtime dependencies**, no daemon, no setup.

![WizardFlow replaying an agent run](https://raw.githubusercontent.com/lkleonk/wizardflow/main/sdk/python/assets/demo.gif)

▶ **[Watch this exact run live](https://getwizardflow.com/?example=university-consultant)** —
the flow from the GIF, replaying in your browser right now. No install, and
nothing is uploaded.

The file it produces is JSON Lines with a small, documented schema: line 1 is a
`header` record carrying the `graph { nodes, edges }`, then one `message`
record per line (`steps[] → payloads[] { label, value }`). Every line is plain
JSON — `head -1 run.jsonl | jq .graph` just works.

## Why WizardFlow?

Most agent tracing means an observability platform (LangSmith, Langfuse, …): a
server or SaaS account, an ingestion pipeline, auto-instrumentation, dashboards
behind a login. WizardFlow takes the opposite bet:

- **The trace is a file.** No server, no account, no daemon — your run becomes
  a `.jsonl` you can commit, diff, grep, or attach to a bug report.
- **Anyone can replay it.** Hand the file to a teammate or PM and they drop it
  into [getwizardflow.com](https://getwizardflow.com) — no Python, no install,
  and nothing is uploaded (the viewer is fully client-side).
- **Three calls, zero dependencies.** The whole API is `init`, `log`,
  `end_message` — pure Python that pulls nothing into your environment, and no
  framework required (LangGraph support just calls `app.get_graph()` on
  whatever you pass — langgraph itself is never imported).
- **Explicit by design.** You place every `log()` call yourself, so a trace
  contains exactly what you logged — nothing else. No auto-instrumentation
  capturing things behind your back, no surprise PII in the payloads, no
  guessing why a span exists.

If you need fleet-wide monitoring, token-cost dashboards, or eval pipelines,
use an observability platform. WizardFlow is for **understanding one run** —
and being able to hand that run to anybody.

## Install

```bash
pip install wizardflow
```

No runtime dependencies. Developing the SDK itself? See
[CONTRIBUTING.md](https://github.com/lkleonk/wizardflow/blob/main/sdk/python/CONTRIBUTING.md).

## Quickstart

```python
import uuid

import wizardflow

wizardflow.init(
    output_dir="traces",                # where trace files are written
    file_prefix="run",                  # optional; defaults to "wizardflow"
    description="A small router-based agent run.",
    nodes=["user_input", "router", "planner", "tool_node", "final_response"],
    edges=[("user_input", "router"), ("router", "planner")],
)

# Every log names its message in the first argument:
# log(message_id, node, payload_label, payload_value)
msg_id = str(uuid.uuid4())                                # one fresh id per message
wizardflow.log(msg_id, "router", "llm_input", prompt)     # same node, two payloads ->
wizardflow.log(msg_id, "router", "llm_output", output)    #   folded into one step
wizardflow.log(msg_id, "tool_node")                       # visited, no payloads
wizardflow.end_message(msg_id)                            # -> writes the trace
```

There is **no `save()`** and no autosave: `log()` only accumulates in memory,
and `end_message(id)` is the one call that writes the trace. Writes happen at
message boundaries — one **append** per finished message, however many `log()`
calls it contains, so a write costs the same no matter how large the trace has
grown. `init()` returns a client and also stashes it as the module default, so
the bare `wizardflow.log(...)` form above works.

**Concurrency-safe.** Multi-agent setups end messages from many threads/tasks at
once; an internal lock serializes the appends so the shared part file is never
corrupted and no message is lost or duplicated. Every ended message is durable
on disk the moment `end_message` returns — a crash can at worst tear the line
being appended, and readers drop a torn final line and load everything before
it.

## Targeting a message

The first argument to `log` is the message id, so overlapping messages never
collide — interleave them freely (as concurrent agents do) and each step routes
to the right message:

```python
# log(message_id, node, payload_label, payload_value)
wizardflow.log("msg-1", "classifier", "input", text_a)
wizardflow.log("msg-2", "classifier", "input", text_b)   # a different message
wizardflow.log("msg-1", "generator", "output", answer_a)
wizardflow.end_message("msg-1")          # writes msg-1
wizardflow.end_message("msg-2")          # writes msg-2
```

Pass the **string `id`**, never a handle object — safe to hand to a callback or
across threads. A message is created on first reference and finalized by
`end_message`; `end_message(id, title="...")` optionally gives it a human title.

### Choosing message ids

A message is **one unit of work** — one user turn, one run through the graph.
Its id only has to be unique within the run, and it **cannot be reused** once
`end_message` has been called on it. The simplest safe choice is a fresh UUID
per message:

```python
import uuid

msg_id = str(uuid.uuid4())
```

Do **not** use a session id, user id, or thread id as the message id. Those
identify a *conversation*, and a conversation contains many messages — after
the first `end_message(session_id)`, every further `log(session_id, ...)` in
that session raises, because that "message" has already ended. If you want the
session visible in the trace, put it in `init(meta=...)` or in the message
title (`end_message(msg_id, title=...)`) — never in the id. Ids are opaque:
the viewer only displays and groups by them, so encoding meaning into them
buys nothing. Hardcoded ids like `"msg-1"` are fine for demo scripts; `uuid4`
is the right default for real applications.

## One flow, or several at once

`init()` installs the client it returns as the module default. With a single
flow — the common case — **ignore the return value** and call
`wizardflow.log(...)` / `wizardflow.end_message(...)` directly: they work from
any module, with no handle to thread through your code.

Running several agent flows side by side (say, a doctor flow and a patient
flow) means several traces, and each needs its own instance. Keep the returned
client per flow and log through it — and name it **`tracer`**, not `client`,
since `client` in an agent codebase is almost always the LLM client:

```python
doctor_tracer  = wizardflow.init(file_prefix="doctor",  nodes=[...], edges=[...])
patient_tracer = wizardflow.init(file_prefix="patient", nodes=[...], edges=[...])

doctor_tracer.log(doc_msg, "diagnose", "llm_input", prompt)
patient_tracer.log(pat_msg, "intake", "llm_input", prompt)
```

With more than one tracer, don't mix in the bare module-level calls:
`wizardflow.log(...)` always targets the most recently initialized tracer.

## Node descriptions, labels & colors

Nodes can carry a short human description of what they do. In the viewer it
stays out of the way: when a node is selected, a small info icon appears next
to its name in the inspector — click it to read the description. Nodes without
one show no icon, and `wizardflow md` / `wizardflow html` list the described
nodes under the graph.

```python
wizardflow.init(
    nodes=["router", "retriever", "generator"],
    edges=[("router", "retriever"), ("retriever", "generator")],
    node_descriptions={
        "router": "Chooses the next step.",
        "retriever": "Fetches relevant documents.",
        "generator": "Writes the final answer.",
    },
)
```

Two sibling kwargs work the same way: `node_labels` maps ids to the display
name the viewer shows instead of the raw id (especially useful with
`init_from_langgraph`, where the extracted ids are your function names), and
`node_colors` sets accent colors. All three are validated against the declared
nodes: an unknown id raises a `WizardFlowError` at `init()` time so typos fail
fast; with `silent=True` it is logged as a warning on the `wizardflow` logger
and skipped instead. All three also work on `init_from_langgraph`, where they
attach to the extracted node ids — `log()` always targets the **id**, never
the label.

## LangGraph: automatic topology

Instead of listing `nodes`/`edges` by hand, read them straight from a compiled
LangGraph app:

```python
app = workflow.compile(checkpointer=memory)

wizardflow.init_from_langgraph(app, output_dir="traces", file_prefix="trace")

wizardflow.log("msg-1", "planner", "Input", state)   # runtime logging unchanged
wizardflow.end_message("msg-1")
```

You can keep the extracted LangGraph topology and still choose node accent
colors for important nodes:

```python
wizardflow.init_from_langgraph(
    app,
    output_dir="traces",
    file_prefix="trace",
    node_colors={
        "router": "#A78BFA",
        "retriever": "#22D3EE",
        "generator": "#60A5FA",
    },
)
```

By default, a color key that does not match an extracted node id raises a
`WizardFlowError` so typos fail fast. With `silent=True`, unknown color keys
are skipped and logged as a warning instead.

It extracts node ids (keeping `__start__` / `__end__`) and directed edges, and
marks runtime branches with `"conditional": true` (deterministic and parallel
fan-out edges stay plain):

```json
{
  "edges": [
    { "source": "__start__", "target": "router" },
    { "source": "router", "target": "planner", "conditional": true },
    { "source": "planner", "target": "final_response" }
  ]
}
```

LangGraph is **not** a dependency — extraction is duck-typed on `app.get_graph()`.
A non-LangGraph object raises `LangGraphExtractionError`; missing conditional
metadata never fails extraction (the edge is just emitted plain). Call it
**after `compile()`**, when the topology actually exists.

## API

- `init(output_dir=, file_prefix="wizardflow", name=, description=, nodes=, edges=, node_labels=, node_colors=, node_descriptions=, meta=, silent=False, max_bytes=16_000_000, max_messages=2_000) -> Client`
  - `description` lands in `meta.description` (matches the schema field).
  - `nodes=` enables fast-fail: `log()` to an undeclared node raises
    `UnknownNodeError` immediately (unless silenced).
  - `node_labels` / `node_colors` / `node_descriptions` map declared node ids
    to a display name / CSS color / short description; an unknown id raises
    unless silenced (then it's logged as a warning and skipped).
  - `output_dir` is optional; omitted, traces are written in cwd.
  - `file_prefix` is optional; omitted, filenames start with `wizardflow`.
  - `max_bytes` / `max_messages` cap each part file before rotation (see below).
- `init_from_langgraph(app, output_dir=, file_prefix="wizardflow", name=, description=, meta=, node_labels=, node_colors=, node_descriptions=, silent=False, max_bytes=..., max_messages=...) -> Client`
  - same as `init`, but `nodes`/`edges` come from `app.get_graph()`.
  - `node_labels` renames extracted ids for display (they're your function
    names); `node_colors` maps them to CSS colors such as `"#A78BFA"`;
    `node_descriptions` to short descriptions.
- `log(id, node, label=None, content=None)` — the first positional is the
  **message id**, the second is the node. With `label`/`content` it records a
  payload; bare `log(id, "node")` records a visit with no payloads. The message
  is created on first reference; this only accumulates in memory.
- `end_message(id, title=None)` — finalize a message and append it to the
  trace; returns the current trace path. The **only** call that touches disk.
  Optional `title` sets the message's human title. Idempotent.
- `reinit(name=None, description=None, meta=None)` — start a **new trace
  file** (fresh timestamped name), keeping the graph and output configuration.
  Use it at natural boundaries of a long-lived process — a new user session, a
  new day. The old file is left as-is (**no seal**: it's a finished run, not a
  rotated part). Open messages carry over and are written wherever they end;
  completed message ids become reusable. `name`/`description`/`meta` replace
  the current values when given. Returns the new trace path.
- `Client.current_path` — the trace file currently being written.
- `to_dict()` / `to_json()` — inspect the active part (completed messages),
  assembled into one `AgentTraceFile` object.

### The file format

A trace part is JSON Lines: one JSON object per line, each with a `type`:

```jsonl
{"type":"header","version":"0.2","name":"run","meta":{...},"graph":{"nodes":[...],"edges":[...]}}
{"type":"message","id":"msg-1","label":"First question","steps":[...]}
{"type":"message","id":"msg-2","steps":[...]}
{"type":"seal","nextPart":"run__...__part2.jsonl"}
```

- **`header`** (always line 1) — everything about the run except the messages.
- **`message`** — one completed message, appended by `end_message`.
- **`seal`** — only on a part that rotated away; its presence means "this part
  is complete, continue at `nextPart`". The active part has no seal.

Readers skip records with an unknown `type` (forward compat) and drop an
unparseable final line (a crash mid-append leaves a torn tail; everything
before it is intact). Only **completed** messages are written; an in-progress
message lives in memory until it ends.

> Early SDK versions (0.1) wrote a trace as one single-document `.json` file
> instead. Newer versions write JSONL only, but every reader — the CLI
> subcommands and the web UI at getwizardflow.com — still opens both formats.

### How saving works

`end_message` **appends one line** to the active part — O(1) no matter how
large the part already is, and the moment it returns, that message is durable
on disk. Nothing is ever rewritten.

### Rotation (no single huge file)

There's no natural "end" to a chatbot trace, so the SDK caps part size instead.
The cap exists for the *reader*: a part is what you drop into the viewer, and an
oversized file makes the browser tab sluggish. Each run writes a timestamped
entry file whose name carries the run-start time:

```
wizardflow__2026-06-08T16-29-09-123Z.jsonl
```

The name's `wizardflow` is the `file_prefix`; the timestamp is captured when
`init()` creates the client. If the next message would push the active part past
`max_bytes` (16 MB by default) — or past `max_messages` (2,000 by default; many
tiny messages strain the viewer before many bytes do) — the part is sealed and
the message starts a fresh one:

```
wizardflow__2026-06-08T16-29-09-123Z.jsonl
wizardflow__2026-06-08T16-29-09-123Z__part2.jsonl
wizardflow__2026-06-08T16-29-09-123Z__part3.jsonl
```

Rotation only ever happens at a **message boundary**, never mid-message (a lone
message larger than the cap gets its own oversized part). `max_bytes` is
clamped to a hard ceiling (64 MB) — past that, parsed-object inflation makes
the viewer slow on ordinary hardware. Each part is **self-contained** (full
graph in its header + its slice of messages), chained backward via the header's
`meta.prevPart` and forward via the seal record's `nextPart`.

A single-part trace stays clean (no `part` metadata, no seal). There's no
`partCount` — the total is genuinely unknown while a continuous run is still
logging; follow the seal records to walk to the end. Since names are
timestamped, read the real file back from the client's `current_path` (also the
path `end_message` returns).

### Logging

Rotation emits an `INFO` notice on the `wizardflow` logger. Following library
convention, the SDK attaches a `NullHandler` and configures nothing — you see
nothing unless you opt in:

```python
import logging
logging.getLogger("wizardflow").setLevel(logging.INFO)
```

This is separate from `silent=` (which governs raise-vs-swallow for *errors*).

### Step folding

Consecutive `log()` calls to the **same** node within a message fold into a
single step with multiple payloads (e.g. a router step carrying both
`llm_input` and `llm_output`). A `log()` to a different node starts a new step.

## What to log (conventions)

Payload labels are free-form strings — the schema reserves none of them. These
conventions just keep traces consistent and readable:

- **LLM-backed nodes** — log the exact prompt as `llm_input` and the raw
  completion as `llm_output`. When a run goes wrong, the trace then shows
  precisely what the model saw and what it said — most of what you need to
  debug an agent — and step folding merges the pair into one step.
- **Everything else** — log the node's real domain data under honest labels: a
  retriever logs its `query` and `results`, a tool node `tool_input` and
  `tool_output`, a deterministic router its `decision`. Don't force
  `llm_input`/`llm_output` onto nodes that never call a model.

## Examples

Fuller runnable examples live in
[`examples/`](https://github.com/lkleonk/wizardflow/tree/main/sdk/python/examples):

- **`quickstart.py`** — a small linear agent; two messages, the second finalized
  with an `end_message(..., title=...)` title.
- **`multibranch.py`** — `router` fans out into a planner/tool path and a
  retriever path that rejoin at `generator`. Two messages take different
  branches, so each logs only the nodes it actually visited.

## CLI

The `wizardflow` command has four subcommands: `ui`, `md`, `html`, and `json`.
Every one takes the trace file as a positional argument **or** via `--path`
(pass one, not both):

```bash
wizardflow ui   run.jsonl
wizardflow md   run.jsonl
wizardflow html run.jsonl
wizardflow json run.jsonl
# --path is equivalent everywhere:
wizardflow ui --path run.jsonl
```

The SDK only ever **writes** JSONL, but these commands **read** either framing —
a `.jsonl` part or a single-document `.json` (what `wizardflow json` emits) — so
they stay at parity with the web viewer, which also accepts both.

### `wizardflow ui` — local viewer

```bash
wizardflow ui run.jsonl [--host 127.0.0.1] [--port 0] [--no-open]
```

Binds a stdlib HTTP server, serves the static WizardFlow UI bundled in the SDK
package, and opens the selected trace in your browser (the JSONL is assembled
server-side and served to the UI as one JSON document, re-read on refresh — so
you can watch a still-running trace grow).

| flag | default | meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | interface to bind |
| `--port` | `0` | port to bind; `0` asks the OS for a free port |
| `--no-open` | off | print the local URL instead of launching a browser |

### `wizardflow md` — export to Markdown

```bash
wizardflow md run.jsonl                 # -> stdout
wizardflow md run.jsonl -o run.md       # -> file
wizardflow md run.jsonl --no-mermaid    # omit the graph diagram
```

Renders the full trace as Markdown: a metadata table, a Mermaid `flowchart` of
the graph, then each message's steps and payloads (scalars inline; multi-line
strings and dict/list values in fenced code blocks; conditional edges drawn
dashed).

| flag | default | meaning |
| --- | --- | --- |
| `-o`, `--output` | — | write to this file instead of stdout |
| `--mermaid` | on | include the Mermaid graph diagram |
| `--no-mermaid` | — | omit the Mermaid graph diagram |

### `wizardflow html` — export to HTML

```bash
wizardflow html run.jsonl               # -> stdout
wizardflow html run.jsonl -o run.html   # -> file
```

Emits a single self-contained document — inline CSS, **no JavaScript, no
external assets** — that opens offline in any browser and follows your OS
light/dark mode. Messages-only by design: no graph/Mermaid (use `md` for that).

| flag | default | meaning |
| --- | --- | --- |
| `-o`, `--output` | — | write to this file instead of stdout |

### `wizardflow json` — assemble to one pretty-printed JSON document

```bash
wizardflow json run.jsonl               # -> stdout
wizardflow json run.jsonl -o run.json   # -> file
```

The inverse of how the SDK writes. JSONL is built for appending, so the raw
file is one long line per record and not much fun to read. This assembles the
part — header plus all its message records, with the seal's `nextPart` folded
into `meta` — into the indented, single-document `AgentTraceFile` shape, for
eyeballing, diffing in review, or handing someone a canonical JSON. (The web UI
reads that single-document form too.)

| flag | default | meaning |
| --- | --- | --- |
| `-o`, `--output` | — | write to this file instead of stdout |

Already have `jq`? You don't need this for a quick look — `jq . run.jsonl`
pretty-prints every record, and `jq 'select(.type=="message")' run.jsonl` just
the messages. `wizardflow json` differs in that it *assembles* the part into one
document (and walks no external tool).

Rendered samples (`*.md`, `*.html`) live in the [repo's
`examples/`](https://github.com/lkleonk/wizardflow/tree/main/sdk/python/examples).

## Status / not yet

- **Timestamps** are wall-clock at log time — fine for slow/live runs, wrong if
  steps fire faster than ms resolution or you import after the fact. (Open
  design item: explicit per-step timestamps.)
