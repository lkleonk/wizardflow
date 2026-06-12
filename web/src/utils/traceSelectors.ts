import type {
  AgentTraceMessage,
  AgentTracePayload,
  AgentTraceStep,
} from "@/types/agenttrace";

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
      result.push({ ...payload, timestamp: step.timestamp, deltaMs, elapsedMs });
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
