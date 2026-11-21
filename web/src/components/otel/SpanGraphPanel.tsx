import { useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Fade from "@mui/material/Fade";
import Typography from "@mui/material/Typography";
import GraphCanvas from "@/components/GraphCanvas";
import type { AgentTraceFile } from "@/types/agenttrace";
import type { ApiSpan } from "@/types/otelstore";
import { nsDiff, useApi } from "@/utils/otelApi";
import { visibleGraph } from "@/utils/traceSelectors";

/**
 * The replay's graph inside the span page: no chips, no playback. It follows
 * the selected span, and clicking a node selects that node's span (or says
 * the node didn't run in this execution). Loaded
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
  // A clicked node that has no span here. The name stays while the notice
  // fades out; `at` restarts the timer when the same node is clicked again.
  const [notRun, setNotRun] = useState<{ nodeId: string; at: number; open: boolean } | null>(null);
  const hideNotRun = () => setNotRun((n) => n && { ...n, open: false });
  useEffect(() => {
    if (!notRun?.open) return;
    const timer = window.setTimeout(() => setNotRun((n) => n && { ...n, open: false }), NOT_RUN_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notRun]);
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
    if (run) {
      hideNotRun();
      onSelectSpan(run.spanId);
    } else {
      setNotRun({ nodeId, at: Date.now(), open: true });
    }
  };

  return (
    <Box sx={{ height: "100%", position: "relative" }}>
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
      <Fade in={Boolean(notRun?.open)}>
        <Alert
          severity="info"
          role="status"
          onClose={hideNotRun}
          sx={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", maxWidth: "calc(100% - 16px)", py: 0 }}
        >
          {notRun && (
            <>
              <b>{notRun.nodeId}</b> didn&apos;t run in this execution, so it has no span.
            </>
          )}
        </Alert>
      </Fade>
    </Box>
  );
}

const NOT_RUN_NOTICE_MS = 4000;
