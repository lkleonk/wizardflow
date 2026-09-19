"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import CallMadeOutlinedIcon from "@mui/icons-material/CallMadeOutlined";
import CallReceivedOutlinedIcon from "@mui/icons-material/CallReceivedOutlined";
import CloseFullscreenOutlinedIcon from "@mui/icons-material/CloseFullscreenOutlined";
import DataUsageOutlinedIcon from "@mui/icons-material/DataUsageOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInFullOutlinedIcon from "@mui/icons-material/OpenInFullOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { formatClock, formatDate, formatDuration } from "@/utils/formatTime";
import {
  getInspectorCompactView,
  getInspectorAlphabeticalTabs,
  getServerInspectorCompactView,
  getServerInspectorAlphabeticalTabs,
  getInspectorHighlightKeys,
  getServerInspectorHighlightKeys,
  getInspectorRenderNewlines,
  getServerInspectorRenderNewlines,
  setInspectorCompactView,
  setInspectorAlphabeticalTabs,
  setInspectorHighlightKeys,
  setInspectorRenderNewlines,
  subscribeInspectorCompactView,
  subscribeInspectorAlphabeticalTabs,
  subscribeInspectorHighlightKeys,
  subscribeInspectorRenderNewlines,
} from "@/utils/flowSession";

type InspectorPayload = {
  displayLabel: string;
  value: unknown;
  /** Stable WizardFlow meaning used to decorate semantic payload tabs. */
  semanticType?: string;
  /** Id of the step (node visit) that emitted this payload. */
  stepId: string;
};

export type InspectorVisit = {
  stepId: string;
  timestamp: string;
  endTimestamp?: string;
  timingMode?: "explicit" | "inferred" | "auto_closed";
  /** Secondary context derived from the ordered message steps. */
  deltaMs?: number;
  elapsedMs?: number;
};

type InspectorPanelProps = {
  selectedNodeId?: string;
  selectedNodeLabel?: string;
  /** Optional dev-provided node description, shown behind an info icon. */
  selectedNodeDescription?: string;
  payloads: InspectorPayload[];
  /** Every execution of the selected node in replay order, including empty ones. */
  visits: InspectorVisit[];
  /**
   * Step id of the node's "current visit" — the latest visit at or before the
   * playhead. The active tab auto-follows it and, when the node was visited more
   * than once, the other visits' tabs are dimmed — so replaying a revisited node
   * surfaces that visit's logs instead of freezing on the first visit.
   */
  currentVisitStepId?: string;
  /**
   * Whether the selected message visits this node at all. Picks which of the
   * two empty states to show: a node that ran and logged nothing says so,
   * while one that took no part in this message gets the plainer line. The
   * distinction matters once a selection is carried across messages to
   * compare one node's turns.
   */
  visitedInMessage?: boolean;
  /**
   * Whether the panel is shown maximized (fullscreen dialog) rather than as
   * the side panel. Toggled by the header button; omitted callback hides it.
   */
  maximized?: boolean;
  onMaximizedChange?: (maximized: boolean) => void;
  /**
   * One-shot request to select a specific payload tab (index into `payloads`),
   * e.g. from a search-result jump. `seq` distinguishes repeated requests for
   * the same index; the request only applies when `seq` changes.
   */
  focusPayload?: { index: number; seq: number };
  /** Selected tab retained by the panel frame across docked/fullscreen remounts. */
  selectedPayload?: { contextKey: string; index: number };
  onSelectedPayloadChange?: (selection: {
    contextKey: string;
    index: number;
  }) => void;
};

// A payload value is either already structured (an object/array, always safe
// to key-highlight or render compactly) or a string that may itself be JSON
// text (as SDKs commonly log `llm_output`) — parsed on a best-effort basis so
// plain prose replies fall back to plain text untouched by any display
// setting below.
type DisplayContent =
  | { kind: "structured"; parsed: unknown }
  | { kind: "plain"; text: string };

