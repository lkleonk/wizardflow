"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  /**
   * Messages appended by a live trace update while the user was parked on an
   * older one. When > 0 a "+N new" chip is pinned at the strip's right edge;
   * clicking it calls `onJumpToNewest`.
   */
  newMessageCount?: number;
  onJumpToNewest?: () => void;
};

const PREVIEW_MAX = 24;
const TOOLTIP_META_VALUE_MAX = 160;
const MESSAGE_TOOLTIP_ENTER_DELAY = 1_200;
// How far from the strip's right edge still counts as "parked at the end".
// Wide enough to cover the strip's right padding, which scrollIntoView leaves
// behind when it aligns the last chip.
const STRIP_END_SLACK_PX = 32;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function comparableText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// Meta values are short scalars by contract; an out-of-contract object/array
// (from a hand-written trace) still renders readably as JSON instead of
// "[object Object]".
function metaText(value: unknown): string {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value);
}

function useClippedText(text: string) {
  const textRef = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setClipped(
        element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return { textRef, clipped };
}

function ClampedMessageText({
  text,
  textRef,
  lines,
  variant,
  sx,
  children,
}: {
  text: string;
  textRef: React.Ref<HTMLDivElement>;
  lines: number;
  variant: "body2" | "caption";
  sx?: Record<string, unknown>;
  children?: React.ReactNode;
}) {
  return (
    <Typography
      ref={textRef}
      component="div"
      variant={variant}
      sx={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: lines,
        overflow: "hidden",
        maxWidth: "100%",
        wordBreak: "break-word",
        ...sx,
      }}
    >
      {children ?? text}
    </Typography>
  );
}

function ExpandedMessageCard({
  messageId,
  index,
  fullText,
  secondary,
  metaEntries,
  selected,
  onSelectMessage,
  anchorRef,
}: {
  messageId: string;
  index: number;
  fullText: string;
  secondary: string;
  metaEntries: [string, unknown][];
  selected: boolean;
  onSelectMessage: (messageId: string) => void;
  anchorRef?: React.Ref<HTMLSpanElement>;
}) {
  const headline = useClippedText(fullText);
  const input = useClippedText(secondary);
  const metaSummary = metaEntries
    .map(([key, value]) => `${key}: ${metaText(value)}`)
    .join(" · ");
  const meta = useClippedText(metaSummary);
  const mutedSx = selected
    ? { color: "inherit", opacity: 0.85 }
    : { color: "text.secondary" };

  const hasClippedContent =
    headline.clipped || input.clipped || meta.clipped;
  const tooltipTitle = hasClippedContent ? (
    <Box>
      {headline.clipped && (
        <Typography
          variant="caption"
          sx={{ display: "block", fontWeight: 600, mb: 0.5 }}
        >
          {fullText}
        </Typography>
      )}
      {input.clipped && (
        <Box sx={{ mb: meta.clipped ? 0.5 : 0 }}>
          <Typography variant="caption" sx={{ display: "block", opacity: 0.65 }}>
            Input
          </Typography>
          <Typography variant="caption" sx={{ display: "block" }}>
            {secondary}
          </Typography>
        </Box>
      )}
      {meta.clipped &&
        metaEntries.map(([key, value]) => (
          <Box key={key} sx={{ display: "flex", gap: 1, py: 0.1 }}>
            <Typography variant="caption" sx={{ opacity: 0.7, flexShrink: 0 }}>
              {key}
            </Typography>
            <Typography variant="caption" sx={{ wordBreak: "break-word" }}>
              {truncate(metaText(value), TOOLTIP_META_VALUE_MAX)}
            </Typography>
          </Box>
        ))}
    </Box>
  ) : (
    ""
  );

  return (
    <Tooltip
      title={tooltipTitle}
      placement="top"
      enterDelay={MESSAGE_TOOLTIP_ENTER_DELAY}
      enterNextDelay={MESSAGE_TOOLTIP_ENTER_DELAY}
      disableInteractive
    >
      <Box
        component="span"
        ref={anchorRef}
        sx={{ display: "inline-flex", flexShrink: 0 }}
      >
        <ButtonBase
          onClick={() => onSelectMessage(messageId)}
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
          <ClampedMessageText
            text={fullText}
            textRef={headline.textRef}
            variant="body2"
            lines={2}
            sx={{ fontWeight: 500 }}
          >
            <Box
              component="span"
              sx={{ opacity: 0.65, fontWeight: 400, mr: 0.5 }}
            >
              {index + 1}
              {fullText && " ·"}
            </Box>
            {fullText}
          </ClampedMessageText>
          {secondary && (
            <ClampedMessageText
              text={secondary}
              textRef={input.textRef}
              variant="caption"
              lines={2}
              sx={mutedSx}
            />
          )}
          {metaEntries.length > 0 && (
            <Box
              sx={{
                position: "relative",
                width: "100%",
                mt: 0.4,
                pt: 0.4,
                "&::before": {
                  content: '""',
                  position: "absolute",
                  top: 0,
                  right: 0,
                  left: 0,
                  borderTop: "1px solid",
                  borderColor: "currentColor",
                  opacity: 0.18,
                },
              }}
            >
              <ClampedMessageText
                text={metaSummary}
                textRef={meta.textRef}
                variant="caption"
                lines={1}
                sx={mutedSx}
              />
            </Box>
          )}
        </ButtonBase>
      </Box>
    </Tooltip>
  );
}

