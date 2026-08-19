"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import type { AgentTraceFile, AgentTraceMessage } from "@/types/agenttrace";
import {
  getSearchDetailedResults,
  getServerSearchDetailedResults,
  setSearchDetailedResults,
  subscribeSearchDetailedResults,
} from "@/utils/flowSession";
import { messageInputText, orderedSteps } from "@/utils/traceSelectors";

/**
 * One search match, carrying everything the page needs to jump the view there:
 * the message, the step (playhead position), the node, and — for payload hits —
 * the payload's index within that node's flattened payload list (the same list
 * the inspector renders as tabs), so the matching tab can be focused.
 */
export type SearchHit = {
  messageId: string;
  /** Index into `trace.messages`, for the "#N" prefix in the result row. */
  messageIndex: number;
  kind: "payload" | "message-label" | "message-meta";
  nodeId?: string;
  /** Index into orderedSteps(message) — where to put the playhead. */
  stepIndex?: number;
  payloadIndex?: number;
  /** Where the hit was found, for the result's context line. */
  sourceLabel: string;
  snippet: { before: string; match: string; after: string };
};

// Bounds keeping the live-per-keystroke search and the result list cheap:
// enough hits to be useful, never enough to stall rendering.
const MAX_HITS = 100;
const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 60;

/**
 * Strip the line noise a JSON-stringified payload carries (`\n` and `\"`
 * escapes) and collapse whitespace, so snippets read as text rather than
 * source. Search runs over this cleaned text too — indexes must line up, and
 * matching what the user sees beats matching escape sequences.
 */
function cleanForDisplay(text: string): string {
  return text
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\s+/g, " ");
}

function makeSnippet(
  text: string,
  matchIndex: number,
  matchLength: number
): SearchHit["snippet"] {
  let start = Math.max(0, matchIndex - SNIPPET_BEFORE);
  // Don't open the snippet mid-token: advance to the next word boundary in
  // the lead-in (unless that would eat the lead-in entirely).
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < matchIndex - 10) start = space + 1;
  }
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_AFTER);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, matchIndex),
    match: text.slice(matchIndex, matchIndex + matchLength),
    after: text.slice(matchIndex + matchLength, end) + (end < text.length ? "…" : ""),
  };
}

function payloadText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Short display name for a message: dev title, else input preview, else id. */
function messageTitle(message: AgentTraceMessage): string {
  const title = message.label?.trim();
  if (title) return title;
  const preview = messageInputText(message);
  return preview || message.id;
}

/**
 * Case-insensitive substring search across the whole trace: every payload of
 * every step of every message, plus message labels and meta values. The trace
 * is already fully in memory, so this just walks it — no index needed at the
 * sizes traces reach.
 */
function searchTrace(
  trace: AgentTraceFile,
  query: string,
  nodeLabels: Map<string, string>
): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const hits: SearchHit[] = [];

  const push = (hit: SearchHit) => {
    hits.push(hit);
    return hits.length >= MAX_HITS;
  };

  for (let m = 0; m < trace.messages.length; m++) {
    const message = trace.messages[m];

    const label = cleanForDisplay(message.label ?? "");
    const labelIndex = label.toLowerCase().indexOf(needle);
    if (labelIndex >= 0) {
      if (
        push({
          messageId: message.id,
          messageIndex: m,
          kind: "message-label",
          sourceLabel: "message title",
          snippet: makeSnippet(label, labelIndex, needle.length),
        })
      ) {
        return hits;
      }
    }

    for (const [key, value] of Object.entries(message.meta ?? {})) {
      const text = cleanForDisplay(`${key}: ${String(value)}`);
      const index = text.toLowerCase().indexOf(needle);
      if (index < 0) continue;
      if (
        push({
          messageId: message.id,
          messageIndex: m,
          kind: "message-meta",
          sourceLabel: "message meta",
          snippet: makeSnippet(text, index, needle.length),
        })
      ) {
        return hits;
      }
    }

    // Flattened payload position per node, matching the order
    // getPayloadsForNode produces — that's the inspector's tab order.
    const payloadCounts = new Map<string, number>();
    const steps = orderedSteps(message);
    for (let s = 0; s < steps.length; s++) {
      const step = steps[s];
      for (const payload of step.payloads) {
        const payloadIndex = payloadCounts.get(step.nodeId) ?? 0;
        payloadCounts.set(step.nodeId, payloadIndex + 1);
        const text = cleanForDisplay(payloadText(payload.value));
        // Match against the label too — searching "llm_output" should find
        // the payloads themselves, not just prose mentioning the term.
        const inLabel = payload.label.toLowerCase().indexOf(needle);
        const index = text.toLowerCase().indexOf(needle);
        if (index < 0 && inLabel < 0) continue;
        const nodeLabel = nodeLabels.get(step.nodeId) ?? step.nodeId;
        if (
          push({
            messageId: message.id,
            messageIndex: m,
            kind: "payload",
            nodeId: step.nodeId,
            stepIndex: s,
            payloadIndex,
            sourceLabel: `${nodeLabel} · ${payload.label}`,
            snippet:
              index >= 0
                ? makeSnippet(text, index, needle.length)
                : makeSnippet(payload.label, inLabel, needle.length),
          })
        ) {
          return hits;
        }
      }
    }
  }
  return hits;
}

type SearchDialogProps = {
  open: boolean;
  onClose: () => void;
  trace: AgentTraceFile;
  onJump: (hit: SearchHit) => void;
};

