"use client";

import { useState, useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
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
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { formatClock, formatDuration } from "@/utils/formatTime";
import {
  getInspectorCompactView,
  getServerInspectorCompactView,
  getInspectorHighlightKeys,
  getServerInspectorHighlightKeys,
  getInspectorRenderNewlines,
  getServerInspectorRenderNewlines,
  setInspectorCompactView,
  setInspectorHighlightKeys,
  setInspectorRenderNewlines,
  subscribeInspectorCompactView,
  subscribeInspectorHighlightKeys,
  subscribeInspectorRenderNewlines,
} from "@/utils/flowSession";

type InspectorPayload = {
  displayLabel: string;
  value: unknown;
  /** Id of the step (node visit) that emitted this payload. */
  stepId: string;
  /** ISO timestamp of the step that emitted this payload. */
  timestamp: string;
  /** Gap from the previous step; cumulative elapsed since message start. */
  deltaMs?: number;
  elapsedMs?: number;
};

type InspectorPanelProps = {
  selectedNodeId?: string;
  selectedNodeLabel?: string;
  /** Optional dev-provided node description, shown behind an info icon. */
  selectedNodeDescription?: string;
  payloads: InspectorPayload[];
  /**
   * Step id of the node's "current visit" — the latest visit at or before the
   * playhead. The active tab auto-follows it and, when the node was visited more
   * than once, the other visits' tabs are dimmed — so replaying a revisited node
   * surfaces that visit's logs instead of freezing on the first visit.
   */
  currentVisitStepId?: string;
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
  currentVisitStepId,
}: InspectorPanelProps) {
  const [tab, setTab] = useState(0);
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

  // Move the active tab to the current visit whenever the selection or that
  // visit changes — so replaying a revisited node lands on the newer log
  // (`node_input_2`) rather than the first visit, and a manual tab click sticks
  // until the playhead crosses into a different visit. Keyed on the visit's step
  // id (not payload count, which is identical across visits of the same node).
  // Done during render (tracking the previous key) rather than in an effect, per
  // React guidance — the rendered index is still clamped below as a safety net.
  const resetKey = `${selectedNodeId}:${currentVisitStepId}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    const firstOfVisit = payloads.findIndex((p) => p.stepId === currentVisitStepId);
    setTab(firstOfVisit >= 0 ? firstOfVisit : 0);
  }

  if (!selectedNodeId) {
    return (
      <CenteredHint>Select a node to inspect its payloads.</CenteredHint>
    );
  }

  // The header (node name + optional description icon, + the display
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
      {selectedNodeDescription ? (
        <NodeDescriptionInfo description={selectedNodeDescription} />
      ) : null}
      {payloads.length > 0 ? (
        <DisplaySettingsButton
          highlightKeys={highlightKeys}
          onHighlightKeysChange={setInspectorHighlightKeys}
          renderNewlines={renderNewlines}
          onRenderNewlinesChange={setInspectorRenderNewlines}
          compactView={compactView}
          onCompactViewChange={setInspectorCompactView}
        />
      ) : null}
    </Box>
  );

  if (payloads.length === 0) {
    return (
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {header}
        <CenteredHint>No payloads logged for this node.</CenteredHint>
      </Box>
    );
  }

  const activeIndex = Math.min(tab, payloads.length - 1);
  const active = payloads[activeIndex];

  // Distinct visits (steps) of this node, in replay order. Only worth
  // distinguishing a "current visit" when there's more than one — otherwise
  // every tab is that one visit and there's nothing to set apart, so the tabs
  // render plainly and no visit counter shows.
  const visitIds = [...new Set(payloads.map((p) => p.stepId))];
  const multipleVisits = visitIds.length > 1;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {header}
      <Tabs
        value={Math.min(tab, payloads.length - 1)}
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
        {payloads.map((p) => {
          // Fade the tabs from other visits so the visit you're viewing stands
          // out. Anchored to the *selected* tab's visit, not the playhead — so
          // clicking an earlier visit's payload re-groups around it rather than
          // leaving its siblings dimmed. Skipped for single-visit nodes.
          const muted = multipleVisits && p.stepId !== active.stepId;
          return (
            <Tab
              key={p.displayLabel}
              label={p.displayLabel}
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
        {/* Metadata band — clock icon + sans dim text + divider, so the
            timestamp reads as chrome rather than the first line of the log. */}
        <Box
          sx={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            px: 2,
            py: 0.75,
            borderBottom: 1,
            borderColor: "divider",
            color: "text.secondary",
          }}
        >
          <AccessTimeIcon sx={{ fontSize: 14, opacity: 0.7 }} />
          <Typography
            variant="caption"
            component="div"
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 1.25,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: 0.2,
            }}
          >
            <span>{formatClock(active.timestamp)}</span>
            <Box component="span" title="Time since previous step">
              Δ {active.deltaMs !== undefined ? formatDuration(active.deltaMs) : "—"}
            </Box>
            <Box
              component="span"
              title="Elapsed since message start"
              sx={{ color: "primary.main" }}
            >
              Σ {active.elapsedMs !== undefined ? formatDuration(active.elapsedMs) : "—"}
            </Box>
            {multipleVisits ? (
              <Box
                component="span"
                title="Which visit of this node this payload came from"
                sx={{ letterSpacing: 0 }}
              >
                visit {visitIds.indexOf(active.stepId) + 1} of {visitIds.length}
              </Box>
            ) : null}
          </Typography>
        </Box>
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
              return renderNewlines ? renderNewlineEscapes(content.text) : content.text;
            }
            if (compactView) {
              return renderCompact(content.parsed, 0, highlightKeys, "root");
            }
            const text = JSON.stringify(content.parsed, null, 2);
            const displayText = renderNewlines ? renderNewlineEscapes(text) : text;
            return highlightKeys ? renderWithHighlightedKeys(displayText) : displayText;
          })()}
        </Box>
      </Box>
    </Box>
  );
}

// Same Popover-on-click affordance as NodeDescriptionInfo below, for the
// payload display toggles: highlighting JSON object keys, turning `\n`
// escapes back into real line breaks, and the bracket-free compact view.
// All three persist per-tab (see flowSession.ts) and apply globally — to
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
}: {
  highlightKeys: boolean;
  onHighlightKeysChange: (value: boolean) => void;
  renderNewlines: boolean;
  onRenderNewlinesChange: (value: boolean) => void;
  compactView: boolean;
  onCompactViewChange: (value: boolean) => void;
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
        </FormGroup>
      </Popover>
    </>
  );
}

// Same affordance as the header's trace-info icon (TraceInfo.tsx): a bare info
// icon that opens a Popover on click — not a hover tooltip — so the description
// is never shown permanently and long text can wrap and be selected/copied.
function NodeDescriptionInfo({ description }: { description: string }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  return (
    <>
      <Tooltip title="Node description" placement="bottom">
        <IconButton
          size="small"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label="Node description"
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
          <Typography
            variant="caption"
            component="div"
            sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {description}
          </Typography>
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
