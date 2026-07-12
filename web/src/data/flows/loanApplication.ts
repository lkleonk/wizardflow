import type { AgentTraceFile } from "@/types/agenttrace";

// Multi-exit example (mirrors a real LangGraph run): an application intake and
// risk assessment feed a decision router that ends in one of three distinct
// user-facing replies — approve, counter-offer, or decline — instead of
// re-converging to a single final node. The graph also carries LangGraph's
// virtual __start__/__end__ nodes; they never log a step, so the canvas hides
// them, leaving the three terminal nodes as the visible exits.
export const loanApplicationTrace: AgentTraceFile = {
  version: "0.1",
  name: "loan_application.jsonl",
  meta: {
    source: "langgraph",
    createdAt: "2026-06-16T09:00:00Z",
    description:
      "A personal-loan underwriting agent. Each application is taken in and " +
      "scored for risk, then a decision router sends it down one of three " +
      "terminal branches — approval, a counter-offer with adjusted terms, or a " +
      "decline with reasons. The branches do not merge: each writes its own " +
      "final reply to the applicant. The compiled graph's virtual __start__ and " +
      "__end__ nodes are recorded in the topology but never run.",
  },
  graph: {
    nodes: [
      { id: "__start__", label: "__start__" },
      {
        id: "intake",
        label: "Application Intake",
        description: "Captures the loan application details (amount, term, purpose, income).",
      },
      {
        id: "risk_assessment",
        label: "Risk Assessment",
        description: "Scores the applicant's credit risk (score, debt-to-income, delinquencies) into a risk band.",
      },
      {
        id: "decision",
        label: "Decision Router",
        description: "Routes the application to approve, counter-offer, or decline based on the risk assessment.",
      },
      {
        id: "approve",
        label: "Approve",
        description: "Finalizes the loan terms and writes the approval reply.",
      },
      {
        id: "counter_offer",
        label: "Counter-Offer",
        description: "Adjusts the requested amount to an affordable offer and writes the counter-offer reply.",
      },
      {
        id: "decline",
        label: "Decline",
        description: "Lists the decline reasons and writes the decline reply with reapplication guidance.",
      },
      { id: "__end__", label: "__end__" },
    ],
    edges: [
      { source: "__start__", target: "intake" },
      { source: "intake", target: "risk_assessment" },
      { source: "risk_assessment", target: "decision" },
      { source: "decision", target: "approve", conditional: true },
      { source: "decision", target: "counter_offer", conditional: true },
      { source: "decision", target: "decline", conditional: true },
      { source: "approve", target: "__end__" },
      { source: "counter_offer", target: "__end__" },
      { source: "decline", target: "__end__" },
    ],
  },
  messages: [
    {
      id: "msg-1",
      meta: { risk_band: "low", outcome: "approved", apr: 8.4, latency_ms: 1720 },
      steps: [
        {
          id: "m1-s1",
          nodeId: "intake",
          timestamp: "2026-06-16T09:00:00.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "I'd like to apply for a $12,000 loan over 36 months to consolidate two credit cards.",
            },
            {
              label: "application",
              value: {
                applicant: "Dana W.",
                amount_requested: 12000,
                term_months: 36,
                purpose: "debt consolidation",
                annual_income: 88000,
              },
            },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "risk_assessment",
          timestamp: "2026-06-16T09:00:00.640Z",
          payloads: [
            {
              label: "assessment",
              value: {
                credit_score: 742,
                debt_to_income: 0.21,
                delinquencies_24mo: 0,
                risk_band: "low",
              },
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "decision",
          timestamp: "2026-06-16T09:00:01.180Z",
          payloads: [
            {
              label: "decision",
              value: {
                route: "approve",
                reason:
                  "Low risk band, strong score, and DTI well under the 0.36 threshold.",
              },
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "approve",
          timestamp: "2026-06-16T09:00:01.720Z",
          payloads: [
            {
              label: "terms",
              value: {
                approved_amount: 12000,
                apr: 8.4,
                term_months: 36,
                monthly_payment: 378.2,
              },
            },
            {
              label: "Output",
              value:
                "Good news — your $12,000 loan is approved at 8.4% APR over 36 months, about $378/month. Funds can be disbursed within two business days.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-2",
      meta: { risk_band: "medium", outcome: "counter_offer", apr: 11.9, latency_ms: 1840 },
      steps: [
        {
          id: "m2-s1",
          nodeId: "intake",
          timestamp: "2026-06-16T09:05:00.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "Looking for a $25,000 loan over 48 months to renovate my kitchen.",
            },
            {
              label: "application",
              value: {
                applicant: "Marcus R.",
                amount_requested: 25000,
                term_months: 48,
                purpose: "home renovation",
                annual_income: 61000,
              },
            },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "risk_assessment",
          timestamp: "2026-06-16T09:05:00.700Z",
          payloads: [
            {
              label: "assessment",
              value: {
                credit_score: 688,
                debt_to_income: 0.39,
                delinquencies_24mo: 1,
                risk_band: "medium",
              },
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "decision",
          timestamp: "2026-06-16T09:05:01.260Z",
          payloads: [
            {
              label: "decision",
              value: {
                route: "counter_offer",
                reason:
                  "DTI exceeds 0.36 at the requested amount; affordable at a lower principal.",
              },
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "counter_offer",
          timestamp: "2026-06-16T09:05:01.840Z",
          payloads: [
            {
              label: "counter_terms",
              value: {
                offered_amount: 18000,
                apr: 11.9,
                term_months: 48,
                monthly_payment: 473.6,
                condition: "brings debt-to-income to 0.34",
              },
            },
            {
              label: "Output",
              value:
                "We can't approve $25,000 at this time, but we can offer $18,000 at 11.9% APR over 48 months (~$474/month), which keeps your payments affordable. Want to proceed with the adjusted amount?",
            },
          ],
        },
      ],
    },
    {
      id: "msg-3",
      meta: { risk_band: "high", outcome: "declined", reasons_count: 3, latency_ms: 1760 },
      steps: [
        {
          id: "m3-s1",
          nodeId: "intake",
          timestamp: "2026-06-16T09:10:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "I need a $30,000 loan over 60 months to cover some bills.",
            },
            {
              label: "application",
              value: {
                applicant: "Priya N.",
                amount_requested: 30000,
                term_months: 60,
                purpose: "general expenses",
                annual_income: 42000,
              },
            },
          ],
        },
        {
          id: "m3-s2",
          nodeId: "risk_assessment",
          timestamp: "2026-06-16T09:10:00.660Z",
          payloads: [
            {
              label: "assessment",
              value: {
                credit_score: 596,
                debt_to_income: 0.58,
                delinquencies_24mo: 3,
                risk_band: "high",
              },
            },
          ],
        },
        {
          id: "m3-s3",
          nodeId: "decision",
          timestamp: "2026-06-16T09:10:01.200Z",
          payloads: [
            {
              label: "decision",
              value: {
                route: "decline",
                reason:
                  "High risk band: score below 620, DTI over 0.5, and recent delinquencies.",
              },
            },
          ],
        },
        {
          id: "m3-s4",
          nodeId: "decline",
          timestamp: "2026-06-16T09:10:01.760Z",
          payloads: [
            {
              label: "reasons",
              value: [
                "Credit score below the 620 minimum",
                "Debt-to-income ratio above 0.50",
                "Three delinquencies in the last 24 months",
              ],
            },
            {
              label: "Output",
              value:
                "We're unable to approve this loan right now. The main factors were your credit score, a high debt-to-income ratio, and recent missed payments. You're welcome to reapply after six months of on-time payments, and we've included free credit-counseling resources.",
            },
          ],
        },
      ],
    },
  ],
};
