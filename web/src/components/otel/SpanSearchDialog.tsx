import { useState } from "react";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import { cleanForDisplay, makeSnippet, payloadText, type SearchHit } from "@/components/SearchDialog";
import type { ApiLog, ApiSpan, Attributes } from "@/types/otelstore";

const MAX_HITS = 100;

export type SpanSearchHit = {
  spanId: string;
  spanName: string;
  /** The inspector tab the match is on. */
  tab: "attrs" | "msgs" | "events" | "logs";
  /** Where the match is, for the result's context line. */
  source: string;
  snippet: SearchHit["snippet"];
};

/**
 * Case-insensitive search over one execution: span names, attributes, events
 * and logs, in timeline order. Everything is already loaded for the page. Logs
 * with no span are left out, since a result has to lead to a span.
 */
function searchSpans(
  spans: ApiSpan[],
  logs: ApiLog[],
  messageKeys: string[],
  query: string
): SpanSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const hits: SpanSearchHit[] = [];

  const check = (span: ApiSpan, tab: SpanSearchHit["tab"], source: string, raw: string) => {
    const text = cleanForDisplay(raw);
    const index = text.toLowerCase().indexOf(needle);
    if (index >= 0 && hits.length < MAX_HITS) {
      hits.push({
        spanId: span.spanId,
        spanName: span.name,
        tab,
        source,
        snippet: makeSnippet(text, index, needle.length),
      });
    }
  };
  const checkAttributes = (
    span: ApiSpan,
    tab: SpanSearchHit["tab"],
    source: string,
    attributes: Attributes
  ) => {
    for (const [key, value] of Object.entries(attributes)) {
      check(span, messageKeys.includes(key) ? "msgs" : tab, source, `${key}: ${payloadText(value)}`);
    }
  };

  for (const span of spans) {
    check(span, "attrs", "Span name", span.name);
    if (span.statusMessage) check(span, "attrs", "Status", span.statusMessage);
    checkAttributes(span, "attrs", "Attribute", span.attributes);
    for (const event of span.events) {
      check(span, "events", "Event", event.name);
      checkAttributes(span, "events", `Event · ${event.name}`, event.attributes);
    }
    for (const log of logs) {
      if (log.spanId !== span.spanId) continue;
      check(span, "logs", "Log", log.bodyText ?? payloadText(log.body));
      checkAttributes(span, "logs", "Log attribute", log.attributes);
    }
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}

/** Same palette as the replay's search; the data and the jump are the span page's. */
export default function SpanSearchDialog({
  open,
  onClose,
  spans,
  logs,
  messageKeys,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  /** In timeline order. */
  spans: ApiSpan[];
  logs: ApiLog[];
  /** Attribute keys shown on the Messages tab rather than Attributes. */
  messageKeys: string[];
  onJump: (hit: SpanSearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const hits = open ? searchSpans(spans, logs, messageKeys, query) : [];

  const jumpTo = (hit: SpanSearchHit) => {
    onJump(hit);
    onClose();
  };

  // Hits arrive span by span, so consecutive runs are exactly the groups.
  const groups: { spanId: string; spanName: string; items: SpanSearchHit[] }[] = [];
  for (const hit of hits) {
    const last = groups[groups.length - 1];
    if (last?.spanId === hit.spanId) last.items.push(hit);
    else groups.push({ spanId: hit.spanId, spanName: hit.spanName, items: [hit] });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      sx={{ "& .MuiDialog-container": { alignItems: "flex-start" } }}
      slotProps={{ paper: { sx: { mt: { xs: 2, sm: 8 } } } }}
    >
      <Box sx={{ p: 1.5, pb: hits.length > 0 ? 0.5 : 1.5 }}>
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          fullWidth
          size="small"
          placeholder="Search this execution: spans, attributes, events, logs"
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
      </Box>
      {query.trim().length > 0 && hits.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2, textAlign: "center" }}>
          No matches in this execution.
        </Typography>
      )}
      {hits.length > 0 && (
        <List dense sx={{ maxHeight: "50vh", overflowY: "auto", pt: 0 }}>
          {groups.map((group) => (
            <Box key={group.spanId} sx={{ pb: 0.75 }}>
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
                  textTransform: "none",
                }}
              >
                {group.spanName}
              </Typography>
              <Box sx={{ ml: 2, mt: 0.5, borderLeft: 2, borderColor: "divider" }}>
                {group.items.map((hit, i) => (
                  <ListItemButton key={i} onClick={() => jumpTo(hit)} sx={{ display: "block", px: 1.5, py: 0.75 }}>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {hit.source}
                    </Typography>
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
                      <Box component="span" sx={{ color: "primary.main", fontWeight: 600 }}>
                        {hit.snippet.match}
                      </Box>
                      {hit.snippet.after}
                    </Typography>
                  </ListItemButton>
                ))}
              </Box>
            </Box>
          ))}
          {hits.length >= MAX_HITS && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, py: 0.75 }}>
              Showing the first {MAX_HITS} matches. Refine the search to narrow it down.
            </Typography>
          )}
        </List>
      )}
    </Dialog>
  );
}
