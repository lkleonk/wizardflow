import type { AgentTraceFile } from "@/types/agenttrace";

// Inspired by a real LangGraph trace from a German CS Master's degree-advising
// bot (genericized: no institution name, course titles, addresses, or model
// provider from the source are kept). A scope classifier fans a student
// message out to one of four branches — off-topic, a direct rule answer, a
// course-offering lookup, or a full study-plan check — and two of those
// branches (course lookup, plan check) run a deterministic tool node before
// rejoining at the composer. Unlike the other bundled examples this reuses one
// large system prompt verbatim on almost every LLM call, exactly as the source
// trace did — a real, if wasteful, pattern worth seeing in the inspector.
const RULES = `Degree checklist (CS Master's program, local Studien- und Pruefungsordnung).

OVERALL STRUCTURE
- The degree comprises 120 LP total: 90 LP of modules before the thesis and a
  30 LP Masterarbeit. Regular duration is 4 semesters. There are no compulsory
  modules.

SPECIALIZATION AREA
- The Informatik area covers practical, technical, and theoretical CS. Exactly
  one of the three must be chosen as the specialization area.
- Informatik area total: 70 to 80 LP.
- Practical CS: at least 20 LP, or 40 LP if it is the specialization area.
- Technical CS: at least 10 LP, or 30 LP if it is the specialization area.
- Theoretical CS: at least 10 LP, or 30 LP if it is the specialization area.

APPLICATION AREA
- The application area (Anwendungsbereich) is tracked separately from
  Informatik and must contain 10 to 20 LP.

ACADEMIC-WRITING MODULES
- At least 2 and at most 4 core academic-writing (Wissenschaftliches Arbeiten)
  modules are required; at least one must be from the specialization area.
- Up to 2 additional academic-writing modules may sit in the elective pool
  (5 LP each, pool cap below). The same module can't be counted twice.

SOFTWARE-PROJECT MODULES
- At least 1 and at most 2 core software-project (Softwareprojekt) modules are
  required. A third is only possible when one is placed in the elective pool,
  for 3 total. Softwareprojekt A is graded; Softwareprojekt B is ungraded.

ELECTIVE POOL
- The elective pool (Wahlbereich) can contain at most 10 LP. A module keeps its
  own area for specialization purposes even while counted toward the pool.

UNGRADED MODULES
- Ungraded / non-differentiated modules must total 25 to 30 LP across the plan.

BACHELOR MODULES
- Bachelor-level modules can only be counted up to 15 LP total.

DUPLICATE MODULES
- The same exact module can't count twice, and a Master module already used in
  a prior Bachelor specialization can't be reused.`;

const CLASSIFIER_SYSTEM = `Domain: CS Master's program under the local Studien- und Pruefungsordnung.

${RULES}

Classify the latest student message into exactly one message_type:

- "plan_check": the student wants their concrete module plan, LP split,
  specialization, seminars, projects, or ungraded/Bachelor totals checked.
- "degree_question": the student asks about rules, LP requirements, limits,
  specialization, academic-writing or software-project modules, or the
  application area, and doesn't need a course-offering lookup.
- "course_offering_question": the student asks which courses, lectures,
  seminars, or software projects are offered in a semester.
- "off_topic": the message is unrelated to degree consulting.

Return valid JSON only.`;

const COMPOSER_SYSTEM = `You are a study consultant for the CS Master's program.
You give advisory answers grounded in the local Studien- und Pruefungsordnung.

${RULES}

Use the RULES section above as your authoritative source for all degree
rules, LP requirements, and structural constraints. Retrieved course-offering
context (when provided) covers exact local buckets and should only be used to
answer which courses are offered, never to override the rules.

Inputs you may receive:
1. Retrieved course-offering context (may be empty)
2. A parsed study plan (validated module list, only for plan checks)
3. A deterministic rule-check result (only for plan checks)

Length:
- A single factual lookup (a number, a name, a yes/no) gets 1-2 sentences.
- A plan check or multi-part question gets short bullet points.
- Never restate the question or list rules the student didn't ask about.

Other rules:
- Answer in the same language as the student.
- Do not invent rules beyond the RULES section.
- Only append the advisory disclaimer ("advisory; official documents and the
  examination office remain authoritative") when the student is making a plan
  decision or asking about their own study plan.

Return valid JSON only.`;

