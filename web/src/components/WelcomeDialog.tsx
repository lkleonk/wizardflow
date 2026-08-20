import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import TraceDropTarget from "@/components/TraceDropTarget";
import TraceUploader from "@/components/TraceUploader";
import WizardHatMark from "@/components/WizardHatMark";
import { LocalDataDetails } from "@/components/TutorialDialog";
import type { AgentTraceFile } from "@/types/agenttrace";

const PYTHON_SDK_QUICKSTART_URL =
  "https://github.com/lkleonk/wizardflow/tree/main/sdk/python#quickstart";

type WelcomeDialogProps = {
  open: boolean;
  /** Dismissing counts as the user's first choice this session. */
  onDismiss: () => void;
  onUploadLoad: (trace: AgentTraceFile) => void;
  /** Starts the flagship demo replay. */
  onWatchDemo: () => void;
  /** The demo's trace is a separate chunk, so a cold click waits on a fetch. */
  watchDemoLoading: boolean;
  onOpenTutorial: () => void;
  onBrowseExamples: () => void;
};

// First-run screen: the four ways into the app (demo, upload, tutorial,
// gallery) plus the local-processing promise.
export default function WelcomeDialog({
  open,
  onDismiss,
  onUploadLoad,
  onWatchDemo,
  watchDemoLoading,
  onOpenTutorial,
  onBrowseExamples,
}: WelcomeDialogProps) {
  // Collapsed by default and read nowhere else, so it stays local.
  const [offlineTipOpen, setOfflineTipOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onClose={onDismiss}
      aria-labelledby="welcome-dialog-title"
      maxWidth="sm"
      fullWidth
    >
      <TraceDropTarget onLoad={onUploadLoad}>
      <DialogTitle id="welcome-dialog-title" sx={{ pb: 1 }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1.5,
            pt: 1,
            textAlign: "center",
          }}
        >
          <WizardHatMark />
          <Typography component="span" variant="h5" sx={{ fontWeight: 700 }}>
            WizardFlow
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ textAlign: "center" }}>
        <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
          Replay recorded agent flows as messages moving through a graph,
          with node payloads and timing shown step by step.
        </Typography>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
            mt: 3,
          }}
        >
          <Button
            size="large"
            variant="contained"
            // The trace is fetched on click, so a cold click (before the idle
            // prefetch lands) waits on the network — swap the play icon for a
            // spinner rather than let the button look unresponsive.
            startIcon={
              watchDemoLoading ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <PlayArrowRoundedIcon />
              )
            }
            disabled={watchDemoLoading}
            onClick={onWatchDemo}
            sx={{ width: { xs: "100%", sm: 320 } }}
          >
            Watch a demo replay
          </Button>
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              gap: 1,
              width: { xs: "100%", sm: 320 },
            }}
          >
            <TraceUploader
              onLoad={onUploadLoad}
              label="Upload trace"
              size="medium"
              variant="outlined"
              sx={{ flex: 1, width: { xs: "100%", sm: "auto" } }}
            />
            <Button
              size="medium"
              variant="outlined"
              startIcon={<MenuBookOutlinedIcon />}
              onClick={onOpenTutorial}
              sx={{ flex: 1, width: { xs: "100%", sm: "auto" } }}
            >
              Tutorial
            </Button>
          </Box>
          <Button
            variant="text"
            size="small"
            onClick={onBrowseExamples}
            sx={{ textTransform: "none", color: "text.secondary" }}
          >
            More demos: Browse examples →
          </Button>
        </Box>
        <Typography
          color="text.secondary"
          variant="body2"
          sx={{ lineHeight: 1.7, mt: 2.5 }}
        >
          Your flow stays in your browser. Imported traces are processed
          locally and never uploaded — and are kept only for this tab.
        </Typography>
        <Button
          variant="text"
          size="small"
          onClick={() => setOfflineTipOpen((open) => !open)}
          aria-expanded={offlineTipOpen}
          endIcon={
            <ExpandMoreIcon
              sx={{
                transition: "transform 0.2s",
                transform: offlineTipOpen ? "rotate(180deg)" : "none",
              }}
            />
          }
          sx={{ mt: 1, textTransform: "none", color: "text.secondary" }}
        >
          How to ensure data stays local
        </Button>
        <Collapse in={offlineTipOpen}>
          <Box sx={{ mt: 1 }}>
            <LocalDataDetails />
          </Box>
        </Collapse>
      </DialogContent>
      <DialogActions
        disableSpacing
        sx={{
          justifyContent: "center",
          flexDirection: "column",
          gap: 1,
          px: 3,
          pb: 3,
          pt: 1,
        }}
      >
        <Typography
          component="a"
          href={PYTHON_SDK_QUICKSTART_URL}
          target="_blank"
          rel="noreferrer"
          variant="body2"
          sx={{
            color: "text.secondary",
            textDecoration: "none",
            "&:hover": {
              color: "primary.main",
              textDecoration: "underline",
            },
          }}
        >
          Need a flow file? Use the Python SDK
        </Typography>
      </DialogActions>
      </TraceDropTarget>
    </Dialog>
  );
}
