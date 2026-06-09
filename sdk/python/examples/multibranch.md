# multibranch.json

> Branching router agent: a tool path and a retrieval path that rejoin.

| field | value |
| --- | --- |
| version | 0.1 |

## Graph

```mermaid
flowchart TD
    n0["user_input"]
    n1["router"]
    n2["planner"]
    n3["retriever"]
    n4["tool_node"]
    n5["generator"]
    n6["final_response"]
    n0 --> n1
    n1 --> n2
    n1 --> n3
    n2 --> n4
    n4 --> n5
    n3 --> n5
    n5 --> n6
```

## msg-1

### user_input · 11:49:15

**Input**: `What's the weather in Berlin?`

### router · 11:49:15

**llm_input**: `Pick a route for the request...`

**llm_output**: `{"route": "planner", "confidence": 0.92}`

### planner · 11:49:15

**llm_input**: `Decompose into tool calls...`

**llm_output**: `{"plan": ["weather_api(city='Berlin')"]}`

### tool_node · 11:49:15

### generator · 11:49:15

**llm_input**: `Answer using the tool result...`

**llm_output**: `It's 19C and partly cloudy in Berlin.`

### final_response · 11:49:15

**Output**: `It's 19C and partly cloudy in Berlin.`

## msg-2

### user_input · 11:49:15

**Input**: `Summarize the attached research paper.`

### router · 11:49:15

**llm_input**: `Pick a route for the request...`

**llm_output**: `{"route": "retriever", "confidence": 0.88}`

### retriever · 11:49:15

**Input**

```json
{
  "topK": 4,
  "namespace": "papers"
}
```

**Retrieved docs**

```json
[
  {
    "id": "doc-7",
    "score": 0.81
  },
  {
    "id": "doc-2",
    "score": 0.77
  }
]
```

### generator · 11:49:15

**llm_input**: `Summarize the retrieved documents...`

**llm_output**: `The paper proposes a sparse attention variant with near-linear cost.`

### final_response · 11:49:15

**Output**: `The paper proposes a sparse attention variant with near-linear cost.`
