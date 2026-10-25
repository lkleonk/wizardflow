"""langgraph tests."""

import pytest
from wizardflow import Client, LangGraphExtractionError, WizardFlowError
from helpers import _new


# --- fakes mimicking langchain_core's drawable graph (no langgraph needed) ---

class _FakeEdge:
    def __init__(self, source, target, conditional=False):
        self.source = source
        self.target = target
        self.conditional = conditional


class _FakeGraph:
    def __init__(self, nodes, edges):
        self.nodes = nodes  # dict[id, Node] in the real thing
        self.edges = edges


class _FakeApp:
    """Stands in for a compiled LangGraph app exposing get_graph()."""

    def __init__(self, nodes, edges):
        self._graph = _FakeGraph(nodes, edges)

    def get_graph(self):
        return self._graph

# --- langgraph topology extraction ---------------------------------------

def _consultant_app():
    # __start__/__end__ kept; some conditional (branch) edges, some plain.
    nodes = {k: object() for k in ["__start__", "router", "planner", "retriever",
                                   "final_response", "__end__"]}
    edges = [
        _FakeEdge("__start__", "router"),
        _FakeEdge("router", "planner", conditional=True),
        _FakeEdge("router", "retriever", conditional=True),
        _FakeEdge("planner", "final_response"),
        _FakeEdge("retriever", "final_response"),
        _FakeEdge("final_response", "__end__"),
    ]
    return _FakeApp(nodes, edges)


def test_from_langgraph_extracts_nodes_keeping_start_end(tmp_path):
    c = Client.from_langgraph(_consultant_app(), output_dir=str(tmp_path), file_prefix="t")
    ids = [n["id"] for n in c.to_dict()["graph"]["nodes"]]
    assert ids == ["__start__", "router", "planner", "retriever",
                   "final_response", "__end__"]


def test_from_langgraph_marks_conditional_edges_only(tmp_path):
    c = Client.from_langgraph(_consultant_app(), output_dir=str(tmp_path), file_prefix="t")
    edges = c.to_dict()["graph"]["edges"]
    cond = {(e["source"], e["target"]) for e in edges if e.get("conditional")}
    plain = {(e["source"], e["target"]) for e in edges if "conditional" not in e}
    assert cond == {("router", "planner"), ("router", "retriever")}
    assert ("planner", "final_response") in plain
    assert ("__start__", "router") in plain


def test_from_langgraph_collapses_duplicate_edges(tmp_path):
    # LangGraph's get_graph() can list the same conditional edge twice when a
    # router maps several branch keys to one target; the viewer keys edges by
    # source->target, so duplicates must collapse to one.
    nodes = {k: object() for k in ["__start__", "router", "target", "__end__"]}
    edges = [
        _FakeEdge("__start__", "router"),
        _FakeEdge("router", "target", conditional=True),
        _FakeEdge("router", "target", conditional=True),
    ]
    c = Client.from_langgraph(_FakeApp(nodes, edges), output_dir=str(tmp_path), file_prefix="t")
    out = c.to_dict()["graph"]["edges"]
    assert out == [
        {"source": "__start__", "target": "router"},
        {"source": "router", "target": "target", "conditional": True},
    ]


def test_dedupe_keeps_conditional_if_any_twin_is(tmp_path):
    # A plain edge and a conditional edge over the same pair collapse to one
    # that keeps the branch flag, regardless of which came first.
    c = _new(tmp_path, nodes=["a", "b"],
             edges=[("a", "b"), {"source": "a", "target": "b", "conditional": True}])
    assert c.to_dict()["graph"]["edges"] == [
        {"source": "a", "target": "b", "conditional": True}
    ]


def test_dedupe_preserves_first_seen_order(tmp_path):
    c = _new(tmp_path, nodes=["a", "b", "c"],
             edges=[("b", "c"), ("a", "b"), ("b", "c")])
    assert c.to_dict()["graph"]["edges"] == [
        {"source": "b", "target": "c"},
        {"source": "a", "target": "b"},
    ]


def test_from_langgraph_applies_node_colors(tmp_path):
    c = Client.from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
        node_colors={
            "router": "#A78BFA",
            "retriever": "#22D3EE",
        },
    )
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["router"]["color"] == "#A78BFA"
    assert nodes["retriever"]["color"] == "#22D3EE"
    assert "color" not in nodes["planner"]


def test_from_langgraph_unknown_node_color_raises(tmp_path):
    with pytest.raises(WizardFlowError, match="node_colors contains unknown"):
        Client.from_langgraph(
            _consultant_app(),
            output_dir=str(tmp_path),
            file_prefix="t",
            node_colors={"routre": "#A78BFA"},
        )


def test_from_langgraph_unknown_node_color_silent_ignored(tmp_path):
    c = Client.from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
        node_colors={
            "router": "#A78BFA",
            "routre": "#22D3EE",
        },
        silent=True,
    )
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["router"]["color"] == "#A78BFA"
    assert "routre" not in nodes


def test_from_langgraph_iterable_nodes_supported(tmp_path):
    # Some versions expose nodes as objects with .id rather than a dict.
    class _N:
        def __init__(self, id):
            self.id = id

    app = _FakeApp([_N("a"), _N("b")], [_FakeEdge("a", "b")])
    c = Client.from_langgraph(app, output_dir=str(tmp_path), file_prefix="t")
    assert [n["id"] for n in c.to_dict()["graph"]["nodes"]] == ["a", "b"]


def test_from_langgraph_rejects_non_langgraph_object(tmp_path):
    with pytest.raises(LangGraphExtractionError):
        Client.from_langgraph(object(), output_dir=str(tmp_path), file_prefix="t")


def test_from_langgraph_logging_still_works(tmp_path):
    c = Client.from_langgraph(_consultant_app(), output_dir=str(tmp_path), file_prefix="t")
    c.log("m1", "planner", "Input", {"q": "hi"})
    c.end_message("m1")
    assert c.to_dict()["messages"][0]["steps"][0]["nodeId"] == "planner"


def test_module_init_from_langgraph_sets_default(tmp_path):
    import wizardflow

    wizardflow.init_from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
    )
    wizardflow.log("m1", "router", "decision", "planner")
    wizardflow.end_message("m1")
    assert wizardflow.to_dict()["graph"]["nodes"][0]["id"] == "__start__"

def test_from_langgraph_applies_node_labels(tmp_path):
    # The main use case: extracted LangGraph ids are function names; node_labels
    # renames them for display without touching the ids log() targets.
    c = Client.from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
        node_labels={"final_response": "Final Response"},
    )
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["final_response"]["label"] == "Final Response"
    assert "label" not in nodes["router"]

def test_from_langgraph_applies_node_descriptions(tmp_path):
    c = Client.from_langgraph(
        _consultant_app(),
        output_dir=str(tmp_path),
        file_prefix="t",
        node_descriptions={"router": "Routes requests."},
    )
    nodes = {n["id"]: n for n in c.to_dict()["graph"]["nodes"]}
    assert nodes["router"]["description"] == "Routes requests."
    assert "description" not in nodes["planner"]