const KEY_SELECTOR_SYSTEM = `Domain: CS Master's program under the local Studien- und Pruefungsordnung.

You select exact course-offering lookup buckets from the local course
offerings tree. The lookup key format is: semester/area/course_type.

Course types:
- vl: Vorlesung/lecture bucket
- swp: Softwareprojekt bucket
- seminar: seminar/Wissenschaftliches-Arbeiten bucket

Selection rules:
- If the student gives a semester but no area, output all course-type buckets
  for that semester.
- If semester + area are given but no course type, output all course-type
  buckets for that semester and area.
- If a course name is given, still output bucket keys, not a course-specific
  slug.

Semester coverage: sose26 only. No local data exists for other semesters.

Tree:
sose26
  technical
    seminar -> sose26/technical/seminar (2 course(s))
    vl -> sose26/technical/vl (3 course(s))
  practical
    seminar -> sose26/practical/seminar (6 course(s))
  theoretical
    seminar -> sose26/theoretical/seminar (3 course(s))

Return valid JSON only.`;

const OFFTOPIC_RESPONSE =
  "I'm just set up to help with this CS Master's program — degree rules, LP requirements, course offerings, and study-plan checks. Happy to help with any of those!";

const PARSER_SYSTEM = `Domain: CS Master's program under the local Studien- und Pruefungsordnung.

Extract a structured module list from the student's freeform plan description.
For each module return: title, area (practical | technical | theoretical |
application), lp, graded (bool), specialization (bool, true if the student
marked it as their chosen specialization area), bachelor_module (bool).

Return valid JSON only: {"modules": [...]}`;

