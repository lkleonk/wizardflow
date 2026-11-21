import { Suspense, lazy, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import SearchIcon from "@mui/icons-material/Search";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import DownloadTraceDialog from "@/components/DownloadTraceDialog";
import { renderWithHighlightedKeys } from "@/components/highlightJsonKeys";
import { clearCrumbsFirstFrame, rememberCrumbs } from "@/components/TracePendingScript";
import { useSearchHotkey } from "@/hooks/useKeyboardShortcuts";
import {
  getInspectorHighlightKeys,
  getServerInspectorHighlightKeys,
  subscribeInspectorHighlightKeys,
} from "@/utils/flowSession";
import type { AgentTraceFile } from "@/types/agenttrace";
import { executionChoices, type ExecutionChoice } from "@/utils/traceSelectors";
import { nodeColorAt, nodeColorForKind } from "@/theme/muiTheme";
import {
  TraceFlag,
  type ApiLog,
  type ApiProject,
  type ApiSpan,
  type ApiTrace,
  type ApiTraceDetail,
  type Attributes,
  type Page,
} from "@/types/otelstore";
import {
  apiPath,
  formatNsClock,
  formatNsDateTime,
  formatNsDuration,
  nsDiff,
  useApi,
} from "@/utils/otelApi";
import { keyMatches, setDisplayPrefs, useDisplayPrefs, type DisplayPrefs } from "@/utils/otelDisplay";
import { goTo, isReplayUrl, otelHref, replayHref, replayUrlAt, type OtelRoute } from "@/utils/otelRoute";
import type { ExecutionPickerProps } from "./ExecutionPicker";
import OtelHeader, { executionCrumbs } from "./OtelHeader";
import { LoadError, Loading, Mono, SeverityChip, TraceBadges, graphSource } from "./OtelBits";
import SpanSearchDialog from "./SpanSearchDialog";

// React Flow is heavy and only needed once the graph is opened.
const SpanGraphPanel = lazy(() => import("./SpanGraphPanel"));

const MONO = "var(--font-geist-mono), monospace";
const KIND_NAMES = ["unspecified", "internal", "server", "client", "producer", "consumer"];

// Node kinds as other conventions name them → the kinds the theme colors.
const KIND_ALIASES: Record<string, string> = {
  invoke_agent: "agent",
  create_agent: "agent",
  chat: "llm",
  text_completion: "llm",
  generate_content: "llm",
  execute_tool: "tool",
  retrieval: "retriever",
  embeddings: "embedding",
};

function kindColor(kind: string | null): string | undefined {
  const raw = (kind ?? "").toLowerCase();
  return nodeColorForKind(KIND_ALIASES[raw] ?? raw);
}

/**
 * The accent each node has in graph replay, so a span and the node it becomes
 * look alike. Same rule as GraphCanvas: the recorded node's own color, else
 * its kind's color, else the palette by the node's place in the graph — the
 * recorded graph's order (a `wizardflow.graph` event), or else the order the
 * nodes first ran in, which is how the replay infers one.
 */
function nodeAccents(spans: ApiSpan[]): Map<string, string> {
  let recorded: { id?: unknown; color?: unknown }[] | null = null;
  for (const span of spans) {
    for (const event of span.events) {
      if (event.name !== "wizardflow.graph") continue;
      try {
        const nodes = JSON.parse(String(event.attributes["wizardflow.graph.nodes"] ?? ""));
        if (Array.isArray(nodes)) recorded = nodes;
      } catch {
        // omitted or unreadable: fall back to the run order
      }
    }
  }
  const byStart = spans.filter((s) => s.nodeId).sort((a, b) => nsDiff(a.startNs, b.startNs));
  const kinds = new Map<string, string | null>();
  for (const span of byStart) if (!kinds.has(span.nodeId!)) kinds.set(span.nodeId!, span.nodeKind);
  const order: { id: string; color?: string }[] = recorded
    ? recorded.map((n) => ({ id: String(n.id), color: typeof n.color === "string" ? n.color : undefined }))
    : [...kinds.keys()].map((id) => ({ id }));
  const accents = new Map<string, string>();
  order.forEach((node, index) => {
    accents.set(node.id, node.color ?? kindColor(kinds.get(node.id) ?? null) ?? nodeColorAt(index));
  });
  return accents;
}

function spanColor(span: ApiSpan, accents: Map<string, string>): string {
  if (span.statusCode === 2) return "error.main";
  return (span.nodeId && accents.get(span.nodeId)) || kindColor(span.nodeKind) || "text.disabled";
}

type Row = { span: ApiSpan; depth: number };

/** Depth-first span tree; spans whose parent isn't here are top-level. */
function flattenTree(spans: ApiSpan[]): Row[] {
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string, ApiSpan[]>();
  const tops: ApiSpan[] = [];
  for (const span of spans) {
    if (span.parentSpanId && ids.has(span.parentSpanId)) {
      const list = children.get(span.parentSpanId) ?? [];
      list.push(span);
      children.set(span.parentSpanId, list);
    } else {
      tops.push(span);
    }
  }
  const rows: Row[] = [];
  const walk = (span: ApiSpan, depth: number) => {
    rows.push({ span, depth });
    for (const child of children.get(span.spanId) ?? []) walk(child, depth + 1);
  };
  for (const top of tops) walk(top, 0);
  return rows;
}

// --- page --------------------------------------------------------------------

export default function TraceView({
  route,
  projects,
}: {
  route: OtelRoute & { project: string; trace: string };
  projects: ApiProject[];
}) {
  const { data, error, loading } = useApi<ApiTraceDetail>(
    apiPath(`traces/${encodeURIComponent(route.trace)}`, { project: route.project }),
    { live: true }
  );
  useEffect(() => {
    if (!loading) clearCrumbsFirstFrame();
  }, [loading]);
  // Moving to another execution keeps the current one on screen until the next
  // has arrived, so the header and graph don't blink away in between.
  const href = otelHref(route);
  const [held, setHeld] = useState<{ detail: ApiTraceDetail; route: typeof route; href: string } | null>(null);
  if (data && (held?.detail !== data || held.href !== href)) setHeld({ detail: data, route, href });
  const shown = data ? { detail: data, route } : loading && held?.route.project === route.project ? held : null;
  if (error || !shown) {
    return (
      <>
        <OtelHeader route={route} projects={projects} live={false} />
        {error ? <LoadError error={error} /> : <Loading />}
      </>
    );
  }
  return <TraceDetail detail={shown.detail} route={shown.route} projects={projects} />;
}

function TraceDetail({
  detail,
  route,
  projects,
}: {
  detail: ApiTraceDetail;
  route: OtelRoute & { project: string; trace: string };
  projects: ApiProject[];
}) {
  const { trace, spans } = detail;
  const conversationId = trace.conversationId;
  const position = detail.conversation?.position;
  const total = detail.conversation?.total;
  useEffect(() => {
    rememberCrumbs({
      traceId: trace.traceId,
      conversation: conversationId ?? `${trace.traceId.slice(0, 12)}…`,
      position,
      total,
    });
  }, [trace.traceId, conversationId, position, total]);
  const [searchOpen, setSearchOpen] = useState(false);
  useSearchHotkey(true, () => setSearchOpen(true));
  const [graphOpen, setGraphOpen] = useState(readGraphOpen);
  const showGraph = (open: boolean) => {
    setGraphOpen(open);
    rememberGraphOpen(open);
  };
  const rows = flattenTree(spans);
  const accents = nodeAccents(spans);
  const selected = spans.find((s) => s.spanId === route.span) ?? rows[0]?.span;
  const select = (spanId: string) => goTo({ ...route, span: spanId }, { replace: true });
  const back = otelHref(route);
  const replayable = (trace.flags & TraceFlag.WIZARDFLOW) !== 0;
  const playback = useSpanPlayback(trace.traceId, spans, selected, replayable && graphOpen, select);
  // Loaded when the popup first opens. It lists what "Execution N of M"
  // counts: a replayable trace counts the conversation's replayable traces,
  // which its replay data names best (the graph and download use the same
  // data); any other trace counts all of them, which only the trace list has.
  const [pickerWanted, setPickerWanted] = useState(false);
  const wantChoices = pickerWanted && trace.conversationId !== null;
  const replayData = useApi<AgentTraceFile>(
    wantChoices && replayable ? agentTracePath(trace, route.project) : null,
    { live: true }
  );
  const conversationTraces = useApi<Page<ApiTrace>>(
    wantChoices && !replayable
      ? apiPath("traces", {
          project: route.project,
          conversation: trace.conversationId ?? "",
          limit: String(PICKER_LIMIT),
        })
      : null,
    { live: true }
  );
  const picker: ExecutionPickerProps = {
    choices: replayable
      ? replayData.data && oneChoicePerTrace(executionChoices(replayData.data.messages))
      : conversationTraces.data && traceChoices(conversationTraces.data.items),
    error: replayable ? replayData.error : conversationTraces.error,
    onOpen: () => setPickerWanted(true),
    onJump: (index) => {
      const traceId = picker.choices?.[index]?.traceId;
      if (traceId) goTo({ view: "trace", project: route.project, trace: traceId, back: route.back });
    },
  };
  // A click on a span or node takes over from playback, as in the replay.
  const pick = (spanId: string) => {
    playback.pause();
    select(spanId);
  };
  const at = { traceId: trace.traceId, spanId: selected?.spanId };
  // Opened from a replay: return to that one, on the selected span.
  const replay =
    route.back && isReplayUrl(route.back)
      ? replayUrlAt(route.back, at)
      : replayHref({
          project: route.project,
          traceId: trace.traceId,
          conversationId: trace.conversationId,
          name: trace.conversationId ?? trace.name,
          back,
          at,
        });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, overflow: "hidden" }}>
      <OtelHeader
        route={route}
        projects={projects}
        trail={traceTrail(detail, route.project, route.back, picker)}
        live
        actions={
          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>
            <Tooltip title="Search this execution (Ctrl+K)">
              <IconButton size="small" onClick={() => setSearchOpen(true)} aria-label="Search this execution">
                <SearchIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {replayable && (
              <Tooltip
                title={
                  trace.conversationId
                    ? `Open conversation ${trace.conversationId} in graph replay`
                    : "Open this execution in graph replay"
                }
              >
                <Button
                  size="small"
                  variant="outlined"
                  color="secondary"
                  startIcon={<AccountTreeOutlinedIcon />}
                  href={replay}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  Open graph replay
                </Button>
              </Tooltip>
            )}
          </Box>
        }
      />
      <SpanSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        spans={rows.map((row) => row.span)}
        logs={detail.logs}
        messageKeys={MESSAGE_KEYS}
        onJump={(hit) => {
          playback.pause();
          goTo({ ...route, span: hit.spanId, tab: hit.tab }, { replace: true });
        }}
      />
      <TraceHeader detail={detail} project={route.project} replayable={replayable} />
      {detail.otherSlices.length > 0 && (
        <Alert severity="info" sx={{ mx: 2, mb: 1, py: 0 }}>
          This trace continues in{" "}
          {detail.otherSlices.map((slice, i) => (
            <span key={slice.project}>
              {i > 0 && ", "}
              <Link
                component="button"
                onClick={() => goTo({ view: "trace", project: slice.project, trace: trace.traceId })}
              >
                {slice.project}
              </Link>{" "}
              ({slice.spanCount} spans)
            </span>
          ))}
        </Alert>
      )}
      <SplitPane
        traceId={trace.traceId}
        spanCount={spans.length}
        left={<SpanTimeline rows={rows} detail={detail} accents={accents} selectedId={selected?.spanId} onSelect={pick} />}
        right={
          selected ? (
            <GraphAndInspector
              strip={
                replayable ? (
                  <GraphStrip
                    span={selected}
                    detail={detail}
                    open={graphOpen}
                    onToggle={() => {
                      playback.pause();
                      showGraph(!graphOpen);
                    }}
                    controls={graphOpen && playback.hasSteps ? <PlaybackButtons playback={playback} /> : null}
                  />
                ) : null
              }
              graph={
                replayable && graphOpen ? (
                  <Suspense fallback={null}>
                    <SpanGraphPanel
                      path={agentTracePath(trace, route.project)}
                      spans={spans}
                      selected={selected}
                      onSelectSpan={pick}
                    />
                  </Suspense>
                ) : null
              }
              inspector={
                <SpanInspector
                  span={selected}
                  detail={detail}
                  accents={accents}
                  tab={route.tab}
                  onTab={(tab) => goTo({ ...route, span: selected.spanId, tab }, { replace: true })}
                />
              }
            />
          ) : null
        }
      />
    </Box>
  );
}

