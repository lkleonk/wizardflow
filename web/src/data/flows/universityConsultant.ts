import type { AgentTraceFile } from "@/types/agenttrace";

// University advisor with a wider router, a nested branch, and a clarify loop.
// An intent classifier routes each student question to one of three branches —
// navigation (campus_guide), advising (advising_desk), or courses
// (course_catalog). The courses branch then runs an eligibility_check that
// itself forks: an eligible student goes to the responder, while a student
// missing prerequisites is handed to advisor_escalation (a human-handoff exit
// that skips the responder). When the classifier is unsure it routes to
// clarifier, which asks a follow-up and loops back to re-classify. classifier,
// clarifier, campus_guide, advising_desk, and responder are LLM nodes;
// course_catalog and eligibility_check are tool lookups.
export const universityConsultantTrace: AgentTraceFile = {
  version: "0.1",
  name: "university_consultant.json",
  meta: {
    source: "langgraph",
    createdAt: "2026-06-06T09:00:00Z",
    description:
      "A university advising assistant. An intent classifier routes each " +
      "student question to a campus-navigation, advising, or course branch. " +
      "The course branch checks prerequisites and escalates to a human advisor " +
      "when they aren't met; an unclear question loops through a clarifier and " +
      "back to the classifier. Four runs exercise the fan-out, the nested " +
      "eligibility branch, the escalation exit, and the clarify loop.",
  },
  graph: {
    nodes: [
      { id: "user_input", label: "Student" },
      { id: "classifier", label: "Intent Classifier" },
      { id: "clarifier", label: "Clarify" },
      { id: "campus_guide", label: "Campus Guide" },
      { id: "advising_desk", label: "Advising Desk" },
      { id: "course_catalog", label: "Course Catalog" },
      { id: "eligibility_check", label: "Eligibility Check" },
      { id: "advisor_escalation", label: "Advisor Escalation" },
      { id: "responder", label: "Responder" },
      { id: "final_response", label: "Final Response" },
    ],
    edges: [
      { source: "user_input", target: "classifier" },
      // Wide fan-out on the classified intent (plus a low-confidence clarify path).
      { source: "classifier", target: "clarifier", conditional: true },
      { source: "classifier", target: "campus_guide", conditional: true },
      { source: "classifier", target: "advising_desk", conditional: true },
      { source: "classifier", target: "course_catalog", conditional: true },
      // Clarify loop: ask a follow-up, then re-classify.
      { source: "clarifier", target: "classifier" },
      { source: "campus_guide", target: "responder" },
      { source: "advising_desk", target: "responder" },
      // Nested branch inside the course path: eligible students answer normally,
      // students missing prerequisites are escalated to a human advisor.
      { source: "course_catalog", target: "eligibility_check" },
      { source: "eligibility_check", target: "responder", conditional: true },
      { source: "eligibility_check", target: "advisor_escalation", conditional: true },
      // Escalation is a second exit that skips the responder.
      { source: "advisor_escalation", target: "final_response" },
      { source: "responder", target: "final_response" },
    ],
  },
  messages: [
    {
      id: "msg-1",
      // Navigation branch: classifier -> campus_guide -> responder.
      steps: [
        {
          id: "m1-s1",
          nodeId: "user_input",
          timestamp: "2026-06-06T09:00:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "How do I get from the main library to the CS building?",
            },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "classifier",
          timestamp: "2026-06-06T09:00:00.300Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "Classify the student's question. Respond as JSON with an intent\n" +
                'of "navigation", "advising", or "courses", and a confidence.\n\n' +
                "User:\n" +
                "How do I get from the main library to the CS building?",
            },
            {
              label: "llm_output",
              value: '{"intent": "navigation", "confidence": 0.95}',
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "campus_guide",
          timestamp: "2026-06-06T09:00:01.620Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are the campus navigation guide. Give clear walking\n" +
                "directions using the campus map facts.\n\n" +
                "Map facts:\n" +
                "  - Main Library is on University Square (central).\n" +
                "  - CS Building (Bld. 7) is north-east, ~6 min walk.\n" +
                "  - Path: exit library north, cross the quad, CS is past the café.\n\n" +
                "User:\n" +
                "How do I get from the main library to the CS building?",
            },
            {
              label: "llm_output",
              value:
                "Exit the Main Library through the north doors onto the quad, walk " +
                "straight across it (past the café on your right), and the CS " +
                "Building (Building 7) is the glass entrance just beyond. About a " +
                "6-minute walk.",
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "responder",
          timestamp: "2026-06-06T09:00:02.480Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Format the branch result as a friendly final reply.\n\n" +
                "Branch output:\n" +
                "<walking directions from library to CS building>",
            },
            {
              label: "llm_output",
              value:
                "From the Main Library, head out the north doors, cross the quad " +
                "past the café, and you'll reach the CS Building (Building 7) — " +
                "about a 6-minute walk. 🚶",
            },
          ],
        },
        {
          id: "m1-s5",
          nodeId: "final_response",
          timestamp: "2026-06-06T09:00:02.840Z",
          payloads: [
            {
              label: "Output",
              value:
                "From the Main Library, head out the north doors, cross the quad " +
                "past the café, and you'll reach the CS Building (Building 7) — " +
                "about a 6-minute walk. 🚶",
            },
          ],
        },
      ],
    },
    {
      id: "msg-2",
      // Course branch, eligible: course_catalog -> eligibility_check -> responder.
      steps: [
        {
          id: "m2-s1",
          nodeId: "user_input",
          timestamp: "2026-06-06T09:04:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "Can I register for Algorithms II next term?",
            },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "classifier",
          timestamp: "2026-06-06T09:04:00.280Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "Classify the student's question. Respond as JSON with an intent\n" +
                'of "navigation", "advising", or "courses", and a confidence.\n\n' +
                "User:\n" +
                "Can I register for Algorithms II next term?",
            },
            {
              label: "llm_output",
              value: '{"intent": "courses", "confidence": 0.96}',
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "course_catalog",
          timestamp: "2026-06-06T09:04:00.910Z",
          payloads: [
            // Tool lookup (non-LLM) — a catalog query and the record returned.
            { label: "query", value: { course: "Algorithms II", term: "Fall 2026" } },
            {
              label: "record",
              value: {
                code: "CS-302",
                title: "Algorithms II",
                credits: 6,
                prerequisites: ["CS-201 Algorithms I", "CS-110 Discrete Math"],
                schedule: "Tue/Thu 10:15–11:45, Bld. 7 Room 204",
              },
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "eligibility_check",
          timestamp: "2026-06-06T09:04:01.340Z",
          payloads: [
            // Tool lookup: compare the student's transcript against the prereqs.
            {
              label: "student_record",
              value: {
                id: "stu-4471",
                completed: ["CS-201 Algorithms I", "CS-110 Discrete Math", "MA-140 Calculus"],
              },
            },
            {
              label: "decision",
              value: { eligible: true, missing: [] },
            },
          ],
        },
        {
          id: "m2-s5",
          nodeId: "responder",
          timestamp: "2026-06-06T09:04:02.560Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Format the branch result as a friendly final reply.\n\n" +
                "Branch output:\n" +
                "CS-302 Algorithms II — eligible (both prereqs met); 6 credits;\n" +
                "Tue/Thu 10:15, Bld. 7 Room 204.",
            },
            {
              label: "llm_output",
              value:
                "You're all set to register for Algorithms II (CS-302) — you've " +
                "completed both prerequisites (CS-201 and CS-110). It's 6 credits, " +
                "Tuesdays and Thursdays 10:15–11:45 in Building 7, Room 204.",
            },
          ],
        },
        {
          id: "m2-s6",
          nodeId: "final_response",
          timestamp: "2026-06-06T09:04:02.930Z",
          payloads: [
            {
              label: "Output",
              value:
                "You're all set to register for Algorithms II (CS-302) — you've " +
                "completed both prerequisites (CS-201 and CS-110). It's 6 credits, " +
                "Tuesdays and Thursdays 10:15–11:45 in Building 7, Room 204.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-3",
      // Course branch, NOT eligible: eligibility_check -> advisor_escalation ->
      // final_response (the escalation exit skips the responder).
      steps: [
        {
          id: "m3-s1",
          nodeId: "user_input",
          timestamp: "2026-06-06T09:09:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "I'd like to enroll in Algorithms II.",
            },
          ],
        },
        {
          id: "m3-s2",
          nodeId: "classifier",
          timestamp: "2026-06-06T09:09:00.290Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "Classify the student's question. Respond as JSON with an intent\n" +
                'of "navigation", "advising", or "courses", and a confidence.\n\n' +
                "User:\n" +
                "I'd like to enroll in Algorithms II.",
            },
            {
              label: "llm_output",
              value: '{"intent": "courses", "confidence": 0.94}',
            },
          ],
        },
        {
          id: "m3-s3",
          nodeId: "course_catalog",
          timestamp: "2026-06-06T09:09:00.880Z",
          payloads: [
            { label: "query", value: { course: "Algorithms II", term: "Fall 2026" } },
            {
              label: "record",
              value: {
                code: "CS-302",
                title: "Algorithms II",
                credits: 6,
                prerequisites: ["CS-201 Algorithms I", "CS-110 Discrete Math"],
                schedule: "Tue/Thu 10:15–11:45, Bld. 7 Room 204",
              },
            },
          ],
        },
        {
          id: "m3-s4",
          nodeId: "eligibility_check",
          timestamp: "2026-06-06T09:09:01.300Z",
          payloads: [
            {
              label: "student_record",
              value: {
                id: "stu-5288",
                completed: ["CS-110 Discrete Math", "MA-140 Calculus"],
              },
            },
            {
              label: "decision",
              value: { eligible: false, missing: ["CS-201 Algorithms I"] },
            },
          ],
        },
        {
          id: "m3-s5",
          nodeId: "advisor_escalation",
          timestamp: "2026-06-06T09:09:01.720Z",
          payloads: [
            // Human handoff: open an advising request rather than answer directly.
            {
              label: "ticket",
              value: {
                queue: "academic-advising",
                student: "stu-5288",
                course: "CS-302",
                reason: "prerequisite CS-201 Algorithms I not completed",
              },
            },
            {
              label: "message",
              value:
                "Enrollment in Algorithms II needs Algorithms I (CS-201) first, " +
                "which isn't on your record yet. I've referred you to academic " +
                "advising — they can discuss an override or the right path.",
            },
          ],
        },
        {
          id: "m3-s6",
          nodeId: "final_response",
          timestamp: "2026-06-06T09:09:02.060Z",
          payloads: [
            {
              label: "Output",
              value:
                "Enrollment in Algorithms II needs Algorithms I (CS-201) first, " +
                "which isn't on your record yet. I've referred you to academic " +
                "advising (ticket opened) — they can discuss an override or the " +
                "right path to get there.",
            },
          ],
        },
      ],
    },
    {
      id: "msg-4",
      // Low confidence: classifier -> clarifier -> classifier (loop) -> advising.
      steps: [
        {
          id: "m4-s1",
          nodeId: "user_input",
          timestamp: "2026-06-06T09:14:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "I need help with my schedule.",
            },
          ],
        },
        {
          id: "m4-s2",
          nodeId: "classifier",
          timestamp: "2026-06-06T09:14:00.300Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "Classify the student's question. Respond as JSON with an intent\n" +
                'of "navigation", "advising", or "courses", and a confidence.\n\n' +
                "User:\n" +
                "I need help with my schedule.",
            },
            {
              label: "llm_output",
              value: '{"intent": "advising", "confidence": 0.41}',
            },
          ],
        },
        {
          id: "m4-s3",
          nodeId: "clarifier",
          timestamp: "2026-06-06T09:14:01.180Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "The intent is unclear (confidence 0.41). Ask one short follow-up\n" +
                "to disambiguate between navigation, courses, and advising.\n\n" +
                "User:\n" +
                "I need help with my schedule.",
            },
            {
              label: "llm_output",
              value:
                "Happy to help! Do you mean finding a room on campus, a specific " +
                "course, or registering/advising for your timetable?",
            },
            {
              label: "student_reply",
              value: "Registering — I want to sort out my timetable for next term.",
            },
          ],
        },
        {
          id: "m4-s4",
          nodeId: "classifier",
          timestamp: "2026-06-06T09:14:08.640Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "Classify the student's question. Respond as JSON with an intent\n" +
                'of "navigation", "advising", or "courses", and a confidence.\n\n' +
                "User:\n" +
                "I need help with my schedule.\n" +
                "Clarification: Registering — sort out my timetable for next term.",
            },
            {
              label: "llm_output",
              value: '{"intent": "advising", "confidence": 0.93}',
            },
          ],
        },
        {
          id: "m4-s5",
          nodeId: "advising_desk",
          timestamp: "2026-06-06T09:14:09.910Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System:\n" +
                "You are the registration & advising desk. Answer using the\n" +
                "advising facts.\n\n" +
                "Advising facts:\n" +
                "  - Fall 2026 registration opens Mon 14 Jul, 09:00.\n" +
                "  - Your enrollment window: 14–25 Jul; holds must be cleared first.\n" +
                "  - Drop/add runs through the first two weeks of term.\n\n" +
                "User:\n" +
                "Registering — sort out my timetable for next term.",
            },
            {
              label: "llm_output",
              value:
                "Fall 2026 registration opens Monday 14 July at 09:00, and your " +
                "enrollment window runs 14–25 July. Clear any account holds before " +
                "then, and remember you can still drop/add during the first two " +
                "weeks of term.",
            },
          ],
        },
        {
          id: "m4-s6",
          nodeId: "responder",
          timestamp: "2026-06-06T09:14:10.870Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Format the branch result as a friendly final reply.\n\n" +
                "Branch output:\n" +
                "Registration opens 14 Jul 09:00; window 14–25 Jul; clear holds;\n" +
                "drop/add first two weeks.",
            },
            {
              label: "llm_output",
              value:
                "To sort your timetable: registration opens Monday 14 July at 9 am " +
                "and your window is 14–25 July. Clear any holds on your account " +
                "first, and you can still adjust things during drop/add in the " +
                "first two weeks of term. 📅",
            },
          ],
        },
        {
          id: "m4-s7",
          nodeId: "final_response",
          timestamp: "2026-06-06T09:14:11.250Z",
          payloads: [
            {
              label: "Output",
              value:
                "To sort your timetable: registration opens Monday 14 July at 9 am " +
                "and your window is 14–25 July. Clear any holds on your account " +
                "first, and you can still adjust things during drop/add in the " +
                "first two weeks of term. 📅",
            },
          ],
        },
      ],
    },
  ],
};