function getDisplayContent(value: unknown): DisplayContent {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== null && typeof parsed === "object") {
        return { kind: "structured", parsed };
      }
    } catch {
      // Not JSON — render as plain text below.
    }
    return { kind: "plain", text: value };
  }
  return { kind: "structured", parsed: value };
}

// JSON.stringify escapes a real newline inside a string value as the two
// literal characters `\` + `n`, so a multi-line prompt logged as part of a
// structured payload (e.g. `llm_input: { prompt, msg }`) displays as one flat
// line unless those are turned back into real line breaks.
function renderNewlineEscapes(text: string): string {
  return text.replace(/\\n/g, "\n");
}

// Matches a JSON string token immediately followed by a colon, i.e. an object
// key — not a string value. `\\.` absorbs escaped characters (including `\"`)
// so it can't be fooled by quotes nested inside a value string.
const JSON_KEY_PATTERN = /"(?:[^"\\]|\\.)*"(?=\s*:)/g;

function renderWithHighlightedKeys(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  JSON_KEY_PATTERN.lastIndex = 0;
  while ((match = JSON_KEY_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <Box key={match.index} component="span" sx={{ color: "primary.main" }}>
        {match[0]}
      </Box>
    );
    lastIndex = match.index + match[0].length;
  }
  parts.push(text.slice(lastIndex));
  return parts;
}

function formatScalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return typeof value === "string" ? value : String(value);
}

type SemanticTabDecoration = {
  icon: React.ReactNode;
  title: string;
};

/**
 * Semantic payloads keep their developer-facing label, but get a small visual
 * cue so they can be distinguished from arbitrary log payloads at a glance.
 * Unknown semantic types intentionally remain text-only: the file format can
 * grow without making the inspector guess at a new meaning.
 */
function getSemanticTabDecoration(
  semanticType?: string
): SemanticTabDecoration | undefined {
  switch (semanticType?.trim().toLowerCase()) {
    case "input":
      return {
        icon: <CallReceivedOutlinedIcon sx={{ fontSize: 15 }} />,
        title: "Input value",
      };
    case "output":
      return {
        icon: <CallMadeOutlinedIcon sx={{ fontSize: 15 }} />,
        title: "Output value",
      };
    case "usage":
      return {
        icon: <DataUsageOutlinedIcon sx={{ fontSize: 15 }} />,
        title: "Token usage",
      };
    case "model_parameters":
      return {
        icon: <TuneOutlinedIcon sx={{ fontSize: 15 }} />,
        title: "Model parameters",
      };
    default:
      return undefined;
  }
}

function intervalMs(start: string, end?: string): number | undefined {
  if (!end) return undefined;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return undefined;
  }
  return endMs - startMs;
}

function formatInterval(ms: number): string {
  return formatDuration(ms).replace(/^\+/, "");
}

