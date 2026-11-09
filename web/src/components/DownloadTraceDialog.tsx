import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import type { AgentTraceFile } from "@/types/agenttrace";
import { useApi } from "@/utils/otelApi";
import { downloadTraceJsonl, traceFileName } from "@/utils/traceExport";

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

/**
 * Save a database run as AgentTrace JSONL. The span page has spans, not the
 * replay's data, so the file's content is read from `path` here. Mount it on
 * the first open: until then there is nothing to fetch.
 */
export default function DownloadTraceDialog({
  open,
  onClose,
  path,
  what,
}: {
  open: boolean;
  onClose: () => void;
  /** The API path of the run's AgentTrace. */
  path: string;
  /** What gets saved, e.g. "this execution". */
  what: string;
}) {
  const { data: trace, error } = useApi<AgentTraceFile>(path, { live: true });
  const fileName = trace ? traceFileName(trace) : "run.jsonl";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="download-trace-title"
    >
      <DialogTitle id="download-trace-title">Download as a file?</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
          Saves {what} as one file. Share it, open it on getwizardflow.com or
          with <Command>wizardflow ui {fileName}</Command>, or add it to a
          database with <Command>wizardflow db import {fileName}</Command>. It
          holds what the graph replay shows, so logs and spans outside the
          graph are left out.
        </Typography>
        {error && (
          <Typography color="error" sx={{ mt: 1, fontSize: 13 }}>
            Couldn&apos;t read this run from the database.
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button size="small" color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!trace}
          onClick={() => {
            if (!trace) return;
            downloadTraceJsonl(trace);
            onClose();
          }}
        >
          Download JSONL
        </Button>
      </DialogActions>
    </Dialog>
  );
}
