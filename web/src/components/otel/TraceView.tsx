import { useRef, useState } from "react";
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
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import { nodeColorForKind } from "@/theme/muiTheme";
import {
  TraceFlag,
  type ApiLog,
  type ApiSpan,
  type ApiTraceDetail,
  type Attributes,
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
import { goTo, otelHref, replayHref, type OtelRoute } from "@/utils/otelRoute";
import { LoadError, Loading, Mono, SeverityChip, TraceBadges, graphSource } from "./OtelBits";

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

function spanColor(span: ApiSpan): string {
  if (span.statusCode === 2) return "error.main";
  const raw = (span.nodeKind ?? "").toLowerCase();
  return nodeColorForKind(KIND_ALIASES[raw] ?? raw) ?? "text.disabled";
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
}: {
  route: OtelRoute & { project: string; trace: string };
}) {
  const { data, error, loading } = useApi<ApiTraceDetail>(
    apiPath(`traces/${encodeURIComponent(route.trace)}`, { project: route.project })
  );
  if (error) return <LoadError error={error} />;
  if (loading || !data) return <Loading />;
  return <TraceDetail detail={data} route={route} />;
}

function TraceDetail({
  detail,
  route,
}: {
  detail: ApiTraceDetail;
  route: OtelRoute & { project: string; trace: string };
}) {
  const { trace, spans } = detail;
  const rows = flattenTree(spans);
  const selected = spans.find((s) => s.spanId === route.span) ?? rows[0]?.span;
  const select = (spanId: string) => goTo({ ...route, span: spanId }, { replace: true });
  const back = otelHref(route);
  const replayable = (trace.flags & TraceFlag.WIZARDFLOW) !== 0;
  const replay = replayHref({
    project: route.project,
    traceId: trace.traceId,
    conversationId: trace.conversationId,
    name: trace.conversationId ?? trace.name,
    back,
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <TraceHeader detail={detail} />
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
        spanCount={spans.length}
        left={<SpanTimeline rows={rows} detail={detail} selectedId={selected?.spanId} onSelect={select} />}
        right={
          selected ? (
            <SpanInspector
              span={selected}
              detail={detail}
              tab={route.tab}
              onTab={(tab) => goTo({ ...route, span: selected.spanId, tab }, { replace: true })}
              replay={
                replayable && (selected.nodeId || selected.spanId === trace.rootSpanId)
                  ? replay
                  : undefined
              }
            />
          ) : null
        }
      />
    </Box>
  );
}

function TraceHeader({ detail }: { detail: ApiTraceDetail }) {
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
    <Box sx={{ px: 2, py: 1.25, display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
      <TraceBadges flags={trace.flags} />
      <Typography component="span" sx={{ fontSize: 12.5, color: "text.secondary" }}>
        trace{" "}
        <Tooltip title={copied ? "Copied" : "Click to copy"}>
          <Box
            component="button"
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
            {trace.traceId}
          </Box>
        </Tooltip>{" "}
        · named after its {localRoot ? "local root" : "root span"}
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
  );
}

// --- split pane --------------------------------------------------------------

const TREE_WIDTH_KEY = "wf-otel-tree-width";
const TREE_MIN = 180;
const INSPECTOR_MIN = 320;

function readTreeWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(TREE_WIDTH_KEY));
    return Number.isFinite(value) && value !== 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Span tree | inspector, with a draggable divider. The width is a per-browser
 * display preference; a one-span trace starts with a narrow tree, since the
 * content is in the inspector. Dragging to the far left (or ⟨) collapses the
 * tree to a strip; -1 stores "collapsed".
 */
function SplitPane({
  spanCount,
  left,
  right,
}: {
  spanCount: number;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  const [width, setWidth] = useState<number | null>(() =>
    typeof window === "undefined" ? null : readTreeWidth()
  );
  const container = useRef<HTMLDivElement>(null);
  const save = (value: number | null) => {
    setWidth(value);
    try {
      if (value === null) window.localStorage.removeItem(TREE_WIDTH_KEY);
      else window.localStorage.setItem(TREE_WIDTH_KEY, String(value));
    } catch {
      // storage unavailable (private mode): the width just isn't remembered
    }
  };
  const collapsed = width === -1;
  const treeColumn = collapsed
    ? "0px"
    : width
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
      if (Math.abs(next - startWidth) > 2) save(next < TREE_MIN - 20 ? -1 : Math.round(next));
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
        gridTemplateColumns: {
          xs: "1fr",
          md: collapsed
            ? `34px 0px 0px minmax(0, 1fr)`
            : `0px ${treeColumn} 6px minmax(${INSPECTOR_MIN}px, 1fr)`,
        },
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Box
        sx={{
          display: { xs: "none", md: collapsed ? "flex" : "none" },
          flexDirection: "column",
          alignItems: "center",
          pt: 1,
          gap: 1,
          borderRight: 1,
          borderColor: "divider",
        }}
      >
        <Tooltip title="Show the span tree">
          <IconButton size="small" onClick={() => save(null)} aria-label="Show the span tree">
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography sx={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11.5, color: "text.secondary" }}>
          {spanCount} {spanCount === 1 ? "span" : "spans"}
        </Typography>
      </Box>
      <Box
        sx={{
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
            onClick={() => save(-1)}
            aria-label="Collapse the span tree"
            sx={{ display: { xs: "none", md: "inline-flex" }, position: "absolute", top: 2, left: 2, zIndex: 2 }}
          >
            <ChevronLeftIcon fontSize="small" />
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
          display: { xs: "none", md: collapsed ? "none" : "block" },
          cursor: "col-resize",
          touchAction: "none",
          position: "relative",
          "&::after": {
            content: '""',
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 2,
            width: "1px",
            bgcolor: "divider",
          },
          "&:hover::after, &:focus-visible::after": { bgcolor: "primary.main", width: "2px" },
          outline: "none",
        }}
      />
      <Box sx={{ overflow: "auto", minWidth: 0, minHeight: 0, borderTop: { xs: 1, md: 0 }, borderColor: "divider" }}>
        {right}
      </Box>
    </Box>
  );
}

