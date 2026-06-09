import type { AgentTraceFile } from "@/types/agenttrace";

// Minimal shape check: enough to reject obviously-wrong files without turning
// the viewer into a full schema validator.
export function isAgentTraceFile(value: unknown): value is AgentTraceFile {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Partial<AgentTraceFile>;
  return (
    !!file.graph &&
    Array.isArray(file.graph.nodes) &&
    Array.isArray(file.graph.edges) &&
    Array.isArray(file.messages)
  );
}
