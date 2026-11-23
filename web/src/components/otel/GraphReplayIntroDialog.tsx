"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";

const STORAGE_KEY = "wizardflow.graphReplayIntroSeen";

/** Per browser, not per tab: the intro is for the first visit only. */
export function graphReplayIntroSeen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberSeen() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Private window or blocked storage: it shows again next time.
  }
}

/**
 * Shown the first time a dashboard user lands in graph replay. Arriving from
 * the span waterfall, the layout is unfamiliar: executions sit on the timeline
 * strip at the bottom, and the graph replaces the span tree. This says so and
 * offers the way back.
 */
export default function GraphReplayIntroDialog({
  open,
  onStay,
  waterfallHref,
}: {
  open: boolean;
  onStay: () => void;
  /** The span waterfall for the execution on screen. */
  waterfallHref?: string;
}) {
  // Unchecked: closing the intro keeps it coming until the user opts out.
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const stay = () => {
    if (dontShowAgain) rememberSeen();
    onStay();
  };

  return (
    <Dialog open={open} onClose={stay} aria-labelledby="graph-replay-intro-title" maxWidth="xs" fullWidth>
      <DialogTitle id="graph-replay-intro-title" sx={{ pb: 1 }}>
        You&apos;re in graph replay
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "grid", gap: 1.25 }}>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
            This view replays your agent on its graph instead of as a span tree.
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.75 }}>
            <Typography component="li" variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
              <b>Workflow executions</b> are the chips in the strip at the bottom. Scroll it
              sideways and click one to open it.
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
              <b>Play</b> steps through the nodes in order; click a node for its inputs and outputs.
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
              The usual <b>span waterfall</b> is one click away in the header, on the same execution.
            </Typography>
          </Box>
          <FormControlLabel
            control={
              <Checkbox size="small" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
            }
            label={<Typography variant="body2">Don&apos;t show this again</Typography>}
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {waterfallHref && (
          <Button
            href={waterfallHref}
            color="inherit"
            onClick={() => {
              if (dontShowAgain) rememberSeen();
            }}
            sx={{ textTransform: "none" }}
          >
            Back to span waterfall
          </Button>
        )}
        <Button variant="contained" onClick={stay} autoFocus sx={{ textTransform: "none" }}>
          Stay in graph replay
        </Button>
      </DialogActions>
    </Dialog>
  );
}
