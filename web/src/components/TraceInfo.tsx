"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import type { AgentTraceFile } from "@/types/agenttrace";

type TraceInfoProps = {
  trace: AgentTraceFile;
};

// Header trace-info affordance. Click opens a Popover (not a hover tooltip) so
// arbitrarily long dev-provided `meta` values can wrap, scroll, and be selected
// /copied rather than overflowing a tooltip.
export default function TraceInfo({ trace }: TraceInfoProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const messageCount = trace.messages.length;
  const nodeCount = trace.graph.nodes.length;
  const edgeCount = trace.graph.edges.length;

  return (
    <>
      <Tooltip title="Agent flow details" placement="bottom">
        <IconButton
          size="small"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label="Agent flow details"
          sx={{ color: "text.secondary" }}
        >
          <InfoOutlinedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 1.5, maxWidth: 360, maxHeight: "60vh", overflow: "auto" }}>
          <InfoRow label="Schema" value={`v${trace.version}`} />
          <InfoRow
            label="Graph"
            value={`${messageCount} messages · ${nodeCount} nodes · ${edgeCount} edges`}
          />
          {trace.meta &&
            Object.entries(trace.meta).map(([key, value]) => (
              <InfoRow key={key} label={key} value={String(value)} />
            ))}
        </Box>
      </Popover>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", gap: 1.5, py: 0.25 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ flexShrink: 0, minWidth: 64 }}
      >
        {label}
      </Typography>
      <Typography
        variant="caption"
        sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {value}
      </Typography>
    </Box>
  );
}