export const degreeConsultantTrace: AgentTraceFile = {
  version: "0.1",
  name: "degree_consultant.jsonl",
  meta: {
    source: "langgraph",
    createdAt: "2026-07-01T10:00:00Z",
    description:
      "A degree-consulting bot for a CS Master's program. A scope classifier " +
      "fans each student message out to one of four branches: an off-topic " +
      "fallback, a direct rule answer, a course-offering lookup (a key " +
      "selector plus a deterministic bucket lookup), or a full study-plan " +
      "check (a plan parser plus a deterministic rule checker). The lookup " +
      "and plan-check branches rejoin at a shared answer composer; off-topic " +
      "uses a fixed redirect response and replies on its own. Genericized from " +
      "a real trace — the huge system " +
      "prompt is resent almost verbatim on every LLM call, exactly as logged.",
  },
  graph: {
    nodes: [
      {
        id: "scope_classifier",
        label: "Scope Classifier",
        description:
          "Classifies the student's message into one of four branches: off-topic, a direct degree question, a course-offering lookup, or a full study-plan check.",
      },
      {
        id: "offtopic",
        label: "Off-Topic Reply",
        description:
          "Returns a hardcoded redirect to degree-consulting topics; no LLM call is made.",
      },
      {
        id: "course_key_selector",
        label: "Course Key Selector",
        description:
          "Selects the exact course-offering lookup keys (semester/area/type) implied by the student's question.",
      },
      {
        id: "course_lookup",
        label: "Course Lookup",
        description: "Looks up the selected course-offering buckets and returns the matching courses.",
      },
      {
        id: "study_plan_parser",
        label: "Study Plan Parser",
        description:
          "Extracts a structured module list (area, LP, graded, specialization, bachelor) from the student's freeform plan description.",
      },
      {
        id: "rule_checker",
        label: "Rule Checker",
        description:
          "Deterministically checks the parsed plan against the degree rules (LP totals, specialization, pool caps, module limits).",
      },
      {
        id: "answer_composer",
        label: "Answer Composer",
        description:
          "Composes the final advisory answer from the retrieved course context, parsed plan, and rule-check result.",
      },
    ],
    edges: [
      { source: "scope_classifier", target: "offtopic", conditional: true },
      { source: "scope_classifier", target: "answer_composer", conditional: true },
      { source: "scope_classifier", target: "course_key_selector", conditional: true },
      { source: "scope_classifier", target: "study_plan_parser", conditional: true },
      { source: "course_key_selector", target: "course_lookup" },
      { source: "course_lookup", target: "answer_composer" },
      { source: "study_plan_parser", target: "rule_checker" },
      { source: "rule_checker", target: "answer_composer" },
    ],
  },
  messages: [
    {
      id: "msg-1",
      label: "Off-topic",
      meta: { message_type: "off_topic", outcome: "redirected", latency_ms: 3400 },
      steps: [
        {
          id: "m1-s1",
          nodeId: "scope_classifier",
          timestamp: "2026-07-01T10:00:00.000Z",
          payloads: [
            { label: "user_input", value: "can you write me a poem about summer break instead?" },
            {
              label: "llm_input",
              value: {
                prompt: CLASSIFIER_SYSTEM,
                msg: "Latest user message:\ncan you write me a poem about summer break instead?",
              },
            },
            { label: "llm_output", value: '{\n  "message_type": "off_topic"\n}' },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "offtopic",
          timestamp: "2026-07-01T10:00:03.400Z",
          payloads: [
            {
              label: "node_input",
              value: {
                msg: "User message:\ncan you write me a poem about summer break instead?",
              },
            },
            {
              label: "node_output",
              value: { message: OFFTOPIC_RESPONSE },
            },
          ],
        },
      ],
    },
    {
      id: "msg-2",
      label: "Degree question",
      meta: { message_type: "degree_question", outcome: "answered", latency_ms: 4800 },
      steps: [
        {
          id: "m2-s1",
          nodeId: "scope_classifier",
          timestamp: "2026-07-01T10:05:00.000Z",
          payloads: [
            {
              label: "user_input",
              value: "how many softwareprojekt modules can i count in total, including electives?",
            },
            {
              label: "llm_input",
              value: {
                prompt: CLASSIFIER_SYSTEM,
                msg:
                  "Latest user message:\nhow many softwareprojekt modules can i count in total, including electives?",
              },
            },
            { label: "llm_output", value: '{\n  "message_type": "degree_question"\n}' },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "answer_composer",
          timestamp: "2026-07-01T10:05:04.800Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: COMPOSER_SYSTEM,
                msg:
                  "User message:\nhow many softwareprojekt modules can i count in total, including electives?\n\n" +
                  "Retrieved course-offering context:\n(no retrieved context)\n\n" +
                  "Parsed study plan:\n(no parsed study plan)\n\n" +
                  "Deterministic rule-check result:\n(not a plan check)",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "message": "- At least 1 and at most 2 core Softwareprojekt modules are required.\\n- One more can be placed in the elective pool, allowing up to 3 total as long as the pool stays under 10 LP."\n}',
            },
          ],
        },
      ],
    },
    {
      id: "msg-3",
      label: "Course lookup",
      meta: { message_type: "course_offering_question", outcome: "answered", courses_found: 2, latency_ms: 5200 },
      steps: [
        {
          id: "m3-s1",
          nodeId: "scope_classifier",
          timestamp: "2026-07-01T10:10:00.000Z",
          payloads: [
            { label: "user_input", value: "i need a seminar in the technical specialization next semester" },
            {
              label: "llm_input",
              value: {
                prompt: CLASSIFIER_SYSTEM,
                msg: "Latest user message:\ni need a seminar in the technical specialization next semester",
              },
            },
            { label: "llm_output", value: '{\n  "message_type": "course_offering_question"\n}' },
          ],
        },
        {
          id: "m3-s2",
          nodeId: "course_key_selector",
          timestamp: "2026-07-01T10:10:04.100Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: KEY_SELECTOR_SYSTEM,
                msg: "Latest user message:\ni need a seminar in the technical specialization next semester",
              },
            },
            {
              label: "llm_output",
              value: '{"keys":["sose26/technical/seminar"],"needs_clarification":false}',
            },
          ],
        },
        {
          id: "m3-s3",
          nodeId: "course_lookup",
          timestamp: "2026-07-01T10:10:04.900Z",
          payloads: [
            { label: "node_input", value: { keys: ["sose26/technical/seminar"] } },
            {
              label: "node_output",
              value: {
                retrieved_context:
                  "## sose26/technical/seminar\n" +
                  "Semester: sose26, Area: technical, Type: seminar (ungraded)\n" +
                  "1. Title: Seminar: Networked Embedded Systems Security\n" +
                  "   Schedule: Wed 10:00-12:00, Bldg C Room 214\n" +
                  "2. Title: Seminar: Distributed Systems Topics\n" +
                  "   Schedule: Tue 10:00-12:00, Bldg C Room 108",
                citations: [{ source: "course_offerings.json", section_heading: "sose26/technical/seminar" }],
              },
            },
          ],
        },
        {
          id: "m3-s4",
          nodeId: "answer_composer",
          timestamp: "2026-07-01T10:10:05.200Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: COMPOSER_SYSTEM,
                msg:
                  "User message:\ni need a seminar in the technical specialization next semester\n\n" +
                  "Retrieved course-offering context:\n## sose26/technical/seminar\n" +
                  "1. Seminar: Networked Embedded Systems Security\n2. Seminar: Distributed Systems Topics\n\n" +
                  "Parsed study plan:\n(no parsed study plan)\n\n" +
                  "Deterministic rule-check result:\n(not a plan check)",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "message": "- Seminar: Networked Embedded Systems Security\\n- Seminar: Distributed Systems Topics\\nBoth are technical-specialization seminars offered next semester."\n}',
            },
          ],
        },
      ],
    },
    {
      id: "msg-4",
      label: "Plan check",
      meta: { message_type: "plan_check", outcome: "issues found", rule_violations: 1, latency_ms: 6400 },
      steps: [
        {
          id: "m4-s1",
          nodeId: "scope_classifier",
          timestamp: "2026-07-01T10:15:00.000Z",
          payloads: [
            {
              label: "user_input",
              value:
                "can you check my plan? specialization is theoretical. i have: Algorithms & Complexity Seminar " +
                "(theoretical, academic-writing, 5 LP), Cryptography Theory (theoretical, 10 LP), Distributed " +
                "Systems Project A (technical Softwareprojekt, graded, 10 LP), Distributed Systems Project B " +
                "(technical Softwareprojekt, ungraded, elective pool, 10 LP), Legacy Bachelor Networks " +
                "(application, bachelor module, 8 LP)",
            },
            {
              label: "llm_input",
              value: {
                prompt: CLASSIFIER_SYSTEM,
                msg: "Latest user message:\ncan you check my plan? ...",
              },
            },
            { label: "llm_output", value: '{\n  "message_type": "plan_check"\n}' },
          ],
        },
        {
          id: "m4-s2",
          nodeId: "study_plan_parser",
          timestamp: "2026-07-01T10:15:05.600Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: PARSER_SYSTEM,
                msg:
                  "Student plan:\nspecialization is theoretical. i have: Algorithms & Complexity Seminar " +
                  "(theoretical, academic-writing, 5 LP), Cryptography Theory (theoretical, 10 LP), Distributed " +
                  "Systems Project A (technical Softwareprojekt, graded, 10 LP), Distributed Systems Project B " +
                  "(technical Softwareprojekt, ungraded, elective pool, 10 LP), Legacy Bachelor Networks " +
                  "(application, bachelor module, 8 LP)",
              },
            },
            {
              label: "llm_output",
              value:
                '{"modules":[' +
                '{"title":"Algorithms & Complexity Seminar","area":"theoretical","lp":5,"graded":false,"specialization":true,"bachelor_module":false},' +
                '{"title":"Cryptography Theory","area":"theoretical","lp":10,"graded":true,"specialization":true,"bachelor_module":false},' +
                '{"title":"Distributed Systems Project A","area":"technical","lp":10,"graded":true,"specialization":false,"bachelor_module":false},' +
                '{"title":"Distributed Systems Project B","area":"technical","lp":10,"graded":false,"specialization":false,"bachelor_module":false},' +
                '{"title":"Legacy Bachelor Networks","area":"application","lp":8,"graded":true,"specialization":false,"bachelor_module":true}' +
                "]}",
            },
          ],
        },
        {
          id: "m4-s3",
          nodeId: "rule_checker",
          timestamp: "2026-07-01T10:15:05.900Z",
          payloads: [
            {
              label: "node_input",
              value: { modules: 5, elective_pool_lp: 10, wahlbereich_modules: ["Distributed Systems Project B"] },
            },
            {
              label: "node_output",
              value: {
                total_lp: 43,
                elective_pool_lp: 10,
                elective_pool_cap_ok: true,
                elective_pool_note:
                  "Distributed Systems Project B fills the entire 10 LP elective-pool cap by itself, so no academic-writing overflow module can be added there.",
                softwareprojekt_count: 2,
                softwareprojekt_ok: true,
                bachelor_module_lp: 8,
                bachelor_module_cap_ok: true,
                specialization_area: "theoretical",
                specialization_lp: 15,
                specialization_threshold_lp: 30,
                specialization_ok: false,
                specialization_issue: "Theoretical CS is the specialization area but only totals 15 LP; at least 30 LP are required.",
              },
            },
          ],
        },
        {
          id: "m4-s4",
          nodeId: "answer_composer",
          timestamp: "2026-07-01T10:15:06.400Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: COMPOSER_SYSTEM,
                msg:
                  "User message:\ncan you check my plan? ...\n\n" +
                  "Retrieved course-offering context:\n(no retrieved context)\n\n" +
                  "Parsed study plan:\n[5 modules, see parser output]\n\n" +
                  "Deterministic rule-check result:\n" +
                  '{"specialization_ok":false,"specialization_issue":"Theoretical CS is the specialization area but only totals 15 LP; at least 30 LP are required.",' +
                  '"elective_pool_note":"Distributed Systems Project B fills the entire 10 LP elective-pool cap by itself, so no academic-writing overflow module can be added there.",' +
                  '"softwareprojekt_ok":true,"bachelor_module_cap_ok":true}',
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "message": "- Softwareprojekt count (2) and Bachelor-module LP (8) are both within limits.\\n- Distributed Systems Project B already fills the 10 LP elective pool, so there\'s no room left there for an overflow academic-writing module.\\n- Your specialization is theoretical CS, but it only totals 15 LP — you need at least 30 LP there, so add more theoretical modules or reconsider the specialization.\\n\\n(advisory; official documents and the examination office remain authoritative)"\n}',
            },
          ],
        },
      ],
    },
  ],
};