/** Crumbs after "Traces": the conversation, then which execution this is. */
function traceTrail(
  detail: ApiTraceDetail,
  project: string,
  back: string | undefined,
  picker: ExecutionPickerProps
): React.ReactNode[] {
  const { trace, conversation } = detail;
  if (!trace.conversationId) {
    return [<Mono key="id" sx={{ fontWeight: 650 }}>{trace.traceId.slice(0, 12)}…</Mono>];
  }
  const stepTo = (traceId: string | null) =>
    traceId ? () => goTo({ view: "trace", project, trace: traceId, back }) : undefined;
  return executionCrumbs({
    conversation: trace.conversationId,
    execution: conversation
      ? {
          position: conversation.position,
          total: conversation.total,
          onPrev: stepTo(conversation.prevTraceId),
          onNext: stepTo(conversation.nextTraceId),
          picker,
        }
      : undefined,
  });
}

/** The most traces the API returns in one page. */
const PICKER_LIMIT = 500;

/** Picker rows straight from the trace list (newest first), oldest first. */
function traceChoices(traces: ApiTrace[]): ExecutionChoice[] {
  return [...traces].reverse().map((t) => ({
    title: t.name ?? `${t.traceId.slice(0, 12)}…`,
    startedAt: new Date(Math.floor(Number(t.startNs) / 1e6)).toISOString(),
    failed: t.errorCount > 0,
    traceId: t.traceId,
  }));
}

