import type { AgentTraceFile } from "@/types/agenttrace";

// Plan-and-execute with a replan loop: the planner emits a structured plan, the
// executor runs one step at a time (calling tools), and the replanner decides
// whether to keep going or finish. The executor is revisited (executor ->
// replanner -> executor), so the graph has a back-edge / cycle.
export const planExecuteTrace: AgentTraceFile = {
  version: "0.1",
  name: "plan_and_execute.jsonl",
  meta: {
    source: "langgraph",
    createdAt: "2026-06-01T16:20:00Z",
    description:
      "A plan-and-execute agent planning a weekend trip. The planner produces a " +
      "JSON plan, the executor runs each step with a tool, and the replanner " +
      "loops back until the plan is complete. Shows a structured plan payload " +
      "and a back-edge (replan loop) in the graph.",
  },
  graph: {
    nodes: [
      { id: "user_input", label: "User Input" },
      { id: "planner", label: "Planner" },
      { id: "executor", label: "Executor" },
      { id: "replanner", label: "Replanner" },
      { id: "final_response", label: "Final Response" },
    ],
    edges: [
      { source: "user_input", target: "planner" },
      { source: "planner", target: "executor" },
      { source: "executor", target: "replanner" },
      { source: "replanner", target: "executor", conditional: true },
      { source: "replanner", target: "final_response", conditional: true },
    ],
  },
  messages: [
    {
      id: "msg-1",
      steps: [
        {
          id: "m1-s1",
          nodeId: "user_input",
          timestamp: "2026-06-01T16:20:00.000Z",
          payloads: [
            { label: "Input", value: "Plan a weekend trip to Rome for two." },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "planner",
          timestamp: "2026-06-01T16:20:01.040Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a planning agent. Produce an ordered JSON plan of tool\n" +
                "steps. Tools: search_flights(origin, dest), search_hotels(city).\n\n" +
                "User:\n" +
                "Plan a weekend trip to Rome for two.",
            },
            {
              label: "llm_output",
              value:
                '{"plan": [' +
                '"search_flights(origin=\'BER\', dest=\'FCO\')", ' +
                '"search_hotels(city=\'Rome\')"]}',
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "executor",
          timestamp: "2026-06-01T16:20:02.560Z",
          payloads: [
            { label: "step", value: "search_flights(origin='BER', dest='FCO')" },
            {
              label: "tool_result",
              value: {
                outbound: "BER→FCO Sat 08:10",
                return: "FCO→BER Sun 19:40",
                price_eur: 184,
              },
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "replanner",
          timestamp: "2026-06-01T16:20:03.910Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Given the plan and completed steps, decide the next\n" +
                "action: continue with the next step or finish.\n\n" +
                "Completed: [search_flights] ✓\n" +
                "Remaining: [search_hotels]",
            },
            {
              label: "llm_output",
              value: '{"decision": "continue", "next": "search_hotels(city=\'Rome\')"}',
            },
          ],
        },
        {
          id: "m1-s5",
          nodeId: "executor",
          timestamp: "2026-06-01T16:20:05.230Z",
          payloads: [
            { label: "step", value: "search_hotels(city='Rome')" },
            {
              label: "tool_result",
              value: {
                hotel: "Trastevere Boutique",
                nights: 2,
                price_eur: 312,
                rating: 4.6,
              },
            },
          ],
        },
        {
          id: "m1-s6",
          nodeId: "replanner",
          timestamp: "2026-06-01T16:20:06.480Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Given the plan and completed steps, decide the next\n" +
                "action: continue with the next step or finish.\n\n" +
                "Completed: [search_flights, search_hotels] ✓\n" +
                "Remaining: []",
            },
            { label: "llm_output", value: '{"decision": "finish"}' },
          ],
        },
        {
          id: "m1-s7",
          nodeId: "final_response",
          timestamp: "2026-06-01T16:20:07.010Z",
          payloads: [
            {
              label: "Output",
              value:
                "Your Rome weekend: fly BER→FCO Sat 08:10, return Sun 19:40 (€184), " +
                "and stay 2 nights at the Trastevere Boutique (4.6★, €312). " +
                "Total ≈ €496 for two.",
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
          timestamp: "2026-06-01T16:30:00.000Z",
          payloads: [
            { label: "Input", value: "Plan a day hike near Munich for Saturday." },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "planner",
          timestamp: "2026-06-01T16:30:01.120Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a planning agent. Produce an ordered JSON plan of tool\n" +
                "steps. Tools: search_trails(near, max_km), check_weather(place, day).\n\n" +
                "User:\n" +
                "Plan a day hike near Munich for Saturday.",
            },
            {
              label: "llm_output",
              value:
                '{"plan": [' +
                '"search_trails(near=\'Munich\', max_km=60)", ' +
                '"check_weather(place=\'Tegernsee\', day=\'Sat\')"]}',
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "executor",
          timestamp: "2026-06-01T16:30:02.580Z",
          payloads: [
            { label: "step", value: "search_trails(near='Munich', max_km=60)" },
            {
              label: "tool_result",
              value: {
                trail: "Tegernsee – Wallberg loop",
                distance_km: 11,
                ascent_m: 850,
                drive_min: 55,
              },
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "replanner",
          timestamp: "2026-06-01T16:30:03.840Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Given the plan and completed steps, decide the next\n" +
                "action: continue with the next step or finish.\n\n" +
                "Completed: [search_trails] ✓\n" +
                "Remaining: [check_weather]",
            },
            {
              label: "llm_output",
              value:
                '{"decision": "continue", "next": "check_weather(place=\'Tegernsee\', day=\'Sat\')"}',
            },
          ],
        },
        {
          id: "m2-s5",
          nodeId: "executor",
          timestamp: "2026-06-01T16:30:05.210Z",
          payloads: [
            { label: "step", value: "check_weather(place='Tegernsee', day='Sat')" },
            {
              label: "tool_result",
              value: { conditions: "sunny", high_c: 21, rain_chance: 0.1 },
            },
          ],
        },
        {
          id: "m2-s6",
          nodeId: "replanner",
          timestamp: "2026-06-01T16:30:06.470Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Given the plan and completed steps, decide the next\n" +
                "action: continue with the next step or finish.\n\n" +
                "Completed: [search_trails, check_weather] ✓\n" +
                "Remaining: []",
            },
            { label: "llm_output", value: '{"decision": "finish"}' },
          ],
        },
        {
          id: "m2-s7",
          nodeId: "final_response",
          timestamp: "2026-06-01T16:30:06.990Z",
          payloads: [
            {
              label: "Output",
              value:
                "For Saturday: the Tegernsee–Wallberg loop (11 km, 850 m ascent, " +
                "~55 min drive from Munich). Weather looks great — sunny, 21°C, " +
                "10% chance of rain. Pack water and sun protection.",
            },
          ],
        },
      ],
    },
  ],
};