export default function SearchDialog({
  open,
  onClose,
  trace,
  onJump,
}: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const detailed = useSyncExternalStore(
    subscribeSearchDetailedResults,
    getSearchDetailedResults,
    getServerSearchDetailedResults
  );

  const nodeLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of trace.graph.nodes) {
      if (node.label) map.set(node.id, node.label);
    }
    return map;
  }, [trace.graph.nodes]);

  const hits = useMemo(
    () => searchTrace(trace, query, nodeLabels),
    [trace, query, nodeLabels]
  );

  // Consecutive hits of one message rendered under a single group header, so
  // the message context appears once instead of repeating on every row.
  // Hits arrive in message order, so consecutive runs are exactly the groups.
  // Within a group, adjacent hits with the same location and identical snippet
  // (e.g. two visits of a node logging the same payload) collapse into one row
  // with a ×N count — clicking it jumps to the first occurrence.
  const groups = useMemo(() => {
    const out: {
      messageIndex: number;
      items: { hit: SearchHit; count: number }[];
    }[] = [];
    for (const hit of hits) {
      const group =
        out[out.length - 1]?.messageIndex === hit.messageIndex
          ? out[out.length - 1]
          : undefined;
      if (!group) {
        out.push({ messageIndex: hit.messageIndex, items: [{ hit, count: 1 }] });
        continue;
      }
      const prev = group.items[group.items.length - 1];
      const sameSnippet =
        prev.hit.snippet.before === hit.snippet.before &&
        prev.hit.snippet.match === hit.snippet.match &&
        prev.hit.snippet.after === hit.snippet.after;
      if (prev.hit.sourceLabel === hit.sourceLabel && sameSnippet) {
        prev.count += 1;
      } else {
        group.items.push({ hit, count: 1 });
      }
    }
    return out;
  }, [hits]);

  const jumpTo = (hit: SearchHit) => {
    onJump(hit);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      // Anchored near the top like a command palette — results grow downward
      // instead of the dialog jumping around vertically as the list changes.
      sx={{ "& .MuiDialog-container": { alignItems: "flex-start" } }}
      slotProps={{ paper: { sx: { mt: { xs: 2, sm: 8 } } } }}
    >
      <Box
        sx={{
          p: 1.5,
          pb: hits.length > 0 ? 0.5 : 1.5,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
        }}
      >
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          fullWidth
          size="small"
          placeholder="Search payloads, titles, meta…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits.length > 0) {
              e.preventDefault();
              jumpTo(hits[0]);
            }
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                </InputAdornment>
              ),
            },
          }}
        />
        {/* Same unfold toggle as the timeline's density control: detailed
            shows a content snippet per hit, compact just the locations. */}
        <Tooltip
          title={detailed ? "Hide snippets" : "Show snippets"}
          placement="bottom"
        >
          <IconButton
            size="small"
            onClick={() => setSearchDetailedResults(!detailed)}
            aria-label={detailed ? "Hide snippets" : "Show snippets"}
            sx={{ color: "text.secondary", flexShrink: 0 }}
          >
            {detailed ? (
              <UnfoldLessIcon sx={{ fontSize: 18 }} />
            ) : (
              <UnfoldMoreIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
      {query.trim().length > 0 && hits.length === 0 && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ px: 2, pb: 2, textAlign: "center" }}
        >
          No matches in this trace.
        </Typography>
      )}
      {hits.length > 0 && (
        <List dense sx={{ maxHeight: "50vh", overflowY: "auto", pt: 0 }}>
          {groups.map((group) => (
            <Box key={group.messageIndex} sx={{ pb: 0.75 }}>
              {/* Tinted, sticky band — the header doubles as the group
                  separator and stays visible while its hits scroll by. */}
              <Typography
                variant="overline"
                color="text.secondary"
                noWrap
                sx={{
                  display: "block",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  bgcolor: "background.default",
                  px: 2,
                  py: 0.75,
                  lineHeight: 1.6,
                }}
              >
                #{group.messageIndex + 1} ·{" "}
                {messageTitle(trace.messages[group.messageIndex])}
              </Typography>
              {/* Left rail under the header: hits read as children of the
                  message above them. */}
              <Box
                sx={{
                  ml: 2,
                  mt: 0.5,
                  borderLeft: 2,
                  borderColor: "divider",
                }}
              >
                {group.items.map(({ hit, count }, i) => (
                  <ListItemButton
                    key={`${hit.kind}:${hit.nodeId ?? ""}:${hit.stepIndex ?? ""}:${hit.payloadIndex ?? ""}:${i}`}
                    onClick={() => jumpTo(hit)}
                    sx={{ display: "block", px: 1.5, py: 0.75 }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      sx={{ display: "block" }}
                    >
                      {hit.sourceLabel}
                      {count > 1 ? ` · ×${count}` : ""}
                    </Typography>
                    {/* Snippets in the inspector's payload typography, so
                        content reads as content and labels as chrome. */}
                    {detailed && (
                      <Typography
                        noWrap
                        sx={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 12,
                          color: "text.primary",
                          opacity: 0.85,
                        }}
                      >
                        {hit.snippet.before}
                        <Box
                          component="span"
                          sx={{ color: "primary.main", fontWeight: 600 }}
                        >
                          {hit.snippet.match}
                        </Box>
                        {hit.snippet.after}
                      </Typography>
                    )}
                  </ListItemButton>
                ))}
              </Box>
            </Box>
          ))}
          {hits.length >= MAX_HITS && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", px: 2, py: 0.75 }}
            >
              Showing the first {MAX_HITS} matches — refine the search to narrow
              down.
            </Typography>
          )}
        </List>
      )}
    </Dialog>
  );
}
