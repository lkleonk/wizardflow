import type { AgentTraceFile } from "@/types/agenttrace";

const TRIAGE_PROMPT =
  "System:\n" +
  "You are the triage classifier for Cloudboard billing support. Route each\n" +
  "ticket to exactly one lane:\n" +
  '  - "faq": how-to and account questions answerable from the help center\n' +
  '  - "refund": refund or billing-adjustment requests the refund tool can draft\n' +
  '  - "human": anything needing judgment — angry or churn-risk customers,\n' +
  "    disputes outside tool scope, or explicit requests for a person\n" +
  "Return compact JSON with exactly: route, intent, sentiment, churn_risk,\n" +
  "confidence.";

const RESPONDER_PROMPT =
  "System:\n" +
  "You are the customer-facing responder for Cloudboard support. Write a\n" +
  "short, warm, concrete reply based only on the resolution notes below.\n" +
  "Never promise anything the notes don't state.";

// Support agent with human handoff: triage fans out to an FAQ lane, a refund
// tool, or a human. Refund drafts pass a deterministic policy gate that can
// return them for revision (the tight tool loop), approve them, or escalate.
// Four messages cover all lanes: an FAQ answer, a refund that loops once
// through a revision, an out-of-policy refund handed to a human, and an angry
// churn-risk ticket routed straight to a person.
export const supportHandoffTrace: AgentTraceFile = {
  version: "0.1",
  name: "support_handoff.jsonl",
  meta: {
    source: "custom",
    createdAt: "2026-06-19T14:05:00Z",
    description:
      "A SaaS billing support agent. Triage routes each ticket to an FAQ " +
      "lane, a refund tool, or a human. Refund drafts pass a policy gate " +
      "that can send them back for revision, approve and issue them, or " +
      "escalate — so automation stops exactly where policy says it should.",
  },
  graph: {
    nodes: [
      { id: "user_input", label: "User Input" },
      {
        id: "triage",
        label: "Triage",
        color: "#A78BFA",
        description: "Classifies each ticket and picks a lane: FAQ, refund tool, or human.",
      },
      {
        id: "faq_answer",
        label: "FAQ Answer",
        description: "Answers how-to questions from help-center articles.",
      },
      {
        id: "refund_tool",
        label: "Refund Tool",
        color: "#22D3EE",
        description: "Drafts and revises refunds via the billing API.",
      },
      {
        id: "policy_check",
        label: "Policy Check",
        description:
          "Deterministic rules gate: approves and issues a draft, returns it for revision, or escalates.",
      },
      {
        id: "human_handoff",
        label: "Human Handoff",
        color: "#FBBF24",
        description: "Packages the ticket's context for a human support agent.",
      },
      {
        id: "responder",
        label: "Responder",
        description: "Writes the customer-facing reply.",
      },
      { id: "final_response", label: "Final Response" },
    ],
    edges: [
      { source: "user_input", target: "triage" },
      { source: "triage", target: "faq_answer", conditional: true },
      { source: "triage", target: "refund_tool", conditional: true },
      { source: "triage", target: "human_handoff", conditional: true },
      { source: "faq_answer", target: "responder" },
      { source: "refund_tool", target: "policy_check" },
      // The revision loop: a rejected draft goes back to the tool.
      { source: "policy_check", target: "refund_tool", conditional: true },
      { source: "policy_check", target: "responder", conditional: true },
      { source: "policy_check", target: "human_handoff", conditional: true },
      { source: "human_handoff", target: "responder" },
      { source: "responder", target: "final_response" },
    ],
  },
  messages: [
    {
      id: "msg-1",
      label: "FAQ answer",
      meta: { user: "u-1094", lane: "faq", outcome: "answered", latency_ms: 2140 },
      // FAQ lane: triage -> faq_answer -> responder.
      steps: [
        {
          id: "m1-s1",
          nodeId: "user_input",
          timestamp: "2026-06-19T14:05:12.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "How do I change the billing email on our workspace? Invoices " +
                "should go to our finance inbox from now on.",
            },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "triage",
          timestamp: "2026-06-19T14:05:13.140Z",
          payloads: [
            {
              label: "llm_input",
              value:
                TRIAGE_PROMPT +
                "\n\n" +
                "Ticket: How do I change the billing email on our workspace? " +
                "Invoices should go to our finance inbox from now on.",
            },
            {
              label: "llm_output",
              value:
                '{"route": "faq", "intent": "billing_email_change", ' +
                '"sentiment": "neutral", "churn_risk": "low", "confidence": 0.97}',
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "faq_answer",
          timestamp: "2026-06-19T14:05:15.480Z",
          payloads: [
            {
              label: "query",
              value: "change billing email workspace invoices",
            },
            {
              label: "article",
              value: {
                id: "HC-114",
                title: "Update billing contacts",
                excerpt:
                  "Workspace admins can change billing recipients under " +
                  "Settings → Workspace → Billing → Billing contacts. Invoices " +
                  "are sent to every listed contact.",
              },
            },
            {
              label: "llm_input",
              value:
                "System: Answer the customer's question using only the " +
                "help-center article below. Be concrete about the click path.\n\n" +
                "Article HC-114 — Update billing contacts: Workspace admins can " +
                "change billing recipients under Settings → Workspace → Billing " +
                "→ Billing contacts. Invoices are sent to every listed contact.\n\n" +
                "Ticket: How do I change the billing email on our workspace?",
            },
            {
              label: "llm_output",
              value:
                "Any workspace admin can do this in about a minute: open " +
                "Settings → Workspace → Billing → Billing contacts, add your " +
                "finance inbox, and remove the old address. Every invoice from " +
                "then on goes to all listed contacts.",
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "responder",
          timestamp: "2026-06-19T14:05:17.260Z",
          payloads: [
            {
              label: "llm_input",
              value:
                RESPONDER_PROMPT +
                "\n\n" +
                "Resolution notes: FAQ answered from article HC-114 — billing " +
                "contacts are changed under Settings → Workspace → Billing → " +
                "Billing contacts; invoices go to all listed contacts.",
            },
            {
              label: "llm_output",
              value:
                "Happy to help! Any workspace admin can point invoices at your " +
                "finance inbox: go to Settings → Workspace → Billing → Billing " +
                "contacts, add the finance address, and remove the old one. " +
                "Future invoices will be sent to every contact on that list.",
            },
          ],
        },
        {
          id: "m1-s5",
          nodeId: "final_response",
          timestamp: "2026-06-19T14:05:17.590Z",
          payloads: [
            {
              label: "Output",
              value:
                "Happy to help! Any workspace admin can point invoices at your " +
                "finance inbox: go to Settings → Workspace → Billing → Billing " +
                "contacts, add the finance address, and remove the old one. " +
                "Future invoices will be sent to every contact on that list.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-2",
      label: "Refund — revise loop",
      meta: { user: "u-4821", lane: "refund", outcome: "refund issued", revisions: 1, latency_ms: 6820 },
      // Refund lane with the revision loop: the first draft is rejected by the
      // policy gate (missing the duplicate invoice pair), the tool revises it,
      // and the second check approves and issues.
      steps: [
        {
          id: "m2-s1",
          nodeId: "user_input",
          timestamp: "2026-06-19T14:11:40.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "We were charged twice for June — two $40 charges on the same " +
                "day. Please refund one of them. Workspace #W-2417.",
            },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "triage",
          timestamp: "2026-06-19T14:11:41.220Z",
          payloads: [
            {
              label: "llm_input",
              value:
                TRIAGE_PROMPT +
                "\n\n" +
                "Ticket: We were charged twice for June — two $40 charges on " +
                "the same day. Please refund one of them. Workspace #W-2417.",
            },
            {
              label: "llm_output",
              value:
                '{"route": "refund", "intent": "duplicate_charge", ' +
                '"sentiment": "mildly annoyed", "churn_risk": "low", ' +
                '"confidence": 0.95}',
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "refund_tool",
          timestamp: "2026-06-19T14:11:41.860Z",
          payloads: [
            {
              label: "tool_input",
              value: {
                action: "draft_refund",
                workspace: "W-2417",
                amount_usd: 40.0,
                reason: "duplicate_charge",
                invoices: [],
              },
            },
            {
              label: "tool_output",
              value: {
                draft_id: "RF-9012",
                status: "draft",
                amount_usd: 40.0,
                invoices: [],
                note: "no invoices attached",
              },
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "policy_check",
          timestamp: "2026-06-19T14:11:42.050Z",
          payloads: [
            {
              label: "draft",
              value: { draft_id: "RF-9012", amount_usd: 40.0, invoices: [] },
            },
            {
              label: "decision",
              value: {
                result: "revise",
                failed_rule:
                  "duplicate_charge refunds must reference both matching invoice ids",
                action: "return draft to refund tool",
              },
            },
          ],
        },
        {
          id: "m2-s5",
          nodeId: "refund_tool",
          timestamp: "2026-06-19T14:11:43.310Z",
          payloads: [
            {
              label: "tool_input",
              value: {
                action: "lookup_invoices",
                workspace: "W-2417",
                month: "2026-06",
              },
            },
            {
              label: "tool_output",
              value: {
                invoices: [
                  { id: "INV-3301", amount_usd: 40.0, date: "2026-06-03" },
                  { id: "INV-3307", amount_usd: 40.0, date: "2026-06-03" },
                ],
              },
            },
            {
              label: "tool_input",
              value: {
                action: "revise_refund",
                draft_id: "RF-9012",
                invoices: ["INV-3301", "INV-3307"],
                refund_target: "INV-3307",
              },
            },
            {
              label: "tool_output",
              value: {
                draft_id: "RF-9012",
                status: "draft",
                amount_usd: 40.0,
                invoices: ["INV-3301", "INV-3307"],
                refund_target: "INV-3307",
              },
            },
          ],
        },
        {
          id: "m2-s6",
          nodeId: "policy_check",
          timestamp: "2026-06-19T14:11:43.940Z",
          payloads: [
            {
              label: "decision",
              value: {
                result: "approve",
                checks_passed: [
                  "duplicate pair verified (INV-3301 / INV-3307, both $40.00 on 2026-06-03)",
                  "amount $40.00 ≤ $100.00 auto-approve limit",
                ],
                action: "issue refund",
              },
            },
            {
              label: "issued",
              value: {
                refund_id: "RF-9012",
                invoice: "INV-3307",
                amount_usd: 40.0,
                status: "issued",
                eta_business_days: "3–5",
              },
            },
          ],
        },
        {
          id: "m2-s7",
          nodeId: "responder",
          timestamp: "2026-06-19T14:11:45.910Z",
          payloads: [
            {
              label: "llm_input",
              value:
                RESPONDER_PROMPT +
                "\n\n" +
                "Resolution notes: duplicate charge confirmed (INV-3301 and " +
                "INV-3307, both $40.00 on 2026-06-03). Refund RF-9012 for " +
                "$40.00 issued against INV-3307; arrives in 3–5 business days.",
            },
            {
              label: "llm_output",
              value:
                "You're right — June was billed twice (invoices INV-3301 and " +
                "INV-3307, both $40.00 on June 3rd). I've refunded the " +
                "duplicate, INV-3307, in full. The $40.00 should reach your " +
                "original payment method within 3–5 business days.",
            },
          ],
        },
        {
          id: "m2-s8",
          nodeId: "final_response",
          timestamp: "2026-06-19T14:11:46.240Z",
          payloads: [
            {
              label: "Output",
              value:
                "You're right — June was billed twice (invoices INV-3301 and " +
                "INV-3307, both $40.00 on June 3rd). I've refunded the " +
                "duplicate, INV-3307, in full. The $40.00 should reach your " +
                "original payment method within 3–5 business days.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-3",
      label: "Refund — escalated",
      meta: { user: "u-3377", lane: "refund", outcome: "escalated to human", latency_ms: 5310 },
      // Refund lane, out of policy: the gate fails two rules and hands the
      // draft to a human instead of looping or approving.
      steps: [
        {
          id: "m3-s1",
          nodeId: "user_input",
          timestamp: "2026-06-19T14:23:05.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "We'd like a refund on the Growth annual plan we renewed six " +
                "weeks ago ($449) — we're consolidating tools and won't be " +
                "using Cloudboard anymore.",
            },
          ],
        },
        {
          id: "m3-s2",
          nodeId: "triage",
          timestamp: "2026-06-19T14:23:06.310Z",
          payloads: [
            {
              label: "llm_input",
              value:
                TRIAGE_PROMPT +
                "\n\n" +
                "Ticket: We'd like a refund on the Growth annual plan we " +
                "renewed six weeks ago ($449) — we're consolidating tools and " +
                "won't be using Cloudboard anymore.",
            },
            {
              label: "llm_output",
              value:
                '{"route": "refund", "intent": "plan_refund", ' +
                '"sentiment": "neutral", "churn_risk": "medium", ' +
                '"confidence": 0.93}',
            },
          ],
        },
        {
          id: "m3-s3",
          nodeId: "refund_tool",
          timestamp: "2026-06-19T14:23:06.980Z",
          payloads: [
            {
              label: "tool_input",
              value: {
                action: "draft_refund",
                workspace: "W-3164",
                amount_usd: 449.0,
                reason: "plan_cancellation",
                invoices: ["INV-2988"],
              },
            },
            {
              label: "tool_output",
              value: {
                draft_id: "RF-9014",
                status: "draft",
                amount_usd: 449.0,
                invoices: ["INV-2988"],
                renewal_date: "2026-05-07",
              },
            },
          ],
        },
        {
          id: "m3-s4",
          nodeId: "policy_check",
          timestamp: "2026-06-19T14:23:07.150Z",
          payloads: [
            {
              label: "decision",
              value: {
                result: "escalate",
                failed_checks: [
                  "amount $449.00 > $100.00 auto-approve limit",
                  "renewal on 2026-05-07 is 43 days ago — outside the 30-day refund window",
                ],
                action: "hand off to billing escalations",
              },
            },
          ],
        },
        {
          id: "m3-s5",
          nodeId: "human_handoff",
          timestamp: "2026-06-19T14:23:07.820Z",
          payloads: [
            {
              label: "ticket",
              value: {
                ticket: "T-5521",
                queue: "billing-escalations",
                draft: "RF-9014",
                summary:
                  "Cancellation refund request for Growth annual ($449.00, " +
                  "INV-2988, renewed 2026-05-07). Outside auto-approve limit " +
                  "and 30-day window; churn risk medium. Needs a human " +
                  "decision on a goodwill or prorated refund.",
                sla_hours: 24,
              },
            },
          ],
        },
        {
          id: "m3-s6",
          nodeId: "responder",
          timestamp: "2026-06-19T14:23:09.560Z",
          payloads: [
            {
              label: "llm_input",
              value:
                RESPONDER_PROMPT +
                "\n\n" +
                "Resolution notes: refund is outside automatic policy (amount " +
                "above auto-approve limit, renewal outside the 30-day window). " +
                "Escalated to the billing team as ticket T-5521; they respond " +
                "within one business day.",
            },
            {
              label: "llm_output",
              value:
                "Thanks for letting us know. Because this refund is larger " +
                "than I can approve automatically and the renewal falls " +
                "outside our standard 30-day window, I've passed it to our " +
                "billing team with the full context (ticket T-5521). A " +
                "teammate will get back to you within one business day with " +
                "your options.",
            },
          ],
        },
        {
          id: "m3-s7",
          nodeId: "final_response",
          timestamp: "2026-06-19T14:23:09.870Z",
          payloads: [
            {
              label: "Output",
              value:
                "Thanks for letting us know. Because this refund is larger " +
                "than I can approve automatically and the renewal falls " +
                "outside our standard 30-day window, I've passed it to our " +
                "billing team with the full context (ticket T-5521). A " +
                "teammate will get back to you within one business day with " +
                "your options.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-4",
      label: "Churn risk — handoff",
      meta: { user: "u-4821", lane: "human", outcome: "handed off", churn_risk: "high", latency_ms: 1670 },
      // Human lane: triage recognizes an angry churn-risk ticket and skips
      // automation entirely.
      steps: [
        {
          id: "m4-s1",
          nodeId: "user_input",
          timestamp: "2026-06-19T14:37:52.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "That's the third outage this month and every time I write in " +
                "I get bot answers. If this isn't fixed we're cancelling. I " +
                "want to talk to a person.",
            },
          ],
        },
        {
          id: "m4-s2",
          nodeId: "triage",
          timestamp: "2026-06-19T14:37:53.360Z",
          payloads: [
            {
              label: "llm_input",
              value:
                TRIAGE_PROMPT +
                "\n\n" +
                "Ticket: That's the third outage this month and every time I " +
                "write in I get bot answers. If this isn't fixed we're " +
                "cancelling. I want to talk to a person.",
            },
            {
              label: "llm_output",
              value:
                '{"route": "human", "intent": "cancellation_threat", ' +
                '"sentiment": "angry", "churn_risk": "high", "confidence": 0.99}',
            },
          ],
        },
        {
          id: "m4-s3",
          nodeId: "human_handoff",
          timestamp: "2026-06-19T14:37:53.980Z",
          payloads: [
            {
              label: "ticket",
              value: {
                ticket: "T-5522",
                queue: "retention",
                priority: "urgent",
                summary:
                  "High churn risk after three June outage reports; customer " +
                  "explicitly asked for a person. Route to a senior support " +
                  "engineer for a call, not another written reply.",
                sla_hours: 4,
              },
            },
          ],
        },
        {
          id: "m4-s4",
          nodeId: "responder",
          timestamp: "2026-06-19T14:37:55.720Z",
          payloads: [
            {
              label: "llm_input",
              value:
                RESPONDER_PROMPT +
                "\n\n" +
                "Resolution notes: ticket escalated as urgent to the retention " +
                "queue (T-5522). A senior support engineer will reach out " +
                "within 4 hours, by phone if the customer shares a number.",
            },
            {
              label: "llm_output",
              value:
                "You're right to be frustrated, and this shouldn't be handled " +
                "by a bot. I've marked your ticket urgent (T-5522) and a " +
                "senior support engineer — a real person — will contact you " +
                "within the next 4 hours. If you reply with a phone number, " +
                "they'll call instead of writing.",
            },
          ],
        },
        {
          id: "m4-s5",
          nodeId: "final_response",
          timestamp: "2026-06-19T14:37:56.030Z",
          payloads: [
            {
              label: "Output",
              value:
                "You're right to be frustrated, and this shouldn't be handled " +
                "by a bot. I've marked your ticket urgent (T-5522) and a " +
                "senior support engineer — a real person — will contact you " +
                "within the next 4 hours. If you reply with a phone number, " +
                "they'll call instead of writing.",
            },
          ],
        },
      ],
    },
  ],
};
