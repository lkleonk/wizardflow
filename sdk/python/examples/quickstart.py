"""Minimal end-to-end example. Run: python examples/quickstart.py

Each log() names its message in the first argument; end_message() finalizes a
message and is the only thing that writes the file. The actual filename is
timestamped (e.g. quickstart__2026-06-08T16-29-09-123Z.json), so read it back
from wiz.current_path.
"""

import sys
from pathlib import Path

# Make the in-repo package importable without installing.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import wizardflow

wiz = wizardflow.init(
    output_dir=str(Path(__file__).parent),
    file_prefix="quickstart",
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

# Message 1 — each log names its message ("msg-1") in the first argument.
wizardflow.log("msg-1", "user_input", "Input", "What's the weather in Berlin?")
wizardflow.log("msg-1", "router", "llm_input", "Route this request...")
wizardflow.log("msg-1", "router", "llm_output", '{"route": "planner"}')
wizardflow.log("msg-1", "tool_node")  # visited, no payloads
wizardflow.log("msg-1", "final_response", "Output", "It's 19C and partly cloudy in Berlin.")
wizardflow.end_message("msg-1")  # <- writes the file; msg-1 is now persisted

# Message 2 — same shape; an optional title gives the message a human title.
wizardflow.log("msg-2", "user_input", "Input", "Summarize the paper.")
wizardflow.log("msg-2", "router", "llm_output", '{"route": "planner"}')
wizardflow.end_message("msg-2", title="Summarize the paper")
# -> the part file now contains msg-1 and msg-2

print(f"wrote {wiz.current_path}")
