# WizardFlow Python SDK

Record agent flows from your Python code and write them to the **AgentTrace**
file format (schema `0.1`) that the WizardFlow visualizer replays.

Website: **[getwizardflow.com](https://getwizardflow.com)**

![WizardFlow replaying an agent run](https://raw.githubusercontent.com/lkleonk/wizardflow/main/sdk/python/assets/demo.gif)

The JSON this SDK produces matches `src/types/agenttrace.ts` in the main repo
(`graph { nodes, edges }` + `messages[] → steps[] → payloads[] { label, value }`).

## Install

```bash
pip install wizardflow
```

No runtime dependencies. To work against a local checkout instead:

```bash
cd sdk/python
pip install -e ".[dev]"
```

## Quickstart

```python
import wizardflow

wizardflow.init(
    output_dir="traces",                # where trace files are written
    file_prefix="run",                  # optional; defaults to "wizardflow"
    description="A small router-based agent run.",
    nodes=["user_input", "router", "planner", "tool_node", "final_response"],
    edges=[("user_input", "router"), ("router", "planner")],
)

# Every log names its message in the first argument.
wizardflow.log("msg-1", "router", "llm_input", prompt)    # same node, two payloads ->
wizardflow.log("msg-1", "router", "llm_output", output)   #   folded into one step
wizardflow.log("msg-1", "tool_node")                       # visited, no payloads
wizardflow.end_message("msg-1")                            # -> writes the trace
```

There is **no `save()`** and no autosave: `log()` only accumulates in memory,
and `end_message(id)` is the one call that writes the trace. Writes happen at
message boundaries — one write per finished message, however many `log()` calls
it contains. `init()` returns a client and also stashes it as the module
default, so the bare `wizardflow.log(...)` form above works.

**Concurrency-safe.** Multi-agent setups end messages from many threads/tasks at
once; an internal lock serializes the mutation-and-write so the shared part file
is never corrupted and no message is lost or duplicated. The write itself is
atomic (temp file + `os.replace`), so the file on disk is always a complete,
valid trace.

## Targeting a message

The first argument to `log` is the message id, so overlapping messages never
collide — interleave them freely (as concurrent agents do) and each step routes
to the right message:

```python
wizardflow.log("msg-1", "classifier", "input", text_a)
wizardflow.log("msg-2", "classifier", "input", text_b)   # a different message
wizardflow.log("msg-1", "generator", "output", answer_a)
wizardflow.end_message("msg-1")          # writes msg-1
wizardflow.end_message("msg-2")          # writes msg-2
```

Pass the **string `id`**, never a handle object — safe to hand to a callback or
across threads. A message is created on first reference and finalized by
`end_message`; `end_message(id, title="...")` optionally gives it a human title.

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
`WizardFlowError` so typos fail fast. With `silent=True`, unknown color keys are
ignored.

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

## API (v0.1)

- `init(output_dir=, file_prefix="wizardflow", name=, description=, nodes=, edges=, meta=, silent=False, max_bytes=256_000) -> Client`
  - `description` lands in `meta.description` (matches the schema field).
  - `nodes=` enables fast-fail: `log()` to an undeclared node raises
    `UnknownNodeError` immediately (unless silenced).
  - `output_dir` is optional; omitted, traces are written in cwd.
  - `file_prefix` is optional; omitted, filenames start with `wizardflow`.
  - `max_bytes` caps each part file before rotation (see below).
- `init_from_langgraph(app, output_dir=, file_prefix="wizardflow", name=, description=, meta=, node_colors=, silent=False, max_bytes=...) -> Client`
  - same as `init`, but `nodes`/`edges` come from `app.get_graph()`.
  - `node_colors` maps extracted node ids to CSS colors such as `"#A78BFA"`.
- `log(id, node, label=None, content=None)` — the first positional is the
  **message id**, the second is the node. With `label`/`content` it records a
  payload; bare `log(id, "node")` records a visit with no payloads. The message
  is created on first reference; this only accumulates in memory.
- `end_message(id, title=None)` — finalize a message and write the trace;
  returns the current trace path. The **only** call that touches disk. Optional `title`
  sets the message's human title. Idempotent.
- `Client.current_path` — the trace file currently being written.
- `to_dict()` / `to_json()` — inspect the active part (completed messages).

### How saving works

`end_message` triggers an **atomic write**: write to `<part>.tmp`, then
`os.replace` over the part file. The file is always a complete, loadable
`AgentTraceFile`. Only **completed** messages are written; an in-progress
message lives in memory until it ends.

### Rotation (no single huge file)

There's no natural "end" to a chatbot trace, so the SDK caps file size instead.
Each run writes a timestamped entry file whose name carries the run-start time:

```
wizardflow__2026-06-08T16-29-09-123Z.json
```

The name's `wizardflow` is the `file_prefix`; the timestamp is captured when
`init()` creates the client. If the active part would exceed `max_bytes` (~256
KB by default), it's sealed and the next message starts a fresh part:

```
wizardflow__2026-06-08T16-29-09-123Z.json
wizardflow__2026-06-08T16-29-09-123Z__part2.json
wizardflow__2026-06-08T16-29-09-123Z__part3.json
```

Rotation only ever happens at a **message boundary**, never mid-message (a lone
message larger than the cap gets its own oversized part). A smaller cap keeps
each rewrite — and the write lock held across it — short, which matters when
many agents end messages concurrently; raise it for fewer files at the cost of
heavier rewrites. `max_bytes` is clamped to a hard ceiling (1 MB) so an
accidental huge value can't stall concurrent writers. Each part is a
**self-contained, valid trace** (full graph + its slice of messages), chained
via `meta`:

```json
"meta": { "part": 2, "prevPart": "...Z.json", "nextPart": "...__part3.json" }
```

A single-part trace stays clean (no `part` metadata). There's no `partCount` —
the total is genuinely unknown while a continuous run is still logging; follow
`nextPart` to walk to the end. Since names are timestamped, read the real file
back from `wiz.current_path`.

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
single step with multiple payloads (matching the sample data, where e.g. the
router step carries both `llm_input` and `llm_output`). A `log()` to a
different node starts a new step.

## Examples

Runnable scripts in `examples/` (each writes a timestamped part file next to
itself and prints the path; load that file in the visualizer). They add `src/`
to the path, so no install is needed:

```bash
python examples/quickstart.py     # linear flow, two messages, optional title
python examples/multibranch.py    # branching graph, two messages, two paths
```

- **`quickstart.py`** — a small linear agent; two messages, the second one
  finalized with an `end_message(..., title=...)` title.
- **`multibranch.py`** — `router` fans out into a planner/tool path and a
  retriever path that rejoin at `generator`. Two messages take different
  branches, so each logs only the nodes it actually visited.

The generated `.json` files are gitignored (regenerated on each run).

## CLI

The `wizardflow` command has three subcommands: `ui`, `md`, and `html`. Every
one takes the trace file as a positional argument **or** via `--path` (pass one,
not both):

```bash
wizardflow ui   run.json
wizardflow md   run.json
wizardflow html run.json
# --path is equivalent everywhere:
wizardflow ui --path run.json
```

### `wizardflow ui` — local viewer

```bash
wizardflow ui run.json [--host 127.0.0.1] [--port 0] [--no-open]
```

Binds a stdlib HTTP server, serves the static WizardFlow UI bundled in the SDK
package, and opens the selected trace in your browser.

| flag | default | meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | interface to bind |
| `--port` | `0` | port to bind; `0` asks the OS for a free port |
| `--no-open` | off | print the local URL instead of launching a browser |

### `wizardflow md` — export to Markdown

```bash
wizardflow md run.json                 # -> stdout
wizardflow md run.json -o run.md       # -> file
wizardflow md run.json --no-mermaid    # omit the graph diagram
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
wizardflow html run.json               # -> stdout
wizardflow html run.json -o run.html   # -> file
```

Emits a single self-contained document — inline CSS, **no JavaScript, no
external assets** — that opens offline in any browser and follows your OS
light/dark mode. Messages-only by design: no graph/Mermaid (use `md` for that).

| flag | default | meaning |
| --- | --- | --- |
| `-o`, `--output` | — | write to this file instead of stdout |

Rendered samples of both formats live in `examples/` (`*.md`, `*.html`).

### Refreshing the bundled UI

The bundled UI lives in `src/wizardflow/_ui/` and is committed so a standalone
SDK checkout works without the website source or a Node build step. Maintainers
can refresh that bundle from the monorepo frontend after UI changes:

```bash
python scripts/build_ui.py
```

That script runs the shared Next frontend with
`NEXT_PUBLIC_WIZARDFLOW_TARGET=local`, copies the static export into
`src/wizardflow/_ui/`, and removes hosted-only legal route artifacts. The SDK UI
keeps the GitHub project link but does not include `Impressum` or `Datenschutz`.

## Tests

```bash
pip install pytest      # declared under the [dev] extra
pytest                  # from sdk/python/
```

`tests/conftest.py` puts `src/` on the path, so the suite runs without an
install. The tests pin the emitted schema shape and the recording semantics
(folding, completed-only persistence, atomic write, `id=` targeting, unknown-node
fast-fail, …).

## Status / not yet

- **Timestamps** are wall-clock at log time — fine for slow/live runs, wrong if
  steps fire faster than ms resolution or you import after the fact. (Open
  design item: explicit per-step timestamps.)
- Messages are addressed by an explicit string `id` on every `log`, so logging
  from any thread or async task works with no context propagation to set up —
  just pass the same id.
