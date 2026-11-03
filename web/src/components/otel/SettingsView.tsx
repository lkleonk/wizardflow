import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useColorScheme } from "@mui/material/styles";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CloseIcon from "@mui/icons-material/Close";
import type {
  ApiCoverage,
  ApiMappingSaved,
  ApiMeta,
  ApiProject,
  ApiReceiver,
  ApiSettings,
  AttributeMapping,
  MappingConcept,
} from "@/types/otelstore";
import { apiPath, formatNsDateTime, sendApi, useApi } from "@/utils/otelApi";
import {
  isAttributeKey,
  setDisplayPrefs,
  useDisplayPrefs,
  type DisplayPrefs,
  type TimeRange,
} from "@/utils/otelDisplay";
import { goTo, type OtelRoute, type SettingsSection } from "@/utils/otelRoute";
import { LoadError, Loading, Mono } from "./OtelBits";

const SECTIONS: [SettingsSection, string][] = [
  ["display", "Display"],
  ["mapping", "Attribute mapping"],
  ["data", "Data and import"],
  ["live", "Live receiver"],
];

export default function SettingsView({ route, meta }: { route: OtelRoute; meta: ApiMeta }) {
  const section = route.sec ?? "display";
  return (
    <Box sx={{ display: "flex", gap: 3, p: { xs: 1.5, sm: 2 }, flexWrap: { xs: "wrap", md: "nowrap" } }}>
      <List dense sx={{ width: { xs: "100%", md: 200 }, flex: "none", p: 0 }} aria-label="Settings sections">
        {SECTIONS.map(([key, label]) => (
          <ListItemButton
            key={key}
            selected={section === key}
            onClick={() => goTo({ ...route, sec: key })}
            sx={{ borderRadius: 1.5 }}
          >
            <ListItemText primary={label} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ flex: 1, minWidth: 0, maxWidth: 980 }}>
        {section === "mapping" && <MappingSection route={route} />}
        {section === "display" && <DisplaySection />}
        {section === "data" && <DataSection meta={meta} />}
        {section === "live" && <LiveSection receiver={meta.receiver} />}
      </Box>
    </Box>
  );
}

function SectionHead({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", minHeight: 40 }}>
        <Typography variant="h6" sx={{ fontWeight: 650, flex: 1 }}>
          {title}
        </Typography>
        {children}
      </Box>
      <Typography sx={{ fontSize: 13, color: "text.secondary", maxWidth: 720 }}>{sub}</Typography>
    </Box>
  );
}

// --- attribute mapping -------------------------------------------------------

const CONCEPTS: { id: MappingConcept; label: string; hint: string; global?: boolean }[] = [
  { id: "project", label: "Project", hint: "Groups traces into projects. Read from resource attributes; a change applies to later imports.", global: true },
  { id: "execution", label: "Workflow execution", hint: "One message in graph replay. Falls back to the trace." },
  { id: "conversation", label: "Conversation", hint: "Joins executions into one graph replay." },
  { id: "user", label: "User", hint: "Shown on traces." },
  { id: "node", label: "Node", hint: "A step on the WizardFlow graph. Enables graph replay." },
  { id: "node_kind", label: "Node kind", hint: "Colour and icon of a node." },
  { id: "model", label: "Model", hint: "Model column." },
  { id: "input_tokens", label: "Input tokens", hint: "Token columns." },
  { id: "output_tokens", label: "Output tokens", hint: "Token columns." },
  { id: "input", label: "Input payload", hint: "Node input in graph replay." },
  { id: "output", label: "Output payload", hint: "Node output in graph replay." },
  { id: "payloads", label: "Extra payloads", hint: "More payloads in graph replay. A trailing * matches a prefix." },
];

// The shipped defaults: mirrors DEFAULT_MAPPING in sdk/python/src/wizardflow/store/settings.py.
const WIZARDFLOW_DEFAULTS: Record<MappingConcept, string[]> = {
  project: ["openinference.project.name", "service.name"],
  execution: ["wizardflow.message.id"],
  conversation: ["gen_ai.conversation.id", "session.id"],
  user: ["user.id"],
  node: ["wizardflow.node.id"],
  node_kind: ["wizardflow.node.kind", "gen_ai.operation.name", "openinference.span.kind"],
  model: ["gen_ai.request.model", "llm.model_name"],
  input_tokens: ["gen_ai.usage.input_tokens", "wizardflow.usage.input_tokens"],
  output_tokens: ["gen_ai.usage.output_tokens", "wizardflow.usage.output_tokens"],
  input: ["gen_ai.input.messages", "gen_ai.tool.call.arguments", "gen_ai.retrieval.query.text", "wizardflow.input", "input.value"],
  output: ["gen_ai.output.messages", "gen_ai.tool.call.result", "gen_ai.retrieval.documents", "wizardflow.output", "output.value"],
  payloads: ["wizardflow.payload.*"],
};

// Starting points to review, not guarantees: the OpenInference and Langfuse
// keys are best effort, so check them against a real export.
const PRESETS: Record<string, AttributeMapping> = {
  "WizardFlow (default)": WIZARDFLOW_DEFAULTS,
  "OTel GenAI semconv": {
    project: ["service.name"],
    execution: [],
    conversation: ["gen_ai.conversation.id"],
    node: ["gen_ai.agent.name"],
    node_kind: ["gen_ai.operation.name"],
    model: ["gen_ai.request.model"],
    input_tokens: ["gen_ai.usage.input_tokens"],
    output_tokens: ["gen_ai.usage.output_tokens"],
    input: ["gen_ai.input.messages", "gen_ai.tool.call.arguments"],
    output: ["gen_ai.output.messages", "gen_ai.tool.call.result"],
    payloads: [],
  },
  "OpenInference (Phoenix)": {
    project: ["openinference.project.name", "service.name"],
    execution: [],
    conversation: ["session.id"],
    node: ["graph.node.id"],
    node_kind: ["openinference.span.kind"],
    model: ["llm.model_name"],
    input_tokens: ["llm.token_count.prompt"],
    output_tokens: ["llm.token_count.completion"],
    input: ["input.value"],
    output: ["output.value"],
    payloads: ["metadata"],
  },
  Langfuse: {
    project: ["service.name"],
    execution: [],
    conversation: ["langfuse.session.id", "session.id"],
    node: ["gen_ai.agent.name"],
    node_kind: ["langfuse.observation.type", "gen_ai.operation.name"],
    model: ["langfuse.observation.model.name", "gen_ai.request.model"],
    input_tokens: ["gen_ai.usage.input_tokens"],
    output_tokens: ["gen_ai.usage.output_tokens"],
    input: ["langfuse.observation.input"],
    output: ["langfuse.observation.output"],
    payloads: ["langfuse.observation.metadata.*"],
  },
};

type Mapping = Record<MappingConcept, string[]>;

function effective(settings: ApiSettings, scope: string | undefined): Mapping {
  const overrides = scope ? settings.mapping.overrides[scope] ?? {} : {};
  return Object.fromEntries(
    CONCEPTS.map(({ id }) => [id, overrides[id] ?? settings.mapping.defaults[id] ?? []])
  ) as Mapping;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((key, i) => key === b[i]);

function MappingSection({ route }: { route: OtelRoute }) {
  const scope = route.scope;
  const projects = useApi<ApiProject[]>(apiPath("projects"));
  const loaded = useApi<ApiSettings>(apiPath("settings"));
  // The latest save's answer replaces the loaded settings; `version` refreshes coverage.
  const [saved, setSaved] = useState<{ settings: ApiSettings; version: number } | null>(null);
  const settings = saved?.settings ?? loaded.data;
  const coverage = useApi<ApiCoverage>(
    settings ? apiPath("settings/coverage", { project: scope, v: saved?.version }) : null
  );
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const current = settings ? effective(settings, scope) : null;
  const draftKey = JSON.stringify([scope ?? null, current]);
  const [draft, setDraft] = useState<{ key: string; mapping: Mapping } | null>(null);
  if (current && draft?.key !== draftKey) setDraft({ key: draftKey, mapping: current });

  if (loaded.error) return <LoadError error={loaded.error} />;
  if (!settings || !current || !draft) return <Loading />;
  const mapping = draft.mapping;
  const editable = CONCEPTS.filter((c) => !(c.global && scope));
  const dirty = editable.filter((c) => !same(mapping[c.id], current[c.id])).length;
  const overrides = scope ? settings.mapping.overrides[scope] ?? {} : {};
  const edit = (id: MappingConcept, keys: string[]) => {
    setMessage(null);
    setDraft({ key: draft.key, mapping: { ...mapping, [id]: keys } });
  };

  const run = async (request: () => Promise<ApiMappingSaved>) => {
    setBusy(true);
    try {
      const result = await request();
      setSaved({ settings: result, version: (saved?.version ?? 0) + 1 });
      setMessage({
        text: `Re-indexed ${result.reindexed.traces} traces · ${result.reindexed.replayable} open in graph replay`,
      });
    } catch (error) {
      setMessage({ text: (error as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const apply = () =>
    run(() =>
      sendApi<ApiMappingSaved>("PUT", "/api/settings/mapping", {
        project: scope ?? null,
        mapping: Object.fromEntries(editable.map((c) => [c.id, mapping[c.id]])),
      })
    );
  const reset = () =>
    run(() => sendApi<ApiMappingSaved>("DELETE", apiPath("settings/mapping", { project: scope })));

  return (
    <>
      <SectionHead
        title="Attribute mapping"
        sub="Which OTel attribute means what. The first key found wins. Raw attributes are always kept, so a change only re-reads them. Stored in the database, so the mapping travels with the file."
      >
        <Select
          size="small"
          value=""
          displayEmpty
          renderValue={() => "Load preset…"}
          onChange={(e) => {
            const preset = PRESETS[String(e.target.value)];
            if (!preset) return;
            const next = { ...mapping };
            for (const { id } of editable) if (preset[id]) next[id] = [...preset[id]!];
            setDraft({ key: draft.key, mapping: next });
            setMessage({ text: `Loaded “${e.target.value}”. Review the keys, then apply.` });
          }}
          sx={{ fontSize: 13 }}
          aria-label="Load a preset"
        >
          {Object.keys(PRESETS).map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={scope ?? ""}
          displayEmpty
          onChange={(e) => goTo({ ...route, scope: String(e.target.value) || undefined })}
          sx={{ fontSize: 13, minWidth: 200 }}
          aria-label="Applies to"
        >
          <MenuItem value="">Defaults (all projects)</MenuItem>
          {(projects.data ?? []).map((project) => (
            <MenuItem key={project.id} value={project.name}>
              {project.name} (override)
            </MenuItem>
          ))}
        </Select>
      </SectionHead>

      <Paper variant="outlined">
        {CONCEPTS.map((concept, i) => {
          const disabled = !!(concept.global && scope);
          const changed = !same(mapping[concept.id], current[concept.id]);
          return (
            <Box key={concept.id}>
              {i > 0 && <Divider />}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "200px minmax(0, 1fr) 150px" },
                  gap: { xs: 1, md: 2 },
                  px: 2,
                  py: 1.25,
                  alignItems: "start",
                  opacity: disabled ? 0.55 : 1,
                }}
              >
                <Box>
                  <Typography sx={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 0.75 }}>
                    {concept.label}
                    {scope && overrides[concept.id] && (
                      <Tooltip title="Differs from the defaults for this project">
                        <Chip label="override" size="small" color="secondary" variant="outlined" sx={{ height: 18, fontSize: 10.5 }} />
                      </Tooltip>
                    )}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                    {disabled ? "Global only: it decides which project a trace belongs to." : concept.hint}
                  </Typography>
                </Box>
                <KeyList
                  keys={mapping[concept.id]}
                  disabled={disabled}
                  ordered
                  trailing={concept.id === "execution" ? "trace" : undefined}
                  onChange={(keys) => edit(concept.id, keys)}
                />
                <CoverageCell
                  concept={concept.id}
                  coverage={coverage.data?.[concept.id]}
                  pending={changed}
                />
              </Box>
            </Box>
          );
        })}
      </Paper>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
        <Typography sx={{ flex: 1, fontSize: 12.5, color: message?.error ? "error.main" : "text.secondary" }}>
          {message?.text ??
            (dirty
              ? `${dirty} unsaved change${dirty === 1 ? "" : "s"} · re-index rewrites mapped columns and roll-ups only`
              : "No changes")}
        </Typography>
        <Button
          size="small"
          disabled={busy || (scope !== undefined && Object.keys(overrides).length === 0)}
          onClick={() => void reset()}
        >
          {scope ? "Remove overrides" : "Reset to defaults"}
        </Button>
        <Button size="small" variant="contained" disabled={busy || dirty === 0} onClick={() => void apply()}>
          {busy ? "Re-indexing…" : "Apply and re-index"}
        </Button>
      </Box>
    </>
  );
}

function CoverageCell({
  concept,
  coverage,
  pending,
}: {
  concept: MappingConcept;
  coverage?: ApiCoverage[MappingConcept];
  pending: boolean;
}) {
  let text = "";
  let warn = false;
  if (pending) text = "recount on apply";
  else if (coverage) {
    if (concept === "project") text = `${coverage.matched} project${coverage.matched === 1 ? "" : "s"}`;
    else if (concept === "execution") text = `${coverage.matched} in ${coverage.total} traces`;
    else text = `${coverage.matched} / ${coverage.total} ${coverage.unit}`;
    warn = concept !== "execution" && concept !== "project" && coverage.matched === 0 && (coverage.total ?? 0) > 0;
  }
  return (
    <Typography
      sx={{
        fontSize: 12,
        fontFamily: "var(--font-geist-mono), monospace",
        textAlign: { md: "right" },
        color: pending ? "info.main" : warn ? "warning.main" : "text.secondary",
        pt: { md: 0.5 },
      }}
    >
      {text}
    </Typography>
  );
}

/**
 * An editable list of attribute keys: × removes, "+ key" adds with
 * validation. `ordered` shows "then" between keys (fallback order) and lets
 * a key move up.
 */
function KeyList({
  keys,
  onChange,
  disabled,
  ordered,
  trailing,
}: {
  keys: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
  ordered?: boolean;
  trailing?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const key = text.trim();
    if (!key) return setError("Enter an attribute key");
    if (!isAttributeKey(key)) return setError("Letters, digits, dots, _ and -, optional trailing *");
    if (keys.includes(key)) return setError("Already in the list");
    onChange([...keys, key]);
    setText("");
    setError("");
    setAdding(false);
  };
  const separator = (
    <Typography component="span" sx={{ fontSize: 11.5, color: "text.disabled", mx: 0.25 }}>
      then
    </Typography>
  );
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5 }}>
      {keys.map((key, i) => (
        <Box key={key} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
          {ordered && i > 0 && separator}
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              pl: 0.75,
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 12,
              bgcolor: "action.hover",
              ...(disabled && { pr: 0.75 }),
            }}
          >
            {key}
            {!disabled && ordered && i > 0 && (
              <IconButton
                size="small"
                aria-label={`Move ${key} up`}
                title="Move up"
                onClick={() => onChange([...keys.slice(0, i - 1), key, keys[i - 1], ...keys.slice(i + 1)])}
                sx={{ p: 0.25 }}
              >
                <ArrowUpwardIcon sx={{ fontSize: 13 }} />
              </IconButton>
            )}
            {!disabled && (
              <IconButton
                size="small"
                aria-label={`Remove ${key}`}
                title="Remove"
                onClick={() => onChange(keys.filter((k) => k !== key))}
                sx={{ p: 0.25 }}
              >
                <CloseIcon sx={{ fontSize: 13 }} />
              </IconButton>
            )}
          </Box>
        </Box>
      ))}
      {trailing && (
        <>
          {keys.length > 0 && separator}
          <Tooltip title="Always the last fallback">
            <Box component="span" sx={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, color: "text.secondary", border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1, px: 0.75 }}>
              {trailing}
            </Box>
          </Tooltip>
        </>
      )}
      {keys.length === 0 && !trailing && (
        <Typography component="span" sx={{ fontSize: 12, color: "text.disabled" }}>
          none
        </Typography>
      )}
      {!disabled &&
        (adding ? (
          <TextField
            size="small"
            autoFocus
            value={text}
            placeholder="attribute.key or prefix.*"
            error={!!error}
            helperText={error || undefined}
            onChange={(e) => {
              setText(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") {
                setAdding(false);
                setError("");
              }
            }}
            onBlur={() => !text && setAdding(false)}
            slotProps={{ htmlInput: { style: { fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, padding: "3px 8px" } } }}
            sx={{ width: 230 }}
          />
        ) : (
          <Button size="small" onClick={() => setAdding(true)} sx={{ minWidth: 0, px: 0.75, fontSize: 12, textTransform: "none" }}>
            + key
          </Button>
        ))}
    </Box>
  );
}

