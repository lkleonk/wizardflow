"use client";

import { useRef } from "react";
import Button from "@mui/material/Button";
import type { ButtonProps } from "@mui/material/Button";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import type { AgentTraceFile } from "@/types/agenttrace";
import {
  INVALID_AGENT_TRACE_FILE_MESSAGE,
  readAgentTraceFile,
} from "@/utils/agentTraceFile";

type TraceUploaderProps = {
  onLoad: (trace: AgentTraceFile) => void;
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  sx?: ButtonProps["sx"];
};

export default function TraceUploader({
  onLoad,
  label = "Upload trace",
  size = "small",
  variant = "outlined",
  sx,
}: TraceUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const parsed = await readAgentTraceFile(file);
    if (!parsed) {
      alert(INVALID_AGENT_TRACE_FILE_MESSAGE);
      return;
    }
    onLoad(parsed);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".jsonl,application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = ""; // allow re-uploading the same file
        }}
      />
      <Button
        size={size}
        variant={variant}
        startIcon={<UploadFileIcon />}
        onClick={() => inputRef.current?.click()}
        sx={sx}
      >
        {label}
      </Button>
    </>
  );
}
