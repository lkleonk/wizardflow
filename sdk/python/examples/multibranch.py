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
    output_dir=str(Path(__file__).parent),
    file_prefix="multibranch",
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
    # Optional one-line description per node (keyed by id), shown behind an
    # info icon in the viewer when the node is selected. Plumbing nodes
    # (user_input, final_response) are intentionally left out.
    node_descriptions={
        "router": "Classifies the request and picks a branch: planner or retriever.",
        "planner": "Decomposes a tool-using request into concrete tool calls.",
        "retriever": "Fetches the most relevant documents for the query.",
        "tool_node": "Runs the planned tool calls against external APIs.",
        "generator": "Writes the answer from the tool result or retrieved docs.",
    },
)

# msg-1 — takes the planner / tool branch.
wizardflow.log("msg-1", "user_input", "Input", "What's the weather in Berlin?")
wizardflow.log("msg-1", "router", "llm_input", "Pick a route for the request...")
wizardflow.log("msg-1", "router", "llm_output", '{"route": "planner", "confidence": 0.92}')
wizardflow.log("msg-1", "planner", "llm_input", "Decompose into tool calls...")
wizardflow.log("msg-1", "planner", "llm_output", "{\"plan\": [\"weather_api(city='Berlin')\"]}")
wizardflow.log("msg-1", "tool_node")  # ran the tool, logged no payload
wizardflow.log("msg-1", "generator", "llm_input", "Answer using the tool result...")
wizardflow.log("msg-1", "generator", "llm_output", "It's 19C and partly cloudy in Berlin.")
wizardflow.log("msg-1", "final_response", "Output", "It's 19C and partly cloudy in Berlin.")
# Optional meta: flat facts about the message as a whole (short scalars only),
# shown on the message's chip in the viewer. Here it records which branch ran
# and how the run turned out.
wizardflow.end_message(
    "msg-1",
    title="Weather in Berlin",
    meta={"branch": "planner", "outcome": "answered", "latency_ms": 10210},
)

# msg-2 — takes the retriever branch (skips planner/tool entirely).
wizardflow.log("msg-2", "user_input", "Input", "Summarize the attached research paper.")
wizardflow.log("msg-2", "router", "llm_input", "Pick a route for the request...")
wizardflow.log("msg-2", "router", "llm_output", '{"route": "retriever", "confidence": 0.88}')
wizardflow.log("msg-2", "retriever", "Input", {"topK": 4, "namespace": "papers"})
wizardflow.log("msg-2", "retriever", "Retrieved docs", [
    {"id": "doc-7", "score": 0.81},
    {"id": "doc-2", "score": 0.77},
])
wizardflow.log("msg-2", "generator", "llm_input", "Summarize the retrieved documents...")
wizardflow.log("msg-2", "generator", "llm_output",
               "The paper proposes a sparse attention variant with near-linear cost.")
wizardflow.log("msg-2", "final_response", "Output",
               "The paper proposes a sparse attention variant with near-linear cost.")
wizardflow.end_message(
    "msg-2",
    title="Summarize research paper",
    meta={"branch": "retriever", "outcome": "answered", "docs_used": 2, "latency_ms": 7130},
)

print(f"wrote {wiz.current_path}")
