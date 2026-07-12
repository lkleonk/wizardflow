import type {
  AgentTraceEdge,
  AgentTraceFile,
  AgentTraceMessage,
  AgentTraceNode,
  AgentTracePayload,
  AgentTraceStep,
} from "@/types/agenttrace";

// LangGraph's reserved virtual nodes. They show up in the extracted topology
// (the SDK passes them through unfiltered) but never execute or log anything, so
// the canvas hides them — see `visibleGraph`. Canonical constant names only.
const STRUCTURAL_NODE_IDS = new Set(["__start__", "__end__"]);

/**
 * Drop duplicate edges that share a source/target pair. The canvas keys edges
 * by `source->target`, so a trace that lists the same edge twice would hand
 * React Flow two children with the same key (and skew layout indegree counts).
 * An edge keeps `conditional` if any of its duplicates were conditional. Returns
 * the original array unchanged when there are no duplicates (stable identity).
 */
function dedupeEdges(edges: AgentTraceEdge[]): AgentTraceEdge[] {
  const byKey = new Map<string, AgentTraceEdge>();
  let hasDuplicate = false;
  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, edge);
    } else {
      hasDuplicate = true;
      if (edge.conditional && !existing.conditional) {
        byKey.set(key, { ...existing, conditional: true });
      }
    }
  }
  return hasDuplicate ? [...byKey.values()] : edges;
}

/**
 * The graph to render. Drops purely structural nodes that never run — currently
 * LangGraph's virtual `__start__`/`__end__` entries — but *only* when they have
 * no logged step anywhere in the trace, then drops edges that touch a hidden
 * node. Duplicate edges (same source/target) are also collapsed. Real branch
 * nodes that simply weren't exercised by the recorded messages are kept, so the
 * full topology still shows. When nothing is hidden or duplicated the original
 * arrays are returned unchanged (stable identity for memoization).
 */
export function visibleGraph(trace: AgentTraceFile): {
  nodes: AgentTraceNode[];
  edges: AgentTraceEdge[];
} {
  const logged = new Set<string>();
  for (const message of trace.messages) {
    for (const step of message.steps) logged.add(step.nodeId);
  }
  const hidden = new Set(
    trace.graph.nodes
      .map((n) => n.id)
      .filter((id) => STRUCTURAL_NODE_IDS.has(id) && !logged.has(id))
  );
  const edges = dedupeEdges(trace.graph.edges);
  if (hidden.size === 0) {
    return { nodes: trace.graph.nodes, edges };
  }
  return {
    nodes: trace.graph.nodes.filter((n) => !hidden.has(n.id)),
    edges: edges.filter(
      (e) => !hidden.has(e.source) && !hidden.has(e.target)
    ),
  };
}

/** Parse an ISO timestamp to epoch ms; undated/invalid steps sort to the end. */
function toEpoch(timestamp: string): number {
  const t = Date.parse(timestamp);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * The message's steps as the replay sequence: sorted ascending by `timestamp`,
 * with ties broken by original array order (stable). This is the canonical
 * order everything else — active node, recent glow, scrubber — reads from.
 */
export function orderedSteps(
  message: AgentTraceMessage | undefined
): AgentTraceStep[] {
  if (!message) return [];
  return message.steps
    .map((step, index) => ({ step, index, key: toEpoch(step.timestamp) }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.step);
}

/**
 * A payload tagged with the timing of the step that emitted it: its ISO
 * timestamp, the per-step delta (gap from the previous step), and the cumulative
 * elapsed time since the message start.
 */
export type TimedPayload = AgentTracePayload & {
  /**
   * Id of the step (node visit) that emitted this payload. A node visited more
   * than once per message contributes several contiguous runs here; this is the
   * robust key the inspector groups tabs by (timestamps can collide when coarse).
   */
  stepId: string;
  timestamp: string;
  deltaMs?: number;
  elapsedMs?: number;
};

/**
 * Collect every payload logged for `nodeId` across all steps of a message,
 * in replay (timestamp) order. A node can be visited more than once per
 * message, so this flattens all of those visits into a single list. Each
 * payload carries its step's timing so the inspector can show when it fired
 * (and disambiguate repeated visits of the same node).
 */
export function getPayloadsForNode(
  message: AgentTraceMessage | undefined,
  nodeId: string | undefined
): TimedPayload[] {
  if (!message || !nodeId) return [];
  const steps = orderedSteps(message);
  const result: TimedPayload[] = [];
  steps.forEach((step, index) => {
    if (step.nodeId !== nodeId) return;
    const deltaMs = deltaMsAtStep(steps, index);
    const elapsedMs = elapsedMsAtStep(steps, index);
    for (const payload of step.payloads) {
      result.push({
        ...payload,
        stepId: step.id,
        timestamp: step.timestamp,
        deltaMs,
        elapsedMs,
      });
    }
  });
  return result;
}

// Labels (case-insensitive) we treat as the message's entry input, in priority
// order, when deriving a timeline-chip preview. This is only a fallback — a dev
// can set the message's title explicitly (SDK `end_message(..., title=...)`), which the UI
// uses verbatim and never reaches this heuristic.
const PREFERRED_INPUT_LABELS = ["input", "msg", "message", "query", "question"];

/**
 * A short, human-readable preview of a message's entry input, used as the
 * timeline-chip preview when no explicit title is set. Looks only at the
 * **first node** (the entry step): prefers a payload whose label is one of
 * PREFERRED_INPUT_LABELS, else falls back to that step's first payload.
 * Returns the full cleaned text (no truncation) — the UI truncates for display.
 */
export function messageInputText(
  message: AgentTraceMessage | undefined
): string {
  const first = orderedSteps(message)[0];
  if (!first || first.payloads.length === 0) return "";

  let chosen: AgentTracePayload | undefined;
  for (const label of PREFERRED_INPUT_LABELS) {
    chosen = first.payloads.find((p) => p.label.trim().toLowerCase() === label);
    if (chosen) break;
  }
  if (!chosen) chosen = first.payloads[0];

  const text =
    typeof chosen.value === "string"
      ? chosen.value
      : JSON.stringify(chosen.value);
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Per-step delta (ms): time from the previous step to `steps[index]` — how long
 * this hop took. Undefined on the first step or if timestamps can't be parsed.
 */
export function deltaMsAtStep(
  steps: AgentTraceStep[],
  index: number
): number | undefined {
  if (index <= 0 || index >= steps.length) return undefined;
  const prev = Date.parse(steps[index - 1].timestamp);
  const curr = Date.parse(steps[index].timestamp);
  if (Number.isNaN(prev) || Number.isNaN(curr)) return undefined;
  return curr - prev;
}

/**
 * Cumulative elapsed time (ms) from the first step to `steps[index]` — the
 * playhead's position within the message. 0 at the first step; undefined if the
 * timestamps can't be parsed.
 */
export function elapsedMsAtStep(
  steps: AgentTraceStep[],
  index: number
): number | undefined {
  if (steps.length === 0 || index < 0 || index >= steps.length) return undefined;
  const start = Date.parse(steps[0].timestamp);
  const curr = Date.parse(steps[index].timestamp);
  if (Number.isNaN(start) || Number.isNaN(curr)) return undefined;
  return curr - start;
}