/** The span page counts traces, and one trace can hold several executions. */
function oneChoicePerTrace(choices: ExecutionChoice[]): ExecutionChoice[] {
  const seen = new Set<string | undefined>();
  return choices.filter((choice) => !seen.has(choice.traceId) && seen.add(choice.traceId));
}

/** A replay plays the whole conversation, so its data is the conversation's. */
function agentTracePath(trace: ApiTraceDetail["trace"], project: string): string {
  return apiPath(
    trace.conversationId
      ? `conversations/${encodeURIComponent(trace.conversationId)}/agenttrace`
      : `traces/${encodeURIComponent(trace.traceId)}/agenttrace`,
    { project }
  );
}

/** Download sits at the row's right end, the Traces list's replay-button spot. */
function DownloadRun({ detail, project }: { detail: ApiTraceDetail; project: string }) {
  const { trace, conversation } = detail;
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const conversationId = trace.conversationId;
  const executions = conversation?.total ?? 1;
  const count = `${executions} execution${executions === 1 ? "" : "s"}`;
  const path = agentTracePath(trace, project);
  const label = conversationId ? `Download conversation ${conversationId} (${count})` : "Download this execution";
  return (
    <>
      <Tooltip title={label}>
        <IconButton
          size="small"
          aria-label={label}
          onClick={() => {
            setRequested(true);
            setOpen(true);
          }}
          sx={{ flex: "none", mt: -0.25 }}
        >
          <FileDownloadOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {requested && (
        <DownloadTraceDialog
          open={open}
          onClose={() => setOpen(false)}
          path={path}
          what={conversationId ? `conversation ${conversationId}, ${count},` : "this execution"}
        />
      )}
    </>
  );
}

