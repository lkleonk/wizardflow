"""Minimal end-to-end example. Run: python examples/quickstart.py

Shows both ways to target a message:
  - inside `with wizardflow.message(id=...)` -> log needs no id
  - anywhere else -> pass id="..."
The trace is written automatically when each message ends. The actual filename
is timestamped + numbered (e.g. quickstart_2026-06-08T16-29-09_001.json), so
read it back from wiz.current_path rather than the path you passed.
"""

import sys
from pathlib import Path

# Make the in-repo package importable without installing.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import wizardflow

wiz = wizardflow.init(
    path=str(Path(__file__).with_name("quickstart.json")),
    name="quickstart",
    description="Tiny router agent recorded with the WizardFlow Python SDK.",
    nodes=["user_input", "router", "planner", "tool_node", "final_response"],
    edges=[
        ("user_input", "router"),
        ("router", "planner"),
        ("planner", "tool_node"),
        ("tool_node", "final_response"),
    ],
)

# Message 1 — ambient form: log() picks up the id from the with-block.
with wizardflow.message(id="msg-1"):
    wizardflow.log("user_input", "Input", "What's the weather in Berlin?")
    wizardflow.log("router", "llm_input", "Route this request...")
    wizardflow.log("router", "llm_output", '{"route": "planner"}')
    wizardflow.log("tool_node")  # visited, no payloads
    wizardflow.log("final_response", "Output", "It's 19C and partly cloudy in Berlin.")
# -> quickstart.json now contains msg-1

# Message 2 — explicit-id form: no with-block, just name the message.
wizardflow.log("user_input", "Input", "Summarize the paper.", id="msg-2")
wizardflow.log("router", "llm_output", '{"route": "planner"}', id="msg-2")
wizardflow.end_message("msg-2")  # dump signal
# -> the part file now contains msg-1 and msg-2

print(f"wrote {wiz.current_path}")
