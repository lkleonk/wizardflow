# WizardFlow

Replay and inspect AI agent runs as messages moving through a graph.

**Website: [getwizardflow.com](https://getwizardflow.com)**

![WizardFlow replaying an agent run](sdk/python/assets/demo.gif)

WizardFlow has two halves that share one file format (`AgentTrace` JSON):

- **[`web/`](web/)** — a fully client-side Next.js viewer that replays a run as a
  message timeline, ordered node steps, live graph activity, and payload
  inspection. Nothing is uploaded; flows are processed in your browser.
- **[`sdk/python/`](sdk/python/)** — a zero-dependency Python SDK that records
  your agent runs into the JSON the viewer replays. `pip install wizardflow`.

## Quickstart

Record a run with the SDK, then open the JSON in the viewer:

```python
import wizardflow

wizardflow.init(path="wizardflow.json", nodes=[...], edges=[...])
with wizardflow.message(id="msg-1"):
    wizardflow.log("router", "llm_output", output)
```

Drop `wizardflow.json` into [getwizardflow.com](https://getwizardflow.com) (or
your local build) to replay it.

## Repo layout

| Path | What |
|------|------|
| `web/` | Next.js viewer (static export) |
| `sdk/python/` | `wizardflow` Python SDK |

See each subfolder's README for details.
