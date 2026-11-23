"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
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

# Finalize the execution, write it to disk, and return the trace file path.
trace_path = trace.end_message(message_id)`;

const otelEnvExample = `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`;

const otelInstallExample = `pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http`;

const otelLiveExample = `trace = wizardflow.init_from_langgraph(
    app,
    name="my-agent",              # the project in the dashboard
    output_dir="traces",
    otel=True,
    otel_endpoint="http://localhost:4318/v1/traces",
)

# Record executions as in the Replay tab, then flush on shutdown.
trace.close_otel()`;

export type TutorialTab = "replay" | "dashboard";

type TutorialDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Loads the flagship example and starts playback (closes this dialog). */
  onWatchDemo?: () => void;
  /** The tab shown when the dialog first opens. */
  initialTab?: TutorialTab;
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

function Body({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
      {children}
    </Typography>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: "grid", gap: 0.75 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** A labelled example inside a step: a short bold line, then its code. */
function Example({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: "grid", gap: 0.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

/** A text toggle that folds optional detail in and out. */
function Expander({
  id,
  label,
  strong = false,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  strong?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <Box
        component="button"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={id}
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
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: (theme) =>
              theme.transitions.create("transform", {
                duration: theme.transitions.duration.shortest,
              }),
          }}
        />
        <Typography
          component="span"
          variant={strong ? "subtitle2" : "body2"}
          sx={strong ? { fontWeight: 700 } : undefined}
        >
          {label}
        </Typography>
      </Box>
      <Collapse in={expanded}>
        <Box id={id} sx={{ display: "grid", gap: 1.25, pt: 0.75 }}>
          {children}
        </Box>
      </Collapse>
    </>
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

function ReplayTab({
  cliExpanded,
  onToggleCli,
}: {
  cliExpanded: boolean;
  onToggleCli: () => void;
}) {
  return (
    <>
      <Body>
        <b>The most lightweight way to observe your agent:</b> record your graph
        one workflow execution at a time into a JSONL file, then replay that
        run. No server, no database, no account.
      </Body>
      <Step title="1. Install">
        <CodeBlock>pip install wizardflow</CodeBlock>
      </Step>
      <Step title="2. Connect your graph">
        <Body>Pass your compiled LangGraph app:</Body>
        <CodeBlock>{connectGraphExample}</CodeBlock>
        <Body>
          Not using LangGraph? Provide nodes and edges with{" "}
          <Box component="code">wizardflow.init()</Box>.
        </Body>
      </Step>
      <Step title="3. Record a workflow execution">
        <CodeBlock>{logValuesExample}</CodeBlock>
        <Body>
          The node context manager records reliable start and end timing.
          Semantic methods preserve input and output meaning; use{" "}
          <Box component="code">node.log()</Box> for your own labels.
        </Body>
      </Step>
      <Step title="4. Replay the JSONL">
        <Body>
          Upload the generated .jsonl file here, or open it locally from the
          command line:
        </Body>
        <CodeBlock>wizardflow replay run.jsonl</CodeBlock>
        <Expander
          id="tutorial-cli-details"
          label="More CLI commands"
          expanded={cliExpanded}
          onToggle={onToggleCli}
        >
          <Example label="Markdown with Mermaid graph">
            <CodeBlock>wizardflow md run.jsonl -o run.md</CodeBlock>
          </Example>
          <Example label="Standalone HTML export">
            <CodeBlock>wizardflow html run.jsonl -o run.html</CodeBlock>
          </Example>
          <Example label="Pretty-printed JSON document">
            <CodeBlock>wizardflow json run.jsonl -o run.json</CodeBlock>
          </Example>
          <Body>All commands also accept an existing .json trace.</Body>
        </Expander>
      </Step>
    </>
  );
}

function DashboardTab({
  liveExpanded,
  onToggleLive,
}: {
  liveExpanded: boolean;
  onToggleLive: () => void;
}) {
  return (
    <>
      <Body>
        A local dashboard over all your runs and any OpenTelemetry data: projects,
        traces, logs, and every span. It runs on your machine, stores everything
        in one SQLite file, and needs no account or collector.
      </Body>
      <Step title="1. Install and open the dashboard">
        <CodeBlock>{"pip install wizardflow\nwizardflow dashboard"}</CodeBlock>
        <Body>
          The dashboard opens in your browser and receives OpenTelemetry on port
          4318 while it runs. Its data lives in{" "}
          <Box component="code">.wizardflow/wizardflow.db</Box> in the folder you
          start it from.
        </Body>
      </Step>
      <Step title="2. Get your data in">
        <Example label="From files">
          <CodeBlock>wizardflow dashboard run.jsonl</CodeBlock>
        </Example>
        <Body>
          Pass your WizardFlow runs or OpenTelemetry files (OTLP JSON, as the
          Collector&apos;s file exporter writes it), one or several. The type is
          detected automatically. They are imported, then the dashboard opens on
          their project. Importing a file twice is safe. To import without
          opening it, use <Box component="code">wizardflow db import FILE</Box>.
        </Body>
        <Example label="Live, from any app with OpenTelemetry">
          <CodeBlock>{otelEnvExample}</CodeBlock>
        </Example>
        <Body>
          Set this in your app&apos;s environment while the dashboard runs.
        </Body>
      </Step>
      <Step title="3. Explore">
        <Body>
          Open a project, then a trace: each workflow execution is one trace,
          shown as the usual span waterfall. <b>Open graph replay</b> switches to
          the replay on your agent&apos;s graph, with every execution as a chip
          along the bottom strip.
        </Body>
        <Body>
          WizardFlow runs open in graph replay as they are. For spans from other
          tools, choose which attribute names a graph node under Settings →
          Attribute mapping. There are presets for the OTel GenAI conventions,
          OpenInference (Phoenix), and Langfuse.
        </Body>
      </Step>
      <Expander
        id="tutorial-otel-live"
        label="Optional: send while recording"
        strong
        expanded={liveExpanded}
        onToggle={onToggleLive}
      >
        <Body>
          WizardFlow can export each execution as OpenTelemetry while it records,
          to this dashboard or to any OTLP backend, such as Phoenix or Langfuse.
          The JSONL file is still written, and no extra packages are needed:
        </Body>
        <CodeBlock>{otelLiveExample}</CodeBlock>
        <Body>
          If your app already uses OpenTelemetry and you want these spans inside
          its traces, install the OpenTelemetry SDK; WizardFlow then sends through it:
        </Body>
        <CodeBlock>{otelInstallExample}</CodeBlock>
        <Body>
          To send a run you already recorded:{" "}
          <Box component="code">wizardflow otel export run.jsonl --endpoint URL</Box>.
        </Body>
      </Expander>
    </>
  );
}

export default function TutorialDialog({
  open,
  onClose,
  onWatchDemo,
  initialTab = "replay",
}: TutorialDialogProps) {
  const [tab, setTab] = useState<TutorialTab>(initialTab);
  const [cliExpanded, setCliExpanded] = useState(false);
  const [liveExpanded, setLiveExpanded] = useState(false);

  const handleClose = () => {
    setCliExpanded(false);
    setLiveExpanded(false);
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
          pb: 0.5,
        }}
      >
        Get started
        <IconButton size="small" onClick={handleClose} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <Tabs
        value={tab}
        onChange={(_, value: TutorialTab) => setTab(value)}
        aria-label="Ways to use WizardFlow"
        variant="fullWidth"
        sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab
          value="replay"
          id="tutorial-tab-replay"
          aria-controls="tutorial-panel"
          label="Replay a run"
          sx={{ textTransform: "none" }}
        />
        <Tab
          value="dashboard"
          id="tutorial-tab-dashboard"
          aria-controls="tutorial-panel"
          label="Dashboard & OpenTelemetry"
          sx={{ textTransform: "none" }}
        />
      </Tabs>
      <DialogContent sx={{ pt: 2.5, pb: 3 }}>
        <Box
          id="tutorial-panel"
          role="tabpanel"
          aria-labelledby={`tutorial-tab-${tab}`}
          sx={{ display: "grid", gap: 2.5 }}
        >
          {/* The demo is a JSONL replay, so it belongs to that tab only. */}
          {onWatchDemo && tab === "replay" && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowRoundedIcon />}
              onClick={() => {
                setCliExpanded(false);
                setLiveExpanded(false);
                onWatchDemo();
              }}
              sx={{ justifySelf: "start", textTransform: "none" }}
            >
              See the result first — watch a demo replay
            </Button>
          )}
          {tab === "replay" ? (
            <ReplayTab
              cliExpanded={cliExpanded}
              onToggleCli={() => setCliExpanded((expanded) => !expanded)}
            />
          ) : (
            <DashboardTab
              liveExpanded={liveExpanded}
              onToggleLive={() => setLiveExpanded((expanded) => !expanded)}
            />
          )}
          <Box sx={{ display: "grid", gap: 0.75 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Local data
            </Typography>
            {tab === "replay" ? (
              <LocalDataDetails />
            ) : (
              <Body>
                The dashboard is served from your machine and reads only its own
                database file. Nothing is sent anywhere unless you export it.
              </Body>
            )}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
