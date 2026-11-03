import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { TraceFlag } from "@/types/otelstore";
import { severityLevel, type SeverityLevel } from "@/utils/otelApi";

const chipSx = { height: 20, fontSize: 11, fontWeight: 600, borderRadius: 1 } as const;

/** What a trace contains, at a glance. Neutral facts are grey, not warnings. */
export function TraceBadges({ flags }: { flags: number }) {
  const genai = (flags & TraceFlag.GENAI) !== 0;
  const wizardflow = (flags & TraceFlag.WIZARDFLOW) !== 0;
  return (
    <Box component="span" sx={{ display: "inline-flex", gap: 0.5, flexWrap: "wrap", verticalAlign: "middle" }}>
      {wizardflow && (
        <Tooltip title={`Has graph nodes (attribute mapping → Node), so it opens in graph replay. ${graphSource(flags)}`}>
          <Chip label="WizardFlow" size="small" color="secondary" variant="outlined" sx={chipSx} />
        </Tooltip>
      )}
      {genai && (
        <Tooltip title="gen_ai.* or OpenInference spans">
          <Chip label="GenAI" size="small" color="primary" variant="outlined" sx={chipSx} />
        </Tooltip>
      )}
      {!genai && !wizardflow && <Chip label="OTel" size="small" variant="outlined" sx={chipSx} />}
      {(flags & TraceFlag.PARENT_OUTSIDE) !== 0 && (
        <Tooltip title="No span here is parentless: the top span continues a trace from another service, or the root hasn't been imported yet. Named after its earliest top-level span.">
          <Chip label="parent not in db" size="small" variant="outlined" sx={chipSx} />
        </Tooltip>
      )}
      {(flags & TraceFlag.MULTI_TOP) !== 0 && (
        <Tooltip title="Several top-level spans: parts of the trace whose parents aren't in the db">
          <Chip label="several tops" size="small" variant="outlined" sx={chipSx} />
        </Tooltip>
      )}
      {(flags & TraceFlag.CROSS_PROJECT) !== 0 && (
        <Tooltip title="Other projects hold spans of the same trace">
          <Chip label="cross-project" size="small" variant="outlined" sx={chipSx} />
        </Tooltip>
      )}
    </Box>
  );
}

/** Where the replay's graph comes from: the same wording as the projection's
 * `meta.graph` (sdk/python/src/wizardflow/store/projection.py). */
export function graphSource(flags: number): string {
  return (flags & TraceFlag.TOPOLOGY) !== 0
    ? "Graph recorded by WizardFlow."
    : "No recorded graph: edges are inferred from the run order.";
}

const SEVERITY_COLOR: Record<SeverityLevel, "default" | "info" | "warning" | "error"> = {
  TRACE: "default",
  DEBUG: "default",
  INFO: "info",
  WARN: "warning",
  ERROR: "error",
  FATAL: "error",
};

export function SeverityChip({ number, label }: { number: number; label?: string }) {
  const level = severityLevel(number);
  return (
    <Chip
      label={label ?? level}
      size="small"
      color={SEVERITY_COLOR[level]}
      variant="outlined"
      sx={{ ...chipSx, fontFamily: "var(--font-geist-mono), monospace" }}
    />
  );
}

export function Loading() {
  return (
    <Box sx={{ display: "grid", placeItems: "center", py: 6 }}>
      <CircularProgress size={28} aria-label="Loading" />
    </Box>
  );
}

export function LoadError({ error }: { error: Error }) {
  return (
    <Alert severity="error" sx={{ m: 2 }}>
      {error.message}
    </Alert>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Box sx={{ textAlign: "center", py: 8, px: 3, color: "text.secondary" }}>
      <Typography variant="h6" sx={{ color: "text.primary", fontWeight: 600, mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** Monospace inline code, for ids and commands. */
export function Mono({ children, sx }: { children: React.ReactNode; sx?: object }) {
  return (
    <Box
      component="span"
      sx={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "0.92em", ...sx }}
    >
      {children}
    </Box>
  );
}