function ExecutionTiming({
  visit,
  visitNumber,
  visitCount,
}: {
  visit?: InspectorVisit;
  visitNumber: number;
  visitCount: number;
}) {
  if (!visit) return null;

  const duration = intervalMs(visit.timestamp, visit.endTimestamp);
  const detail = (
    <Box sx={{ minWidth: 210 }}>
      <Typography
        variant="caption"
        component="div"
        sx={{ fontWeight: 700, mb: 0.5 }}
      >
        Execution timing
      </Typography>
      <Typography variant="caption" component="div">
        Date: {formatDate(visit.timestamp)}
      </Typography>
      <Typography variant="caption" component="div">
        Started: {formatClock(visit.timestamp)}
      </Typography>
      <Typography variant="caption" component="div">
        Ended: {visit.endTimestamp ? formatClock(visit.endTimestamp) : "—"}
      </Typography>
      <Typography variant="caption" component="div">
        Duration: {duration !== undefined ? formatInterval(duration) : "—"}
      </Typography>
      <Typography variant="caption" component="div">
        Since previous node start:{" "}
        {visit.deltaMs !== undefined ? formatInterval(visit.deltaMs) : "—"}
      </Typography>
      <Typography variant="caption" component="div">
        Since message start:{" "}
        {visit.elapsedMs !== undefined ? formatInterval(visit.elapsedMs) : "—"}
      </Typography>
    </Box>
  );

  return (
    <Box
      sx={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 1.25,
        py: 0.75,
        color: "text.secondary",
      }}
    >
      <Tooltip title={detail} placement="bottom" arrow>
        <Box
          component="span"
          role="img"
          aria-label="Execution timing details"
          tabIndex={0}
          sx={{ display: "inline-flex", flexShrink: 0 }}
        >
          <AccessTimeIcon sx={{ fontSize: 15 }} />
        </Box>
      </Tooltip>
      <Box sx={{ minWidth: 0, fontVariantNumeric: "tabular-nums" }}>
        <Typography variant="caption" component="div" sx={{ lineHeight: 1.35 }}>
          Visit {visitNumber} of {visitCount}
        </Typography>
        <Typography
          variant="caption"
          component="div"
          sx={{ lineHeight: 1.35, overflowWrap: "anywhere" }}
        >
          {formatClock(visit.timestamp)} →{" "}
          {visit.endTimestamp ? formatClock(visit.endTimestamp) : "—"}
          {duration !== undefined ? ` · ${formatInterval(duration)}` : ""}
        </Typography>
      </Box>
    </Box>
  );
}

// Renders a parsed value as an indented `key: value` tree with no braces,
// brackets, or quoted keys/strings — closer to YAML than JSON. Operates on
// the already-parsed value (not stringified text), so nested multi-line
// strings keep their real line breaks with no escaping involved — the
// bracket-free view sidesteps the whole `\n`-escaping problem rather than
// needing to also respect that setting. `path` gives every node a stable,
// unique React key without a mutable counter.
function renderCompact(
  value: unknown,
  indent: number,
  highlightKeys: boolean,
  path: string
): React.ReactNode[] {
  const pad = "  ".repeat(indent);
  const nodes: React.ReactNode[] = [];

  const renderKey = (key: string, keyPath: string): React.ReactNode =>
    highlightKeys ? (
      <Box key={keyPath} component="span" sx={{ color: "primary.main" }}>
        {key}
      </Box>
    ) : (
      key
    );

  if (Array.isArray(value)) {
    if (value.length === 0) {
      nodes.push(`${pad}(empty list)\n`);
      return nodes;
    }
    value.forEach((item, i) => {
      const itemPath = `${path}[${i}]`;
      if (item !== null && typeof item === "object") {
        nodes.push(`${pad}-\n`);
        nodes.push(...renderCompact(item, indent + 1, highlightKeys, itemPath));
      } else {
        nodes.push(`${pad}- ${formatScalar(item)}\n`);
      }
    });
    return nodes;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      nodes.push(`${pad}(empty)\n`);
      return nodes;
    }
    entries.forEach(([key, v]) => {
      const keyPath = `${path}.${key}`;
      if (v !== null && typeof v === "object") {
        nodes.push(pad, renderKey(key, keyPath), ":\n");
        nodes.push(...renderCompact(v, indent + 1, highlightKeys, keyPath));
      } else {
        nodes.push(pad, renderKey(key, keyPath), `: ${formatScalar(v)}\n`);
      }
    });
    return nodes;
  }

  nodes.push(`${pad}${formatScalar(value)}\n`);
  return nodes;
}

