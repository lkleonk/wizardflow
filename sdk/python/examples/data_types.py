"""JSON-native data type example. Run: python examples/data_types.py

Each node is named after the Python data type being logged. Load the generated
WizardFlow JSON in the visualizer to see how the inspector renders each value.
"""

import sys
from pathlib import Path

# Make the in-repo package importable without installing.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import wizardflow

nodes = [
    "string",
    "integer",
    "float",
    "boolean",
    "none",
    "list",
    "dict",
    "nested_dict",
    "mixed_list",
    "final",
]

wiz = wizardflow.init(
    output_dir=str(Path(__file__).parent),
    file_prefix="data_types",
    name="data_types",
    description="Shows how JSON-native Python values render in WizardFlow.",
    nodes=nodes,
    edges=list(zip(nodes, nodes[1:])),
)

wizardflow.log("msg-1", "string", "value", "A plain Python string.")
wizardflow.log("msg-1", "integer", "value", 42)
wizardflow.log("msg-1", "float", "value", 0.875)
wizardflow.log("msg-1", "boolean", "value", True)
wizardflow.log("msg-1", "none", "value", None)
wizardflow.log("msg-1", "list", "value", ["router", "retriever", "generator"])
wizardflow.log(
    "msg-1",
    "dict",
    "value",
    {
        "route": "retriever",
        "confidence": 0.88,
        "needs_tool": True,
    },
)
wizardflow.log(
    "msg-1",
    "nested_dict",
    "value",
    {
        "request": {
            "id": "req-123",
            "intent": "research",
        },
        "scores": {
            "retrieval": 0.91,
            "safety": 0.99,
        },
    },
)
wizardflow.log(
    "msg-1",
    "mixed_list",
    "value",
    [
        "answer",
        3,
        0.42,
        False,
        None,
        {"source": "doc-7", "score": 0.81},
    ],
)
wizardflow.log("msg-1", "final", "value", "All values above are JSON-serializable.")
wizardflow.end_message("msg-1")

print(f"wrote {wiz.current_path}")
