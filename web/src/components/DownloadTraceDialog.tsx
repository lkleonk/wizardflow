import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { AgentTraceFile } from "@/types/agenttrace";
import { apiPath, useApi } from "@/utils/otelApi";
import { RANGE_MS, useNow, type TimeRange } from "@/utils/otelDisplay";
import {
  downloadBlob,
  downloadTraceJsonl,
  fileStem,
  toTraceJsonl,
  traceFileName,
  traceFileNames,
} from "@/utils/traceExport";
import { zipFiles } from "@/utils/zip";

export type DownloadScope = "execution" | "conversation" | "project";

/** GET /api/export: the replayable runs in scope, one per conversation. */
type ExportResult = { files: AgentTraceFile[]; skippedTraces: number };

const RANGES: [TimeRange, string][] = [
  ["1h", "Last hour"],
  ["24h", "Last 24 hours"],
  ["7d", "Last 7 days"],
  ["all", "Any time"],
];

function Command({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="code"
      sx={{
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: "0.92em",
        color: "text.primary",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </Box>
  );
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Save database runs as AgentTrace JSONL: one execution, one conversation, or
 * the whole project (a .zip, one file per conversation), optionally only the
 * executions started in a recent time range. The span page has spans, not
 * the replay's data, so the runs are read from the API here. Mount it on the
 * first open: until then there is nothing to fetch.
 */
export default function DownloadTraceDialog({
  open,
  onClose,
  project,
  traceId,
  conversationId,
  executionLabel,
  initialScope,
  initialRange = "all",
}: {
  open: boolean;
  onClose: () => void;
  project: string;
  /** The execution being viewed, if any (and replayable). */
  traceId?: string | null;
  /** Its conversation, if it has one. */
  conversationId?: string | null;
  /** e.g. "Execution 3 of 3": shown under "This execution". */
  executionLabel?: string;
  initialScope: DownloadScope;
  /** The time range it opens with, e.g. the trace list's. */
  initialRange?: TimeRange;
}) {
  const [scope, setScope] = useState<DownloadScope>(initialScope);
  const [range, setRange] = useState<TimeRange>(initialRange);
  // Anchored when the range is picked, as in the trace list, so the count
  // doesn't refetch on every clock tick.
  const now = useNow();
  const [anchor, setAnchor] = useState({ range, now });
  if (anchor.range !== range || (anchor.now === 0 && now !== 0)) setAnchor({ range, now });
  const windowMs = RANGE_MS[range];
  // ns as a string: ms × 10⁶ is past what a JS number holds exactly.
  const from =
    scope !== "execution" && windowMs !== null && anchor.now
      ? `${BigInt(anchor.now - windowMs) * BigInt(1_000_000)}`
      : null;

  const execution = useApi<AgentTraceFile>(
    scope === "execution" && traceId
      ? apiPath(`traces/${encodeURIComponent(traceId)}/agenttrace`, { project })
      : null
  );
  const exported = useApi<ExportResult>(
    scope === "execution"
      ? null
      : apiPath("export", {
          project,
          conversation: scope === "conversation" ? conversationId : null,
          from,
        })
  );
  const result: ExportResult | undefined =
    scope === "execution"
      ? execution.data && { files: [execution.data], skippedTraces: 0 }
      : exported.data;
  const error = scope === "execution" ? execution.error : exported.error;

  const files = result?.files ?? [];
  const executions = files.reduce((sum, file) => sum + file.messages.length, 0);
  const zipName = `${fileStem(project, "wizardflow-project")}.zip`;
  const fileName = files.length === 1 ? traceFileName(files[0]) : zipName;
  const command = files.length === 1 ? fileName : "<file>.jsonl";

  const save = () => {
    if (files.length === 1) {
      downloadTraceJsonl(files[0]);
    } else if (files.length > 1) {
      const names = traceFileNames(files);
      downloadBlob(
        zipFiles(files.map((file, i) => ({ name: names[i], text: toTraceJsonl(file) }))),
        zipName
      );
    }
    onClose();
  };

  const option = (value: DownloadScope, title: string, detail: string) => (
    <FormControlLabel
      value={value}
      control={<Radio size="small" />}
      sx={{ alignItems: "flex-start", mr: 0, mb: 0.5, "& .MuiRadio-root": { pt: 0.25 } }}
      label={
        <Box>
          <Typography sx={{ fontSize: 14 }}>{title}</Typography>
          <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>{detail}</Typography>
        </Box>
      }
    />
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="download-trace-title">
      <DialogTitle id="download-trace-title">Download as files</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ fontSize: 13.5, lineHeight: 1.6, mb: 2 }}>
          Open them on getwizardflow.com, with <Command>wizardflow replay {command}</Command>, or
          add them to a database with <Command>wizardflow db import {command}</Command>.
        </Typography>

        <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 0.5 }}>What to save</Typography>
        <RadioGroup value={scope} onChange={(event) => setScope(event.target.value as DownloadScope)}>
          {traceId && option("execution", "This execution", executionLabel ?? "The execution you're viewing")}
          {conversationId && option("conversation", "This conversation", conversationId)}
          {option("project", "Whole project", `${project}: one file per conversation, in a .zip`)}
        </RadioGroup>

        {scope !== "execution" && (
          <>
            <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 1.5, mb: 0.75 }}>
              Executions started
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={range}
              onChange={(_, value: TimeRange | null) => value && setRange(value)}
              sx={{ flexWrap: "wrap" }}
            >
              {RANGES.map(([value, label]) => (
                <ToggleButton key={value} value={value} sx={{ textTransform: "none", py: 0.25 }}>
                  {label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </>
        )}

        <Box sx={{ mt: 2, p: 1.25, borderRadius: 1, bgcolor: "action.hover", fontSize: 13 }}>
          {error ? (
            <Typography color="error" sx={{ fontSize: 13 }}>
              Couldn&apos;t read these runs from the database.
            </Typography>
          ) : !result ? (
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Counting…</Typography>
          ) : executions === 0 ? (
            <Typography sx={{ fontSize: 13 }}>No executions started in that range.</Typography>
          ) : (
            <Typography sx={{ fontSize: 13 }}>
              Saves <b>{plural(executions, "execution")}</b> as <Command>{fileName}</Command>
              {files.length > 1 && `: one .jsonl per conversation (${files.length} files)`}.
              {result.skippedTraces > 0 &&
                ` ${plural(result.skippedTraces, "trace")} without graph nodes ${
                  result.skippedTraces === 1 ? "is" : "are"
                } left out.`}
            </Typography>
          )}
        </Box>
        <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 1 }}>
          The files hold what graph replay shows, so logs and spans outside the graph are left out.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button size="small" color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" disabled={executions === 0} onClick={save}>
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
}
