import type { AgentTraceFile } from "@/types/agenttrace";

// The most graph-interesting bundled flow: a sequential research agent with two
// loops. A planner → searcher → synthesizer → gap_analyzer chain repeats when
// coverage is thin (gap_analyzer loops back to the planner — a long back-edge),
// and once satisfied a writer/critic pair revises the draft in a tight loop
// before finalizing. No parallelism — every step follows the one before it.
export const deepResearchTrace: AgentTraceFile = {
  version: "0.1",
  name: "deep_research.jsonl",
  meta: {
    source: "langgraph",
    createdAt: "2026-06-06T20:00:00Z",
    description:
      "An autonomous research agent. It plans a search, gathers sources, " +
      "synthesizes the findings, and checks for gaps — looping back to research " +
      "more when coverage is thin. Once satisfied it drafts a briefing and " +
      "revises it through a writer/critic loop. Two loops of different sizes " +
      "(a wide research cycle and a tight revision cycle) make the graph.",
  },
  graph: {
    nodes: [
      { id: "user_input", label: "User Input" },
      {
        id: "planner",
        label: "Planner",
        description:
          "Turns the topic into a search query, refining it based on gaps found in later rounds.",
      },
      {
        id: "searcher",
        label: "Searcher",
        description: "Runs the search query and returns the raw results.",
      },
      {
        id: "synthesizer",
        label: "Synthesizer",
        description: "Merges the search results into concise research notes.",
      },
      {
        id: "gap_analyzer",
        label: "Gap Analyzer",
        description:
          "Judges whether the notes cover the topic well enough to write the briefing, looping back to the planner when coverage is thin.",
      },
      {
        id: "writer",
        label: "Writer",
        description: "Drafts, and later revises, the briefing from the research notes.",
      },
      {
        id: "critic",
        label: "Critic",
        description: "Reviews the draft for accuracy and completeness, approving it or requesting a revision.",
      },
      { id: "final_response", label: "Final Response" },
    ],
    edges: [
      { source: "user_input", target: "planner" },
      { source: "planner", target: "searcher" },
      { source: "searcher", target: "synthesizer" },
      { source: "synthesizer", target: "gap_analyzer" },
      // Loop 1 (wide): coverage too thin → plan another research round.
      { source: "gap_analyzer", target: "planner", conditional: true },
      { source: "gap_analyzer", target: "writer", conditional: true },
      { source: "writer", target: "critic" },
      // Loop 2 (tight): critic asks for changes → writer revises.
      { source: "critic", target: "writer", conditional: true },
      { source: "critic", target: "final_response", conditional: true },
    ],
  },
  messages: [
    {
      id: "msg-1",
      meta: { research_rounds: 2, revisions: 1, outcome: "approved", latency_ms: 22360 },
      steps: [
        {
          id: "m1-s1",
          nodeId: "user_input",
          timestamp: "2026-06-06T20:00:00.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "Write a short briefing on the current state of solid-state " +
                "batteries.",
            },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "planner",
          timestamp: "2026-06-06T20:00:00.420Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are a research planner. Turn the topic into a search query.\n" +
                "Respond as JSON.\n\n" +
                "User:\n" +
                "Write a short briefing on the current state of solid-state batteries.",
            },
            {
              label: "llm_output",
              value:
                '{"round": 1, "query": "solid-state battery breakthroughs and challenges 2026"}',
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "searcher",
          timestamp: "2026-06-06T20:00:02.100Z",
          payloads: [
            {
              label: "query",
              value: "solid-state battery breakthroughs and challenges 2026",
            },
            {
              label: "results",
              value: [
                {
                  title: "Solid-state cells hit 500 Wh/kg in lab tests",
                  source: "web",
                },
                {
                  title: "Interfacial resistance in sulfide electrolytes",
                  source: "academic",
                },
                {
                  title: "Automaker targets pilot SSB line by 2027",
                  source: "news",
                },
              ],
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "synthesizer",
          timestamp: "2026-06-06T20:00:04.600Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Merge the search results into concise research notes.\n\n" +
                "Results: 500 Wh/kg lab cells; interfacial resistance challenge;\n" +
                "automaker pilot line targeted for 2027.",
            },
            {
              label: "llm_output",
              value:
                "Notes: Lab cells reach ~500 Wh/kg; sulfide electrolytes promising " +
                "but limited by interfacial resistance and dendrites; first pilot " +
                "production lines targeted ~2027. Missing: cost and scale-up data.",
            },
          ],
        },
        {
          id: "m1-s5",
          nodeId: "gap_analyzer",
          timestamp: "2026-06-06T20:00:05.840Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Judge whether the notes cover the topic well enough to\n" +
                'write the briefing. Respond as JSON: {"decision": "research_more"\n' +
                '| "sufficient", ...}.\n\n' +
                "Notes: <energy density, electrolyte challenges, 2027 pilots>",
            },
            {
              label: "llm_output",
              value:
                '{"decision": "research_more", "coverage": 0.6, ' +
                '"missing": "manufacturing cost and scale-up figures"}',
            },
          ],
        },
        {
          id: "m1-s6",
          nodeId: "planner",
          timestamp: "2026-06-06T20:00:06.500Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Coverage was thin on cost/scale-up. Plan a focused\n" +
                "second search. Respond as JSON.\n\n" +
                "Missing: manufacturing cost and scale-up figures",
            },
            {
              label: "llm_output",
              value:
                '{"round": 2, "query": "solid-state battery cost per kWh and manufacturing scale-up"}',
            },
          ],
        },
        {
          id: "m1-s7",
          nodeId: "searcher",
          timestamp: "2026-06-06T20:00:08.250Z",
          payloads: [
            {
              label: "query",
              value: "solid-state battery cost per kWh and manufacturing scale-up",
            },
            {
              label: "results",
              value: [
                {
                  title: "SSB packs still ~3× Li-ion cost, falling fast",
                  source: "web",
                },
                {
                  title: "Roll-to-roll processing of thin solid electrolytes",
                  source: "academic",
                },
              ],
            },
          ],
        },
        {
          id: "m1-s8",
          nodeId: "synthesizer",
          timestamp: "2026-06-06T20:00:10.700Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Update the notes with the second-round results.\n\n" +
                "Results: SSB packs ~3× Li-ion cost, declining; roll-to-roll\n" +
                "processing aids scale-up.",
            },
            {
              label: "llm_output",
              value:
                "Updated notes: add cost (~3× Li-ion today, falling) and a scale-up " +
                "path (roll-to-roll electrolyte processing). Coverage now spans " +
                "performance, challenges, cost, and manufacturing.",
            },
          ],
        },
        {
          id: "m1-s9",
          nodeId: "gap_analyzer",
          timestamp: "2026-06-06T20:00:11.820Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Judge whether the notes are now sufficient.\n\n" +
                "Notes: performance + challenges + cost + manufacturing",
            },
            {
              label: "llm_output",
              value: '{"decision": "sufficient", "coverage": 0.9}',
            },
          ],
        },
        {
          id: "m1-s10",
          nodeId: "writer",
          timestamp: "2026-06-06T20:00:15.300Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Write a short briefing (3–4 sentences) from the notes.\n\n" +
                "Notes: ~500 Wh/kg lab cells; interfacial resistance & dendrites;\n" +
                "~3× Li-ion cost falling; roll-to-roll scale-up; pilots ~2027.",
            },
            {
              label: "llm_output",
              value:
                "Solid-state batteries have reached ~500 Wh/kg in the lab, well " +
                "above today's lithium-ion. Key hurdles remain interfacial " +
                "resistance and dendrite growth, and packs still cost roughly three " +
                "times as much. Pilot production lines are targeted around 2027.",
            },
          ],
        },
        {
          id: "m1-s11",
          nodeId: "critic",
          timestamp: "2026-06-06T20:00:17.600Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Review the draft for accuracy and completeness. Respond\n" +
                'as JSON: {"decision": "revise" | "approved", "feedback": ...}.\n\n' +
                "Draft: <solid-state briefing v1>",
            },
            {
              label: "llm_output",
              value:
                '{"decision": "revise", "feedback": "Good, but add a one-line ' +
                'outlook on timeline/risk so a reader knows what to watch."}',
            },
          ],
        },
        {
          id: "m1-s12",
          nodeId: "writer",
          timestamp: "2026-06-06T20:00:20.100Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Revise per the critic's feedback (add an outlook line).\n\n" +
                "Feedback: add a one-line timeline/risk outlook.",
            },
            {
              label: "llm_output",
              value:
                "Solid-state batteries have reached ~500 Wh/kg in the lab, well " +
                "above today's lithium-ion. Key hurdles remain interfacial " +
                "resistance and dendrite growth, and packs still cost roughly three " +
                "times as much. Pilot lines are targeted around 2027. Outlook: " +
                "watch cost curves and yield from the first scale-up lines — those " +
                "will decide whether mass-market adoption arrives late this decade.",
            },
          ],
        },
        {
          id: "m1-s13",
          nodeId: "critic",
          timestamp: "2026-06-06T20:00:21.900Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Review the revised draft.\n\n" +
                "Draft: <solid-state briefing v2 with outlook>",
            },
            {
              label: "llm_output",
              value: '{"decision": "approved", "score": 0.92}',
            },
          ],
        },
        {
          id: "m1-s14",
          nodeId: "final_response",
          timestamp: "2026-06-06T20:00:22.360Z",
          payloads: [
            {
              label: "Output",
              value:
                "Solid-state batteries have reached ~500 Wh/kg in the lab, well " +
                "above today's lithium-ion. Key hurdles remain interfacial " +
                "resistance and dendrite growth, and packs still cost roughly three " +
                "times as much. Pilot lines are targeted around 2027. Outlook: " +
                "watch cost curves and yield from the first scale-up lines — those " +
                "will decide whether mass-market adoption arrives late this decade.",
            },
          ],
        },
      ],
    },
  ],
};
