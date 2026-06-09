import type { AgentTraceFile } from "@/types/agenttrace";

// Linear RAG pipeline: embed the question, search a knowledge base, rerank the
// hits, then let an LLM answer from the retrieved docs. Only the generator is an
// LLM node (llm_input/llm_output); the retrieval nodes log their own domain data
// (vectors, scored matches) instead.
export const ragPipelineTrace: AgentTraceFile = {
  version: "0.1",
  name: "rag_pipeline.json",
  meta: {
    source: "llamaindex",
    createdAt: "2026-05-28T14:12:00Z",
    description:
      "A retrieval-augmented generation pipeline answering a medical question. " +
      "The query is embedded, matched against a drug-information knowledge base, " +
      "the top hits are reranked, and a single LLM call writes the grounded " +
      "answer. A clean linear flow with structured retrieval payloads.",
  },
  graph: {
    nodes: [
      { id: "user_input", label: "User Input" },
      { id: "embedder", label: "Embedder" },
      { id: "vector_search", label: "Vector Search" },
      { id: "reranker", label: "Reranker" },
      { id: "generator", label: "Generator" },
      { id: "final_response", label: "Final Response" },
    ],
    edges: [
      { source: "user_input", target: "embedder" },
      { source: "embedder", target: "vector_search" },
      { source: "vector_search", target: "reranker" },
      { source: "reranker", target: "generator" },
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
          timestamp: "2026-05-28T14:12:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "What are the common side effects of ibuprofen?",
            },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "embedder",
          timestamp: "2026-05-28T14:12:00.140Z",
          payloads: [
            {
              label: "query",
              value: "What are the common side effects of ibuprofen?",
            },
            {
              label: "embedding",
              value: {
                model: "text-embedding-3-small",
                dims: 1536,
                // truncated for display
                vector: [0.0182, -0.0461, 0.0093, 0.0517, -0.0228, "…"],
              },
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "vector_search",
          timestamp: "2026-05-28T14:12:00.380Z",
          payloads: [
            { label: "params", value: { topK: 4, namespace: "drug-info" } },
            {
              label: "matches",
              value: [
                { id: "ibuprofen#adverse", score: 0.89, source: "DrugBank" },
                { id: "nsaid#gi-effects", score: 0.84, source: "DrugBank" },
                { id: "ibuprofen#dosage", score: 0.71, source: "DrugBank" },
                { id: "nsaid#renal", score: 0.66, source: "DrugBank" },
              ],
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "reranker",
          timestamp: "2026-05-28T14:12:00.910Z",
          payloads: [
            { label: "model", value: "rerank-3" },
            {
              label: "reranked",
              value: [
                { id: "ibuprofen#adverse", score: 0.97 },
                { id: "nsaid#gi-effects", score: 0.93 },
                { id: "nsaid#renal", score: 0.55 },
              ],
            },
          ],
        },
        {
          id: "m1-s5",
          nodeId: "generator",
          timestamp: "2026-05-28T14:12:03.420Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a careful medical-information assistant. Answer only from\n" +
                "the provided context. Keep it brief and add a safety note.\n\n" +
                "Context:\n" +
                "[ibuprofen#adverse] Common adverse effects: nausea, dyspepsia,\n" +
                "  abdominal pain, headache, dizziness.\n" +
                "[nsaid#gi-effects] NSAIDs may cause GI bleeding with prolonged use.\n\n" +
                "User:\n" +
                "What are the common side effects of ibuprofen?",
            },
            {
              label: "llm_output",
              value:
                "Common side effects of ibuprofen include nausea, indigestion, " +
                "stomach pain, headache, and dizziness. Prolonged use can raise the " +
                "risk of gastrointestinal bleeding. This isn't medical advice — " +
                "check with a pharmacist or doctor for your situation.",
            },
          ],
        },
        {
          id: "m1-s6",
          nodeId: "final_response",
          timestamp: "2026-05-28T14:12:03.880Z",
          payloads: [
            {
              label: "Output",
              value:
                "Common side effects of ibuprofen include nausea, indigestion, " +
                "stomach pain, headache, and dizziness. Prolonged use can raise the " +
                "risk of gastrointestinal bleeding. This isn't medical advice — " +
                "check with a pharmacist or doctor for your situation.",
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
          timestamp: "2026-05-28T14:18:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "Can I take ibuprofen with my blood pressure medication?",
            },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "embedder",
          timestamp: "2026-05-28T14:18:00.150Z",
          payloads: [
            {
              label: "query",
              value: "Can I take ibuprofen with my blood pressure medication?",
            },
            {
              label: "embedding",
              value: {
                model: "text-embedding-3-small",
                dims: 1536,
                vector: [0.0291, 0.0117, -0.0382, 0.0044, 0.0265, "…"],
              },
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "vector_search",
          timestamp: "2026-05-28T14:18:00.410Z",
          payloads: [
            { label: "params", value: { topK: 4, namespace: "drug-info" } },
            {
              label: "matches",
              value: [
                { id: "nsaid#interactions", score: 0.9, source: "DrugBank" },
                { id: "ibuprofen#bp-meds", score: 0.86, source: "DrugBank" },
                { id: "ibuprofen#adverse", score: 0.6, source: "DrugBank" },
              ],
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "reranker",
          timestamp: "2026-05-28T14:18:00.930Z",
          payloads: [
            { label: "model", value: "rerank-3" },
            {
              label: "reranked",
              value: [
                { id: "ibuprofen#bp-meds", score: 0.96 },
                { id: "nsaid#interactions", score: 0.94 },
              ],
            },
          ],
        },
        {
          id: "m2-s5",
          nodeId: "generator",
          timestamp: "2026-05-28T14:18:03.270Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a careful medical-information assistant. Answer only from\n" +
                "the provided context. Keep it brief and add a safety note.\n\n" +
                "Context:\n" +
                "[ibuprofen#bp-meds] NSAIDs can reduce the effect of ACE inhibitors\n" +
                "  and diuretics and may raise blood pressure.\n" +
                "[nsaid#interactions] Caution combining NSAIDs with antihypertensives.\n\n" +
                "User:\n" +
                "Can I take ibuprofen with my blood pressure medication?",
            },
            {
              label: "llm_output",
              value:
                "Ibuprofen can blunt the effect of some blood-pressure medicines " +
                "(like ACE inhibitors and diuretics) and may raise blood pressure, " +
                "so it's best used sparingly. Check with your doctor or pharmacist " +
                "before combining them — this isn't medical advice.",
            },
          ],
        },
        {
          id: "m2-s6",
          nodeId: "final_response",
          timestamp: "2026-05-28T14:18:03.690Z",
          payloads: [
            {
              label: "Output",
              value:
                "Ibuprofen can blunt the effect of some blood-pressure medicines " +
                "(like ACE inhibitors and diuretics) and may raise blood pressure, " +
                "so it's best used sparingly. Check with your doctor or pharmacist " +
                "before combining them — this isn't medical advice.",
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
          timestamp: "2026-05-28T14:25:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "What's the maximum safe daily dose of acetaminophen?",
            },
          ],
        },
        {
          id: "m3-s2",
          nodeId: "embedder",
          timestamp: "2026-05-28T14:25:00.140Z",
          payloads: [
            {
              label: "query",
              value: "What's the maximum safe daily dose of acetaminophen?",
            },
            {
              label: "embedding",
              value: {
                model: "text-embedding-3-small",
                dims: 1536,
                vector: [-0.0123, 0.0408, 0.0091, -0.0277, 0.0162, "…"],
              },
            },
          ],
        },
        {
          id: "m3-s3",
          nodeId: "vector_search",
          timestamp: "2026-05-28T14:25:00.390Z",
          payloads: [
            { label: "params", value: { topK: 4, namespace: "drug-info" } },
            {
              label: "matches",
              value: [
                { id: "acetaminophen#dosage", score: 0.93, source: "DrugBank" },
                { id: "acetaminophen#liver", score: 0.79, source: "DrugBank" },
              ],
            },
          ],
        },
        {
          id: "m3-s4",
          nodeId: "reranker",
          timestamp: "2026-05-28T14:25:00.880Z",
          payloads: [
            { label: "model", value: "rerank-3" },
            {
              label: "reranked",
              value: [
                { id: "acetaminophen#dosage", score: 0.98 },
                { id: "acetaminophen#liver", score: 0.81 },
              ],
            },
          ],
        },
        {
          id: "m3-s5",
          nodeId: "generator",
          timestamp: "2026-05-28T14:25:02.940Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a careful medical-information assistant. Answer only from\n" +
                "the provided context. Keep it brief and add a safety note.\n\n" +
                "Context:\n" +
                "[acetaminophen#dosage] Adults: max 4,000 mg/day; many guidelines\n" +
                "  advise staying at or below 3,000 mg to protect the liver.\n" +
                "[acetaminophen#liver] Overdose risk is hepatotoxicity.\n\n" +
                "User:\n" +
                "What's the maximum safe daily dose of acetaminophen?",
            },
            {
              label: "llm_output",
              value:
                "For most adults the maximum is 4,000 mg of acetaminophen per day, " +
                "though many guidelines suggest staying at or under 3,000 mg to be " +
                "easier on the liver. Don't combine it with other products that " +
                "also contain acetaminophen. This isn't medical advice.",
            },
          ],
        },
        {
          id: "m3-s6",
          nodeId: "final_response",
          timestamp: "2026-05-28T14:25:03.350Z",
          payloads: [
            {
              label: "Output",
              value:
                "For most adults the maximum is 4,000 mg of acetaminophen per day, " +
                "though many guidelines suggest staying at or under 3,000 mg to be " +
                "easier on the liver. Don't combine it with other products that " +
                "also contain acetaminophen. This isn't medical advice.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-4",
      steps: [
        {
          id: "m4-s1",
          nodeId: "user_input",
          timestamp: "2026-05-28T14:31:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "How long does amoxicillin take to start working?",
            },
          ],
        },
        {
          id: "m4-s2",
          nodeId: "embedder",
          timestamp: "2026-05-28T14:31:00.150Z",
          payloads: [
            {
              label: "query",
              value: "How long does amoxicillin take to start working?",
            },
            {
              label: "embedding",
              value: {
                model: "text-embedding-3-small",
                dims: 1536,
                vector: [0.0205, -0.0312, 0.0177, 0.0049, -0.0231, "…"],
              },
            },
          ],
        },
        {
          id: "m4-s3",
          nodeId: "vector_search",
          timestamp: "2026-05-28T14:31:00.400Z",
          payloads: [
            { label: "params", value: { topK: 4, namespace: "drug-info" } },
            {
              label: "matches",
              value: [
                { id: "amoxicillin#onset", score: 0.88, source: "DrugBank" },
                { id: "antibiotics#course", score: 0.74, source: "DrugBank" },
              ],
            },
          ],
        },
        {
          id: "m4-s4",
          nodeId: "reranker",
          timestamp: "2026-05-28T14:31:00.910Z",
          payloads: [
            { label: "model", value: "rerank-3" },
            {
              label: "reranked",
              value: [
                { id: "amoxicillin#onset", score: 0.95 },
                { id: "antibiotics#course", score: 0.83 },
              ],
            },
          ],
        },
        {
          id: "m4-s5",
          nodeId: "generator",
          timestamp: "2026-05-28T14:31:03.020Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a careful medical-information assistant. Answer only from\n" +
                "the provided context. Keep it brief and add a safety note.\n\n" +
                "Context:\n" +
                "[amoxicillin#onset] Begins working within hours; noticeable\n" +
                "  improvement usually in 48–72 hours.\n" +
                "[antibiotics#course] Finish the full prescribed course.\n\n" +
                "User:\n" +
                "How long does amoxicillin take to start working?",
            },
            {
              label: "llm_output",
              value:
                "Amoxicillin starts acting within a few hours, but you'll usually " +
                "feel noticeably better after about 48–72 hours. Finish the whole " +
                "course even if you improve sooner. If you're not better in 3 days, " +
                "contact your doctor. This isn't medical advice.",
            },
          ],
        },
        {
          id: "m4-s6",
          nodeId: "final_response",
          timestamp: "2026-05-28T14:31:03.440Z",
          payloads: [
            {
              label: "Output",
              value:
                "Amoxicillin starts acting within a few hours, but you'll usually " +
                "feel noticeably better after about 48–72 hours. Finish the whole " +
                "course even if you improve sooner. If you're not better in 3 days, " +
                "contact your doctor. This isn't medical advice.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-5",
      steps: [
        {
          id: "m5-s1",
          nodeId: "user_input",
          timestamp: "2026-05-28T14:39:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "Is it safe to take aspirin during pregnancy?",
            },
          ],
        },
        {
          id: "m5-s2",
          nodeId: "embedder",
          timestamp: "2026-05-28T14:39:00.160Z",
          payloads: [
            {
              label: "query",
              value: "Is it safe to take aspirin during pregnancy?",
            },
            {
              label: "embedding",
              value: {
                model: "text-embedding-3-small",
                dims: 1536,
                vector: [-0.0098, 0.0231, 0.0405, -0.0152, 0.0079, "…"],
              },
            },
          ],
        },
        {
          id: "m5-s3",
          nodeId: "vector_search",
          timestamp: "2026-05-28T14:39:00.420Z",
          payloads: [
            { label: "params", value: { topK: 4, namespace: "drug-info" } },
            {
              label: "matches",
              value: [
                { id: "aspirin#pregnancy", score: 0.92, source: "DrugBank" },
                { id: "nsaid#pregnancy", score: 0.85, source: "DrugBank" },
              ],
            },
          ],
        },
        {
          id: "m5-s4",
          nodeId: "reranker",
          timestamp: "2026-05-28T14:39:00.940Z",
          payloads: [
            { label: "model", value: "rerank-3" },
            {
              label: "reranked",
              value: [
                { id: "aspirin#pregnancy", score: 0.97 },
                { id: "nsaid#pregnancy", score: 0.88 },
              ],
            },
          ],
        },
        {
          id: "m5-s5",
          nodeId: "generator",
          timestamp: "2026-05-28T14:39:03.110Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a careful medical-information assistant. Answer only from\n" +
                "the provided context. Keep it brief and add a safety note.\n\n" +
                "Context:\n" +
                "[aspirin#pregnancy] Regular-dose aspirin is generally avoided,\n" +
                "  especially in the third trimester; low-dose may be prescribed.\n" +
                "[nsaid#pregnancy] NSAIDs are not recommended late in pregnancy.\n\n" +
                "User:\n" +
                "Is it safe to take aspirin during pregnancy?",
            },
            {
              label: "llm_output",
              value:
                "Regular-dose aspirin is generally avoided in pregnancy, especially " +
                "in the third trimester. Low-dose aspirin is sometimes prescribed " +
                "for specific reasons, but only under medical supervision. Please " +
                "talk to your doctor before taking it — this isn't medical advice.",
            },
          ],
        },
        {
          id: "m5-s6",
          nodeId: "final_response",
          timestamp: "2026-05-28T14:39:03.530Z",
          payloads: [
            {
              label: "Output",
              value:
                "Regular-dose aspirin is generally avoided in pregnancy, especially " +
                "in the third trimester. Low-dose aspirin is sometimes prescribed " +
                "for specific reasons, but only under medical supervision. Please " +
                "talk to your doctor before taking it — this isn't medical advice.",
            },
          ],
        },
      ],
    },
  ],
};
