import type { AgentTraceFile } from "@/types/agenttrace";
import { routerAgentTrace } from "./flows/routerAgent";
import { ragPipelineTrace } from "./flows/ragPipeline";
import { multiAgentCrewTrace } from "./flows/multiAgentCrew";
import { planExecuteTrace } from "./flows/planExecute";
import { selfCorrectingCodeTrace } from "./flows/selfCorrectingCode";
import { universityConsultantTrace } from "./flows/universityConsultant";
import { textToSqlTrace } from "./flows/textToSql";
import { supportHandoffTrace } from "./flows/supportHandoff";
import { deepResearchTrace } from "./flows/deepResearch";
import { itHelpdeskRouterTrace } from "./flows/itHelpdeskRouter";
import { loanApplicationTrace } from "./flows/loanApplication";

// A bundled example flow, shown in the example-picker gallery. `title` and
// `summary` are the short, card-facing copy; the full prose lives in
// `trace.meta.description`. `pattern` is a tiny tag for the card's meta row.
export type ExampleFlow = {
  id: string;
  title: string;
  summary: string;
  pattern: string;
  trace: AgentTraceFile;
};

export const exampleFlows: ExampleFlow[] = [
  {
    id: "router",
    title: "Router agent",
    summary: "Routes each request to a planner or retriever branch.",
    pattern: "branching",
    trace: routerAgentTrace,
  },
  {
    id: "rag",
    title: "RAG pipeline",
    summary: "Embeds a medical question, retrieves docs, and answers from them.",
    pattern: "linear",
    trace: ragPipelineTrace,
  },
  {
    id: "crew",
    title: "Multi-agent crew",
    summary: "An orchestrator delegates a coding task to three specialists.",
    pattern: "fan-out",
    trace: multiAgentCrewTrace,
  },
  {
    id: "plan-execute",
    title: "Plan & execute",
    summary: "Plans a trip, runs each step with tools, and replans in a loop.",
    pattern: "loop",
    trace: planExecuteTrace,
  },
  {
    id: "self-correcting-code",
    title: "Self-correcting code",
    summary: "Writes code, runs tests, and patches itself until they pass.",
    pattern: "test loop",
    trace: selfCorrectingCodeTrace,
  },
  {
    id: "university-consultant",
    title: "University consultant",
    summary:
      "Routes questions across navigation, advising, and courses — with a prereq escalation and a clarify loop.",
    pattern: "branch + loop",
    trace: universityConsultantTrace,
  },
  {
    id: "text-to-sql",
    title: "Text to SQL",
    summary:
      "Generates SQL, repairs it from the DB error when it fails, then explains the result.",
    pattern: "repair loop",
    trace: textToSqlTrace,
  },
  {
    id: "support-handoff",
    title: "Support agent with handoff",
    summary:
      "Triages billing tickets to FAQ, a policy-gated refund tool, or a human — one refund loops through a revision.",
    pattern: "tool loop + handoff",
    trace: supportHandoffTrace,
  },
  {
    id: "deep-research",
    title: "Deep research agent",
    summary:
      "Searches, loops back to gather more, then revises through a writer/critic loop.",
    pattern: "loops",
    trace: deepResearchTrace,
  },
  {
    id: "it-helpdesk-router",
    title: "IT helpdesk router",
    summary:
      "Routes employee tickets through account, network, hardware, software, email, and security branches.",
    pattern: "multi-branch",
    trace: itHelpdeskRouterTrace,
  },
  {
    id: "loan-application",
    title: "Loan application",
    summary:
      "Scores each application and ends in one of three replies — approve, counter-offer, or decline.",
    pattern: "multi-exit",
    trace: loanApplicationTrace,
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