// --- display -----------------------------------------------------------------

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        py: 1.25,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ minWidth: 200, flex: "1 1 240px" }}>
        <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{label}</Typography>
        {hint && <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{hint}</Typography>}
      </Box>
      <Box sx={{ display: "flex", justifyContent: "flex-end", flex: "1 1 280px" }}>{children}</Box>
    </Box>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <ToggleButtonGroup size="small" exclusive value={value} onChange={(_, v: T | null) => v && onChange(v)} aria-label={label}>
      {options.map(([key, text]) => (
        <ToggleButton key={key} value={key} sx={{ textTransform: "none", px: 1.5 }}>
          {text}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

function DisplaySection() {
  const prefs = useDisplayPrefs();
  const { mode, setMode } = useColorScheme();
  const set = (change: Partial<DisplayPrefs>) => setDisplayPrefs(change);
  return (
    <>
      <SectionHead title="Display" sub="How the dashboard looks. Saved in this browser only, not in the database." />
      <SettingRow label="Timestamps" hint="Started column in the trace list.">
        <Segmented
          label="Timestamps"
          value={prefs.time}
          options={[["relative", "Relative"], ["absolute", "Absolute"]]}
          onChange={(time) => set({ time })}
        />
      </SettingRow>
      <SettingRow label="Theme">
        <Segmented
          label="Theme"
          value={(mode ?? "system") as "system" | "light" | "dark"}
          options={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]}
          onChange={(value) => setMode(value)}
        />
      </SettingRow>
      <SettingRow label="Default time range" hint="Trace lists open with this range.">
        <Segmented<TimeRange>
          label="Default time range"
          value={prefs.range}
          options={[["1h", "1h"], ["24h", "24h"], ["7d", "7d"], ["all", "All"]]}
          onChange={(range) => set({ range })}
        />
      </SettingRow>
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5, mt: 3 }}>
        Attributes in the span inspector
      </Typography>
      <SettingRow label="Pinned" hint="Shown first on every span that has them. Pin from the inspector too. A trailing * matches a prefix.">
        <KeyList keys={prefs.pins} ordered onChange={(pins) => set({ pins })} />
      </SettingRow>
      <SettingRow label="Hidden" hint="Collapsed into an “N hidden” line, e.g. telemetry.* or code.*.">
        <KeyList keys={prefs.hidden} onChange={(hidden) => set({ hidden })} />
      </SettingRow>
      <SettingRow label="Order inside a group">
        <Segmented
          label="Order inside a group"
          value={prefs.attrOrder}
          options={[["sent", "As sent"], ["az", "A–Z"]]}
          onChange={(attrOrder) => set({ attrOrder })}
        />
      </SettingRow>
    </>
  );
}

