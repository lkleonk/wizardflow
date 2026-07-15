"use client";

import { useSyncExternalStore } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import type { AgentTraceMessage } from "@/types/agenttrace";
import { messageInputText } from "@/utils/traceSelectors";
import {
  getServerTimelineExpanded,
  getTimelineExpanded,
  setTimelineExpanded,
  subscribeTimelineExpanded,
} from "@/utils/flowSession";

type MessageTimelineProps = {
  messages: AgentTraceMessage[];
  selectedMessageId?: string;
  onSelectMessage: (messageId: string) => void;
};

const PREVIEW_MAX = 24;
const TOOLTIP_META_VALUE_MAX = 160;
const MESSAGE_TOOLTIP_ENTER_DELAY = 500;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Meta values are short scalars by contract; an out-of-contract object/array
// (from a hand-written trace) still renders readably as JSON instead of
// "[object Object]".
function metaText(value: unknown): string {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value);
}

export default function MessageTimeline({
  messages,
  selectedMessageId,
  onSelectMessage,
}: MessageTimelineProps) {
  const expanded = useSyncExternalStore(
    subscribeTimelineExpanded,
    getTimelineExpanded,
    getServerTimelineExpanded
  );

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        borderBottom: 1,
        borderColor: "divider",
        pl: { xs: 0.25, sm: 0.75 },
      }}
    >
      {/* Strip label and density toggle as one control: clicking "MESSAGES ⇕"
          expands/compacts the chips. The text is hidden on phones where chip
          space is scarce; the icon alone remains the toggle there. */}
      <Tooltip
        title={expanded ? "Compact messages" : "Show message details"}
        placement="top"
      >
        <ButtonBase
          onClick={() => setTimelineExpanded(!expanded)}
          aria-label={expanded ? "Compact messages" : "Show message details"}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.25,
            flexShrink: 0,
            px: 0.5,
            py: 0.25,
            borderRadius: 1,
            color: "text.secondary",
            "&:hover": { color: "text.primary" },
            "&:focus-visible": {
              outline: "2px solid",
              outlineColor: "primary.main",
              outlineOffset: -2,
            },
          }}
        >
          <Typography
            variant="overline"
            sx={{ display: { xs: "none", sm: "block" }, lineHeight: 1 }}
          >
            Messages
          </Typography>
          {expanded ? (
            <UnfoldLessIcon sx={{ fontSize: 16 }} />
          ) : (
            <UnfoldMoreIcon sx={{ fontSize: 16 }} />
          )}
        </ButtonBase>
      </Tooltip>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: { xs: 0.75, sm: 1 },
          pl: { xs: 0.25, sm: 0.5 },
          pr: { xs: 1, sm: 2 },
          py: { xs: 0.5, sm: 1 },
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          flex: 1,
          minWidth: 0,
        }}
      >
        {messages.map((message, index) => {
          const selected = message.id === selectedMessageId;
          const title = message.label?.trim();
          const preview = messageInputText(message);
          const fullText = title || preview;
          const metaEntries = message.meta ? Object.entries(message.meta) : [];

          // Tooltip carries everything the chip/card may clip: the headline,
          // the input preview when a dev title displaced it from the headline,
          // and the meta as key/value rows (values truncated — the expanded
          // strip is the place to actually read things).
          const secondary = title ? preview : "";
          let tooltipTitle: React.ReactNode = "";
          if (metaEntries.length > 0 || secondary) {
            tooltipTitle = (
              <Box>
                {fullText && (
                  <Typography
                    variant="caption"
                    sx={{ display: "block", fontWeight: 600, mb: 0.25 }}
                  >
                    {fullText}
                  </Typography>
                )}
                {secondary && (
                  <Typography
                    variant="caption"
                    sx={{ display: "block", opacity: 0.8, mb: 0.25 }}
                  >
                    {secondary}
                  </Typography>
                )}
                {metaEntries.map(([key, value]) => (
                  <Box key={key} sx={{ display: "flex", gap: 1, py: 0.1 }}>
                    <Typography
                      variant="caption"
                      sx={{ opacity: 0.7, flexShrink: 0 }}
                    >
                      {key}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ wordBreak: "break-word" }}
                    >
                      {truncate(metaText(value), TOOLTIP_META_VALUE_MAX)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            );
          } else if (fullText.length > PREVIEW_MAX) {
            tooltipTitle = fullText;
          }

          let item: React.ReactNode;
          if (expanded) {
            const mutedSx = selected
              ? { color: "inherit", opacity: 0.85 }
              : { color: "text.secondary" };
            item = (
              <ButtonBase
                onClick={() => onSelectMessage(message.id)}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  textAlign: "left",
                  border: 1,
                  borderColor: selected ? "primary.main" : "divider",
                  bgcolor: selected ? "primary.main" : "transparent",
                  color: selected ? "primary.contrastText" : "text.primary",
                  borderRadius: 2,
                  px: 1.25,
                  py: 0.5,
                  maxWidth: { xs: 240, sm: 320 },
                }}
              >
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ maxWidth: "100%", fontWeight: 500 }}
                >
                  <Box
                    component="span"
                    sx={{ opacity: 0.65, fontWeight: 400, mr: 0.5 }}
                  >
                    {index + 1}
                    {fullText && " ·"}
                  </Box>
                  {fullText}
                </Typography>
                {secondary && (
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ maxWidth: "100%", ...mutedSx }}
                  >
                    {secondary}
                  </Typography>
                )}
                {metaEntries.length > 0 && (
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ maxWidth: "100%", ...mutedSx }}
                  >
                    {metaEntries
                      .map(([key, value]) => `${key}: ${metaText(value)}`)
                      .join(" · ")}
                  </Typography>
                )}
              </ButtonBase>
            );
          } else {
            // Every chip leads with a muted position index — the strip is a
            // timeline, so order stays visible even on titled messages. The
            // text is the dev title when set, else the input preview.
            const label = (
              <>
                <Box component="span" sx={{ opacity: 0.65, mr: 0.5 }}>
                  {index + 1}
                  {fullText && " ·"}
                </Box>
                {truncate(fullText, PREVIEW_MAX)}
              </>
            );
            item = (
              <Chip
                label={label}
                onClick={() => onSelectMessage(message.id)}
                variant={selected ? "filled" : "outlined"}
                color={selected ? "primary" : "default"}
                size="small"
                sx={{ maxWidth: { xs: 240, sm: 320 } }}
              />
            );
          }

          // Anchor the Tooltip to a stable <span>, not the chip/card — otherwise
          // re-rendering it (e.g. selecting it) disturbs the cloned tooltip
          // child and makes it flicker. Empty title = no tooltip.
          return (
            <Tooltip
              key={message.id}
              title={tooltipTitle}
              placement="top"
              enterDelay={MESSAGE_TOOLTIP_ENTER_DELAY}
              disableInteractive
            >
              <Box
                component="span"
                sx={{ display: "inline-flex", flexShrink: 0 }}
              >
                {item}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}
