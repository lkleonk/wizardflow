import type { AgentTraceFile, AgentTraceRecord, AgentTraceStep } from "@/types/agenttrace";

/**
 * The trace as AgentTrace JSONL: a header line, then one line per execution,
 * the framing the SDK writes (see the record types in agenttrace.ts).
 *
 * Drops `otelTraceId` / `otelSpanId` (they point into this machine's database,
 * which means nothing to whoever receives the file) and `otelError` with them:
 * the other dashboard-only field, which a file reader has no use for.
 */
export function toTraceJsonl(trace: AgentTraceFile): string {
  const { messages, ...header } = trace;
  const records: AgentTraceRecord[] = [
    { type: "header", ...header },
    ...messages.map((message) => {
      const record = { type: "message" as const, ...message, steps: message.steps.map(withoutSpanId) };
      delete record.otelTraceId;
      delete record.otelError;
      return record;
    }),
  ];
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function withoutSpanId(step: AgentTraceStep): AgentTraceStep {
  const copy = { ...step };
  delete copy.otelSpanId;
  return copy;
}

/** A safe file name for the trace, e.g. `run-2026-10-11T10-00-00Z.jsonl`. */
export function traceFileName(trace: AgentTraceFile): string {
  const stem = (trace.name ?? "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${stem || "wizardflow-run"}.jsonl`;
}

/** Save the trace as a JSONL file through the browser. */
export function downloadTraceJsonl(trace: AgentTraceFile): void {
  const url = URL.createObjectURL(new Blob([toTraceJsonl(trace)], { type: "application/jsonl" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = traceFileName(trace);
  link.click();
  URL.revokeObjectURL(url);
}
