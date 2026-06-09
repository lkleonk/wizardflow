// Framework-agnostic AgentTrace file format.
// A visualizer loads one `AgentTraceFile` object and replays it.

export type AgentTraceFile = {
  /** Schema version of the trace format. */
  version: "0.1";
  /** Display name for the trace (e.g. the source file name). Shown in the header. */
  name?: string;
  /**
   * Optional free-form metadata about the run (source framework, created time,
   * description, …). Surfaced in the header's trace-info tooltip.
   */
  meta?: Record<string, string | number | boolean>;
  graph: {
    nodes: AgentTraceNode[];
    edges: AgentTraceEdge[];
  };
  messages: AgentTraceMessage[];
};

export type AgentTraceNode = {
  id: string;
  label?: string;
  /** Optional override for the node's accent color. Falls back to a palette color. */
  color?: string;
};

export type AgentTraceEdge = {
  source: string;
  target: string;
  /**
   * Marks a branch the agent chooses at runtime (e.g. a router/classifier
   * picking one of several next nodes), as opposed to an edge that is always
   * followed. Rendered dashed. Leave unset for deterministic edges; do NOT set
   * it on a parallel fan-out where every target runs.
   */
  conditional?: boolean;
};

export type AgentTraceMessage = {
  id: string;
  label?: string;
  steps: AgentTraceStep[];
};

export type AgentTraceStep = {
  id: string;
  /** Id of the graph node that was active during this step. */
  nodeId: string;
  /**
   * ISO 8601 timestamp — the single source of truth for ordering. Steps are
   * replayed sorted ascending by this value; the UI derives the elapsed delta
   * between steps from it (it is never stored separately). For a node that ran
   * but logged nothing, this is still set (e.g. the node's end time) so it can
   * be placed in the sequence.
   */
  timestamp: string;
  payloads: AgentTracePayload[];
};

export type AgentTracePayload = {
  label: string;
  value: unknown;
};