export default function InspectorPanel({
  selectedNodeId,
  selectedNodeLabel,
  selectedNodeDescription,
  payloads,
  visits,
  currentVisitStepId,
  visitedInMessage = true,
  maximized,
  onMaximizedChange,
  focusPayload,
  selectedPayload,
  onSelectedPayloadChange,
}: InspectorPanelProps) {
  const resetKey = `${selectedNodeId}:${currentVisitStepId}`;

  // Maximizing swaps the docked panel for the fullscreen instance. Restore the
  // shared selection when it belongs to this node visit; otherwise initialize
  // to the current visit's first payload as before.
  const [tab, setTab] = useState(() => {
    if (selectedPayload?.contextKey === resetKey) return selectedPayload.index;
    const firstOfVisit = payloads.findIndex((p) => p.stepId === currentVisitStepId);
    return firstOfVisit;
  });
  const highlightKeys = useSyncExternalStore(
    subscribeInspectorHighlightKeys,
    getInspectorHighlightKeys,
    getServerInspectorHighlightKeys
  );
  const renderNewlines = useSyncExternalStore(
    subscribeInspectorRenderNewlines,
    getInspectorRenderNewlines,
    getServerInspectorRenderNewlines
  );
  const compactView = useSyncExternalStore(
    subscribeInspectorCompactView,
    getInspectorCompactView,
    getServerInspectorCompactView
  );
  const alphabeticalTabs = useSyncExternalStore(
    subscribeInspectorAlphabeticalTabs,
    getInspectorAlphabeticalTabs,
    getServerInspectorAlphabeticalTabs
  );

  // Keep node visits in replay order and only sort payloads inside each visit.
  // The original index remains the tab value so search jumps and retained
  // selections continue to address the same payload regardless of display order.
  const displayedPayloads = useMemo(() => {
    const indexed = payloads.map((payload, index) => ({ payload, index }));
    if (!alphabeticalTabs) return indexed;

    const visitOrder = new Map<string, number>();
    indexed.forEach(({ payload }) => {
      if (!visitOrder.has(payload.stepId)) {
        visitOrder.set(payload.stepId, visitOrder.size);
      }
    });

    return indexed.sort((a, b) => {
      const visitDelta =
        (visitOrder.get(a.payload.stepId) ?? 0) -
        (visitOrder.get(b.payload.stepId) ?? 0);
      if (visitDelta !== 0) return visitDelta;
      return (
        a.payload.displayLabel.localeCompare(b.payload.displayLabel, undefined, {
          sensitivity: "base",
          numeric: true,
        }) || a.index - b.index
      );
    });
  }, [alphabeticalTabs, payloads]);

  // Move the active tab to the current visit whenever the selection or that
  // visit changes — so replaying a revisited node lands on the newer log
  // (`node_input_2`) rather than the first visit, and a manual tab click sticks
  // until the playhead crosses into a different visit. Keyed on the visit's step
  // id (not payload count, which is identical across visits of the same node).
  // Done during render (tracking the previous key) rather than in an effect, per
  // React guidance — the rendered index is still clamped below as a safety net.
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    const firstOfVisit = payloads.findIndex((p) => p.stepId === currentVisitStepId);
    setTab(firstOfVisit);
  }

  // An explicit tab request (search jump) — applied after the visit reset
  // above so it wins when both fire in the same render (a jump changes the
  // selection too). Initialized to the current seq so a remount (maximize
  // toggle) doesn't replay a stale request.
  const [lastFocusSeq, setLastFocusSeq] = useState(focusPayload?.seq);
  if (focusPayload && focusPayload.seq !== lastFocusSeq) {
    setLastFocusSeq(focusPayload.seq);
    if (focusPayload.index >= 0 && focusPayload.index < payloads.length) {
      setTab(focusPayload.index);
    }
  }

  // Keep the selection above the two mutually exclusive panel instances so a
  // maximize/restore remount cannot reset it. The context key prevents a tab
  // index from one node visit leaking into another.
  useEffect(() => {
    onSelectedPayloadChange?.({ contextKey: resetKey, index: tab });
  }, [onSelectedPayloadChange, resetKey, tab]);

  if (!selectedNodeId) {
    // Maximized, this hint is a fullscreen dialog — keep a visible way back
    // besides Esc. The plain side panel stays chrome-free.
    return (
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {maximized && onMaximizedChange ? (
          <Box sx={{ px: 2, pt: 1.5, display: "flex", justifyContent: "flex-end" }}>
            <Tooltip title="Restore inspector" placement="bottom">
              <IconButton
                size="small"
                onClick={() => onMaximizedChange(false)}
                aria-label="Restore inspector"
                sx={{ color: "text.secondary" }}
              >
                <CloseFullscreenOutlinedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : null}
        <CenteredHint>Select a node to inspect its payloads.</CenteredHint>
      </Box>
    );
  }

  const activeIndex = tab >= 0 && tab < payloads.length ? tab : -1;
  const active = activeIndex >= 0 ? payloads[activeIndex] : undefined;
  const selectedVisitStepId = active?.stepId ?? currentVisitStepId;
  const selectedVisitIndex = visits.findIndex(
    (visit) => visit.stepId === selectedVisitStepId
  );
  const selectedVisit =
    selectedVisitIndex >= 0 ? visits[selectedVisitIndex] : undefined;

  // The header (node name + information icon, + the display
  // settings gear once there's something to configure) renders for every
  // selected node — including one with no payloads, so a described node's
  // info stays reachable even when it logged nothing. The label takes the
  // flexible space so the icons stay pinned to the right edge.
  const header = (
    <Box sx={{ px: 2, pt: 1.5, display: "flex", alignItems: "center", gap: 0.25 }}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: "block", overflowWrap: "anywhere", lineHeight: 1.4, flex: 1, minWidth: 0 }}
      >
        {selectedNodeLabel ?? selectedNodeId}
      </Typography>
      {selectedNodeDescription || selectedVisit ? (
        <NodeInfo
          description={selectedNodeDescription}
          timingMode={selectedVisit?.timingMode}
          hasVisit={Boolean(selectedVisit)}
        />
      ) : null}
      {payloads.length > 0 ? (
        <DisplaySettingsButton
          highlightKeys={highlightKeys}
          onHighlightKeysChange={setInspectorHighlightKeys}
          renderNewlines={renderNewlines}
          onRenderNewlinesChange={setInspectorRenderNewlines}
          compactView={compactView}
          onCompactViewChange={setInspectorCompactView}
          alphabeticalTabs={alphabeticalTabs}
          onAlphabeticalTabsChange={setInspectorAlphabeticalTabs}
        />
      ) : null}
      {onMaximizedChange ? (
        <Tooltip
          title={maximized ? "Restore inspector" : "Maximize inspector"}
          placement="bottom"
        >
          <IconButton
            size="small"
            onClick={() => onMaximizedChange(!maximized)}
            aria-label={maximized ? "Restore inspector" : "Maximize inspector"}
            sx={{ color: "text.secondary", flexShrink: 0 }}
          >
            {maximized ? (
              <CloseFullscreenOutlinedIcon sx={{ fontSize: 16 }} />
            ) : (
              <OpenInFullOutlinedIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );

  const timing = (
    <ExecutionTiming
      visit={selectedVisit}
      visitNumber={selectedVisitIndex + 1}
      visitCount={visits.length}
    />
  );

  if (payloads.length === 0) {
    return (
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {header}
        {timing}
        <CenteredHint>
          {visitedInMessage
            ? "Node ran, but no payload was logged."
            : "No payloads logged for this node."}
        </CenteredHint>
      </Box>
    );
  }

  // Only dim payload tabs when this node has more than one execution. Empty
  // visits count too, because timing is attached to the execution itself.
  const multipleVisits = visits.length > 1;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {header}
      {timing}
      <Tabs
        value={activeIndex >= 0 ? activeIndex : false}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          minHeight: 40,
          borderBottom: 1,
          borderColor: "divider",
          // A disabled scroll button (e.g. the left arrow before any scrolling
          // has happened) still reserves its full width by default, leaving a
          // dead gap before the first tab. Collapse it to 0 so the tab list
          // reclaims that space until scrolling that direction is possible.
          "& .MuiTabs-scrollButtons.Mui-disabled": {
            width: 0,
            opacity: 0,
          },
        }}
      >
        {displayedPayloads.map(({ payload: p, index }) => {
          // Fade the tabs from other visits so the visit you're viewing stands
          // out. Anchored to the *selected* tab's visit, not the playhead — so
          // clicking an earlier visit's payload re-groups around it rather than
          // leaving its siblings dimmed. Skipped for single-visit nodes.
          const muted = multipleVisits && p.stepId !== selectedVisitStepId;
          const semanticTab = getSemanticTabDecoration(p.semanticType);
          return (
            <Tab
              key={p.displayLabel}
              value={index}
              label={
                semanticTab ? (
                  <Box
                    component="span"
                    sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
                  >
                    <Tooltip title={semanticTab.title} placement="top">
                      <Box
                        component="span"
                        aria-hidden="true"
                        sx={{ display: "inline-flex" }}
                      >
                        {semanticTab.icon}
                      </Box>
                    </Tooltip>
                    <span>{p.displayLabel}</span>
                  </Box>
                ) : (
                  p.displayLabel
                )
              }
              sx={{
                minHeight: 40,
                textTransform: "none",
                transition: "opacity 200ms",
                opacity: muted ? 0.45 : 1,
              }}
            />
          );
        })}
      </Tabs>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {active ? (
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              flex: 1,
              overflow: "auto",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 12.5,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "text.primary",
            }}
          >
            {(() => {
              const content = getDisplayContent(active.value);
              if (content.kind === "plain") {
                return renderNewlines
                  ? renderNewlineEscapes(content.text)
                  : content.text;
              }
              if (compactView) {
                return renderCompact(content.parsed, 0, highlightKeys, "root");
              }
              const text = JSON.stringify(content.parsed, null, 2);
              const displayText = renderNewlines
                ? renderNewlineEscapes(text)
                : text;
              return highlightKeys
                ? renderWithHighlightedKeys(displayText)
                : displayText;
            })()}
          </Box>
        ) : (
          <CenteredHint>No payload was logged for this visit.</CenteredHint>
        )}
      </Box>
    </Box>
  );
}

