import type { AgentTraceFile } from "@/types/agenttrace";

// A bundled example flow, shown in the example-picker gallery. `title` and
// `summary` are the short, card-facing copy; the full prose lives in
// `trace.meta.description`. `pattern` is a tiny tag for the card's meta row.
//
// The trace itself is loaded on demand rather than imported: a static import
// would merge all twelve traces (~200 KB of literal data) into the entry chunk,
// so every visitor downloaded and parsed all of them to watch at most one.
// `loadTrace` is a dynamic import, which makes each flow its own chunk, fetched
// when the user actually picks it.
export type ExampleFlow = {
  id: string;
  title: string;
  summary: string;
  pattern: string;
  /**
   * Card stats, duplicated here because the gallery renders every card without
   * loading a single trace — deriving them would defeat the lazy loading above.
   * `nodeCount` is post-`visibleGraph` (unlogged `__start__`/`__end__` hidden).
   *
   * These must be updated by hand when a flow in `./flows/` changes. Regenerate
   * the correct values with `node scripts/flow-card-meta.mjs` (see AGENTS.md).
   */
  nodeCount: number;
  messageCount: number;
  loadTrace: () => Promise<AgentTraceFile>;
};

export const exampleFlows: ExampleFlow[] = [
  {
    id: "doctor-consultation",
    title: "AI doctor consultation",
    summary:
      "Runs a full doctor's visit for three patients — interview, diagnosis, safety-checked prescriptions (an allergy catch and a drug-interaction catch), and a blood test that comes back the next day.",
    pattern: "branches + loop",
    nodeCount: 9,
    messageCount: 5,
    loadTrace: () =>
      import("./flows/doctorConsultation").then((m) => m.doctorConsultationTrace),
  },
  {
    id: "router",
    title: "Router agent",
    summary: "Routes each request to a planner or retriever branch.",
    pattern: "branching",
    nodeCount: 7,
    messageCount: 3,
    loadTrace: () => import("./flows/routerAgent").then((m) => m.routerAgentTrace),
  },
  {
    id: "rag",
    title: "RAG pipeline",
    summary: "Embeds a medical question, retrieves docs, and answers from them.",
    pattern: "linear",
    nodeCount: 6,
    messageCount: 5,
    loadTrace: () => import("./flows/ragPipeline").then((m) => m.ragPipelineTrace),
  },
  {
    id: "crew",
    title: "Multi-agent crew",
    summary: "An orchestrator delegates a coding task to three specialists.",
    pattern: "fan-out",
    nodeCount: 7,
    messageCount: 2,
    loadTrace: () =>
      import("./flows/multiAgentCrew").then((m) => m.multiAgentCrewTrace),
  },
  {
    id: "plan-execute",
    title: "Plan & execute",
    summary: "Plans a trip, runs each step with tools, and replans in a loop.",
    pattern: "loop",
    nodeCount: 5,
    messageCount: 2,
    loadTrace: () => import("./flows/planExecute").then((m) => m.planExecuteTrace),
  },
  {
    id: "self-correcting-code",
    title: "Self-correcting code",
    summary: "Writes code, runs tests, and patches itself until they pass.",
    pattern: "test loop",
    nodeCount: 4,
    messageCount: 2,
    loadTrace: () =>
      import("./flows/selfCorrectingCode").then((m) => m.selfCorrectingCodeTrace),
  },
  {
    id: "degree-consultant",
    title: "Degree consultant",
    summary:
      "Fans a student question out to an off-topic reply, a direct rule answer, a course lookup, or a full plan check.",
    pattern: "uneven branches",
    nodeCount: 7,
    messageCount: 4,
    loadTrace: () =>
      import("./flows/degreeConsultant").then((m) => m.degreeConsultantTrace),
  },
  {
    id: "text-to-sql",
    title: "Text to SQL",
    summary:
      "Generates SQL, repairs it from the DB error when it fails, then explains the result.",
    pattern: "repair loop",
    nodeCount: 7,
    messageCount: 2,
    loadTrace: () => import("./flows/textToSql").then((m) => m.textToSqlTrace),
  },
  {
    id: "support-handoff",
    title: "Support agent with handoff",
    summary:
      "Triages billing tickets to FAQ, a policy-gated refund tool, or a human — one refund loops through a revision.",
    pattern: "tool loop + handoff",
    nodeCount: 8,
    messageCount: 4,
    loadTrace: () =>
      import("./flows/supportHandoff").then((m) => m.supportHandoffTrace),
  },
  {
    id: "deep-research",
    title: "Deep research agent",
    summary:
      "Searches, loops back to gather more, then revises through a writer/critic loop.",
    pattern: "loops",
    nodeCount: 8,
    messageCount: 1,
    loadTrace: () => import("./flows/deepResearch").then((m) => m.deepResearchTrace),
  },
  {
    id: "it-helpdesk-router",
    title: "IT helpdesk router",
    summary:
      "Routes employee tickets through account, network, hardware, software, email, and security branches.",
    pattern: "multi-branch",
    nodeCount: 24,
    messageCount: 4,
    loadTrace: () =>
      import("./flows/itHelpdeskRouter").then((m) => m.itHelpdeskRouterTrace),
  },
  {
    id: "loan-application",
    title: "Loan application",
    summary:
      "Scores each application and ends in one of three replies — approve, counter-offer, or decline.",
    pattern: "multi-exit",
    nodeCount: 6,
    messageCount: 3,
    loadTrace: () =>
      import("./flows/loanApplication").then((m) => m.loanApplicationTrace),
  },
];

// Placeholder flow used when nothing is loaded — on first visit, or after the
// user clears the current flow. The canvas, timeline, and inspector all render
// blank for it; the UI surfaces the example gallery instead.
export const emptyTrace: AgentTraceFile = {
  version: "0.1",
  graph: { nodes: [], edges: [] },
  messages: [],
};
