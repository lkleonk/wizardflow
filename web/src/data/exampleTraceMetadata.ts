import type {
  AgentTraceFile,
  AgentTracePayload,
  AgentTraceStep,
} from "@/types/agenttrace";

/**
 * The bundled examples predate the SDK's node-lifecycle fields. Keep their
 * narrative data readable, while making the examples exercise the same
 * metadata that a current SDK trace contains.
 */
export type ExampleTraceMetadataOptions = {
  timingMode?: AgentTraceStep["timingMode"];
};

// These are fixture annotations, deliberately kept separate from the SDK's
// inference rules. A bundled example only receives a kind where its narrative
// makes the node's role unambiguous; all other nodes remain generic.
const EXAMPLE_NODE_KINDS: Record<string, string> = {
  orchestrator: "agent",
  researcher: "agent",
  router: "agent",
  scope_classifier: "agent",
  ticket_classifier: "agent",
  triage: "agent",
  planner: "agent",
  replanner: "agent",
  retriever: "retriever",
  tool_node: "tool",
  embedder: "embedding",
  reranker: "reranker",
  searcher: "retriever",
  vector_search: "retriever",
  course_lookup: "retriever",
  schema_lookup: "retriever",
  course_key_selector: "tool",
  study_plan_parser: "tool",
  rule_checker: "tool",
  executor: "tool",
  test_runner: "tool",
  db_executor: "tool",
  fetch_lab_results: "tool",
  order_lab_test: "tool",
  identity_check: "tool",
  site_status_check: "tool",
  network_diagnostics: "tool",
  device_lookup: "tool",
  license_check: "tool",
  install_request: "tool",
  mailbox_check: "tool",
  calendar_rules_audit: "tool",
  containment_steps: "tool",
  urgency_check: "tool",
  writer: "llm",
  critic: "llm",
  synthesizer: "llm",
  coder: "llm",
  generator: "llm",
  answer_composer: "llm",
  final_response: "llm",
  doctor_reply: "llm",
  differential: "llm",
  diagnosis: "llm",
  treatment_plan: "llm",
  interview: "llm",
  sql_generator: "llm",
  sql_repair: "llm",
  answer_writer: "llm",
  resolution_plan: "llm",
};

const INPUT_LABELS = new Set([
  "input",
  "llm_input",
  "node_input",
  "tool_input",
  "user_input",
]);

const OUTPUT_LABELS = new Set([
  "output",
  "llm_output",
  "node_output",
  "tool_output",
  "tool_result",
]);

function semanticTypeFor(label: string): string | undefined {
  const normalized = label.trim().toLowerCase();
  if (INPUT_LABELS.has(normalized)) return "input";
  if (OUTPUT_LABELS.has(normalized)) return "output";
  return undefined;
}

function addTiming(
  step: AgentTraceStep,
  nextStep: AgentTraceStep | undefined,
  timingMode: AgentTraceStep["timingMode"],
): AgentTraceStep {
  const start = Date.parse(step.timestamp);
  const next = nextStep ? Date.parse(nextStep.timestamp) : Number.NaN;
  const end = Number.isFinite(next)
    ? Math.max(start, next - 40)
    : start + 240;

  return {
    ...step,
    endTimestamp: new Date(end).toISOString(),
    timingMode,
    payloads: step.payloads.map((payload: AgentTracePayload) => ({
      ...payload,
      ...(payload.semanticType === undefined && semanticTypeFor(payload.label)
        ? { semanticType: semanticTypeFor(payload.label) }
        : {}),
    })),
  };
}

/** Enrich a bundled trace without changing its graph or message counts. */
export function decorateExampleTrace(
  trace: AgentTraceFile,
  options: ExampleTraceMetadataOptions = {},
): AgentTraceFile {
  const timingMode = options.timingMode ?? "explicit";
  return {
    ...trace,
    messages: trace.messages.map((message) => ({
      ...message,
      steps: message.steps.map((step, index) => ({
        ...addTiming(step, message.steps[index + 1], timingMode),
        ...(step.kind === undefined && EXAMPLE_NODE_KINDS[step.nodeId]
          ? { kind: EXAMPLE_NODE_KINDS[step.nodeId] }
          : {}),
      })),
    })),
  };
}
