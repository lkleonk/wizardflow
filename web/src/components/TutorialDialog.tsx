"use client";

import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";

const pythonSdkExample = `import wizardflow

app = workflow.compile()  # your compiled LangGraph app

wizardflow.init_from_langgraph(app, path="run.json")
# No LangGraph instance? Use wizardflow.init(..., nodes=[...], edges=[...]).

# Log with the node ids from your graph.
wizardflow.log("msg-1", "router", "Input", "What's the weather?")
wizardflow.log("msg-1", "router", "route", "weather")
wizardflow.log("msg-1", "tool_node")
wizardflow.log("msg-1", "final_response", "Output", "19C and cloudy.")
wizardflow.end_message("msg-1")  # writes run.json`;

type TutorialDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function LocalDataDetails() {
  return (
    <Box sx={{ display: "grid", gap: 1.5, textAlign: "left" }}>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        WizardFlow runs as a static browser app. Imported JSON is parsed in this
        tab and stored only in this tab&apos;s sessionStorage; there is no upload
        step or server-side processing.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        For extra assurance, you can cut the tab&apos;s connection after opening
        WizardFlow and it keeps working. In Chrome: open DevTools
        (Ctrl&nbsp;+&nbsp;Shift&nbsp;+&nbsp;I), go to the{" "}
        <Box component="strong" sx={{ fontWeight: 600 }}>
          Network
        </Box>{" "}
        tab, and set the throttling dropdown to{" "}
        <Box component="strong" sx={{ fontWeight: 600 }}>
          Offline
        </Box>
        . While DevTools stays open the tab is offline, yet importing and
        replaying still work.
      </Typography>
    </Box>
  );
}

export default function TutorialDialog({ open, onClose }: TutorialDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="tutorial-dialog-title"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle
        id="tutorial-dialog-title"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          pb: 1,
        }}
      >
        Tutorial
        <IconButton size="small" onClick={onClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        <Box sx={{ display: "grid", gap: 2.25 }}>
          <Box sx={{ display: "grid", gap: 0.75 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Start
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ lineHeight: 1.7 }}
            >
              Upload a WizardFlow JSON file, browse a bundled example, or create
              a trace with the Python SDK and open it in the viewer.
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.25,
                overflowX: "auto",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "action.hover",
                color: "text.secondary",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 12,
                lineHeight: 1.55,
                whiteSpace: "pre",
              }}
            >
              <Box component="code">{pythonSdkExample}</Box>
            </Box>
          </Box>
          <Box sx={{ display: "grid", gap: 0.75 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Local data
            </Typography>
            <LocalDataDetails />
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
