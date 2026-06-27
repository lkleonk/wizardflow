import type { AgentTraceFile, AgentTraceMessage } from "@/types/agenttrace";

export const INVALID_AGENT_TRACE_FILE_MESSAGE =
  "That file doesn't look like a WizardFlow trace (.jsonl or .json).";

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

/**
 * Parse trace file text in either framing into one `AgentTraceFile`:
 *
 * - JSONL (what the SDK writes): line 1 is a `header` record, then one
 *   `message` record per line, optionally ending in a `seal` record. Detected
 *   by the first line alone parsing as a header record — a single-document
 *   trace's first line is just `{` (pretty-printed) or has no `type`.
 * - a single JSON document (legacy traces and the bundled example flows).
 *
 * Returns null when the text is neither.
 */
export function parseAgentTrace(text: string): AgentTraceFile | null {
  const jsonl = parseJsonlTrace(text);
  if (jsonl) return jsonl;
  try {
    const parsed = JSON.parse(text);
    return isAgentTraceFile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readAgentTraceFile(
  file: File
): Promise<AgentTraceFile | null> {
  const parsed = parseAgentTrace(await file.text());
  if (!parsed) return null;

  // The on-disk file name is what the user recognizes - use it as the trace's
  // display name, overriding any name baked into the file.
  return { ...parsed, name: file.name };
}

function parseJsonlTrace(text: string): AgentTraceFile | null {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;

  const header = parseRecord(lines[0]);
  if (!header || header.type !== "header") return null;

  // Duplicate ids keep the last occurrence's content (future amend semantics)
  // at the first occurrence's position.
  const messages = new Map<string, AgentTraceMessage>();
  let nextPart: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const record = parseRecord(lines[i]);
    // Unparseable: a torn final line (crash mid-append) is expected and
    // dropped; a corrupt middle line is skipped rather than failing the file.
    if (!record) continue;
    if (record.type === "message" && typeof record.id === "string") {
      const message = stripType(record);
      messages.set(record.id, message as unknown as AgentTraceMessage);
    } else if (record.type === "seal" && typeof record.nextPart === "string") {
      nextPart = record.nextPart as string;
    }
    // Unknown record types: skip (forward compat).
  }

  const fields = stripType(header);
  const trace = {
    ...fields,
    ...(nextPart !== undefined
      ? { meta: { ...(fields.meta as object), nextPart } }
      : {}),
    messages: [...messages.values()],
  };
  return isAgentTraceFile(trace) ? trace : null;
}

function stripType(record: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...record };
  delete copy.type;
  return copy;
}

function parseRecord(line: string): Record<string, unknown> | null {
  try {
    const record = JSON.parse(line);
    return typeof record === "object" && record !== null && !Array.isArray(record)
      ? (record as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
