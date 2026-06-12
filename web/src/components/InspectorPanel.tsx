"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { formatClock, formatDuration } from "@/utils/formatTime";

type InspectorPayload = {
  displayLabel: string;
  value: unknown;
  /** ISO timestamp of the step that emitted this payload. */
  timestamp: string;
  /** Gap from the previous step; cumulative elapsed since message start. */
  deltaMs?: number;
  elapsedMs?: number;
};

type InspectorPanelProps = {
  selectedNodeId?: string;
  selectedNodeLabel?: string;
  payloads: InspectorPayload[];
};

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export default function InspectorPanel({
  selectedNodeId,
  selectedNodeLabel,
  payloads,
}: InspectorPanelProps) {
  const [tab, setTab] = useState(0);

  // Reset the active tab whenever the selection or payload set changes so we
  // never point past the end of the list. Done during render (tracking the
  // previous key) rather than in an effect, per React guidance — the rendered
  // index is still clamped below as a safety net.
  const resetKey = `${selectedNodeId}:${payloads.length}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setTab(0);
  }

  if (!selectedNodeId) {
    return (
      <CenteredHint>Select a node to inspect its payloads.</CenteredHint>
    );
  }

  if (payloads.length === 0) {
    return (
      <CenteredHint>No payloads logged for this node.</CenteredHint>
    );
  }

  const active = payloads[Math.min(tab, payloads.length - 1)];

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2, pt: 1.5 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: "block", overflowWrap: "anywhere", lineHeight: 1.4 }}
        >
          {selectedNodeLabel ?? selectedNodeId}
        </Typography>
      </Box>
      <Tabs
        value={Math.min(tab, payloads.length - 1)}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 40, borderBottom: 1, borderColor: "divider" }}
      >
        {payloads.map((p) => (
          <Tab
            key={p.displayLabel}
            label={p.displayLabel}
            sx={{ minHeight: 40, textTransform: "none" }}
          />
        ))}
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
          {formatValue(active.value)}
        </Box>
      </Box>
    </Box>
  );
}

function CenteredHint({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        height: "100%",
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
