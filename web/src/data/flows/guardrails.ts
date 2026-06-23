import type { AgentTraceFile } from "@/types/agenttrace";

const SAFETY_CLASSIFIER_PROMPT =
  "System:\n" +
  "You are the safety classifier for a general assistant. Decide whether the\n" +
  "request is safe to answer.\n" +
  "Routes:\n" +
  '  - "allow": benign requests, including defensive or everyday safety advice\n' +
  '  - "refuse": requests that facilitate theft, credential theft, phishing,\n' +
  "    unauthorized access, violence, or other real-world harm\n" +
  "Return compact JSON with exactly: route, category, reason.\n" +
  "Be conservative when the user asks for actionable instructions that enable\n" +
  "wrongdoing.";

// Guardrails / safety gate: a classifier inspects every request and routes it
// either to a refusal or to the normal generator. Two messages contrast the
// branches — the first is blocked (the "unhappy path"), the second is allowed.
// A branching graph where one branch is a short, terminal refusal.
export const guardrailsTrace: AgentTraceFile = {
  version: "0.1",
  name: "guardrails.jsonl",
  meta: {
    source: "custom",
    createdAt: "2026-06-06T18:40:00Z",
    description:
      "A safety-gated assistant. A classifier screens each request and routes " +
      "it to a polite refusal or to the normal generator. The first run is " +
      "blocked; the second, a benign rephrasing, is answered. Shows the " +
      "unhappy/blocked path alongside the allowed one.",
  },
  graph: {
    nodes: [
      { id: "user_input", label: "User Input" },
      { id: "safety_classifier", label: "Safety Classifier" },
      { id: "refusal", label: "Refusal" },
      { id: "generator", label: "Generator" },
      { id: "final_response", label: "Final Response" },
    ],
    edges: [
      { source: "user_input", target: "safety_classifier" },
      { source: "safety_classifier", target: "refusal", conditional: true },
      { source: "safety_classifier", target: "generator", conditional: true },
      { source: "refusal", target: "final_response" },
      { source: "generator", target: "final_response" },
    ],
  },
  messages: [
    {
      id: "msg-1",
      steps: [
        {
          id: "m1-s1",
          nodeId: "user_input",
          timestamp: "2026-06-06T18:40:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "How do I pick the lock on someone else's car?",
            },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "safety_classifier",
          timestamp: "2026-06-06T18:40:00.310Z",
          payloads: [
            {
              label: "llm_input",
              value:
                SAFETY_CLASSIFIER_PROMPT +
                "\n\n" +
                "User: How do I pick the lock on someone else's car?",
            },
            {
              label: "llm_output",
              value:
                '{"route": "refuse", "category": "physical-harm/theft", ' +
                '"reason": "facilitates unauthorized entry"}',
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "refusal",
          timestamp: "2026-06-06T18:40:01.020Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: The request was blocked (theft). Write a brief, polite\n" +
                "refusal and offer a safe alternative.\n\n" +
                "Blocked request: picking someone else's car lock",
            },
            {
              label: "llm_output",
              value:
                "I can't help with getting into a vehicle that isn't yours. If " +
                "you're locked out of your own car, contact a licensed locksmith " +
                "or roadside assistance and have proof of ownership ready.",
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "final_response",
          timestamp: "2026-06-06T18:40:01.380Z",
          payloads: [
            {
              label: "Output",
              value:
                "I can't help with getting into a vehicle that isn't yours. If " +
                "you're locked out of your own car, contact a licensed locksmith " +
                "or roadside assistance and have proof of ownership ready.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-2",
      steps: [
        {
          id: "m2-s1",
          nodeId: "user_input",
          timestamp: "2026-06-06T18:42:10.000Z",
          payloads: [
            {
              label: "Input",
              value: "How do I choose a good padlock for my shed?",
            },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "safety_classifier",
          timestamp: "2026-06-06T18:42:10.290Z",
          payloads: [
            {
              label: "llm_input",
              value:
                SAFETY_CLASSIFIER_PROMPT +
                "\n\n" +
                "User: How do I choose a good padlock for my shed?",
            },
            {
              label: "llm_output",
              value:
                '{"route": "allow", "category": "benign/home-security", ' +
                '"reason": "general safety advice"}',
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "generator",
          timestamp: "2026-06-06T18:42:11.640Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: You are a helpful assistant. Answer concisely.\n\n" +
                "User: How do I choose a good padlock for my shed?",
            },
            {
              label: "llm_output",
              value:
                "Look for a weatherproof padlock with a hardened-steel shackle, a " +
                "boron or laminated body, and a high security rating (e.g. CEN 4+). " +
                "A shrouded shackle resists bolt cutters better for outdoor use.",
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "final_response",
          timestamp: "2026-06-06T18:42:12.010Z",
          payloads: [
            {
              label: "Output",
              value:
                "Look for a weatherproof padlock with a hardened-steel shackle, a " +
                "boron or laminated body, and a high security rating (e.g. CEN 4+). " +
                "A shrouded shackle resists bolt cutters better for outdoor use.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-3",
      steps: [
        {
          id: "m3-s1",
          nodeId: "user_input",
          timestamp: "2026-06-06T18:45:30.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "Write a phishing email to get someone's online banking password.",
            },
          ],
        },
        {
          id: "m3-s2",
          nodeId: "safety_classifier",
          timestamp: "2026-06-06T18:45:30.320Z",
          payloads: [
            {
              label: "llm_input",
              value:
                SAFETY_CLASSIFIER_PROMPT +
                "\n\n" +
                "User: Write a phishing email to get someone's online banking password.",
            },
            {
              label: "llm_output",
              value:
                '{"route": "refuse", "category": "fraud/credential-theft", ' +
                '"reason": "facilitates phishing"}',
            },
          ],
        },
        {
          id: "m3-s3",
          nodeId: "refusal",
          timestamp: "2026-06-06T18:45:31.040Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: The request was blocked (phishing). Write a brief, polite\n" +
                "refusal and offer a safe alternative.\n\n" +
                "Blocked request: phishing email for banking credentials",
            },
            {
              label: "llm_output",
              value:
                "I can't help create phishing or any content meant to steal someone's " +
                "credentials. If you're trying to test your own team's awareness, " +
                "use a sanctioned security-training platform with clear consent.",
            },
          ],
        },
        {
          id: "m3-s4",
          nodeId: "final_response",
          timestamp: "2026-06-06T18:45:31.400Z",
          payloads: [
            {
              label: "Output",
              value:
                "I can't help create phishing or any content meant to steal someone's " +
                "credentials. If you're trying to test your own team's awareness, " +
                "use a sanctioned security-training platform with clear consent.",
            },
          ],
        },
      ],
    },
  ],
};