// Same Popover-on-click affordance as NodeInfo below, for the
// payload display toggles: highlighting JSON object keys, turning `\n`
// escapes back into real line breaks, the bracket-free compact view, and tab
// sorting. All four persist per-tab (see flowSession.ts) and apply globally — to
// every payload, on every node, for the whole session — not just the one
// currently open. Highlight/newlines default on (off is the "show exact raw
// text" choice); compact view defaults off (it's the opt-in alternate view).
function DisplaySettingsButton({
  highlightKeys,
  onHighlightKeysChange,
  renderNewlines,
  onRenderNewlinesChange,
  compactView,
  onCompactViewChange,
  alphabeticalTabs,
  onAlphabeticalTabsChange,
}: {
  highlightKeys: boolean;
  onHighlightKeysChange: (value: boolean) => void;
  renderNewlines: boolean;
  onRenderNewlinesChange: (value: boolean) => void;
  compactView: boolean;
  onCompactViewChange: (value: boolean) => void;
  alphabeticalTabs: boolean;
  onAlphabeticalTabsChange: (value: boolean) => void;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  return (
    <>
      <Tooltip title="Payload display settings" placement="bottom">
        <IconButton
          size="small"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label="Payload display settings"
          sx={{ color: "text.secondary", flexShrink: 0 }}
        >
          <SettingsOutlinedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <FormGroup sx={{ p: 1.5, minWidth: 240 }}>
          <FormControlLabel
            sx={{ mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={highlightKeys}
                onChange={(e) => onHighlightKeysChange(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Highlight object keys</Typography>}
          />
          <FormControlLabel
            sx={{ mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={renderNewlines}
                onChange={(e) => onRenderNewlinesChange(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Render \n as line breaks</Typography>}
          />
          <FormControlLabel
            sx={{ mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={compactView}
                onChange={(e) => onCompactViewChange(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Hide braces &amp; brackets</Typography>}
          />
          <FormControlLabel
            sx={{ mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={alphabeticalTabs}
                onChange={(e) => onAlphabeticalTabsChange(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Sort tabs alphabetically</Typography>}
          />
        </FormGroup>
      </Popover>
    </>
  );
}

// Same affordance as the header's trace-info icon (TraceInfo.tsx): a bare info
// icon that opens a Popover on click. It keeps optional developer description
// text and the timing provenance explanation together as node information.
const TIMING_MODE_INFO = [
  ["explicit", "Explicit", "start and end were recorded directly."],
  ["inferred", "Inferred", "timing was estimated from recorded log activity."],
  [
    "auto_closed",
    "Auto-closed",
    "execution was started explicitly but closed when the message ended.",
  ],
  ["unknown", "Unknown", "the trace does not record how timing was obtained."],
] as const;

function NodeInfo({
  description,
  timingMode,
  hasVisit,
}: {
  description?: string;
  timingMode?: InspectorVisit["timingMode"];
  hasVisit: boolean;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [showTimingModes, setShowTimingModes] = useState(false);
  const currentMode = timingMode ?? "unknown";
  const currentModeLabel = TIMING_MODE_INFO.find(
    ([mode]) => mode === currentMode
  )?.[1];

  return (
    <>
      <Tooltip title="Node information" placement="bottom">
        <IconButton
          size="small"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label="Node information"
          sx={{ color: "text.secondary" }}
        >
          <InfoOutlinedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1.5, maxWidth: 320, maxHeight: "50vh", overflow: "auto" }}>
          {description ? (
            <Box>
              <Typography variant="caption" component="div" sx={{ fontWeight: 700 }}>
                Node description (provided by trace author)
              </Typography>
              <Typography
                variant="caption"
                component="div"
                sx={{ mt: 0.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {description}
              </Typography>
            </Box>
          ) : null}
          <Box
            sx={{
              mt: description ? 1.25 : 0,
              pt: description ? 1.25 : 0,
              borderTop: description ? 1 : 0,
              borderColor: "divider",
            }}
          >
            <Typography variant="caption" component="div" sx={{ fontWeight: 700 }}>
              Timing
            </Typography>
            <Button
              size="small"
              variant="text"
              onClick={() => setShowTimingModes((shown) => !shown)}
              aria-expanded={showTimingModes}
              endIcon={
                <ExpandMoreIcon
                  sx={{
                    fontSize: 16,
                    transform: showTimingModes ? "rotate(180deg)" : "none",
                    transition: "transform 150ms",
                  }}
                />
              }
              sx={{ mt: 0.4, ml: -0.75, px: 0.75, textTransform: "none" }}
            >
              {showTimingModes ? "Hide timing details" : "Inspect timing mode"}
            </Button>
            <Collapse in={showTimingModes}>
              {hasVisit ? (
                <Typography variant="caption" component="div" sx={{ mt: 0.25 }}>
                  Current visit: {currentModeLabel}
                </Typography>
              ) : null}
              <Typography variant="caption" component="div" sx={{ mt: 0.75 }}>
                Timing modes
              </Typography>
              <Box component="ul" sx={{ m: 0, mt: 0.25, pl: 2.25 }}>
                {TIMING_MODE_INFO.map(([mode, label, explanation]) => (
                  <Typography
                    key={mode}
                    component="li"
                    variant="caption"
                    sx={{ mb: 0.4, fontWeight: mode === currentMode ? 600 : 400 }}
                  >
                    {label} — {explanation}
                  </Typography>
                ))}
              </Box>
            </Collapse>
          </Box>
        </Box>
      </Popover>
    </>
  );
}

// `height: 100%` fills the panel when the hint is the whole content (no node
// selected); `flex: 1` takes over when it sits below the header in the column
// (flex-basis wins over height for flex children).
function CenteredHint({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        height: "100%",
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
        textAlign: "center",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Box>
  );
}
