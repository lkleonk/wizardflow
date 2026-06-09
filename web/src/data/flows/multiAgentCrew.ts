import type { AgentTraceFile } from "@/types/agenttrace";

// Fan-out multi-agent crew: an orchestrator delegates to three specialists with
// distinct roles (researcher, coder, critic), then a synthesizer merges their
// work. Every node here is an LLM node, so each logs llm_input/llm_output. The
// wide graph (one source fanning to three, then converging) stresses the layout.
export const multiAgentCrewTrace: AgentTraceFile = {
  version: "0.1",
  name: "multi_agent_crew.json",
  meta: {
    source: "crewai",
    createdAt: "2026-05-30T09:45:00Z",
    description:
      "A crew of specialist agents collaborating on a coding task. The " +
      "orchestrator assigns subtasks to a researcher, a coder, and a critic " +
      "that run independently, then a synthesizer combines their outputs into " +
      "the final answer. Demonstrates a wide fan-out / fan-in graph.",
  },
  graph: {
    nodes: [
      { id: "user_input", label: "User Input" },
      { id: "orchestrator", label: "Orchestrator" },
      { id: "researcher", label: "Researcher" },
      { id: "coder", label: "Coder" },
      { id: "critic", label: "Critic" },
      { id: "synthesizer", label: "Synthesizer" },
      { id: "final_response", label: "Final Response" },
    ],
    edges: [
      { source: "user_input", target: "orchestrator" },
      { source: "orchestrator", target: "researcher" },
      { source: "orchestrator", target: "coder" },
      { source: "orchestrator", target: "critic" },
      { source: "researcher", target: "synthesizer" },
      { source: "coder", target: "synthesizer" },
      { source: "critic", target: "synthesizer" },
      { source: "synthesizer", target: "final_response" },
    ],
  },
  messages: [
    {
      id: "msg-1",
      steps: [
        {
          id: "m1-s1",
          nodeId: "user_input",
          timestamp: "2026-05-30T09:45:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "Write a Python function to detect palindromes and explain it.",
            },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "orchestrator",
          timestamp: "2026-05-30T09:45:00.520Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are the orchestrator. Break the task into subtasks for the\n" +
                "researcher, coder, and critic. Respond as JSON.\n\n" +
                "User:\n" +
                "Write a Python function to detect palindromes and explain it.",
            },
            {
              label: "llm_output",
              value:
                '{"researcher": "define palindrome + edge cases", ' +
                '"coder": "implement is_palindrome(s)", ' +
                '"critic": "review correctness + style"}',
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "researcher",
          timestamp: "2026-05-30T09:45:02.110Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: You are the researcher. Define the problem precisely.\n\n" +
                "Task: define palindrome + edge cases",
            },
            {
              label: "llm_output",
              value:
                "A palindrome reads the same forwards and backwards. Edge cases: " +
                "case-insensitivity, ignoring spaces/punctuation, and treating the " +
                "empty string as a palindrome.",
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "coder",
          timestamp: "2026-05-30T09:45:03.470Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: You are the coder. Implement the function in Python.\n\n" +
                "Task: implement is_palindrome(s)",
            },
            {
              label: "llm_output",
              value:
                "def is_palindrome(s: str) -> bool:\n" +
                "    cleaned = [c.lower() for c in s if c.isalnum()]\n" +
                "    return cleaned == cleaned[::-1]",
            },
          ],
        },
        {
          id: "m1-s5",
          nodeId: "critic",
          timestamp: "2026-05-30T09:45:04.880Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: You are the critic. Review the implementation.\n\n" +
                "Task: review correctness + style",
            },
            {
              label: "llm_output",
              value:
                "Correct and handles the edge cases. Clean and idiomatic. " +
                "Optional: a two-pointer scan avoids building a reversed copy.",
            },
          ],
        },
        {
          id: "m1-s6",
          nodeId: "synthesizer",
          timestamp: "2026-05-30T09:45:06.300Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: You are the synthesizer. Combine the researcher's notes,\n" +
                "the coder's function, and the critic's review into one answer.\n\n" +
                "Researcher: <definition + edge cases>\n" +
                "Coder: <is_palindrome implementation>\n" +
                "Critic: <approved, suggested two-pointer>",
            },
            {
              label: "llm_output",
              value:
                "Here's a palindrome checker that ignores case and non-alphanumeric " +
                "characters:\n\n" +
                "def is_palindrome(s: str) -> bool:\n" +
                "    cleaned = [c.lower() for c in s if c.isalnum()]\n" +
                "    return cleaned == cleaned[::-1]\n\n" +
                "It normalizes the string, then checks it against its reverse.",
            },
          ],
        },
        {
          id: "m1-s7",
          nodeId: "final_response",
          timestamp: "2026-05-30T09:45:06.720Z",
          payloads: [
            {
              label: "Output",
              value:
                "Here's a palindrome checker that ignores case and non-alphanumeric " +
                "characters:\n\n" +
                "def is_palindrome(s: str) -> bool:\n" +
                "    cleaned = [c.lower() for c in s if c.isalnum()]\n" +
                "    return cleaned == cleaned[::-1]\n\n" +
                "It normalizes the string, then checks it against its reverse.",
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
          timestamp: "2026-05-30T09:50:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "Write a Python function to check if a number is prime.",
            },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "orchestrator",
          timestamp: "2026-05-30T09:50:00.480Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are the orchestrator. Break the task into subtasks for the\n" +
                "researcher, coder, and critic. Respond as JSON.\n\n" +
                "User:\n" +
                "Write a Python function to check if a number is prime.",
            },
            {
              label: "llm_output",
              value:
                '{"researcher": "define primality + edge cases", ' +
                '"coder": "implement is_prime(n)", ' +
                '"critic": "review correctness + efficiency"}',
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "researcher",
          timestamp: "2026-05-30T09:50:01.960Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: You are the researcher. Define the problem precisely.\n\n" +
                "Task: define primality + edge cases",
            },
            {
              label: "llm_output",
              value:
                "A prime is an integer > 1 divisible only by 1 and itself. Edge " +
                "cases: numbers ≤ 1 are not prime; 2 is the only even prime. You " +
                "only need to test divisors up to √n.",
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "coder",
          timestamp: "2026-05-30T09:50:03.310Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: You are the coder. Implement the function in Python.\n\n" +
                "Task: implement is_prime(n)",
            },
            {
              label: "llm_output",
              value:
                "def is_prime(n: int) -> bool:\n" +
                "    if n < 2:\n" +
                "        return False\n" +
                "    i = 2\n" +
                "    while i * i <= n:\n" +
                "        if n % i == 0:\n" +
                "            return False\n" +
                "        i += 1\n" +
                "    return True",
            },
          ],
        },
        {
          id: "m2-s5",
          nodeId: "critic",
          timestamp: "2026-05-30T09:50:04.690Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: You are the critic. Review the implementation.\n\n" +
                "Task: review correctness + efficiency",
            },
            {
              label: "llm_output",
              value:
                "Correct, and the √n bound keeps it efficient. Handles n < 2. " +
                "Optional micro-optimization: special-case 2, then step odds only.",
            },
          ],
        },
        {
          id: "m2-s6",
          nodeId: "synthesizer",
          timestamp: "2026-05-30T09:50:06.020Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: You are the synthesizer. Combine the researcher's notes,\n" +
                "the coder's function, and the critic's review into one answer.\n\n" +
                "Researcher: <primality + edge cases>\n" +
                "Coder: <is_prime implementation>\n" +
                "Critic: <approved, √n bound is efficient>",
            },
            {
              label: "llm_output",
              value:
                "Here's an efficient primality check:\n\n" +
                "def is_prime(n: int) -> bool:\n" +
                "    if n < 2:\n" +
                "        return False\n" +
                "    i = 2\n" +
                "    while i * i <= n:\n" +
                "        if n % i == 0:\n" +
                "            return False\n" +
                "        i += 1\n" +
                "    return True\n\n" +
                "It rejects numbers below 2 and only tests divisors up to √n.",
            },
          ],
        },
        {
          id: "m2-s7",
          nodeId: "final_response",
          timestamp: "2026-05-30T09:50:06.450Z",
          payloads: [
            {
              label: "Output",
              value:
                "Here's an efficient primality check:\n\n" +
                "def is_prime(n: int) -> bool:\n" +
                "    if n < 2:\n" +
                "        return False\n" +
                "    i = 2\n" +
                "    while i * i <= n:\n" +
                "        if n % i == 0:\n" +
                "            return False\n" +
                "        i += 1\n" +
                "    return True\n\n" +
                "It rejects numbers below 2 and only tests divisors up to √n.",
            },
          ],
        },
      ],
    },
  ],
};