export default function MessageTimeline({
  messages,
  selectedMessageId,
  onSelectMessage,
  newMessageCount = 0,
  onJumpToNewest,
}: MessageTimelineProps) {
  const expanded = useSyncExternalStore(
    subscribeTimelineExpanded,
    getTimelineExpanded,
    getServerTimelineExpanded
  );

  // Keep the selected chip in view: matters for keyboard message navigation
  // and for live tail-follow, where the strip grows off-screen to the right.
  const selectedItemRef = useRef<HTMLSpanElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  // Tail-follow must not fight the user. Scrolling back to older chips parks
  // the strip, and appended messages stop dragging it to the right edge until
  // it returns there. Recorded on scroll rather than measured in the effect
  // because an append widens the strip without moving scrollLeft (no scroll
  // event fires), so this still reflects where the user left it.
  const atStripEndRef = useRef(true);
  const messageCountRef = useRef(messages.length);
  const firstMessageIdRef = useRef(messages[0]?.id);

  function handleStripScroll() {
    const strip = stripRef.current;
    if (!strip) return;
    atStripEndRef.current =
      strip.scrollWidth - strip.clientWidth - strip.scrollLeft <=
      STRIP_END_SLACK_PX;
  }

  // Let a mouse wheel scroll the strip horizontally — vertical deltas are the
  // only ones a plain mouse can produce, and the strip has no vertical axis to
  // spend them on. Trackpads already pan sideways natively (deltaX), so those
  // events pass through untouched. Attached natively (not via onWheel) because
  // preventDefault — needed so the hijacked wheel can't also scroll the page
  // on the stacked mobile layout — requires a non-passive listener.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || e.deltaX !== 0) return;
      if (strip.scrollWidth <= strip.clientWidth) return;
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    // An append keeps the same first message and adds to the end; a different
    // flow (or another part of a rotated run) replaces the list, and must
    // scroll whatever it lands on into view however far right the strip was.
    const firstMessageId = messages[0]?.id;
    const appended =
      firstMessageId === firstMessageIdRef.current &&
      messages.length > messageCountRef.current;
    firstMessageIdRef.current = firstMessageId;
    messageCountRef.current = messages.length;
    // Only appends are suppressed while parked; a deliberate selection change
    // (chip click, arrow keys, the "+N new" chip) always scrolls into view.
    if (appended && !atStripEndRef.current) return;
    selectedItemRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedMessageId, messages]);

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
        ref={stripRef}
        onScroll={handleStripScroll}
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
          const secondary =
            title && comparableText(title) !== comparableText(preview)
              ? preview
              : "";
          if (expanded) {
            return (
              <ExpandedMessageCard
                key={message.id}
                messageId={message.id}
                index={index}
                fullText={fullText}
                secondary={secondary}
                metaEntries={metaEntries}
                selected={selected}
                onSelectMessage={onSelectMessage}
                anchorRef={selected ? selectedItemRef : undefined}
              />
            );
          }

          // Compact chips are navigation only. Expanding the timeline is the
          // explicit way to reveal message details.
          const label = (
            <>
              <Box component="span" sx={{ opacity: 0.65, mr: 0.5 }}>
                {index + 1}
                {fullText && " ·"}
              </Box>
              {truncate(fullText, PREVIEW_MAX)}
            </>
          );
          return (
            <Box
              key={message.id}
              component="span"
              ref={selected ? selectedItemRef : undefined}
              sx={{ display: "inline-flex", flexShrink: 0 }}
            >
              <Chip
                label={label}
                onClick={() => onSelectMessage(message.id)}
                variant={selected ? "filled" : "outlined"}
                color={selected ? "primary" : "default"}
                size="small"
                sx={{ maxWidth: { xs: 240, sm: 320 } }}
              />
            </Box>
          );
        })}
        {newMessageCount > 0 && onJumpToNewest && (
          // Pinned to the strip's right edge (sticky, over its own opaque
          // background) so it stays visible however far back the user has
          // scrolled; `ml: auto` keeps it at the edge on short strips too.
          <Box
            component="span"
            sx={{
              position: "sticky",
              right: 0,
              zIndex: 1,
              ml: "auto",
              pl: 0.75,
              display: "inline-flex",
              flexShrink: 0,
              bgcolor: "background.paper",
            }}
          >
            <Chip
              label={`+${newMessageCount} new`}
              onClick={onJumpToNewest}
              color="primary"
              variant="outlined"
              size="small"
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