// --- span timeline -----------------------------------------------------------

function SpanTimeline({
  rows,
  detail,
  selectedId,
  onSelect,
}: {
  rows: Row[];
  detail: ApiTraceDetail;
  selectedId?: string;
  onSelect: (spanId: string) => void;
}) {
  const { trace } = detail;
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
        const color = spanColor(span);
        const isRoot = span.spanId === trace.rootSpanId;
        return (
          <Box
            key={span.spanId}
            onClick={() => onSelect(span.spanId)}
            sx={{
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
              <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: color, flex: "none" }} />
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

const GROUPS: [string, (key: string) => boolean][] = [
  ["WizardFlow payloads", (k) => k.startsWith("wizardflow.payload.")],
  ["WizardFlow", (k) => k.startsWith("wizardflow.")],
  ["GenAI", (k) => k.startsWith("gen_ai.")],
  [
    "OpenInference",
    (k) => ["openinference.", "llm.", "input.", "output.", "tool."].some((p) => k.startsWith(p)),
  ],
  ["Other", () => true],
];
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
    const [name] = GROUPS.find(([, match]) => match(key))!;
    const shown = name === "WizardFlow payloads" ? key.slice("wizardflow.payload.".length) : key;
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
                ...(long && { maxHeight: 140, overflow: "auto", bgcolor: "action.hover", borderRadius: 1, px: 0.75, py: 0.5 }),
              }}
            >
              {text}
            </Box>
            {pinnable && <PinButton attributeKey={key} pins={pins} />}
          </Box>
        );
      })}
    </Box>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5, mb: 0.5 }}>
        {title}
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
  if (!Array.isArray(messages)) return <KeyValues entries={[["raw", "content", raw]]} />;
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
  tab,
  onTab,
  replay,
}: {
  span: ApiSpan;
  detail: ApiTraceDetail;
  tab?: string;
  onTab: (tab: string) => void;
  replay?: string;
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
          <Box component="span" sx={{ width: 9, height: 9, borderRadius: 0.5, bgcolor: spanColor(span), flex: "none" }} />
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
        {replay && (
          <Paper
            variant="outlined"
            sx={{ mt: 1.5, p: 1, pl: 1.5, borderRadius: 2, display: "flex", alignItems: "center", gap: 1, borderColor: "secondary.main" }}
          >
            <Typography sx={{ fontSize: 13, flex: 1 }}>
              {span.nodeId ? (
                <>
                  Node <b>{span.nodeId}</b>
                </>
              ) : (
                "Workflow execution"
              )}
              {detail.trace.conversationId && (
                <>
                  {" · conversation "}
                  <Mono>{detail.trace.conversationId}</Mono>
                </>
              )}
              <Box component="span" sx={{ display: "block", fontSize: 11.5, color: "text.secondary" }}>
                {graphSource(detail.trace.flags)}
              </Box>
            </Typography>
            <Button size="small" variant="outlined" color="secondary" startIcon={<PlayArrowIcon />} href={replay}>
              Graph replay
            </Button>
          </Paper>
        )}
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
              <Section key={name} title={name}>
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
