// Framework-agnostic AgentTrace file format.
// A visualizer loads one `AgentTraceFile` object and replays it.
//
// On disk this comes in two framings:
// - JSONL (`.jsonl`, what the Python SDK writes since 0.2): see the record
//   types at the bottom of this file. Assembling header + message records
//   yields one `AgentTraceFile`.
// - a single JSON document (legacy 0.1 traces and the bundled example flows);
//   the web UI still reads this, the SDK does not.

export type AgentTraceFile = {
  /** Schema version. "0.2" = same shapes as "0.1", introduced JSONL framing. */
  version: "0.1" | "0.2";
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
  /**
   * Optional short human description of what this node does. Surfaced behind
   * an info icon when the node is selected — never rendered permanently.
   */
  description?: string;
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
  /**
   * Optional flat metadata about this message as a whole (outcome, latency,
   * user id, …), as opposed to step payloads, which belong to one node visit.
   * Shown in the message chip's tooltip and expanded card. Keep values short —
   * large structured data belongs in payloads.
   */
  meta?: Record<string, string | number | boolean>;
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

// --- JSONL framing (what the Python SDK writes) ----------------------------
// A trace part is JSON Lines: line 1 is a header record (an AgentTraceFile
// minus `messages`), then one message record per completed message, and — only
// on a part that rotated away — a final seal record naming the next part.
// Readers must skip records with an unknown `type` (forward compat) and
// tolerate an unparseable final line (a crash mid-append leaves a torn tail).

export type AgentTraceHeaderRecord = Omit<AgentTraceFile, "messages"> & {
  type: "header";
};

export type AgentTraceMessageRecord = AgentTraceMessage & { type: "message" };

/** Marks a part as complete; an active (still-growing) part has no seal. */
export type AgentTraceSealRecord = { type: "seal"; nextPart: string };

export type AgentTraceRecord =
  | AgentTraceHeaderRecord
  | AgentTraceMessageRecord
  | AgentTraceSealRecord;
