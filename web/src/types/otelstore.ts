// JSON shapes served by `wizardflow serve` under /api — the contract with
// sdk/python/src/wizardflow/store/queries.py and projection.py. Change both
// sides together.
//
// Nanosecond timestamps are strings: they exceed JavaScript's 2^53, so a JSON
// number would silently lose precision. Convert with utils/otelApi.ts.

export type Attributes = Record<string, unknown>;

/** Bits of `traces.flags` (sdk/python/src/wizardflow/store/schema.py). */
export const TraceFlag = {
  GENAI: 1,
  /** Has graph nodes (per the Node mapping): replayable in WizardFlow. */
  WIZARDFLOW: 2,
  /** Exact graph from a wizardflow.graph span event. */
  TOPOLOGY: 4,
  /** No parentless span here: the top span's parent is in another service or not imported. */
  PARENT_OUTSIDE: 8,
  MULTI_TOP: 16,
  CROSS_PROJECT: 32,
} as const;

export type ApiMeta = {
  schemaVersion: number;
  latestSchemaVersion: number;
  dbPath: string;
  wizardflowVersion: string;
  capabilities: string[];
};

export type ApiProject = {
  id: number;
  name: string;
  traceCount: number;
  spanCount: number;
  errorTraceCount: number;
  logCount: number;
  tokenCount: number;
  lastSeenNs: string | null;
  /** OR of the GENAI / WIZARDFLOW bits over the project's traces. */
  flags: number;
  services: string[];
};

export type ApiTrace = {
  traceId: string;
  name: string | null;
  serviceName: string | null;
  startNs: string;
  endNs: string;
  durationNs: string;
  spanCount: number;
  errorCount: number;
  logCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  conversationId: string | null;
  userId: string | null;
  flags: number;
  rootSpanId: string | null;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

export type ApiSpanEvent = { timeNs: string; name: string; attributes: Attributes };

export type ApiSpanLink = { traceId: string; spanId: string; attributes: Attributes };

export type ApiSpan = {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  /** OTLP SpanKind: 0 unspecified, 1 internal, 2 server, 3 client, 4 producer, 5 consumer. */
  kind: number;
  startNs: string;
  endNs: string;
  /** 0 unset, 1 ok, 2 error. */
  statusCode: number;
  statusMessage: string | null;
  attributes: Attributes;
  droppedAttributesCount: number;
  resourceId: number;
  nodeId: string | null;
  nodeKind: string | null;
  executionKey: string | null;
  events: ApiSpanEvent[];
  links: ApiSpanLink[];
};

export type ApiLog = {
  id: number;
  tsNs: string;
  severityNumber: number;
  severityText: string | null;
  body: unknown;
  bodyText: string | null;
  attributes: Attributes;
  eventName: string | null;
  traceId: string | null;
  spanId: string | null;
};

export type ApiTraceDetail = {
  trace: ApiTrace;
  spans: ApiSpan[];
  /** Keyed by `ApiSpan.resourceId`. */
  resources: Record<string, { serviceName: string | null; attributes: Attributes }>;
  logs: ApiLog[];
  /** The same trace id in other projects (a distributed trace). */
  otherSlices: { project: string; spanCount: number; rootSpanName: string | null }[];
};
