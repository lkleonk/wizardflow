"""Multi-branch graph example. Run: python examples/multibranch.py

The graph branches at `router` into two paths that rejoin at `generator`:

    user_input -> router -+-> planner   -> tool_node -+-> generator -> final_response
                          +-> retriever --------------+

Two messages exercise different branches:
  - msg-1 (weather)  goes router -> planner -> tool_node -> generator
  - msg-2 (research) goes router -> retriever -> generator
A node only appears in a message's steps if that message actually visited it,
so the timeline reflects the real path taken.
"""

import sys
from pathlib import Path

# Make the in-repo package importable without installing.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import wizardflow

wiz = wizardflow.init(
    path=str(Path(__file__).with_name("multibranch.json")),
    name="multibranch",
    description="Branching router agent: a tool path and a retrieval path that rejoin.",
    nodes=[
        "user_input",
        "router",
        "planner",
        "retriever",
        "tool_node",
        "generator",
        "final_response",
    ],
    edges=[
        ("user_input", "router"),
        ("router", "planner"),       # branch A
        ("router", "retriever"),     # branch B
        ("planner", "tool_node"),
        ("tool_node", "generator"),
        ("retriever", "generator"),  # branches rejoin
        ("generator", "final_response"),
    ],
)

# msg-1 — takes the planner / tool branch.
with wizardflow.message(id="msg-1"):
    wizardflow.log("user_input", "Input", "What's the weather in Berlin?")
    wizardflow.log("router", "llm_input", "Pick a route for the request...")
    wizardflow.log("router", "llm_output", '{"route": "planner", "confidence": 0.92}')
    wizardflow.log("planner", "llm_input", "Decompose into tool calls...")
    wizardflow.log("planner", "llm_output", "{\"plan\": [\"weather_api(city='Berlin')\"]}")
    wizardflow.log("tool_node")  # ran the tool, logged no payload
    wizardflow.log("generator", "llm_input", "Answer using the tool result...")
    wizardflow.log("generator", "llm_output", "It's 19C and partly cloudy in Berlin.")
    wizardflow.log("final_response", "Output", "It's 19C and partly cloudy in Berlin.")

# msg-2 — takes the retriever branch (skips planner/tool entirely).
with wizardflow.message(id="msg-2"):
    wizardflow.log("user_input", "Input", "Summarize the attached research paper.")
    wizardflow.log("router", "llm_input", "Pick a route for the request...")
    wizardflow.log("router", "llm_output", '{"route": "retriever", "confidence": 0.88}')
    wizardflow.log("retriever", "Input", {"topK": 4, "namespace": "papers"})
    wizardflow.log("retriever", "Retrieved docs", [
        {"id": "doc-7", "score": 0.81},
        {"id": "doc-2", "score": 0.77},
    ])
    wizardflow.log("generator", "llm_input", "Summarize the retrieved documents...")
    wizardflow.log("generator", "llm_output",
                   "The paper proposes a sparse attention variant with near-linear cost.")
    wizardflow.log("final_response", "Output",
                   "The paper proposes a sparse attention variant with near-linear cost.")

print(f"wrote {wiz.current_path}")
