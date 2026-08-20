"use client";

import { useCallback, useRef } from "react";
import Button from "@mui/material/Button";
import type { ButtonProps } from "@mui/material/Button";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import type { AgentTraceFile } from "@/types/agenttrace";
import {
  INVALID_AGENT_TRACE_FILE_MESSAGE,
  readAgentTraceFile,
} from "@/utils/agentTraceFile";

/**
 * The file-picking half of the uploader, for callers that need their own
 * trigger — a menu row, say — instead of the button below. Render `input`
 * anywhere in the tree and call `pick()` from whatever the user clicks, and
 * the parsing and validation stay in one place.
 */
export function useTraceFilePicker(onLoad: (trace: AgentTraceFile) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = useCallback(() => inputRef.current?.click(), []);

  async function handleFile(file: File) {
    const parsed = await readAgentTraceFile(file);
    if (!parsed) {
      alert(INVALID_AGENT_TRACE_FILE_MESSAGE);
      return;
    }
    onLoad(parsed);
  }

  const input = (
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
  );

  return { input, pick };
}

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
  const { input, pick } = useTraceFilePicker(onLoad);

  return (
    <>
      {input}
      <Button
        size={size}
        variant={variant}
        startIcon={<UploadFileIcon />}
        onClick={pick}
        sx={sx}
      >
        {label}
      </Button>
    </>
  );
}
