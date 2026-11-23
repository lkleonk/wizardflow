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
  downloadBlob(new Blob([toTraceJsonl(trace)], { type: "application/jsonl" }), traceFileName(trace));
}

/**
 * Unique file names for several runs saved together: the run's name plus,
 * when runs share it (every conversation of one recording does), its
 * conversation id, then a counter as a last resort.
 */
export function traceFileNames(traces: AgentTraceFile[]): string[] {
  const used = new Set<string>();
  return traces.map((trace) => {
    const stem = traceFileName(trace).replace(/\.jsonl$/, "");
    const conversation = typeof trace.meta?.conversationId === "string" ? trace.meta.conversationId : "";
    const tag = safeStem(conversation) || safeStem(trace.messages[0]?.id ?? "");
    let name = tag ? `${stem}__${tag}.jsonl` : `${stem}.jsonl`;
    for (let n = 2; used.has(name); n++) name = `${stem}__${tag || "run"}-${n}.jsonl`;
    used.add(name);
    return name;
  });
}

function safeStem(text: string): string {
  return text.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** A safe file name stem for anything, e.g. a project name. */
export function fileStem(text: string, fallback: string): string {
  return safeStem(text) || fallback;
}

/** Save a blob through the browser as `name`. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
