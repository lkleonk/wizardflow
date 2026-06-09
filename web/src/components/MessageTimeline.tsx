"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import type { AgentTraceMessage } from "@/types/agenttrace";
import { messageInputText } from "@/utils/traceSelectors";

type MessageTimelineProps = {
  messages: AgentTraceMessage[];
  selectedMessageId?: string;
  onSelectMessage: (messageId: string) => void;
};

const PREVIEW_MAX = 24;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function MessageTimeline({
  messages,
  selectedMessageId,
  onSelectMessage,
}: MessageTimelineProps) {
  return (
    <Box
      sx={{
        display: "flex",
        gap: 1,
        px: 2,
        py: 1,
        overflowX: "auto",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      {messages.map((message, index) => {
        const selected = message.id === selectedMessageId;
        const title = message.label?.trim();

        // Dev-set title → show it alone. Otherwise auto "Message N : <preview>".
        let label: React.ReactNode;
        let fullText: string;
        if (title) {
          fullText = title;
          label = truncate(title, PREVIEW_MAX);
        } else {
          fullText = messageInputText(message);
          const preview = truncate(fullText, PREVIEW_MAX);
          label = (
            <>
              {`Message ${index + 1}`}
              {preview && (
                <Box component="span" sx={{ opacity: 0.65, ml: 0.5 }}>
                  : {preview}
                </Box>
              )}
            </>
          );
        }

        const chip = (
          <Chip
            label={label}
            onClick={() => onSelectMessage(message.id)}
            variant={selected ? "filled" : "outlined"}
            color={selected ? "primary" : "default"}
            size="small"
            sx={{ maxWidth: 320 }}
          />
        );

        // Anchor the Tooltip to a stable <span>, not the Chip — otherwise
        // re-rendering the Chip (e.g. selecting it) disturbs the cloned tooltip
        // child and makes it flicker. Empty title = no tooltip when not clipped.
        return (
          <Tooltip
            key={message.id}
            title={fullText.length > PREVIEW_MAX ? fullText : ""}
            placement="top"
            disableInteractive
          >
            <Box component="span" sx={{ display: "inline-flex", flexShrink: 0 }}>
              {chip}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