// --- data and import ---------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function Command({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        mt: 1,
        p: 1.25,
        borderRadius: 1.5,
        bgcolor: "action.hover",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 12.5,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </Box>
  );
}

function DataSection({ meta }: { meta: ApiMeta }) {
  const projects = useApi<ApiProject[]>(apiPath("projects"), { live: true });
  const totals = (projects.data ?? []).reduce(
    (sum, p) => ({ traces: sum.traces + p.traceCount, spans: sum.spans + p.spanCount, logs: sum.logs + p.logCount }),
    { traces: 0, spans: 0, logs: 0 }
  );
  const upToDate = meta.schemaVersion === meta.latestSchemaVersion;
  return (
    <>
      <SectionHead title="Data and import" sub="The SQLite file behind this dashboard." />
      <SettingRow label="Database">
        <Mono sx={{ fontSize: 12.5, overflowWrap: "anywhere", textAlign: "right" }}>{meta.dbPath}</Mono>
      </SettingRow>
      <SettingRow label="Schema">
        <Mono sx={{ fontSize: 12.5 }}>
          v{meta.schemaVersion} · {upToDate ? "up to date" : `v${meta.latestSchemaVersion} available: wizardflow db migrate`}
        </Mono>
      </SettingRow>
      <SettingRow label="Contents">
        <Mono sx={{ fontSize: 12.5 }}>
          {projects.data
            ? `${projects.data.length} projects · ${totals.traces} traces · ${totals.spans} spans · ${totals.logs} logs · ${formatBytes(meta.dbSizeBytes)}`
            : "…"}
        </Mono>
      </SettingRow>
      <SettingRow label="WizardFlow">
        <Mono sx={{ fontSize: 12.5 }}>{meta.wizardflowVersion}</Mono>
      </SettingRow>
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5, mt: 3 }}>
        Import more
      </Typography>
      <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.5 }}>
        Importing runs from the command line. A WizardFlow run first becomes OTLP JSON:
      </Typography>
      <Command>
        wizardflow otel export run.jsonl --out run.otlp.jsonl{"\n"}wizardflow db import run.otlp.jsonl collector/out/*.json
      </Command>
    </>
  );
}

// --- live receiver -----------------------------------------------------------

function LiveSection({ receiver }: { receiver: ApiReceiver }) {
  if (!receiver.enabled) {
    return (
      <>
        <SectionHead title="Live receiver" sub="Receive OTLP over HTTP while wizardflow serve runs, so apps send traces and logs here directly.">
          <Chip label="off" size="small" variant="outlined" />
        </SectionHead>
        <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
          Restart the dashboard with the receiver on. It listens on 4318, the standard OTLP/HTTP port:
        </Typography>
        <Command>wizardflow serve --otlp</Command>
        <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 2 }}>
          Use <Mono sx={{ fontSize: 12.5 }}>--otlp-port</Mono> if a Collector already runs there.
        </Typography>
      </>
    );
  }
  return (
    <>
      <SectionHead title="Live receiver" sub="Apps send OTLP here while wizardflow serve runs. New data shows up on every page within a few seconds.">
        <Chip label="receiving" size="small" color="success" variant="outlined" />
      </SectionHead>
      <SettingRow label="Endpoint" hint="POST /v1/traces and /v1/logs, as protobuf or JSON, optionally gzipped.">
        <Mono sx={{ fontSize: 12.5 }}>{receiver.endpoint}</Mono>
      </SettingRow>
      <SettingRow label="Received" hint="Since this wizardflow serve started.">
        <Mono sx={{ fontSize: 12.5 }}>
          {receiver.requests} requests · {receiver.spans} spans · {receiver.logs} logs
          {receiver.rejected > 0 && ` · ${receiver.rejected} rejected`}
        </Mono>
      </SettingRow>
      <SettingRow label="Last request">
        <Mono sx={{ fontSize: 12.5 }}>
          {receiver.lastReceivedNs ? formatNsDateTime(receiver.lastReceivedNs) : "none yet"}
        </Mono>
      </SettingRow>
      {receiver.lastError && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Last refused request: {receiver.lastError}
        </Alert>
      )}
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5, mt: 3 }}>
        Point your app here
      </Typography>
      <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.5 }}>
        Any OpenTelemetry SDK reads this variable. Python apps need the OTLP/HTTP exporter (opentelemetry-exporter-otlp-proto-http).
      </Typography>
      <Command>OTEL_EXPORTER_OTLP_ENDPOINT={receiver.endpoint}</Command>
      <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 2 }}>
        Metrics are not stored. If your app exports them too, turn them off to keep its log quiet:
      </Typography>
      <Command>OTEL_METRICS_EXPORTER=none</Command>
    </>
  );
}
