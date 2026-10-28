// Where you are in the OTel dashboard lives in the URL query (`/otel?view=…`),
// so links, reload and the back button work. Not path segments: a static
// export can't pre-render one page per trace id.

export type OtelView = "projects" | "traces" | "trace" | "logs";
export type TraceKind = "all" | "wizardflow" | "genai" | "otel";
export type LogCorrelation = "all" | "with" | "without";

export type OtelRoute = {
  view: OtelView;
  project?: string;
  trace?: string;
  span?: string;
  tab?: string;
  kind?: TraceKind;
  errors?: boolean;
  q?: string;
  /** Logs: minimum severity number. */
  sev?: number;
  corr?: LogCorrelation;
};

const VIEWS: OtelView[] = ["projects", "traces", "trace", "logs"];
const KINDS: TraceKind[] = ["all", "wizardflow", "genai", "otel"];
const CORRELATIONS: LogCorrelation[] = ["all", "with", "without"];

export function parseOtelRoute(params: URLSearchParams): OtelRoute {
  const project = params.get("project") || undefined;
  const rawView = params.get("view") as OtelView | null;
  // A project without a view opens its traces; nothing opens the overview.
  const view = rawView && VIEWS.includes(rawView) ? rawView : project ? "traces" : "projects";
  const kind = params.get("kind") as TraceKind | null;
  const corr = params.get("corr") as LogCorrelation | null;
  const sev = Number(params.get("sev"));
  return {
    view,
    project,
    trace: params.get("trace") || undefined,
    span: params.get("span") || undefined,
    tab: params.get("tab") || undefined,
    kind: kind && KINDS.includes(kind) ? kind : undefined,
    errors: params.get("errors") === "1" || undefined,
    q: params.get("q") || undefined,
    sev: Number.isFinite(sev) && sev > 0 ? sev : undefined,
    corr: corr && CORRELATIONS.includes(corr) ? corr : undefined,
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
  }
  if (route.view === "logs") {
    if (route.sev) query.set("sev", String(route.sev));
    if (route.corr && route.corr !== "all") query.set("corr", route.corr);
  }
  if ((route.view === "traces" || route.view === "logs") && route.q) query.set("q", route.q);
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
  traceId: string;
  conversationId?: string | null;
  name?: string | null;
  back: string;
}): string {
  const projectQuery = `?project=${encodeURIComponent(project)}`;
  const source = conversationId
    ? `/api/conversations/${encodeURIComponent(conversationId)}/agenttrace${projectQuery}`
    : `/api/traces/${encodeURIComponent(traceId)}/agenttrace${projectQuery}`;
  const query = new URLSearchParams({ trace: source, from: "otel", back });
  if (name) query.set("traceName", name);
  return `/?${query.toString()}`;
}
