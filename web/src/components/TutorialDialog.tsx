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

trace = wizardflow.init_from_langgraph(
    app,
    output_dir="traces",
    file_prefix="run",
)`;

const logValuesExample = `with trace.node(message_id, "generator") as node:
    node.log_input(prompt)
    response = ...
    node.log_output(response)

# Finalize the message, write it to disk, and return the trace file path.
trace_path = trace.end_message(message_id)`;

const otelInstallExample = `pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http`;

const otelExample = `trace = wizardflow.init_from_langgraph(
    app,
    name="my-agent",
    output_dir="traces",
    file_prefix="run",
    otel=True,
    otel_endpoint="http://localhost:4318/v1/traces",
    otel_trace_scope="message",
)

# Record messages as above, then flush WizardFlow-owned OTel resources.
trace.close_otel()`;

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
        The viewer source is public in the{" "}
        <Box
          component="a"
          href="https://github.com/lkleonk/wizardflow"
          target="_blank"
          rel="noreferrer"
          sx={{ color: "primary.main" }}
        >
          WizardFlow GitHub repository
        </Box>
        . The hosted app is built and deployed from that repository to Vercel
        through continuous deployment, so you can inspect the code that handles
        imported files.
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        WizardFlow continues working offline after the static app has loaded.
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
  const [otelExpanded, setOtelExpanded] = useState(false);

  const handleClose = () => {
    setCliExpanded(false);
    setOtelExpanded(false);
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
            WizardFlow records your graph one message at a time and writes a
            replayable JSONL file. OpenTelemetry export is also available.
          </Typography>
          {onWatchDemo && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowRoundedIcon />}
              onClick={() => {
                setCliExpanded(false);
                setOtelExpanded(false);
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
              3. Record a message
            </Typography>
            <CodeBlock>{logValuesExample}</CodeBlock>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ lineHeight: 1.7 }}
            >
              The node context manager records reliable start and end timing.
              Semantic methods preserve input and output meaning; use{" "}
              <Box component="code">node.log()</Box> for your own labels.
            </Typography>
          </Box>
          <Box sx={{ display: "grid", gap: 0.75 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              4. Replay the JSONL
            </Typography>
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
            <Box
              component="button"
              type="button"
              onClick={() => setOtelExpanded((expanded) => !expanded)}
              aria-expanded={otelExpanded}
              aria-controls="tutorial-otel-details"
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
                  transform: otelExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: (theme) =>
                    theme.transitions.create("transform", {
                      duration: theme.transitions.duration.shortest,
                    }),
                }}
              />
              <Typography component="span" variant="subtitle2" sx={{ fontWeight: 700 }}>
                Optional: export to OpenTelemetry
              </Typography>
            </Box>
            <Collapse in={otelExpanded}>
              <Box
                id="tutorial-otel-details"
                sx={{ display: "grid", gap: 1.25, pt: 0.75 }}
              >
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ lineHeight: 1.7 }}
                >
                  OpenTelemetry is the common interoperability layer between
                  instrumented applications and many observability systems,
                  including AI observability platforms. WizardFlow can send
                  OTLP traces to any compatible endpoint, so the same SDK works
                  with Phoenix, Langfuse, and other tools that accept
                  OpenTelemetry. The JSONL artifact remains available, and
                  content export stays off by default.
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Install the optional OpenTelemetry packages
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ lineHeight: 1.7 }}
                >
                  WizardFlow loads these packages only when OTel export is
                  enabled; the base JSONL recorder remains dependency-free.
                </Typography>
                <CodeBlock>{otelInstallExample}</CodeBlock>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Enable OTLP export when initializing WizardFlow
                </Typography>
                <CodeBlock>{otelExample}</CodeBlock>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ lineHeight: 1.7 }}
                >
                  <Box component="code">name</Box> becomes the project name for
                  a private OTLP provider. Use{" "}
                  <Box component="code">otel_trace_scope=&quot;message&quot;</Box>{" "}
                  for one isolated trace per message, or omit it to keep the
                  backward-compatible recording-wide trace.
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ lineHeight: 1.7 }}
                >
                  Importing existing OpenTelemetry traces into WizardFlow is
                  planned for a future release.
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
