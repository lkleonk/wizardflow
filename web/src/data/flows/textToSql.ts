import type { AgentTraceFile } from "@/types/agenttrace";

// Text-to-SQL agent with an on-error repair loop: look up the schema, generate
// SQL, and run it. If the database rejects the query, sql_repair rewrites it
// from the error and the query is re-executed; once it succeeds, answer_writer
// explains the rows. sql_generator, sql_repair, and answer_writer are LLM nodes;
// schema_lookup and db_executor log their own data (table metadata, the SQL run,
// and either an error or a result table). The db_executor -> sql_repair ->
// db_executor back-edge makes the repair loop visible.
export const textToSqlTrace: AgentTraceFile = {
  version: "0.1",
  name: "text_to_sql.jsonl",
  meta: {
    source: "custom",
    createdAt: "2026-06-05T10:15:00Z",
    description:
      "A text-to-SQL agent answering an analytics question. It inspects the " +
      "schema, generates a SQL query, and runs it. When the database rejects " +
      "the query, the agent reads the error, repairs the SQL, and retries " +
      "before writing a plain-language answer. Shows a generate→run→repair→retry " +
      "loop with a generated-SQL payload and a tabular result set.",
  },
  graph: {
    nodes: [
      { id: "user_input", label: "User Input" },
      {
        id: "schema_lookup",
        label: "Schema Lookup",
        description: "Looks up the relevant table schema for the question.",
      },
      {
        id: "sql_generator",
        label: "SQL Generator",
        description: "Generates a SQL query from the question and schema.",
      },
      {
        id: "db_executor",
        label: "DB Executor",
        description: "Runs the SQL query against the database and returns rows or an error.",
      },
      {
        id: "sql_repair",
        label: "SQL Repair",
        description: "Rewrites the failed SQL using the database error before it's retried.",
      },
      {
        id: "answer_writer",
        label: "Answer Writer",
        description: "Explains the query results in plain language.",
      },
      { id: "final_response", label: "Final Response" },
    ],
    edges: [
      { source: "user_input", target: "schema_lookup" },
      { source: "schema_lookup", target: "sql_generator" },
      { source: "sql_generator", target: "db_executor" },
      // On a DB error the run loops through sql_repair and back to db_executor;
      // on success it falls through to answer_writer.
      { source: "db_executor", target: "sql_repair", conditional: true },
      { source: "db_executor", target: "answer_writer", conditional: true },
      { source: "sql_repair", target: "db_executor" },
      { source: "answer_writer", target: "final_response" },
    ],
  },
  messages: [
    {
      id: "msg-1",
      meta: { repairs: 0, rows_returned: 3, outcome: "success", latency_ms: 3880 },
      steps: [
        {
          id: "m1-s1",
          nodeId: "user_input",
          timestamp: "2026-06-05T10:15:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "Which 3 products sold the most units last quarter?",
            },
          ],
        },
        {
          id: "m1-s2",
          nodeId: "schema_lookup",
          timestamp: "2026-06-05T10:15:00.260Z",
          payloads: [
            {
              label: "tables",
              value: {
                order_items: ["order_id", "product_id", "quantity"],
                orders: ["id", "created_at"],
                products: ["id", "name"],
              },
            },
          ],
        },
        {
          id: "m1-s3",
          nodeId: "sql_generator",
          timestamp: "2026-06-05T10:15:01.840Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Write a single SQL query for the question using the\n" +
                "given schema. 'Last quarter' = 2026-Q1.\n\n" +
                "Schema:\n" +
                "  order_items(order_id, product_id, quantity)\n" +
                "  orders(id, created_at)\n" +
                "  products(id, name)\n\n" +
                "User: Which 3 products sold the most units last quarter?",
            },
            {
              label: "llm_output",
              value:
                "SELECT p.name, SUM(oi.quantity) AS units\n" +
                "FROM order_items oi\n" +
                "JOIN orders o ON o.id = oi.order_id\n" +
                "JOIN products p ON p.id = oi.product_id\n" +
                "WHERE o.created_at >= '2026-01-01' AND o.created_at < '2026-04-01'\n" +
                "GROUP BY p.name\n" +
                "ORDER BY units DESC\n" +
                "LIMIT 3;",
            },
          ],
        },
        {
          id: "m1-s4",
          nodeId: "db_executor",
          timestamp: "2026-06-05T10:15:02.190Z",
          payloads: [
            { label: "status", value: "ok" },
            { label: "rows_returned", value: 3 },
            {
              label: "result",
              value: [
                { name: "Aero Water Bottle", units: 4120 },
                { name: "Trail Runner Socks", units: 3987 },
                { name: "Cloud Pillow", units: 3540 },
              ],
            },
          ],
        },
        {
          id: "m1-s5",
          nodeId: "answer_writer",
          timestamp: "2026-06-05T10:15:03.470Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Answer the user's question in one sentence from the rows.\n\n" +
                "Rows:\n" +
                "  Aero Water Bottle — 4120\n" +
                "  Trail Runner Socks — 3987\n" +
                "  Cloud Pillow — 3540",
            },
            {
              label: "llm_output",
              value:
                "Last quarter's top sellers were the Aero Water Bottle (4,120 " +
                "units), Trail Runner Socks (3,987), and Cloud Pillow (3,540).",
            },
          ],
        },
        {
          id: "m1-s6",
          nodeId: "final_response",
          timestamp: "2026-06-05T10:15:03.880Z",
          payloads: [
            {
              label: "Output",
              value:
                "Last quarter's top sellers were the Aero Water Bottle (4,120 " +
                "units), Trail Runner Socks (3,987), and Cloud Pillow (3,540).",
            },
          ],
        },
      ],
    },
    {
      id: "msg-2",
      meta: { repairs: 1, rows_returned: 4, outcome: "success", latency_ms: 5620 },
      steps: [
        {
          id: "m2-s1",
          nodeId: "user_input",
          timestamp: "2026-06-05T10:22:00.000Z",
          payloads: [
            {
              label: "Input",
              value: "What was our total revenue for each quarter in 2025?",
            },
          ],
        },
        {
          id: "m2-s2",
          nodeId: "schema_lookup",
          timestamp: "2026-06-05T10:22:00.240Z",
          payloads: [
            {
              label: "tables",
              value: {
                orders: ["id", "created_at", "total_cents", "status"],
              },
            },
          ],
        },
        {
          id: "m2-s3",
          nodeId: "sql_generator",
          timestamp: "2026-06-05T10:22:01.770Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Write a single SQL query for the question using the\n" +
                "given schema. Only count paid orders (status = 'paid').\n\n" +
                "Schema:\n" +
                "  orders(id, created_at, total_cents, status)\n\n" +
                "User: What was our total revenue for each quarter in 2025?",
            },
            {
              label: "llm_output",
              value:
                "SELECT EXTRACT(QUARTER FROM created_at) AS quarter,\n" +
                "       SUM(total_amount) / 100.0 AS revenue\n" +
                "FROM orders\n" +
                "WHERE status = 'paid'\n" +
                "  AND created_at >= '2025-01-01' AND created_at < '2026-01-01'\n" +
                "GROUP BY quarter\n" +
                "ORDER BY quarter;",
            },
          ],
        },
        {
          id: "m2-s4",
          nodeId: "db_executor",
          timestamp: "2026-06-05T10:22:02.130Z",
          payloads: [
            { label: "status", value: "error" },
            {
              label: "error",
              value: {
                code: "42703",
                message: 'column "total_amount" does not exist',
                hint: "Perhaps you meant to reference the column orders.total_cents.",
              },
            },
          ],
        },
        {
          id: "m2-s5",
          nodeId: "sql_repair",
          timestamp: "2026-06-05T10:22:03.520Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: The query failed. Fix it using the schema and the error.\n" +
                "Return only the corrected SQL.\n\n" +
                "Schema:\n" +
                "  orders(id, created_at, total_cents, status)\n\n" +
                'Error: column "total_amount" does not exist\n' +
                "  (hint: did you mean orders.total_cents?)\n\n" +
                "Failed SQL:\n" +
                "  SUM(total_amount) / 100.0 AS revenue",
            },
            {
              label: "llm_output",
              value:
                "SELECT EXTRACT(QUARTER FROM created_at) AS quarter,\n" +
                "       SUM(total_cents) / 100.0 AS revenue\n" +
                "FROM orders\n" +
                "WHERE status = 'paid'\n" +
                "  AND created_at >= '2025-01-01' AND created_at < '2026-01-01'\n" +
                "GROUP BY quarter\n" +
                "ORDER BY quarter;",
            },
          ],
        },
        {
          id: "m2-s6",
          nodeId: "db_executor",
          timestamp: "2026-06-05T10:22:03.910Z",
          payloads: [
            { label: "status", value: "ok" },
            { label: "rows_returned", value: 4 },
            {
              label: "result",
              value: [
                { quarter: 1, revenue: 184320.5 },
                { quarter: 2, revenue: 201475.0 },
                { quarter: 3, revenue: 198640.25 },
                { quarter: 4, revenue: 256910.75 },
              ],
            },
          ],
        },
        {
          id: "m2-s7",
          nodeId: "answer_writer",
          timestamp: "2026-06-05T10:22:05.210Z",
          payloads: [
            {
              label: "llm_input",
              value:
                "System: Answer the user's question in one sentence from the rows.\n\n" +
                "Rows:\n" +
                "  Q1 184320.50\n  Q2 201475.00\n  Q3 198640.25\n  Q4 256910.75",
            },
            {
              label: "llm_output",
              value:
                "2025 revenue by quarter: Q1 $184,320.50, Q2 $201,475.00, Q3 " +
                "$198,640.25, and Q4 $256,910.75 — the strongest quarter.",
            },
          ],
        },
        {
          id: "m2-s8",
          nodeId: "final_response",
          timestamp: "2026-06-05T10:22:05.620Z",
          payloads: [
            {
              label: "Output",
              value:
                "2025 revenue by quarter: Q1 $184,320.50, Q2 $201,475.00, Q3 " +
                "$198,640.25, and Q4 $256,910.75 — the strongest quarter.",
            },
          ],
        },
      ],
    },
  ],
};
