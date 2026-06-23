import type { AgentTraceFile } from "@/types/agenttrace";

// Default trace loaded when the app starts. Payload labels are entirely the
// dev's choice in their own code — this sample just demonstrates a common,
// realistic convention:
// - LLM-backed nodes (router/planner/generator) log a single `llm_input` —
//   the raw prompt exactly as sent to the model — plus `llm_output`. We don't
//   artificially split "input" vs "prompt"; you build one call and log it.
// - non-LLM nodes log whatever fits them (a query, retrieved docs, etc.).
//
// It also exercises the visualizer's edge cases:
// - a branching graph (router -> planner/retriever)
// - multiple messages with different paths
// - duplicate payload labels within a node's step ("Input" → "Input"/"Input_2")
// - a node that is visited but logs no payloads (tool_node in message 1)
export const routerAgentTrace: AgentTraceFile = {
  version: "0.1",
  name: "router_agent.jsonl",
  meta: {
    source: "langgraph",
    createdAt: "2026-06-02T10:00:00Z",
    description:
      "A small router-based agent shown across two runs: a weather lookup that " +
      "goes through the planner and a tool call, and a research-paper summary " +
      "that goes through the retriever. Use it to explore playback, the " +
      "inspector, and the timeline without uploading your own. (Intentionally " +
      "long to show the info popover wrapping and scrolling rather than " +
      "overflowing a tooltip.)",
  },
  graph: {
    nodes: [
      { id: "user_input", label: "User Input" },
      { id: "router", label: "Router" },
      { id: "planner", label: "Planner" },
      { id: "retriever", label: "Retriever" },
      { id: "tool_node", label: "Tool" },
      { id: "generator", label: "Generator" },
      { id: "final_response", label: "Final Response" },
    ],
    edges: [
      { source: "user_input", target: "router" },
      { source: "router", target: "planner", conditional: true },
      { source: "router", target: "retriever", conditional: true },
      { source: "planner", target: "tool_node" },
      { source: "retriever", target: "generator" },
      { source: "tool_node", target: "generator" },
      { source: "generator", target: "final_response" },
    ],
  },
  messages: [
    {
      id: "msg-1",
      // No explicit title → the chip auto-renders "Message 1 : <entry input>".
      steps: [
        {
          id: "m1-s1",
          nodeId: "user_input",
          timestamp: "2026-06-02T10:00:00.000Z",
          payloads: [{ label: "Input", value: "What's the weather in Berlin?" }],
        },
        {
          id: "m1-s2",
          nodeId: "router",
          timestamp: "2026-06-02T10:00:00.290Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a routing agent. Pick the next node for the request.\n" +
                "Options:\n" +
                "  - planner: the request needs tools or external actions\n" +
                "  - retriever: the request needs document lookup\n" +
                'Respond as JSON: {"route": ..., "confidence": ...}\n\n' +
                "User:\n" +
                "What's the weather in Berlin?",
            },
            {
              label: "llm_output",
              value: '{"route": "planner", "confidence": 0.92}',
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "planner",
          timestamp: "2026-06-02T10:00:02.460Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a planning agent. Decompose the request into an ordered\n" +
                "list of tool calls. Use only the available tools.\n" +
                "Available tools:\n" +
                "  - weather_api(city: string)\n" +
                "  - news_api(topic: string)\n\n" +
                "User:\n" +
                "What's the weather in Berlin?",
            },
            {
              label: "llm_output",
              value: "{\"plan\": [\"weather_api(city='Berlin')\"]}",
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "tool_node",
          timestamp: "2026-06-02T10:00:06.010Z",
          // Visited but logs nothing — inspector should say "No payloads logged".
          payloads: [],
        },
        {
          id: "m1-s5",
          nodeId: "generator",
          timestamp: "2026-06-02T10:00:09.840Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a helpful assistant. Answer concisely and in a friendly\n" +
                "tone, using the tool result. Do not invent data.\n\n" +
                "User:\n" +
                "What's the weather in Berlin?\n\n" +
                "Tool result:\n" +
                '{"temp_c": 19, "conditions": "partly cloudy"}',
            },
            {
              label: "llm_output",
              value: "It's 19°C and partly cloudy in Berlin.",
            },
          ],
        },
        {
          id: "m1-s6",
          nodeId: "final_response",
          timestamp: "2026-06-02T10:00:10.210Z",
          payloads: [
            { label: "Output", value: "It's 19°C and partly cloudy in Berlin." },
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
          timestamp: "2026-06-02T10:05:00.000Z",
          payloads: [
            { label: "Input", value: "Summarize the attached research paper." },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "router",
          timestamp: "2026-06-02T10:05:00.340Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a routing agent. Pick the next node for the request.\n" +
                "Options:\n" +
                "  - planner: the request needs tools or external actions\n" +
                "  - retriever: the request needs document lookup\n" +
                'Respond as JSON: {"route": ..., "confidence": ...}\n\n' +
                "User:\n" +
                "Summarize the attached research paper.",
            },
            {
              label: "llm_output",
              value: '{"route": "retriever", "confidence": 0.88}',
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "retriever",
          timestamp: "2026-06-02T10:05:03.880Z",
          payloads: [
            // Duplicate label "Input" within the same step — the UI disambiguates
            // these as "Input" and "Input_2". (Retriever isn't an LLM node, so it
            // has no llm_input — just its query and what it fetched.)
            { label: "Input", value: "Summarize the attached research paper." },
            { label: "Input", value: { topK: 4, namespace: "papers" } },
            {
              label: "Retrieved docs",
              value: [
                { id: "doc-7", score: 0.81 },
                { id: "doc-2", score: 0.77 },
              ],
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "generator",
          timestamp: "2026-06-02T10:05:11.220Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a research assistant. Summarize the retrieved documents\n" +
                "into 3-4 sentences for a technical reader. Cite nothing the\n" +
                "documents don't support.\n\n" +
                "User:\n" +
                "Summarize the attached research paper.\n\n" +
                "Documents:\n" +
                "[doc-7, doc-2]",
            },
            {
              label: "llm_output",
              value:
                "The paper proposes a sparse attention variant that scales to long " +
                "contexts with near-linear cost, trading a small accuracy drop for " +
                "large memory savings.",
            },
          ],
        },
        {
          id: "m2-s5",
          nodeId: "final_response",
          timestamp: "2026-06-02T10:05:11.690Z",
          payloads: [
            {
              label: "Output",
              value:
                "The paper proposes a sparse attention variant that scales to long " +
                "contexts with near-linear cost, trading a small accuracy drop for " +
                "large memory savings.",
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
          timestamp: "2026-06-02T10:10:00.000Z",
          payloads: [
            { label: "Input", value: "Any recent news about the Mars rover?" },
          ],
        },
        {
          id: "m3-s2",
          nodeId: "router",
          timestamp: "2026-06-02T10:10:00.320Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a routing agent. Pick the next node for the request.\n" +
                "Options:\n" +
                "  - planner: the request needs tools or external actions\n" +
                "  - retriever: the request needs document lookup\n" +
                'Respond as JSON: {"route": ..., "confidence": ...}\n\n' +
                "User:\n" +
                "Any recent news about the Mars rover?",
            },
            {
              label: "llm_output",
              value: '{"route": "planner", "confidence": 0.9}',
            },
          ],
        },
        {
          id: "m3-s3",
          nodeId: "planner",
          timestamp: "2026-06-02T10:10:02.180Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a planning agent. Decompose the request into an ordered\n" +
                "list of tool calls. Use only the available tools.\n" +
                "Available tools:\n" +
                "  - weather_api(city: string)\n" +
                "  - news_api(topic: string)\n\n" +
                "User:\n" +
                "Any recent news about the Mars rover?",
            },
            {
              label: "llm_output",
              value: "{\"plan\": [\"news_api(topic='Mars rover')\"]}",
            },
          ],
        },
        {
          id: "m3-s4",
          nodeId: "tool_node",
          timestamp: "2026-06-02T10:10:05.640Z",
          payloads: [
            { label: "tool", value: "news_api(topic='Mars rover')" },
            {
              label: "tool_result",
              value: [
                { title: "Rover finds new mineral veins in crater", age_h: 6 },
                { title: "Mission extended through 2027", age_h: 20 },
              ],
            },
          ],
        },
        {
          id: "m3-s5",
          nodeId: "generator",
          timestamp: "2026-06-02T10:10:08.900Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a helpful assistant. Summarize the tool result briefly.\n\n" +
                "User:\n" +
                "Any recent news about the Mars rover?\n\n" +
                "Tool result:\n" +
                "[mineral veins in crater (6h), mission extended to 2027 (20h)]",
            },
            {
              label: "llm_output",
              value:
                "Two recent items: the rover found new mineral veins in the crater, " +
                "and the mission was just extended through 2027.",
            },
          ],
        },
        {
          id: "m3-s6",
          nodeId: "final_response",
          timestamp: "2026-06-02T10:10:09.270Z",
          payloads: [
            {
              label: "Output",
              value:
                "Two recent items: the rover found new mineral veins in the crater, " +
                "and the mission was just extended through 2027.",
            },
          ],
        },
      ],
    },
  ],
};
