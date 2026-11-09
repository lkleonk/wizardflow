import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import GraphCanvas from "@/components/GraphCanvas";
import type { AgentTraceFile } from "@/types/agenttrace";
import type { ApiSpan } from "@/types/otelstore";
import { nsDiff, useApi } from "@/utils/otelApi";
import { visibleGraph } from "@/utils/traceSelectors";

/**
 * The replay's graph inside the span page: no chips, no playback. It follows
 * the selected span, and clicking a node selects that node's span. Loaded
 * lazily (see TraceView), so React Flow stays out of the other dashboard pages.
 */
export default function SpanGraphPanel({
  path,
  spans,
  selected,
  onSelectSpan,
}: {
  /** The API path of the replay's AgentTrace: the same graph the replay draws. */
  path: string;
  spans: ApiSpan[];
  selected?: ApiSpan;
  onSelectSpan: (spanId: string) => void;
}) {
  const { data: trace, error } = useApi<AgentTraceFile>(path, { live: true });
  const [arrangeMode, setArrangeMode] = useState(false);
  const graph = useMemo(() => (trace ? visibleGraph(trace) : null), [trace]);
  const nodeKinds = useMemo(() => {
    const kinds = new Map<string, string>();
    for (const message of trace?.messages ?? []) {
      for (const step of message.steps) {
        if (step.kind && !kinds.has(step.nodeId)) kinds.set(step.nodeId, step.kind);
      }
    }
    return kinds;
  }, [trace]);

  const runs = spans.filter((s) => s.nodeId).sort((a, b) => nsDiff(a.startNs, b.startNs));
  const selectedNode = selected?.nodeId ?? undefined;
  // The path taken up to the selected node, most recent first, as in the replay.
  const position = runs.findIndex((s) => s.spanId === selected?.spanId);
  const recentNodeIds = [
    ...new Set(
      runs
        .slice(0, Math.max(0, position))
        .reverse()
        .map((s) => s.nodeId!)
    ),
  ].filter((id) => id !== selectedNode);

  // A node can run several times: its latest run. A conversation's graph can
  // also hold nodes this execution never reached, which have no span to select.
  const selectNode = (nodeId: string) => {
    const run = [...runs].reverse().find((s) => s.nodeId === nodeId);
    if (run) onSelectSpan(run.spanId);
  };

  return (
    <Box sx={{ height: "100%" }}>
      {graph ? (
        <GraphCanvas
          nodes={graph.nodes}
          edges={graph.edges}
          activeNodeId={selectedNode}
          selectedNodeId={selectedNode}
          recentNodeIds={recentNodeIds}
          onSelectNode={selectNode}
          isPlaying={false}
          arrangeMode={arrangeMode}
          onArrangeModeChange={setArrangeMode}
          nodeKinds={nodeKinds}
        />
      ) : (
        <Typography sx={{ p: 2, fontSize: 13, color: error ? "error.main" : "text.secondary" }}>
          {error ? "Couldn't load the graph." : "Loading graph…"}
        </Typography>
      )}
    </Box>
  );
}
