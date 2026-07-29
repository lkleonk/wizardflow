import type { AgentTraceFile } from "@/types/agenttrace";

const ANAMNESIS_PROMPT = `You are the interview step of a simulated primary-care consultation.
You get the patient's message, their record, and any pending lab orders.
Decide exactly one action:
- "ask_followups": the picture is incomplete — list the questions to ask
- "diagnose": enough is known — hand off to differential diagnosis
- "fetch_lab_results": a pending lab order has results ready
Return valid JSON only.`;

const DIFFERENTIAL_PROMPT = `You are the diagnostic step of a simulated primary-care consultation.
Rank the plausible causes of the patient's complaints, each with a confidence
score between 0 and 1. If no cause reaches 0.6, mark the case inconclusive
and name the lab tests that would settle it.
Return valid JSON only.`;

const TREATMENT_PROMPT = `You are the treatment step of a simulated primary-care consultation.
Propose a concrete plan for the confirmed diagnosis: one prescription (if
needed) plus supportive measures. If the safety check returned a conflict,
propose an alternative that avoids it.
Return valid JSON only.`;

const REPLY_PROMPT = `You write the doctor's chat reply for a simulated consultation.
Be warm, concrete, and brief. Explain decisions in plain language and say
when the patient should come back. Always end with the line:
"(Demo consultation — not real medical advice.)"
Return valid JSON only.`;

