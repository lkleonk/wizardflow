# WizardFlow JSONL format

WizardFlow writes JSON Lines only. Each line is one complete JSON record, so a
finished message can be appended without rewriting the existing trace.

The Python and web readers also accept the legacy single-document WizardFlow
trace representation.

## Records

A part begins with one header, contains zero or more messages, and may end with
a seal when rotation continues in another file:

```jsonl
{"type":"header","version":"0.2","name":"run","graph":{"nodes":[],"edges":[]}}
{"type":"message","id":"msg-1","steps":[]}
{"type":"seal","nextPart":"run__...__part2.jsonl"}
```

### Header

The header contains every WizardFlow trace field except `messages`:

```json
{
  "type": "header",
  "version": "0.2",
  "name": "research run",
  "meta": {"description": "Example"},
  "graph": {
    "nodes": [{"id": "router"}, {"id": "generator"}],
    "edges": [{"source": "router", "target": "generator"}]
  }
}
```

Node declarations may include `label`, `color`, and `description`. An edge may
include `conditional: true` for a runtime branch.

### Message

```json
{
  "type": "message",
  "id": "msg-1",
  "label": "First question",
  "meta": {"outcome": "ok"},
  "steps": []
}
```

Only completed messages are written. The optional label is the message title;
message metadata is intended for short scalar values.

### Step

```json
{
  "id": "msg-1-s1",
  "nodeId": "generator",
  "kind": "llm",
  "timestamp": "2026-09-17T10:00:00.000Z",
  "endTimestamp": "2026-09-17T10:00:02.000Z",
  "timingMode": "explicit",
  "payloads": []
}
```

`timestamp` remains the execution start for backward compatibility.
`endTimestamp`, `timingMode`, and `kind` are optional, so older files remain
valid. Omitted kind means generic. `timingMode` describes the reliability of
the recorded interval without coupling the format to one SDK syntax:

- `explicit` means both boundaries were explicitly recorded by a scoped node
  execution or matching `start_node()` / `end_node()` calls.
- `inferred` means at least the start came from observed log activity and the
  interval is an observed window rather than an exact runtime.
- `auto_closed` means the start was explicit but `end_message()` supplied the
  end because `end_node()` was not called.
- Missing means unknown, as in traces written before this field existed.

### Payload

A generic payload has a developer-facing label and any JSON-compatible value:

```json
{"label":"confidence","value":0.91}
```

First-class WizardFlow meanings use `semanticType` independently of the label:

```json
{"label":"input","value":{"question":"..."},"semanticType":"input"}
```

```json
{
  "label": "usage",
  "value": {"inputTokens": 120, "outputTokens": 30},
  "semanticType": "usage"
}
```

Initial semantic types are `input`, `output`, `usage`, and
`model_parameters`. Readers pass unknown future strings through unchanged.

When a record must remain in JSONL but never be projected to OTel, it contains:

```json
{"label":"debug","value":"...","exportToOtel":false}
```

`exportToJsonl` is not stored: a record excluded from JSONL is absent.

## Source-of-truth rules

- JSON-compatible complex values remain intact.
- JSONL does not contain OTel attribute names.
- Exporters, rather than the writer, normalize values for their transport.
- Content truncation for OTel never mutates the JSONL value.
- Generic labels do not imply semantic meaning.

These rules let `wizardflow otel export` parse JSONL and call the same OTel
mapping layer used during live recording.

## Rotation

The default part limits are 16 MB or 2,000 messages, whichever is reached
first. Rotation happens only at a message boundary. A single oversized message
is kept intact in its own oversized part.

Files are named like:

```text
run__2026-09-17T10-00-00-123Z.jsonl
run__2026-09-17T10-00-00-123Z__part2.jsonl
```

Part 2 and later carry `meta.part` and `meta.prevPart` in their headers. A
rotated-away part ends with a seal naming `nextPart`. The active part has no
seal, and one part is loaded at a time.

Calling `reinit(jsonl=True)` starts a new run rather than rotating: the old file
does not receive a seal and the new filename gets a fresh timestamp.

## Reader tolerance

Both readers:

- detect JSONL when line 1 is a header record;
- otherwise attempt the single-document format;
- ignore unknown JSONL record types;
- skip corrupt middle lines;
- tolerate an unparseable final line left by a crashed append;
- keep the last content for duplicate message IDs.

Optional additions such as `kind`, `semanticType`, `endTimestamp`,
`timingMode`, and `exportToOtel` do not require a schema-version bump while
readers remain forward-tolerant.

## Related implementation files

- Python writer: [`../src/wizardflow/client.py`](../src/wizardflow/client.py)
- Python reader: [`../src/wizardflow/reader.py`](../src/wizardflow/reader.py)
- TypeScript schema: [`../../../web/src/types/agenttrace.ts`](../../../web/src/types/agenttrace.ts)
- Web parser: [`../../../web/src/utils/agentTraceFile.ts`](../../../web/src/utils/agentTraceFile.ts)
