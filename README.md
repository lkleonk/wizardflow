# WizardFlow

Replay and inspect AI agent runs as messages moving through a graph.

**Website: [getwizardflow.com](https://getwizardflow.com) · ▶ Live demo:
[watch an example run replay](https://getwizardflow.com/?example=doctor-consultation)**

![WizardFlow replaying an agent run](sdk/python/assets/demo.gif)

WizardFlow has two halves that share one file format (`AgentTrace` JSONL):

- **[`web/`](web/)** — a fully client-side Next.js viewer that replays a run as a
  message timeline, ordered node steps, live graph activity, and payload
  inspection. Nothing is uploaded; flows are processed in your browser.
- **[`sdk/python/`](sdk/python/)** — a zero-dependency Python SDK that records
  your agent runs into the JSONL trace the viewer replays.
  `pip install wizardflow`.

## Why WizardFlow?

- **The trace is a file.** No server, no account, no infra — recording a run
  produces a `.jsonl` you can commit, diff, grep, or attach to a bug report.
- **Anyone can replay it.** Drop the file into
  [getwizardflow.com](https://getwizardflow.com) — no Python, no install; the
  viewer is fully client-side, so nothing is uploaded.
- **Small, zero-dependency API.** Scope a node execution, record the values you
  care about, and end the message when its run through the graph is complete.
- **Explicit by design.** You place every recording call, so a trace contains
  exactly what you chose to record — nothing more.

## Quickstart

Record a run with the SDK, then open the trace in the viewer:

```python
import wizardflow

trace = wizardflow.init(
    file_prefix="run",
    nodes=["generator"],
)

with trace.node("msg-1", "generator") as node:
    node.log_input(prompt)
    node.log_output(response)

trace_path = trace.end_message("msg-1")  # appends to the trace
print(trace_path)                       # run__<timestamp>.jsonl
```

OpenTelemetry export is optional: WizardFlow can project the same node
executions to OTLP-compatible observability platforms while retaining JSONL as
the portable source of truth. The base SDK remains dependency-free.

For generic `log()` records, lower-level lifecycle control, and detailed
OpenTelemetry configuration, see the [Python SDK guide](sdk/python/README.md).

Drop the `.jsonl` file into [getwizardflow.com](https://getwizardflow.com) (or
your local build) to replay it.

## Repo layout

| Path | What |
|------|------|
| `web/` | Next.js viewer (static export) |
| [`sdk/python/`](sdk/python/) | `wizardflow` Python SDK and full usage documentation |

See the [Python SDK guide](sdk/python/README.md) for semantic logging,
OpenTelemetry configuration, privacy controls, trace rotation, and CLI usage.
