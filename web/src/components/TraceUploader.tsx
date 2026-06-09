"use client";

import { useRef } from "react";
import Button from "@mui/material/Button";
import type { ButtonProps } from "@mui/material/Button";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import type { AgentTraceFile } from "@/types/agenttrace";
import { isAgentTraceFile } from "@/utils/agentTraceFile";

type TraceUploaderProps = {
  onLoad: (trace: AgentTraceFile) => void;
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  sx?: ButtonProps["sx"];
};

export default function TraceUploader({
  onLoad,
  label = "Upload JSON",
  size = "small",
  variant = "outlined",
  sx,
}: TraceUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!isAgentTraceFile(parsed)) {
        alert("That file doesn't look like a WizardFlow JSON file.");
        return;
      }
      // The on-disk file name is what the user recognizes — use it as the
      // trace's display name, overriding any name baked into the JSON.
      onLoad({ ...parsed, name: file.name });
    } catch {
      alert("Could not parse that file as JSON.");
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
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
