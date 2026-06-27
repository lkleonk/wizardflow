"use client";

import { useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { alpha, type SxProps, type Theme } from "@mui/material/styles";
import type { AgentTraceFile } from "@/types/agenttrace";
import {
  INVALID_AGENT_TRACE_FILE_MESSAGE,
  readAgentTraceFile,
} from "@/utils/agentTraceFile";

type TraceDropTargetProps = {
  onLoad: (trace: AgentTraceFile) => void;
  children: ReactNode;
  sx?: SxProps<Theme>;
};

function dragHasFiles(event: DragEvent<HTMLElement>) {
  return (
    Array.from(event.dataTransfer.types).includes("Files") ||
    event.dataTransfer.files.length > 0
  );
}

export default function TraceDropTarget({
  onLoad,
  children,
  sx,
}: TraceDropTargetProps) {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragDepthRef = useRef(0);

  const sxList = Array.isArray(sx) ? sx : sx ? [sx] : [];

  function resetDragState() {
    dragDepthRef.current = 0;
    setIsDraggingFile(false);
  }

  async function handleFile(file: File) {
    let parsed: AgentTraceFile | null = null;
    try {
      parsed = await readAgentTraceFile(file);
    } catch {
      parsed = null;
    }

    if (!parsed) {
      alert(INVALID_AGENT_TRACE_FILE_MESSAGE);
      return;
    }
    onLoad(parsed);
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFile(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    resetDragState();

    const file = event.dataTransfer.files[0];
    if (file) {
      void handleFile(file);
    }
  }

  return (
    <Box
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={[{ position: "relative" }, ...sxList]}
    >
      {children}
      {isDraggingFile && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 8,
            zIndex: 1,
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.75,
            border: 2,
            borderStyle: "dashed",
            borderColor: "primary.main",
            borderRadius: 1.5,
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94),
            color: "primary.main",
            boxShadow: (theme) =>
              `0 0 0 1px ${alpha(theme.palette.primary.main, 0.24)}`,
            textAlign: "center",
          }}
        >
          <UploadFileIcon sx={{ fontSize: 36 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Drop trace file
          </Typography>
          <Typography variant="body2" color="text.secondary">
            .jsonl or .json
          </Typography>
        </Box>
      )}
    </Box>
  );
}