function TraceHeader({
  detail,
  project,
  replayable,
}: {
  detail: ApiTraceDetail;
  project: string;
  replayable: boolean;
}) {
  const { trace } = detail;
  const [copied, setCopied] = useState(false);
  const localRoot = (trace.flags & TraceFlag.PARENT_OUTSIDE) !== 0;
  const fact = (label: string, value: React.ReactNode) => (
    <Typography component="span" sx={{ fontSize: 12.5, color: "text.secondary" }}>
      {label}{" "}
      <Box component="b" sx={{ color: "text.primary", fontWeight: 600 }}>
        {value}
      </Box>
    </Typography>
  );
  return (
    <Box sx={{ px: 2, py: 1.25, display: "flex", alignItems: "flex-start", gap: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
      <TraceBadges flags={trace.flags} />
      <Typography component="span" sx={{ fontSize: 12.5, color: "text.secondary" }}>
        trace{" "}
        {/* Shortened, so the facts fit on one row; the tooltip has the rest. */}
        <Tooltip
          title={
            copied ? (
              "Copied"
            ) : (
              <>
                <Box component="span" sx={{ fontFamily: MONO }}>{trace.traceId}</Box>
                <br />
                Click to copy. The trace is named after its {localRoot ? "local root" : "root span"}.
              </>
            )
          }
        >
          <Box
            component="button"
            aria-label={`Copy trace id ${trace.traceId}`}
            onClick={() => {
              void navigator.clipboard?.writeText(trace.traceId);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
            sx={{
              font: "inherit",
              fontFamily: MONO,
              fontWeight: 600,
              color: "text.primary",
              bgcolor: "transparent",
              border: 0,
              p: 0,
              cursor: "pointer",
              borderBottom: 1,
              borderStyle: "dashed",
              borderColor: "divider",
            }}
          >
            {trace.traceId.slice(0, 8)}…
          </Box>
        </Tooltip>
      </Typography>
      {fact("started", formatNsDateTime(trace.startNs))}
      {fact("duration", formatNsDuration(Number(trace.durationNs)))}
      {fact("spans", trace.spanCount)}
      {trace.errorCount > 0 && fact("errors", trace.errorCount)}
      {(trace.inputTokens != null || trace.outputTokens != null) &&
        fact("tokens", `${trace.inputTokens ?? 0} in / ${trace.outputTokens ?? 0} out`)}
      {trace.conversationId && fact("conversation", trace.conversationId)}
      {trace.logCount > 0 && fact("logs", trace.logCount)}
      </Box>
      {replayable && <DownloadRun detail={detail} project={project} />}
    </Box>
  );
}

// --- split pane --------------------------------------------------------------

// The surface of the replay's panels (MuiPaper in muiTheme.ts), on grid cells.
const card = {
  bgcolor: "background.paper",
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
} as const;

const TREE_WIDTH_KEY = "wf-otel-tree-width";
const TREE_MIN = 180;
const INSPECTOR_MIN = 320;

function readTreeWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(TREE_WIDTH_KEY));
    // Older builds stored -1 for "collapsed"; that is no longer remembered.
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Span tree | inspector, with a draggable divider. The width is a per-browser
 * display preference; a one-span trace starts with a narrow tree, since the
 * content is in the inspector. Dragging to the far left (or «) collapses the
 * tree to a strip, for this trace only: the next trace opens with its tree.
 */
function SplitPane({
  traceId,
  spanCount,
  left,
  right,
}: {
  traceId: string;
  spanCount: number;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  const [width, setWidth] = useState<number | null>(() =>
    typeof window === "undefined" ? null : readTreeWidth()
  );
  // Tied to the trace: the page stays mounted when moving between executions.
  const [collapsedTrace, setCollapsedTrace] = useState<string | null>(null);
  const collapsed = collapsedTrace === traceId;
  const setCollapsed = (on: boolean) => setCollapsedTrace(on ? traceId : null);
  const container = useRef<HTMLDivElement>(null);
  const save = (value: number | null) => {
    setWidth(value);
    setCollapsed(false);
    try {
      if (value === null) window.localStorage.removeItem(TREE_WIDTH_KEY);
      else window.localStorage.setItem(TREE_WIDTH_KEY, String(value));
    } catch {
      // storage unavailable (private mode): the width just isn't remembered
    }
  };
  const treeColumn = width
    ? `${width}px`
    : spanCount <= 1
      ? "300px"
      : `minmax(${TREE_MIN}px, 57%)`;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = container.current?.getBoundingClientRect();
    const tree = event.currentTarget.previousElementSibling?.getBoundingClientRect();
    if (!box || !tree) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = tree.width;
    let next = startWidth;
    const handle = event.currentTarget;
    const move = (e: PointerEvent) => {
      next = Math.max(60, Math.min(box.width - INSPECTOR_MIN, startWidth + e.clientX - startX));
      if (container.current) {
        container.current.style.gridTemplateColumns = `0px ${next}px 6px minmax(${INSPECTOR_MIN}px, 1fr)`;
      }
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      if (container.current) container.current.style.gridTemplateColumns = "";
      if (Math.abs(next - startWidth) <= 2) return;
      if (next < TREE_MIN - 20) setCollapsed(true);
      else save(Math.round(next));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  return (
    <Box
      ref={container}
      sx={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        // Two floating cards, like the replay's graph + inspector; the 6px
        // column between them is the resize handle (and the gap when folded).
        gridTemplateColumns: {
          xs: "1fr",
          md: collapsed
            ? `34px 0px 6px minmax(0, 1fr)`
            : `0px ${treeColumn} 6px minmax(${INSPECTOR_MIN}px, 1fr)`,
        },
        rowGap: { xs: 1.5, md: 0 },
        px: { xs: 1.5, sm: 2 },
        pb: { xs: 1.5, sm: 2 },
        // Explicit columns below: the strip and the divider are display:none
        // in turn, and a hidden item would otherwise shift the rest left.
      }}
    >
      <Box
        sx={{
          ...card,
          gridColumn: { md: 1 },
          display: { xs: "none", md: collapsed ? "flex" : "none" },
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          gap: 1,
        }}
      >
        <Tooltip title="Show the span tree">
          <IconButton size="small" onClick={() => setCollapsed(false)} aria-label="Show the span tree">
            <KeyboardDoubleArrowRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography sx={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11.5, color: "text.secondary" }}>
          {spanCount} {spanCount === 1 ? "span" : "spans"}
        </Typography>
      </Box>
      <Box
        sx={{
          ...card,
          gridColumn: { md: 2 },
          overflow: "auto",
          minWidth: 0,
          minHeight: { xs: 240, md: 0 },
          maxHeight: { xs: "55vh", md: "none" },
          visibility: { md: collapsed ? "hidden" : "visible" },
          position: "relative",
        }}
      >
        <Tooltip title="Collapse the span tree">
          <IconButton
            size="small"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse the span tree"
            // Small enough that its hover circle stays inside the 28px header.
            sx={{ display: { xs: "none", md: "inline-flex" }, position: "absolute", top: 0, left: 4, zIndex: 2, p: 0.25 }}
          >
            <KeyboardDoubleArrowLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {left}
      </Box>
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize span tree"
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={startDrag}
        onDoubleClick={() => save(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const tree = e.currentTarget.previousElementSibling?.getBoundingClientRect();
          if (tree) save(Math.max(TREE_MIN, Math.round(tree.width + (e.key === "ArrowRight" ? 32 : -32))));
        }}
        sx={{
          gridColumn: { md: 3 },
          display: { xs: "none", md: collapsed ? "none" : "block" },
          cursor: "col-resize",
          touchAction: "none",
          position: "relative",
          "&::after": {
            content: '""',
            position: "absolute",
            top: 8,
            bottom: 8,
            left: 2,
            width: "2px",
            borderRadius: 1,
          },
          "&:hover::after, &:focus-visible::after": { bgcolor: "primary.main" },
          outline: "none",
        }}
      />
      <Box sx={{ ...card, gridColumn: { md: 4 }, overflow: "auto", minWidth: 0, minHeight: 0, position: "relative" }}>
        {right}
      </Box>
    </Box>
  );
}

// --- graph above the inspector -----------------------------------------------

const GRAPH_OPEN_KEY = "wf-otel-span-graph";
const GRAPH_HEIGHT_KEY = "wf-otel-span-graph-height";
const GRAPH_HEIGHT_DEFAULT = 280;
const GRAPH_HEIGHT_MIN = 140;
const INSPECTOR_HEIGHT_MIN = 160;

function readGraphOpen(): boolean {
  try {
    return window.localStorage.getItem(GRAPH_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberGraphOpen(open: boolean): void {
  try {
    window.localStorage.setItem(GRAPH_OPEN_KEY, open ? "1" : "0");
  } catch {
    // storage unavailable (private mode): it just isn't remembered
  }
}

function readGraphHeight(): number {
  try {
    const value = Number(window.localStorage.getItem(GRAPH_HEIGHT_KEY));
    return Number.isFinite(value) && value >= GRAPH_HEIGHT_MIN ? value : GRAPH_HEIGHT_DEFAULT;
  } catch {
    return GRAPH_HEIGHT_DEFAULT;
  }
}

const PLAYBACK_STEP_MS = 1200; // the replay's default pace

type SpanPlayback = ReturnType<typeof useSpanPlayback>;

/** Keys the step shortcuts must leave alone: typing, dialogs, and widgets with arrow keys of their own. */
function stepKeyIgnored(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return true;
  if (target.closest('[role="dialog"],[role="tablist"],[role="separator"],[role="listbox"],[role="combobox"],[role="menu"]')) {
    return true;
  }
  return event.key === " " && target.tagName === "BUTTON"; // Space presses the focused button
}

/**
 * Walks this execution's node spans in time order by selecting them, so the
 * timeline, graph and inspector all follow. It stops on the last node.
 */
function useSpanPlayback(
  traceId: string,
  spans: ApiSpan[],
  selected: ApiSpan | undefined,
  enabled: boolean,
  select: (spanId: string) => void
) {
  // Tied to the trace: moving to another execution ends playback by itself.
  const [playingTrace, setPlayingTrace] = useState<string | null>(null);
  const playing = playingTrace === traceId;
  const setPlaying = (on: boolean) => setPlayingTrace(on ? traceId : null);
  const runs = spans.filter((s) => s.nodeId).sort((a, b) => nsDiff(a.startNs, b.startNs));
  const position = runs.findIndex((s) => s.spanId === selected?.spanId);
  // From a span outside the graph, the nearest node run on that side of it.
  const neighbour = (direction: -1 | 1): ApiSpan | undefined => {
    if (position >= 0) return runs[position + direction];
    if (!selected) return direction > 0 ? runs[0] : undefined;
    return direction > 0
      ? runs.find((s) => nsDiff(s.startNs, selected.startNs) >= 0)
      : [...runs].reverse().find((s) => nsDiff(s.startNs, selected.startNs) < 0);
  };
  const previous = neighbour(-1);
  const next = neighbour(1);
  const nextId = next?.spanId;

  // `select` is a new function every render (and live data re-renders the
  // page every few seconds): read through an effect event, so a refetch
  // doesn't restart the step timer and make playback stutter.
  const advance = useEffectEvent((spanId: string | undefined) => {
    if (spanId) select(spanId);
    else setPlayingTrace(null);
  });
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => advance(nextId), PLAYBACK_STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, nextId]);

  const step = (span: ApiSpan | undefined) => {
    setPlaying(false);
    if (span) select(span.spanId);
  };
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!next && runs[0]) select(runs[0].spanId); // at the end: from the top
    setPlaying(true);
  };

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (stepKeyIgnored(event)) return;
      if (event.key === "ArrowLeft") step(previous);
      else if (event.key === "ArrowRight") step(next);
      else if (event.key === " ") togglePlay();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return {
    playing: playing && enabled,
    hasSteps: runs.length > 0,
    canGoBack: previous !== undefined,
    canGoForward: next !== undefined,
    stepBack: () => step(previous),
    stepForward: () => step(next),
    togglePlay,
    pause: () => setPlaying(false),
  };
}

function PlaybackButtons({ playback }: { playback: SpanPlayback }) {
  const button = (label: string, onClick: () => void, disabled: boolean, icon: React.ReactNode) => (
    <Tooltip title={disabled ? "" : label}>
      <span>
        <IconButton size="small" onClick={onClick} disabled={disabled} aria-label={label}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
  return (
    <Box sx={{ display: "flex", alignItems: "center", flex: "none" }}>
      {button("Previous step (←)", playback.stepBack, !playback.canGoBack, <SkipPreviousIcon fontSize="small" />)}
      {button(
        playback.playing ? "Pause (Space)" : "Play this execution (Space)",
        playback.togglePlay,
        false,
        playback.playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />
      )}
      {button("Next step (→)", playback.stepForward, !playback.canGoForward, <SkipNextIcon fontSize="small" />)}
    </Box>
  );
}

/** Docked on top of the graph, so the toggle and what it opens read as one. */
function GraphStrip({
  span,
  detail,
  open,
  onToggle,
  controls,
}: {
  span: ApiSpan;
  detail: ApiTraceDetail;
  open: boolean;
  onToggle: () => void;
  controls: React.ReactNode;
}) {
  const { trace } = detail;
  return (
    <Box
      sx={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.5,
        py: 0.75,
        borderBottom: 1,
        borderColor: open ? "secondary.main" : "divider",
      }}
    >
      <Typography component="div" sx={{ fontSize: 13, flex: 1, minWidth: 0 }}>
        {span.nodeId ? (
          <>
            Node <b>{span.nodeId}</b>
          </>
        ) : span.spanId === trace.rootSpanId ? (
          "Workflow execution"
        ) : (
          "Not a graph node"
        )}
        {/* The conversation is in the crumbs and the facts row already. */}
        <Box sx={{ fontSize: 11.5, color: "text.secondary" }}>{graphSource(trace.flags)}</Box>
      </Typography>
      {controls}
      <Button
        size="small"
        variant="outlined"
        color="secondary"
        startIcon={<AccountTreeOutlinedIcon />}
        onClick={onToggle}
        aria-expanded={open}
        sx={{ whiteSpace: "nowrap", flex: "none" }}
      >
        {open ? "Hide graph" : "Show graph"}
      </Button>
    </Box>
  );
}

/** Strip, optional graph and inspector, with a draggable divider under the graph. */
function GraphAndInspector({
  strip,
  graph,
  inspector,
}: {
  strip: React.ReactNode;
  graph: React.ReactNode;
  inspector: React.ReactNode;
}) {
  const [height, setHeight] = useState(readGraphHeight);
  const container = useRef<HTMLDivElement>(null);
  const graphBox = useRef<HTMLDivElement>(null);

  const clamp = (value: number) => {
    const total = container.current?.getBoundingClientRect().height ?? 0;
    const above = graphBox.current?.offsetTop ?? 0; // the strip
    return Math.max(GRAPH_HEIGHT_MIN, Math.min(total - above - INSPECTOR_HEIGHT_MIN, value));
  };
  const save = (value: number) => {
    setHeight(value);
    try {
      window.localStorage.setItem(GRAPH_HEIGHT_KEY, String(value));
    } catch {
      // storage unavailable (private mode): the height just isn't remembered
    }
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    let next = height;
    const move = (e: PointerEvent) => {
      next = clamp(height + e.clientY - startY);
      // Straight to the DOM: no re-render of the graph on every pointer move.
      if (graphBox.current) graphBox.current.style.height = `${next}px`;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      if (graphBox.current) graphBox.current.style.height = "";
      save(Math.round(next));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  return (
    <Box
      ref={container}
      sx={{
        // Filling the card exactly, so only the inspector scrolls under the graph.
        position: { md: "absolute" },
        inset: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {strip}
      {graph && (
        <>
          <Box ref={graphBox} sx={{ flex: "none", height: { xs: 260, md: height }, minHeight: 0 }}>
            {graph}
          </Box>
          <Box
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize graph"
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={startDrag}
            onDoubleClick={() => save(GRAPH_HEIGHT_DEFAULT)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              save(clamp(height + (e.key === "ArrowDown" ? 32 : -32)));
            }}
            sx={{
              flex: "none",
              height: 6,
              display: { xs: "none", md: "block" },
              cursor: "row-resize",
              touchAction: "none",
              borderTop: 1,
              borderColor: "divider",
              outline: "none",
              "&:hover, &:focus-visible": { borderColor: "primary.main" },
            }}
          />
        </>
      )}
      <Box sx={{ flex: { md: 1 }, minHeight: 0, overflow: { md: "auto" } }}>{inspector}</Box>
    </Box>
  );
}

// --- span timeline -----------------------------------------------------------

function SpanTimeline({
  rows,
  detail,
  accents,
  selectedId,
  onSelect,
}: {
  rows: Row[];
  detail: ApiTraceDetail;
  accents: Map<string, string>;
  selectedId?: string;
  onSelect: (spanId: string) => void;
}) {
  const { trace } = detail;
  // Stepping or playing can move the selection past the visible rows.
  const selectedRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  const total = Math.max(1, Number(trace.durationNs));
  const pct = (ns: string) => (nsDiff(ns, trace.startNs) / total) * 100;
  const logsBySpan = new Map<string, ApiLog[]>();
  for (const log of detail.logs) {
    if (!log.spanId) continue;
    logsBySpan.set(log.spanId, [...(logsBySpan.get(log.spanId) ?? []), log]);
  }
  const grid = "minmax(110px, 40%) minmax(0, 1fr) 64px";
  return (
    <Box sx={{ minWidth: 360 }}>
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          bgcolor: "background.paper",
          display: "grid",
          gridTemplateColumns: grid,
          borderBottom: 1,
          borderColor: "divider",
          fontSize: 11,
          color: "text.secondary",
          height: 28,
          alignItems: "end",
        }}
      >
        <Box sx={{ pl: 5, pb: 0.5 }}>Span</Box>
        {/* Ruler: same box as the bars (8px side margin), marks on every grid line. */}
        <Box sx={{ position: "relative", mx: 1, height: "100%" }}>
          {[0, 25, 50, 75, 100].map((p) => (
            <Box key={p} sx={{ position: "absolute", bottom: 0, left: `${p}%`, width: "1px", height: 5, bgcolor: "text.disabled" }} />
          ))}
          {[
            [0, "0", "none"],
            [50, formatNsDuration(total / 2), "translateX(-50%)"],
            [100, formatNsDuration(total), "translateX(-100%)"],
          ].map(([p, label, transform]) => (
            <Box
              key={p}
              sx={{ position: "absolute", top: 4, left: `${p}%`, transform, fontFamily: MONO, whiteSpace: "nowrap" }}
            >
              {label}
            </Box>
          ))}
        </Box>
        <Box sx={{ textAlign: "right", pr: 1.5, pb: 0.5 }}>Dur.</Box>
      </Box>
      {rows.map(({ span, depth }) => {
        const selected = span.spanId === selectedId;
        const color = spanColor(span, accents);
        const isRoot = span.spanId === trace.rootSpanId;
        return (
          <Box
            key={span.spanId}
            ref={selected ? selectedRow : undefined}
            onClick={() => onSelect(span.spanId)}
            sx={{
              scrollMarginTop: "32px", // clear of the sticky header row
              display: "grid",
              gridTemplateColumns: grid,
              alignItems: "center",
              minHeight: 30,
              cursor: "pointer",
              bgcolor: selected ? "action.selected" : undefined,
              "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, pl: `${10 + depth * 14}px`, pr: 1, overflow: "hidden" }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flex: "none" }} />
              <Typography noWrap title={span.name} sx={{ fontSize: 13 }}>
                {span.name}
              </Typography>
              {isRoot && (
                <Tooltip
                  title={
                    span.parentSpanId
                      ? "Its parent is in another service or not imported. The trace is named after this span."
                      : "The trace has no name of its own: it is named after this span"
                  }
                >
                  <Chip label={span.parentSpanId ? "local root" : "root"} size="small" variant="outlined" sx={{ height: 17, fontSize: 10 }} />
                </Tooltip>
              )}
              {span.nodeId && (
                <Chip label="node" size="small" color="secondary" variant="outlined" sx={{ height: 17, fontSize: 10 }} />
              )}
            </Box>
            <Box sx={{ position: "relative", height: 30, mx: 1 }}>
              {[25, 50, 75].map((p) => (
                <Box key={p} sx={{ position: "absolute", top: 0, bottom: 0, left: `${p}%`, width: "1px", bgcolor: "divider" }} />
              ))}
              <Box
                sx={{
                  position: "absolute",
                  top: 9,
                  height: 12,
                  borderRadius: 0.75,
                  left: `${pct(span.startNs)}%`,
                  width: `${Math.max(0.3, (nsDiff(span.endNs, span.startNs) / total) * 100)}%`,
                  bgcolor: color,
                  opacity: selected ? 1 : 0.75,
                  outline: span.statusCode === 2 ? 1.5 : 0,
                  outlineColor: "error.main",
                  outlineStyle: "solid",
                }}
              />
              {span.events.map((event, i) => (
                <Tooltip key={`e${i}`} title={`${event.name} · +${formatNsDuration(nsDiff(event.timeNs, trace.startNs))}`}>
                  <Box
                    sx={{
                      position: "absolute",
                      top: 5,
                      left: `${pct(event.timeNs)}%`,
                      width: 7,
                      height: 7,
                      transform: "translateX(-50%) rotate(45deg)",
                      bgcolor: event.name === "exception" ? "error.main" : "text.primary",
                      opacity: event.name === "exception" ? 1 : 0.6,
                    }}
                  />
                </Tooltip>
              ))}
              {(logsBySpan.get(span.spanId) ?? []).map((log) => (
                <Tooltip key={`l${log.id}`} title={`log: ${log.bodyText ?? ""}`}>
                  <Box
                    sx={{
                      position: "absolute",
                      top: 22,
                      left: `${pct(log.tsNs)}%`,
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      transform: "translateX(-50%)",
                      bgcolor:
                        log.severityNumber >= 17 ? "error.main" : log.severityNumber >= 13 ? "warning.main" : "primary.main",
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
            <Typography sx={{ fontFamily: MONO, fontSize: 11.5, color: "text.secondary", textAlign: "right", pr: 1.5 }}>
              {formatNsDuration(nsDiff(span.endNs, span.startNs))}
            </Typography>
          </Box>
        );
      })}
      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", px: 1.5, py: 1, fontSize: 11.5, color: "text.secondary" }}>
        <span>◆ span event</span>
        <span>● correlated log</span>
        {(trace.flags & TraceFlag.PARENT_OUTSIDE) !== 0 && (
          <span>
            The top span&apos;s parent isn&apos;t in the db: this trace continues from another service,
            or its root hasn&apos;t arrived yet.
          </span>
        )}
      </Box>
    </Box>
  );
}

// --- inspector ---------------------------------------------------------------

const PAYLOADS = "Payloads";
const PAYLOAD_PREFIX = "wizardflow.payload.";

const GROUPS: [string, (key: string) => boolean, string][] = [
  // What the node logged, shown without the prefix.
  [
    PAYLOADS,
    (k) => k.startsWith(PAYLOAD_PREFIX),
    "Values logged with log(id, node, label, value), shown without the wizardflow.payload. prefix.",
  ],
  [
    "WizardFlow",
    (k) => k.startsWith("wizardflow."),
    "Set by the WizardFlow SDK: message and node ids, node kind, trace name, message meta, and log_input / log_output on nodes with no GenAI equivalent.",
  ],
  [
    "GenAI",
    (k) => k.startsWith("gen_ai."),
    "OpenTelemetry GenAI conventions (gen_ai.*): model messages, token usage, model parameters, tool calls, retrieval. Set by log_input / log_output / log_usage / log_model_parameters, or by any GenAI instrumentation.",
  ],
  [
    "OpenInference",
    (k) => ["openinference.", "llm.", "input.", "output.", "tool."].some((p) => k.startsWith(p)),
    "Attributes from OpenInference instrumentation (Arize Phoenix): llm.*, input.*, output.*, tool.*.",
  ],
  ["Other", () => true, "Everything else on the span, such as HTTP or database attributes from other instrumentation."],
];
const GROUP_HELP = new Map(GROUPS.map(([name, , help]) => [name, help]));
const MESSAGE_KEYS = ["gen_ai.input.messages", "gen_ai.output.messages"];

/** [full key, key as shown, value]: pins always refer to the full key. */
type Entry = [string, string, unknown];

/**
 * The Attributes tab, top to bottom: pinned keys (in pin order), the prefix
 * groups, then the hidden keys collapsed. Pins and hidden keys come from
 * Settings → Display; a trailing * matches a prefix.
 */
function layoutAttributes(
  attributes: Attributes,
  prefs: DisplayPrefs
): { pinned: Entry[]; groups: [string, Entry[]][]; hidden: Entry[] } {
  const all = Object.entries(attributes);
  const pinned: Entry[] = [];
  for (const pattern of prefs.pins) {
    for (const [key, value] of all) {
      if (keyMatches(key, pattern) && !pinned.some(([k]) => k === key)) pinned.push([key, key, value]);
    }
  }
  const isPinned = (key: string) => pinned.some(([k]) => k === key);
  const hidden: Entry[] = [];
  const groups = new Map<string, Entry[]>();
  for (const [key, value] of all) {
    if (isPinned(key)) continue;
    if (prefs.hidden.some((pattern) => keyMatches(key, pattern))) {
      hidden.push([key, key, value]);
      continue;
    }
    if (MESSAGE_KEYS.includes(key)) continue;
    // `<payload>.encoding` only tells the importer the payload is JSON, which
    // the value shows anyway.
    if (isEncodingMarker(key, attributes)) continue;
    const [name] = GROUPS.find(([, match]) => match(key))!;
    const shown = name === PAYLOADS ? key.slice(PAYLOAD_PREFIX.length) : key;
    groups.set(name, [...(groups.get(name) ?? []), [key, shown, value]]);
  }
  const order = (list: Entry[]) =>
    prefs.attrOrder === "az" ? [...list].sort((a, b) => a[1].localeCompare(b[1])) : list;
  return {
    pinned,
    groups: GROUPS.map(([name]) => [name, order(groups.get(name) ?? [])] as [string, Entry[]]).filter(
      ([, list]) => list.length > 0
    ),
    hidden: order(hidden),
  };
}

function isEncodingMarker(key: string, attributes: Attributes): boolean {
  return (
    key.startsWith(PAYLOAD_PREFIX) &&
    key.endsWith(".encoding") &&
    key.slice(0, -".encoding".length) in attributes
  );
}

function PinButton({ attributeKey, pins }: { attributeKey: string; pins: string[] }) {
  const exact = pins.includes(attributeKey);
  const viaPrefix = !exact && pins.some((pattern) => keyMatches(attributeKey, pattern));
  if (viaPrefix) {
    return (
      <Tooltip title="Pinned by a prefix rule; edit it in Settings → Display">
        <PushPinIcon sx={{ fontSize: 14, color: "text.disabled", mt: 0.25 }} />
      </Tooltip>
    );
  }
  return (
    <Tooltip title={exact ? "Unpin" : "Pin to the top for every span"}>
      <IconButton
        size="small"
        aria-label={`${exact ? "Unpin" : "Pin"} ${attributeKey}`}
        onClick={() =>
          setDisplayPrefs({ pins: exact ? pins.filter((p) => p !== attributeKey) : [...pins, attributeKey] })
        }
        sx={{
          p: 0.25,
          alignSelf: "start",
          color: exact ? "secondary.main" : "text.disabled",
          opacity: exact ? 1 : 0,
          ".kv-row:hover &, &:focus-visible": { opacity: 1 },
        }}
      >
        {exact ? <PushPinIcon sx={{ fontSize: 14 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 14 }} />}
      </IconButton>
    </Tooltip>
  );
}

// A JSON value longer than this starts closed, showing its first few lines.
const JSON_COLLAPSE_LINES = 12;
const JSON_PREVIEW_LINES = 8;

/** A JSON object or array, one key per line; null for anything else. */
function prettyJson(value: unknown): string | null {
  let parsed = value;
  if (typeof value === "string") {
    if (!/^\s*[{[]/.test(value)) return null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null; // not JSON after all, or cut off by the content limit
    }
  }
  return parsed !== null && typeof parsed === "object" ? JSON.stringify(parsed, null, 2) : null;
}

function JsonValue({ text, label }: { text: string; label: string }) {
  // The same "Highlight keys" setting as the replay inspector's.
  const highlightKeys = useSyncExternalStore(
    subscribeInspectorHighlightKeys,
    getInspectorHighlightKeys,
    getServerInspectorHighlightKeys
  );
  const show = (json: string) => (highlightKeys ? renderWithHighlightedKeys(json) : json);
  const lines = text.split("\n");
  const collapsible = lines.length > JSON_COLLAPSE_LINES;
  const [open, setOpen] = useState(!collapsible);
  if (!collapsible) return show(text);
  const action = open ? "Collapse" : `Show all ${lines.length} lines`;
  return (
    <>
      {show(open ? text : lines.slice(0, JSON_PREVIEW_LINES).join("\n"))}
      {!open && (
        <Box sx={{ color: "text.disabled" }}>… {lines.length - JSON_PREVIEW_LINES} more lines</Box>
      )}
      <Tooltip title={action}>
        <IconButton
          size="small"
          aria-label={`${action}: ${label}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          sx={{ position: "absolute", top: 2, right: 2, p: 0.25 }}
        >
          {open ? <ExpandLessIcon sx={{ fontSize: 18 }} /> : <ExpandMoreIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Tooltip>
    </>
  );
}

function KeyValues({ entries, pins }: { entries: Entry[]; pins?: string[] }) {
  const pinnable = pins !== undefined;
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: "grid",
        gridTemplateColumns: `minmax(120px, 40%) minmax(0, 1fr)${pinnable ? " auto" : ""}`,
        gap: "2px 10px",
      }}
    >
      {entries.map(([key, shown, value]) => {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        const json = prettyJson(value);
        const long = text.length > 90;
        return (
          <Box key={key} className="kv-row" sx={{ display: "contents" }}>
            <Box component="dt" title={key} sx={{ fontFamily: MONO, fontSize: 12.5, color: "text.secondary", overflowWrap: "anywhere" }}>
              {shown}
            </Box>
            <Box
              component="dd"
              sx={{
                m: 0,
                fontFamily: MONO,
                fontSize: 12.5,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                ...(json
                  ? { position: "relative", bgcolor: "action.hover", borderRadius: 1, px: 0.75, py: 0.5 }
                  : long && { maxHeight: 140, overflow: "auto", bgcolor: "action.hover", borderRadius: 1, px: 0.75, py: 0.5 }),
              }}
            >
              {json ? <JsonValue text={json} label={key} /> : text}
            </Box>
            {pinnable && <PinButton attributeKey={key} pins={pins} />}
          </Box>
        );
      })}
    </Box>
  );
}

function Section({
  title,
  note,
  help,
  children,
}: {
  title: string;
  note?: string;
  /** Shown in a tooltip on an info icon after the title. */
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5, mb: 0.5 }}>
        {title}
        {help && (
          <Tooltip title={help} placement="top" arrow>
            <InfoOutlinedIcon
              aria-label={help}
              tabIndex={0}
              sx={{ fontSize: 13, ml: 0.5, verticalAlign: "-2px", color: "text.disabled", cursor: "help" }}
            />
          </Tooltip>
        )}
        {note && (
          <Box component="span" sx={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, ml: 1, color: "text.disabled" }}>
            {note}
          </Box>
        )}
      </Typography>
      {children}
    </Box>
  );
}

function ChatMessages({ raw }: { raw: unknown }) {
  let messages: { role?: string; parts?: { type?: string; content?: unknown }[] }[] = [];
  try {
    messages = typeof raw === "string" ? JSON.parse(raw) : (raw as typeof messages);
  } catch {
    return <KeyValues entries={[["raw", "content", raw]]} />;
  }
  // Attribute values come from any instrumentation: anything not shaped like
  // GenAI messages ([null], parts as a string, …) is shown as plain content
  // instead of crashing the page.
  const wellFormed =
    Array.isArray(messages) &&
    messages.every(
      (message) =>
        message !== null &&
        typeof message === "object" &&
        (message.role === undefined || typeof message.role === "string") &&
        (message.parts === undefined ||
          (Array.isArray(message.parts) &&
            message.parts.every((part) => part !== null && typeof part === "object")))
    );
  if (!wellFormed) return <KeyValues entries={[["raw", "content", raw]]} />;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {messages.map((message, i) => (
        <Paper
          key={i}
          variant="outlined"
          sx={{
            p: 1,
            borderRadius: 2,
            maxWidth: "92%",
            alignSelf: message.role === "assistant" ? "flex-end" : "flex-start",
            bgcolor: message.role === "assistant" ? "action.selected" : undefined,
          }}
        >
          <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "text.secondary", textTransform: "uppercase" }}>
            {message.role ?? "message"}
          </Typography>
          <Typography sx={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
            {(message.parts ?? [])
              .map((part) => (typeof part.content === "string" ? part.content : JSON.stringify(part.content)))
              .join("\n")}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}

function SpanInspector({
  span,
  detail,
  accents,
  tab,
  onTab,
}: {
  span: ApiSpan;
  detail: ApiTraceDetail;
  accents: Map<string, string>;
  tab?: string;
  onTab: (tab: string) => void;
}) {
  const logs = detail.logs.filter((log) => log.spanId === span.spanId);
  const hasMessages = MESSAGE_KEYS.some((key) => key in span.attributes);
  const tabs = [
    ["attrs", `Attributes ${Object.keys(span.attributes).length}`],
    ...(hasMessages ? [["msgs", "Messages"]] : []),
    ["events", `Events ${span.events.length}`],
    ["logs", `Logs ${logs.length}`],
    ["res", "Resource"],
  ];
  const current = tabs.some(([key]) => key === tab) ? tab! : "attrs";
  const resource = detail.resources[String(span.resourceId)];
  const model = span.attributes["gen_ai.request.model"];
  const status = ["Unset", "OK", "Error"][span.statusCode] ?? "Unset";
  const prefs = useDisplayPrefs();
  const layout = layoutAttributes(span.attributes, prefs);
  const [showHidden, setShowHidden] = useState(false);

  return (
    <Box>
      <Box sx={{ px: 2, pt: 1.5 }}>
        <Typography sx={{ fontWeight: 650, fontSize: 15, display: "flex", alignItems: "center", gap: 1 }}>
          <Box component="span" sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: spanColor(span, accents), flex: "none" }} />
          {span.name}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 12, color: "text.secondary", mt: 0.25 }}>
          <Box component="span" sx={{ color: span.statusCode === 2 ? "error.main" : span.statusCode === 1 ? "success.main" : undefined, fontWeight: span.statusCode === 2 ? 600 : 400 }}>
            {status}
            {span.statusMessage ? `: ${span.statusMessage}` : ""}
          </Box>
          <span>{KIND_NAMES[span.kind] ?? "unspecified"}</span>
          <span>{formatNsDuration(nsDiff(span.endNs, span.startNs))}</span>
          {typeof model === "string" && <span>{model}</span>}
        </Box>
      </Box>
      <Tabs
        value={current}
        onChange={(_, value: string) => onTab(value)}
        variant="scrollable"
        sx={{ px: 1, mt: 1, borderBottom: 1, borderColor: "divider", minHeight: 40 }}
      >
        {tabs.map(([key, label]) => (
          <Tab key={key} value={key} label={label} sx={{ minHeight: 40, textTransform: "none" }} />
        ))}
      </Tabs>
      <Box sx={{ p: 2 }}>
        {current === "attrs" && (
          <>
            {layout.pinned.length > 0 && (
              <Section title="Pinned" note="edit in Settings → Display">
                <KeyValues entries={layout.pinned} pins={prefs.pins} />
              </Section>
            )}
            {layout.groups.map(([name, entries]) => (
              <Section key={name} title={name} help={GROUP_HELP.get(name)}>
                <KeyValues entries={entries} pins={prefs.pins} />
              </Section>
            ))}
            {layout.hidden.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Button
                  size="small"
                  startIcon={showHidden ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                  onClick={() => setShowHidden(!showHidden)}
                  sx={{ textTransform: "none", color: "text.secondary", ml: -0.75 }}
                >
                  {layout.hidden.length} hidden
                </Button>
                {showHidden && <KeyValues entries={layout.hidden} pins={prefs.pins} />}
              </Box>
            )}
            {Object.keys(span.attributes).length === 0 && (
              <Typography sx={{ color: "text.secondary", fontSize: 13, mb: 2 }}>
                No attributes on this span. Its details may be in Events and Logs.
              </Typography>
            )}
            {span.droppedAttributesCount > 0 && (
              <Typography sx={{ color: "text.secondary", fontSize: 12, mb: 2 }}>
                {span.droppedAttributesCount} attributes were dropped by the SDK before export.
              </Typography>
            )}
            <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.5, mt: 1 }}>
              <Section title="Ids">
                <KeyValues
                  entries={[
                    ["span_id", "span_id", span.spanId],
                    ["parent_span_id", "parent_span_id", span.parentSpanId ?? "none (root)"],
                    ["trace_id", "trace_id", detail.trace.traceId],
                    ["start", "start", `${formatNsDateTime(span.startNs)} (${span.startNs} ns)`],
                  ]}
                />
              </Section>
            </Box>
          </>
        )}
        {current === "msgs" &&
          MESSAGE_KEYS.filter((key) => key in span.attributes).map((key) => (
            <Section key={key} title={key}>
              <ChatMessages raw={span.attributes[key]} />
            </Section>
          ))}
        {current === "events" &&
          (span.events.length === 0 ? (
            <Typography sx={{ color: "text.secondary", fontSize: 13 }}>
              No span events. Span events are timestamped points inside a span.
            </Typography>
          ) : (
            span.events.map((event, i) => (
              <Paper key={i} variant="outlined" sx={{ p: 1.25, mb: 1, borderRadius: 2 }}>
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 0.5 }}>
                  <SeverityChip number={event.name === "exception" ? 17 : 0} label={event.name === "exception" ? "EXC" : "EVT"} />
                  <Typography sx={{ fontWeight: 600, fontSize: 13 }}>{event.name}</Typography>
                  <Mono sx={{ fontSize: 11.5, color: "text.secondary" }}>
                    +{formatNsDuration(nsDiff(event.timeNs, span.startNs))}
                  </Mono>
                </Box>
                <KeyValues entries={Object.entries(event.attributes).map(([k, v]) => [k, k, v])} />
              </Paper>
            ))
          ))}
        {current === "logs" &&
          (logs.length === 0 ? (
            <Typography sx={{ color: "text.secondary", fontSize: 13 }}>No log records carry this span&apos;s id.</Typography>
          ) : (
            logs.map((log) => (
              <Paper key={log.id} variant="outlined" sx={{ p: 1.25, mb: 1, borderRadius: 2 }}>
                <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 0.5 }}>
                  <SeverityChip number={log.severityNumber} />
                  <Mono sx={{ fontSize: 11.5, color: "text.secondary" }}>{formatNsClock(log.tsNs)}</Mono>
                </Box>
                <Typography sx={{ fontSize: 13, mb: 0.5, whiteSpace: "pre-wrap" }}>{log.bodyText}</Typography>
                <KeyValues entries={Object.entries(log.attributes).map(([k, v]) => [k, k, v])} />
              </Paper>
            ))
          ))}
        {current === "res" && resource && (
          <Section title="resource.attributes">
            <KeyValues entries={Object.entries(resource.attributes).map(([k, v]) => [k, k, v])} />
          </Section>
        )}
      </Box>
    </Box>
  );
}
