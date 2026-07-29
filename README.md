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
- **Three calls, zero dependencies.** The whole SDK API is `init`, `log`,
  `end_message` — pure Python that pulls nothing into your environment.
- **Explicit by design.** You place every log call, so a trace contains exactly
  what you chose to record — nothing more.

## Quickstart

Record a run with the SDK, then open the trace in the viewer:

```python
import wizardflow

wiz = wizardflow.init(file_prefix="run", nodes=[...], edges=[...])

# log(message_id, node, payload_label, payload_value)
wizardflow.log("msg-1", "router", "llm_output", output)

wizardflow.end_message("msg-1")   # -> appends to the trace (the only call that writes)
print(wiz.current_path)           # run__<timestamp>.jsonl
```

Drop the `.jsonl` file into [getwizardflow.com](https://getwizardflow.com) (or
your local build) to replay it.

## Repo layout

| Path | What |
|------|------|
| `web/` | Next.js viewer (static export) |
| `sdk/python/` | `wizardflow` Python SDK |

See each subfolder's README for details.
