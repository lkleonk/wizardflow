// Where you are in the OTel dashboard lives in the URL query (`/otel?view=…`),
// so links, reload and the back button work. Not path segments: a static
// export can't pre-render one page per trace id.

import type { TimeRange } from "./otelDisplay";

export type OtelView = "projects" | "traces" | "trace" | "logs" | "settings";
export type TraceKind = "all" | "wizardflow" | "genai" | "otel";
export type LogCorrelation = "all" | "with" | "without";
export type SettingsSection = "mapping" | "display" | "data" | "live";

export type OtelRoute = {
  view: OtelView;
  project?: string;
  trace?: string;
  span?: string;
  tab?: string;
  kind?: TraceKind;
  errors?: boolean;
  q?: string;
  /** Traces: group by conversation. */
  group?: "conversation";
  /** Traces: started within; unset = the display preference. */
  range?: TimeRange;
  /** Logs: minimum severity number. */
  sev?: number;
  corr?: LogCorrelation;
  /** Settings: the open section. */
  sec?: SettingsSection;
  /** Settings → mapping: which project's overrides; unset = the defaults. */
  scope?: string;
};

const VIEWS: OtelView[] = ["projects", "traces", "trace", "logs", "settings"];
const KINDS: TraceKind[] = ["all", "wizardflow", "genai", "otel"];
const CORRELATIONS: LogCorrelation[] = ["all", "with", "without"];
const RANGES: TimeRange[] = ["1h", "24h", "7d", "all"];
const SECTIONS: SettingsSection[] = ["display", "mapping", "data", "live"];

function oneOf<T extends string>(value: string | null, options: T[]): T | undefined {
  return value && (options as string[]).includes(value) ? (value as T) : undefined;
}

export function parseOtelRoute(params: URLSearchParams): OtelRoute {
  const project = params.get("project") || undefined;
  // A project without a view opens its traces; nothing opens the overview.
  const view = oneOf(params.get("view"), VIEWS) ?? (project ? "traces" : "projects");
  const sev = Number(params.get("sev"));
  return {
    view,
    project,
    trace: params.get("trace") || undefined,
    span: params.get("span") || undefined,
    tab: params.get("tab") || undefined,
    kind: oneOf(params.get("kind"), KINDS),
    errors: params.get("errors") === "1" || undefined,
    q: params.get("q") || undefined,
    group: params.get("group") === "conversation" ? "conversation" : undefined,
    range: oneOf(params.get("range"), RANGES),
    sev: Number.isFinite(sev) && sev > 0 ? sev : undefined,
    corr: oneOf(params.get("corr"), CORRELATIONS),
    sec: oneOf(params.get("sec"), SECTIONS),
    scope: params.get("scope") || undefined,
  };
}

export function otelHref(route: OtelRoute): string {
  const query = new URLSearchParams();
  if (route.view !== "projects") query.set("view", route.view);
  if (route.project) query.set("project", route.project);
  if (route.view === "trace") {
    if (route.trace) query.set("trace", route.trace);
    if (route.span) query.set("span", route.span);
    if (route.tab) query.set("tab", route.tab);
  }
  if (route.view === "traces") {
    if (route.kind && route.kind !== "all") query.set("kind", route.kind);
    if (route.errors) query.set("errors", "1");
    if (route.group) query.set("group", route.group);
    if (route.range) query.set("range", route.range);
  }
  if (route.view === "logs") {
    if (route.sev) query.set("sev", String(route.sev));
    if (route.corr && route.corr !== "all") query.set("corr", route.corr);
  }
  if ((route.view === "traces" || route.view === "logs") && route.q) query.set("q", route.q);
  if (route.view === "settings") {
    if (route.sec && route.sec !== "display") query.set("sec", route.sec);
    if (route.scope) query.set("scope", route.scope);
  }
  const text = query.toString();
  return `/otel${text ? `?${text}` : ""}`;
}

/** Navigate inside the dashboard. pushState is picked up by Next's router,
 * so `useSearchParams` re-renders and the back button works. */
export function goTo(route: OtelRoute, { replace = false } = {}): void {
  const href = otelHref(route);
  if (replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}

/**
 * The classic viewer URL replaying a trace or conversation from the database.
 * `back` returns to where the user came from; `from=otel` trims the viewer's
 * chrome (see utils/viewerContext.ts).
 */
export function replayHref({
  project,
  traceId,
  conversationId,
  name,
  back,
}: {
  project: string;
  traceId?: string;
  conversationId?: string | null;
  name?: string | null;
  back: string;
}): string {
  const projectQuery = `?project=${encodeURIComponent(project)}`;
  const source = conversationId
    ? `/api/conversations/${encodeURIComponent(conversationId)}/agenttrace${projectQuery}`
    : `/api/traces/${encodeURIComponent(traceId ?? "")}/agenttrace${projectQuery}`;
  const query = new URLSearchParams({ trace: source, from: "otel", back });
  if (name) query.set("traceName", name);
  return `/?${query.toString()}`;
}
