"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";

const connectGraphExample = `import wizardflow

wizardflow.init_from_langgraph(
    app,
    output_dir="traces",
    file_prefix="run",
)`;

const logValuesExample = `# These values already exist in your agent.
wizardflow.log(message_id, "router", "input", prompt)
wizardflow.log(message_id, "router", "route", route)
wizardflow.log(message_id, "tool_node")
wizardflow.log(message_id, "final_response", "output", response)

# Finalize the message, write it to disk, and return the trace file path.
trace_path = wizardflow.end_message(message_id)`;

type TutorialDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Loads the flagship example and starts playback (closes this dialog). */
  onWatchDemo?: () => void;
};

function CodeBlock({ children }: { children: string }) {
  return (
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
      <Box component="code">{children}</Box>
    </Box>
  );
}

export function LocalDataDetails() {
  return (
    <Box sx={{ display: "grid", gap: 1.5, textAlign: "left" }}>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        WizardFlow runs as a static browser app. An imported trace is processed
        in this tab and stored only in this tab&apos;s sessionStorage. There is no
        server-side processing.
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

export default function TutorialDialog({
  open,
  onClose,
  onWatchDemo,
}: TutorialDialogProps) {
  const [cliExpanded, setCliExpanded] = useState(false);

  const handleClose = () => {
    setCliExpanded(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
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
        Create your first trace
        <IconButton size="small" onClick={handleClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        <Box sx={{ display: "grid", gap: 2.5 }}>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ lineHeight: 1.7 }}
          >
            WizardFlow records values your agent already has and writes them to
            a local trace file.
          </Typography>
          {onWatchDemo && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowRoundedIcon />}
              onClick={() => {
                setCliExpanded(false);
                onWatchDemo();
              }}
              sx={{ justifySelf: "start", textTransform: "none" }}
            >
              See the result first — watch a demo replay
            </Button>
          )}
          <Box sx={{ display: "grid", gap: 0.75 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              1. Install
            </Typography>
            <CodeBlock>pip install wizardflow</CodeBlock>
          </Box>
          <Box sx={{ display: "grid", gap: 0.75 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              2. Connect your graph
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ lineHeight: 1.7 }}
            >
              Pass your compiled LangGraph app:
            </Typography>
            <CodeBlock>{connectGraphExample}</CodeBlock>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ lineHeight: 1.7 }}
            >
              Not using LangGraph? Provide nodes and edges with{" "}
              <Box component="code">wizardflow.init()</Box>.
            </Typography>
          </Box>
          <Box sx={{ display: "grid", gap: 0.75 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              3. Log existing values
            </Typography>
            <CodeBlock>{logValuesExample}</CodeBlock>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ lineHeight: 1.7 }}
            >
              Upload the generated .jsonl file here, or open it locally from the
              command line:
            </Typography>
            <CodeBlock>wizardflow ui trace.jsonl</CodeBlock>
            <Box
              component="button"
              type="button"
              onClick={() => setCliExpanded((expanded) => !expanded)}
              aria-expanded={cliExpanded}
              aria-controls="tutorial-cli-details"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                justifySelf: "start",
                gap: 0.5,
                p: 0,
                border: 0,
                bgcolor: "transparent",
                color: "text.secondary",
                font: "inherit",
                cursor: "pointer",
                "&:hover": { color: "primary.main" },
                "&:focus-visible": {
                  outline: "2px solid",
                  outlineColor: "primary.main",
                  outlineOffset: 2,
                  borderRadius: 0.5,
                },
              }}
            >
              <ExpandMoreIcon
                fontSize="small"
                sx={{
                  transform: cliExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: (theme) =>
                    theme.transitions.create("transform", {
                      duration: theme.transitions.duration.shortest,
                    }),
                }}
              />
              <Typography component="span" variant="body2">
                More CLI commands
              </Typography>
            </Box>
            <Collapse in={cliExpanded}>
              <Box
                id="tutorial-cli-details"
                sx={{ display: "grid", gap: 1.5, pt: 0.75 }}
              >
                <Box sx={{ display: "grid", gap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Markdown with Mermaid graph
                  </Typography>
                  <CodeBlock>
                    wizardflow md trace.jsonl -o trace.md
                  </CodeBlock>
                </Box>
                <Box sx={{ display: "grid", gap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Standalone HTML export
                  </Typography>
                  <CodeBlock>
                    wizardflow html trace.jsonl -o trace.html
                  </CodeBlock>
                </Box>
                <Box sx={{ display: "grid", gap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Pretty-printed JSON document
                  </Typography>
                  <CodeBlock>
                    wizardflow json trace.jsonl -o trace.json
                  </CodeBlock>
                </Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ lineHeight: 1.7 }}
                >
                  All commands also accept an existing .json trace.
                </Typography>
              </Box>
            </Collapse>
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