// The flagship example: a chatbot that runs a full doctor's visit itself —
// interview, diagnosis, prescription — instead of routing to specialists.
// Three fictional patients across five messages exercise every branch: Anna's
// sinus infection triggers the allergy safety-gate revision loop, Ben's back
// strain trips the same gate on a blood-thinner drug interaction, and Jonas's
// unclear fatigue orders a blood test whose results arrive a day later
// (a real overnight gap between the two message timestamps).
export const doctorConsultationTrace: AgentTraceFile = {
  version: "0.1",
  name: "doctor_consultation.jsonl",
  meta: {
    source: "custom",
    createdAt: "2026-07-02T09:00:00Z",
    description:
      "A simulated AI doctor that runs the whole consultation: it looks up " +
      "the patient's file, asks follow-up questions, weighs possible causes, " +
      "and prescribes treatment behind a deterministic safety check. Three " +
      "fictional patients: Anna's sinus infection is caught by the interview, " +
      "and her first prescription is rejected by the allergy check and " +
      "revised; Ben's back strain has its ibuprofen swapped out when the " +
      "safety check flags a blood-thinner interaction; Jonas's unexplained " +
      "tiredness is inconclusive, so the bot orders a blood test and finishes " +
      "the diagnosis the next day when the results are in. Entirely fictional " +
      "— not medical advice.",
  },
  graph: {
    nodes: [
      { id: "patient_message", label: "Patient Message" },
      {
        id: "interview",
        label: "Interview",
        description:
          "The anamnesis step: checks what is already known and asks follow-up " +
          "questions until the picture is complete enough to diagnose.",
      },
      {
        id: "differential",
        label: "Differential Diagnosis",
        color: "#A78BFA",
        description:
          "Weighs the plausible causes and scores how confident it is in each. " +
          "Below the confidence bar, it asks for lab tests instead of guessing.",
      },
      {
        id: "order_lab_test",
        label: "Order Lab Test",
        color: "#22D3EE",
        description:
          "Files a blood-test order with the clinic lab; results arrive on a later visit.",
      },
      {
        id: "fetch_lab_results",
        label: "Fetch Lab Results",
        color: "#22D3EE",
        description: "Pulls finished lab values from the clinic system.",
      },
      {
        id: "diagnosis",
        label: "Diagnosis",
        description:
          "Commits to the top-ranked cause once it clears the confidence threshold.",
      },
      {
        id: "treatment_plan",
        label: "Treatment Plan",
        description:
          "Drafts the prescription and self-care steps; revises them when the safety check objects.",
      },
      {
        id: "safety_check",
        label: "Safety Check",
        color: "#FBBF24",
        description:
          "Deterministic gate: checks the plan against the patient's allergies and " +
          "current medication, and returns it for revision on a conflict.",
      },
      {
        id: "doctor_reply",
        label: "Doctor's Reply",
        description: "Writes the chat reply to the patient.",
      },
    ],
    edges: [
      { source: "patient_message", target: "interview" },
      // The interview's three-way choice each turn.
      { source: "interview", target: "doctor_reply", conditional: true },
      { source: "interview", target: "differential", conditional: true },
      { source: "interview", target: "fetch_lab_results", conditional: true },
      { source: "fetch_lab_results", target: "differential" },
      { source: "differential", target: "diagnosis", conditional: true },
      { source: "differential", target: "order_lab_test", conditional: true },
      { source: "order_lab_test", target: "doctor_reply" },
      { source: "diagnosis", target: "treatment_plan" },
      { source: "treatment_plan", target: "safety_check" },
      // The revision loop: a plan with an allergy conflict goes back.
      { source: "safety_check", target: "treatment_plan", conditional: true },
      { source: "safety_check", target: "doctor_reply", conditional: true },
    ],
  },
  messages: [
    {
      id: "msg-1",
      label: "Anna — first visit",
      meta: { patient: "Anna M.", outcome: "follow-up questions" },
      steps: [
        {
          id: "m1-s1",
          nodeId: "patient_message",
          timestamp: "2026-07-02T09:00:00.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "Hi, I've had a pounding headache and a completely blocked nose " +
                "for about ten days now. Since yesterday I'm also running a fever.",
            },
            {
              label: "patient_record",
              value: {
                name: "Anna M.",
                age: 34,
                allergies: ["penicillin"],
                medications: ["cetirizine (hay fever, daily)"],
                last_visit: "2025-11-14",
              },
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "interview",
          timestamp: "2026-07-02T09:00:00.400Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: ANAMNESIS_PROMPT,
                msg:
                  "Patient message:\nHi, I've had a pounding headache and a completely " +
                  "blocked nose for about ten days now. Since yesterday I'm also " +
                  "running a fever.\n\n" +
                  "Patient record: Anna M., 34. Allergies: penicillin. " +
                  "Medications: cetirizine.\n\nPending lab orders: none",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "action": "ask_followups",\n  "missing": ["fever height", "course over time"],\n' +
                '  "questions": [\n    "How high is the fever?",\n' +
                '    "Did it briefly get better before getting worse again?"\n  ]\n}',
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "doctor_reply",
          timestamp: "2026-07-02T09:00:03.900Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: REPLY_PROMPT,
                msg:
                  "Interview outcome: ask_followups\n" +
                  "Questions: fever height; better-then-worse course",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "message": "That sounds unpleasant — ten days is quite a while. ' +
                "Two quick questions so I can narrow it down: How high is the fever? " +
                "And did it briefly get better before getting worse again?\\n\\n" +
                '(Demo consultation — not real medical advice.)"\n}',
            },
          ],
        },
      ],
    },
    {
      id: "msg-2",
      label: "Anna — diagnosis & prescription",
      meta: {
        patient: "Anna M.",
        outcome: "sinusitis — prescription revised after allergy conflict",
      },
      steps: [
        {
          id: "m2-s1",
          nodeId: "patient_message",
          timestamp: "2026-07-02T09:06:10.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "Fever is 38.4 °C. It actually felt better last week and " +
                "then came back worse.",
            },
            {
              label: "patient_record",
              value: {
                name: "Anna M.",
                age: 34,
                allergies: ["penicillin"],
                medications: ["cetirizine (hay fever, daily)"],
                last_visit: "2025-11-14",
              },
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "interview",
          timestamp: "2026-07-02T09:06:10.380Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: ANAMNESIS_PROMPT,
                msg:
                  "Patient message:\nFever is 38.4 °C. It actually felt better last " +
                  "week and then came back worse.\n\n" +
                  "Known from this conversation: 10+ days blocked nose, headache, " +
                  "fever since yesterday.\n\n" +
                  "Patient record: Anna M., 34. Allergies: penicillin. " +
                  "Medications: cetirizine.\n\nPending lab orders: none",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "action": "diagnose",\n  "summary": "10+ days of nasal congestion and headache, ' +
                "fever 38.4 °C, and a better-then-worse course — " +
                'the picture is complete enough to assess."\n}',
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "differential",
          timestamp: "2026-07-02T09:06:14.100Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: DIFFERENTIAL_PROMPT,
                msg:
                  "Case summary: 34-year-old, 10+ days of nasal congestion and " +
                  "headache, fever 38.4 °C, symptoms improved then worsened again " +
                  "('double worsening').",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "candidates": [\n' +
                '    { "condition": "acute bacterial sinusitis", "confidence": 0.78,\n' +
                '      "for": "symptoms past 10 days, fever, and a better-then-worse (double-worsening) course" },\n' +
                '    { "condition": "viral upper respiratory infection", "confidence": 0.15,\n' +
                '      "against": "would usually resolve within 10 days, no second worsening" },\n' +
                '    { "condition": "migraine", "confidence": 0.04,\n' +
                '      "against": "does not explain the fever or the 10-day course" }\n' +
                '  ],\n  "confident": true\n}',
            },
          ],
        },
        {
          id: "m2-s5",
          nodeId: "diagnosis",
          timestamp: "2026-07-02T09:06:14.300Z",
          payloads: [
            {
              label: "node_input",
              value: {
                top_candidate: "acute bacterial sinusitis",
                confidence: 0.78,
                threshold: 0.6,
              },
            },
            {
              label: "node_output",
              value: {
                diagnosis: "acute bacterial sinusitis",
                confidence: 0.78,
                basis:
                  "Symptom duration past 10 days, fever, and a better-then-worse (double-worsening) course.",
              },
            },
          ],
        },
        {
          id: "m2-s6",
          nodeId: "treatment_plan",
          timestamp: "2026-07-02T09:06:17.800Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: TREATMENT_PROMPT,
                msg: "Diagnosis: acute bacterial sinusitis (confidence 0.78).\nSafety-check conflict: none",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "prescription": "amoxicillin 500 mg, 3x daily, 7 days",\n' +
                '  "supportive": ["saline nasal rinse", "ibuprofen for pain and fever", "rest and fluids"]\n}',
            },
          ],
        },
        {
          id: "m2-s7",
          nodeId: "safety_check",
          timestamp: "2026-07-02T09:06:18.000Z",
          payloads: [
            {
              label: "node_input",
              value: {
                prescription: "amoxicillin 500 mg, 3x daily, 7 days",
                allergies: ["penicillin"],
                medications: ["cetirizine (hay fever, daily)"],
              },
            },
            {
              label: "node_output",
              value: {
                ok: false,
                conflict:
                  "amoxicillin is a penicillin-class antibiotic; the patient record lists a penicillin allergy",
                action: "revise",
              },
            },
          ],
        },
        {
          id: "m2-s8",
          nodeId: "treatment_plan",
          timestamp: "2026-07-02T09:06:21.500Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: TREATMENT_PROMPT,
                msg:
                  "Diagnosis: acute bacterial sinusitis (confidence 0.78).\n" +
                  "Safety-check conflict: amoxicillin is penicillin-class; " +
                  "patient is allergic to penicillin. Propose an alternative.",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "prescription": "doxycycline 100 mg, 2x daily, 7 days",\n' +
                '  "note": "penicillin-free alternative",\n' +
                '  "supportive": ["saline nasal rinse", "ibuprofen for pain and fever", "rest and fluids"]\n}',
            },
          ],
        },
        {
          id: "m2-s9",
          nodeId: "safety_check",
          timestamp: "2026-07-02T09:06:21.700Z",
          payloads: [
            {
              label: "node_input",
              value: {
                prescription: "doxycycline 100 mg, 2x daily, 7 days",
                allergies: ["penicillin"],
                medications: ["cetirizine (hay fever, daily)"],
              },
            },
            {
              label: "node_output",
              value: {
                ok: true,
                checked_against: ["penicillin allergy", "cetirizine"],
                note: "No conflict: doxycycline is not penicillin-class and does not interact with cetirizine.",
              },
            },
          ],
        },
        {
          id: "m2-s10",
          nodeId: "doctor_reply",
          timestamp: "2026-07-02T09:06:25.400Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: REPLY_PROMPT,
                msg:
                  "Diagnosis: acute bacterial sinusitis.\n" +
                  "Plan: doxycycline 100 mg 2x daily for 7 days (revised — patient " +
                  "is allergic to penicillin, so no amoxicillin), saline rinse, " +
                  "ibuprofen, rest.\nSafety check: passed.",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "message": "Everything points to a bacterial sinus infection — the long ' +
                "duration, the fever, and the way it got better and " +
                "then worse again. Normally the first choice would be amoxicillin, but your " +
                "file says you're allergic to penicillin, so I'm prescribing doxycycline " +
                "(100 mg, twice a day, 7 days) instead. Also: saline rinses, ibuprofen for " +
                "the pain, and take it easy. If the fever passes 39.5 °C or you notice " +
                "swelling around the eyes, please see a doctor in person right away.\\n\\n" +
                '(Demo consultation — not real medical advice.)"\n}',
            },
          ],
        },
      ],
    },
    {
      id: "msg-3",
      label: "Jonas — unclear case",
      meta: { patient: "Jonas K.", outcome: "blood test ordered" },
      steps: [
        {
          id: "m3-s1",
          nodeId: "patient_message",
          timestamp: "2026-07-02T11:30:00.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "I'm honestly just exhausted all the time — for about two months " +
                "now. I sleep eight hours and could still nap all day. No pain, " +
                "no fever, nothing else really.",
            },
            {
              label: "patient_record",
              value: {
                name: "Jonas K.",
                age: 27,
                allergies: [],
                medications: [],
                last_visit: "2024-03-02",
              },
            },
          ],
        },
        {
          id: "m3-s3",
          nodeId: "interview",
          timestamp: "2026-07-02T11:30:00.350Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: ANAMNESIS_PROMPT,
                msg:
                  "Patient message:\nI'm honestly just exhausted all the time — for " +
                  "about two months now. I sleep eight hours and could still nap all " +
                  "day. No pain, no fever, nothing else really.\n\n" +
                  "Patient record: Jonas K., 27. Allergies: none. Medications: none.\n\n" +
                  "Pending lab orders: none",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "action": "diagnose",\n  "summary": "Two months of persistent fatigue ' +
                "despite adequate sleep, no pain, no fever, no other complaints — no red flags, " +
                'but also nothing that points anywhere specific yet."\n}',
            },
          ],
        },
        {
          id: "m3-s4",
          nodeId: "differential",
          timestamp: "2026-07-02T11:30:04.200Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: DIFFERENTIAL_PROMPT,
                msg:
                  "Case summary: 27-year-old, two months of constant fatigue despite " +
                  "8 hours of sleep, no pain, no fever, no weight change mentioned, " +
                  "no medication.",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "candidates": [\n' +
                '    { "condition": "iron deficiency", "confidence": 0.30 },\n' +
                '    { "condition": "hypothyroidism", "confidence": 0.25 },\n' +
                '    { "condition": "sleep apnea", "confidence": 0.15 },\n' +
                '    { "condition": "depression", "confidence": 0.15 }\n' +
                '  ],\n  "confident": false,\n' +
                '  "suggested_tests": ["complete blood count", "ferritin", "TSH"]\n}',
            },
          ],
        },
        {
          id: "m3-s5",
          nodeId: "order_lab_test",
          timestamp: "2026-07-02T11:30:04.450Z",
          payloads: [
            {
              label: "node_input",
              value: {
                patient_id: "pat-0892",
                tests: ["complete blood count", "ferritin", "TSH"],
              },
            },
            {
              label: "node_output",
              value: {
                order_id: "LAB-2607-0292",
                status: "ordered",
                lab_hours: "Mon-Fri 7:00-13:00",
                results_expected: "next business day",
              },
            },
          ],
        },
        {
          id: "m3-s6",
          nodeId: "doctor_reply",
          timestamp: "2026-07-02T11:30:08.100Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: REPLY_PROMPT,
                msg:
                  "Interview outcome: case inconclusive, no red flags.\n" +
                  "Lab order LAB-2607-0292 filed: complete blood count, ferritin, TSH. " +
                  "Lab open Mon-Fri 7:00-13:00, results expected next business day.",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "message": "Two months of feeling drained is worth looking into, but ' +
                "nothing you describe sounds alarming. The usual suspects — low iron, a slow " +
                "thyroid, poor sleep quality — all look the same from the outside, so let's " +
                "get data: I've ordered a blood test (blood count, iron stores, thyroid). " +
                "Just stop by the lab any weekday morning before 13:00, no appointment " +
                "needed. The results should be in by the next day — message me then.\\n\\n" +
                '(Demo consultation — not real medical advice.)"\n}',
            },
          ],
        },
      ],
    },
    {
      id: "msg-4",
      label: "Jonas — lab results",
      meta: {
        patient: "Jonas K.",
        outcome: "iron deficiency — supplement prescribed",
      },
      steps: [
        {
          id: "m4-s1",
          nodeId: "patient_message",
          timestamp: "2026-07-03T09:15:00.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "Good morning! I had my blood drawn yesterday right after we " +
                "talked — are the results in?",
            },
            {
              label: "patient_record",
              value: {
                name: "Jonas K.",
                age: 27,
                allergies: [],
                medications: [],
                last_visit: "2026-07-02",
              },
            },
          ],
        },
        {
          id: "m4-s3",
          nodeId: "interview",
          timestamp: "2026-07-03T09:15:00.350Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: ANAMNESIS_PROMPT,
                msg:
                  "Patient message:\nGood morning! I had my blood drawn yesterday " +
                  "right after we talked — are the results in?\n\n" +
                  "Patient record: Jonas K., 27. Allergies: none. Medications: none.\n\n" +
                  "Pending lab orders: LAB-2607-0292 (complete blood count, ferritin, TSH)",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "action": "fetch_lab_results",\n  "pending_order": "LAB-2607-0292"\n}',
            },
          ],
        },
        {
          id: "m4-s4",
          nodeId: "fetch_lab_results",
          timestamp: "2026-07-03T09:15:00.600Z",
          payloads: [
            { label: "node_input", value: { order_id: "LAB-2607-0292" } },
            {
              label: "node_output",
              value: {
                status: "final",
                results: {
                  hemoglobin: "12.9 g/dL (low-normal)",
                  ferritin: "9 ng/mL (low — reference 30-300)",
                  TSH: "1.8 mU/L (normal)",
                },
              },
            },
          ],
        },
        {
          id: "m4-s5",
          nodeId: "differential",
          timestamp: "2026-07-03T09:15:04.300Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: DIFFERENTIAL_PROMPT,
                msg:
                  "Case summary: 27-year-old, two months of constant fatigue.\n" +
                  "Lab results: hemoglobin 12.9 g/dL (low-normal), ferritin 9 ng/mL " +
                  "(low, reference 30-300), TSH 1.8 mU/L (normal).",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "candidates": [\n' +
                '    { "condition": "iron deficiency", "confidence": 0.86,\n' +
                '      "for": "ferritin of 9 means the iron stores are nearly empty, which fully explains the fatigue" },\n' +
                '    { "condition": "hypothyroidism", "confidence": 0.02, "against": "TSH is normal" },\n' +
                '    { "condition": "sleep apnea", "confidence": 0.05, "against": "less likely with a clear lab finding" }\n' +
                '  ],\n  "confident": true\n}',
            },
          ],
        },
        {
          id: "m4-s6",
          nodeId: "diagnosis",
          timestamp: "2026-07-03T09:15:04.500Z",
          payloads: [
            {
              label: "node_input",
              value: {
                top_candidate: "iron deficiency",
                confidence: 0.86,
                threshold: 0.6,
              },
            },
            {
              label: "node_output",
              value: {
                diagnosis: "iron deficiency",
                confidence: 0.86,
                basis: "Ferritin 9 ng/mL with fatigue; thyroid ruled out by normal TSH.",
              },
            },
          ],
        },
        {
          id: "m4-s7",
          nodeId: "treatment_plan",
          timestamp: "2026-07-03T09:15:08.000Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: TREATMENT_PROMPT,
                msg: "Diagnosis: iron deficiency (confidence 0.86).\nSafety-check conflict: none",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "prescription": "ferrous sulfate 100 mg, 1x daily, 8 weeks",\n' +
                '  "supportive": ["take with orange juice (vitamin C helps absorption), not with coffee",\n' +
                '    "iron-rich diet: legumes, red meat, oats",\n' +
                '    "recheck ferritin in 8 weeks"]\n}',
            },
          ],
        },
        {
          id: "m4-s8",
          nodeId: "safety_check",
          timestamp: "2026-07-03T09:15:08.200Z",
          payloads: [
            {
              label: "node_input",
              value: {
                prescription: "ferrous sulfate 100 mg, 1x daily, 8 weeks",
                allergies: [],
                medications: [],
              },
            },
            {
              label: "node_output",
              value: {
                ok: true,
                checked_against: [],
                note: "No allergies or current medication on file — no conflicts possible.",
              },
            },
          ],
        },
        {
          id: "m4-s9",
          nodeId: "doctor_reply",
          timestamp: "2026-07-03T09:15:12.100Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: REPLY_PROMPT,
                msg:
                  "Diagnosis: iron deficiency (ferritin 9 ng/mL, thyroid normal).\n" +
                  "Plan: ferrous sulfate 100 mg daily for 8 weeks, take with vitamin C " +
                  "not coffee, iron-rich diet, recheck ferritin in 8 weeks.\n" +
                  "Safety check: passed.",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "message": "The results are in, and they explain a lot: your iron stores ' +
                "are nearly empty (ferritin 9, where 30+ is normal) — that alone can cause " +
                "exactly the exhaustion you describe. Thyroid is fine. The fix is simple: an " +
                "iron supplement (100 mg daily for 8 weeks), ideally with a glass of orange " +
                "juice and not with coffee, plus iron-rich food. We'll recheck the level in " +
                "8 weeks — if you're not feeling clearly better by then, come back sooner.\\n\\n" +
                '(Demo consultation — not real medical advice.)"\n}',
            },
          ],
        },
      ],
    },
    {
      id: "msg-5",
      label: "Ben — back strain",
      meta: {
        patient: "Ben H.",
        outcome: "lower-back strain — ibuprofen swapped after blood-thinner interaction",
      },
      steps: [
        {
          id: "m5-s1",
          nodeId: "patient_message",
          timestamp: "2026-07-03T14:00:00.000Z",
          payloads: [
            {
              label: "Input",
              value:
                "Hey, my lower back has been really sore for a few days — pretty " +
                "sure I tweaked it lifting boxes. Can I take something for it?",
            },
            {
              label: "patient_record",
              value: {
                name: "Ben H.",
                age: 61,
                allergies: [],
                medications: ["warfarin (blood thinner, for atrial fibrillation)"],
                last_visit: "2026-05-20",
              },
            },
          ],
        },
        {
          id: "m5-s2",
          nodeId: "interview",
          timestamp: "2026-07-03T14:00:00.380Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: ANAMNESIS_PROMPT,
                msg:
                  "Patient message:\nHey, my lower back has been really sore for a " +
                  "few days — pretty sure I tweaked it lifting boxes. Can I take " +
                  "something for it?\n\n" +
                  "Patient record: Ben H., 61. Allergies: none. " +
                  "Medications: warfarin (blood thinner).\n\nPending lab orders: none",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "action": "diagnose",\n  "summary": "A few days of lower-back pain ' +
                "with a clear mechanical trigger (lifting), no radiating leg pain, numbness, " +
                'or other red flags — enough to assess as a musculoskeletal strain."\n}',
            },
          ],
        },
        {
          id: "m5-s3",
          nodeId: "differential",
          timestamp: "2026-07-03T14:00:04.100Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: DIFFERENTIAL_PROMPT,
                msg:
                  "Case summary: 61-year-old, a few days of lower-back pain after " +
                  "lifting boxes, no radiating leg pain, no numbness, no urinary " +
                  "symptoms. On warfarin.",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "candidates": [\n' +
                '    { "condition": "mechanical lower-back strain", "confidence": 0.82,\n' +
                '      "for": "acute onset after lifting, localized movement-related pain, no neurological signs" },\n' +
                '    { "condition": "lumbar disc herniation", "confidence": 0.12,\n' +
                '      "against": "no pain radiating down the leg, no numbness or weakness" },\n' +
                '    { "condition": "kidney stone", "confidence": 0.03,\n' +
                '      "against": "no flank colic and no urinary symptoms" }\n' +
                '  ],\n  "confident": true\n}',
            },
          ],
        },
        {
          id: "m5-s4",
          nodeId: "diagnosis",
          timestamp: "2026-07-03T14:00:04.300Z",
          payloads: [
            {
              label: "node_input",
              value: {
                top_candidate: "mechanical lower-back strain",
                confidence: 0.82,
                threshold: 0.6,
              },
            },
            {
              label: "node_output",
              value: {
                diagnosis: "mechanical lower-back strain",
                confidence: 0.82,
                basis:
                  "Acute onset after lifting, movement-related localized pain, and no neurological red flags.",
              },
            },
          ],
        },
        {
          id: "m5-s5",
          nodeId: "treatment_plan",
          timestamp: "2026-07-03T14:00:07.800Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: TREATMENT_PROMPT,
                msg: "Diagnosis: mechanical lower-back strain (confidence 0.82).\nSafety-check conflict: none",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "prescription": "ibuprofen 400 mg, 3x daily with food, up to 5 days",\n' +
                '  "supportive": ["keep gently moving — avoid bed rest", "heat on the lower back", "lift with the legs once healed"]\n}',
            },
          ],
        },
        {
          id: "m5-s6",
          nodeId: "safety_check",
          timestamp: "2026-07-03T14:00:08.000Z",
          payloads: [
            {
              label: "node_input",
              value: {
                prescription: "ibuprofen 400 mg, 3x daily, up to 5 days",
                allergies: [],
                medications: ["warfarin (blood thinner)"],
              },
            },
            {
              label: "node_output",
              value: {
                ok: false,
                conflict:
                  "ibuprofen is an NSAID; combined with warfarin it raises the risk of bleeding",
                action: "revise",
              },
            },
          ],
        },
        {
          id: "m5-s7",
          nodeId: "treatment_plan",
          timestamp: "2026-07-03T14:00:11.500Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: TREATMENT_PROMPT,
                msg:
                  "Diagnosis: mechanical lower-back strain (confidence 0.82).\n" +
                  "Safety-check conflict: ibuprofen is an NSAID and raises bleeding " +
                  "risk with warfarin. Propose a non-NSAID alternative.",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "prescription": "paracetamol (acetaminophen) 1 g, up to 3x daily",\n' +
                '  "note": "NSAID-free — safe alongside warfarin",\n' +
                '  "supportive": ["keep gently moving — avoid bed rest", "heat on the lower back", "lift with the legs once healed"]\n}',
            },
          ],
        },
        {
          id: "m5-s8",
          nodeId: "safety_check",
          timestamp: "2026-07-03T14:00:11.700Z",
          payloads: [
            {
              label: "node_input",
              value: {
                prescription: "paracetamol (acetaminophen) 1 g, up to 3x daily",
                allergies: [],
                medications: ["warfarin (blood thinner)"],
              },
            },
            {
              label: "node_output",
              value: {
                ok: true,
                checked_against: ["warfarin (blood thinner)"],
                note: "Paracetamol is not an NSAID and does not increase bleeding risk with warfarin.",
              },
            },
          ],
        },
        {
          id: "m5-s9",
          nodeId: "doctor_reply",
          timestamp: "2026-07-03T14:00:15.400Z",
          payloads: [
            {
              label: "llm_input",
              value: {
                prompt: REPLY_PROMPT,
                msg:
                  "Diagnosis: mechanical lower-back strain.\n" +
                  "Plan: paracetamol 1 g up to 3x daily (revised — patient takes " +
                  "warfarin, so no ibuprofen), gentle movement, heat.\n" +
                  "Safety check: passed.",
              },
            },
            {
              label: "llm_output",
              value:
                '{\n  "message": "Sounds like a classic lower-back strain from the lifting — ' +
                "the good news is these almost always settle on their own. Normally I'd suggest " +
                "ibuprofen, but your record shows you take warfarin, and the two together can " +
                "raise your bleeding risk — so take paracetamol instead (up to 1 g, three times " +
                "a day). Keep moving gently rather than resting in bed, and a heat pack helps. " +
                "If you get numbness, leg weakness, or it hasn't eased in a couple of weeks, " +
                "please come in.\\n\\n" +
                '(Demo consultation — not real medical advice.)"\n}',
            },
          ],
        },
      ],
    },
  ],
};
