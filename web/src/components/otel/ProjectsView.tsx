import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ApiActivity, ApiProject } from "@/types/otelstore";
import { apiPath, formatNsDateTime, nsToMs, useApi } from "@/utils/otelApi";
import { goTo } from "@/utils/otelRoute";
import { EmptyState, LoadError, Loading, Mono, TraceBadges } from "./OtelBits";

function Stat({ value, label, danger }: { value: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 650, color: danger ? "error.main" : "text.primary" }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 11, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </Typography>
    </Box>
  );
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Traces started per half hour, newest on the right. Bar height is relative
 * to the busiest slot; the red part is the traces with an error span. For
 * data older than the window it ends at the last trace instead of now.
 */
function ActivityChart({ activity }: { activity: ApiActivity }) {
  const slotMs = nsToMs(activity.slotNs);
  const endMs = nsToMs(activity.endNs);
  const startMs = endMs - activity.traces.length * slotMs;
  const peak = Math.max(1, ...activity.traces);
  const hours = Math.round((activity.traces.length * slotMs) / 3_600_000);
  return (
    <Box>
      <Box
        role="img"
        aria-label={`Traces per half hour over ${hours} hours, peak ${peak}`}
        sx={{ display: "flex", alignItems: "flex-end", gap: "2px", height: 30 }}
      >
        {activity.traces.map((count, i) => {
          const from = startMs + i * slotMs;
          const errors = activity.errors[i];
          const tip = `${clock(from)}–${clock(from + slotMs)} · ${
            count ? `${count} trace${count > 1 ? "s" : ""}${errors ? ` · ${errors} with errors` : ""}` : "no traces"
          }`;
          return (
            <Tooltip key={i} title={tip} disableInteractive>
              <Box sx={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end" }}>
                {count ? (
                  <Box
                    sx={{
                      width: "100%",
                      height: `${(count / peak) * 100}%`,
                      minHeight: 3,
                      bgcolor: "primary.main",
                      opacity: 0.75,
                      borderRadius: "2px 2px 0 0",
                      display: "flex",
                      alignItems: "flex-end",
                      overflow: "hidden",
                    }}
                  >
                    {errors > 0 && (
                      <Box sx={{ width: "100%", height: `${(errors / count) * 100}%`, bgcolor: "error.main" }} />
                    )}
                  </Box>
                ) : (
                  <Box sx={{ width: "100%", height: 2, bgcolor: "divider", borderRadius: 1 }} />
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "text.secondary", mt: 0.25 }}>
        <span>{activity.anchor === "now" ? `${hours}h ago` : clock(startMs)}</span>
        <span>peak {peak} / 30 min</span>
        <span>{activity.anchor === "now" ? "now" : `${clock(endMs)}, last activity`}</span>
      </Box>
    </Box>
  );
}

function compact(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export default function ProjectsView() {
  const { data: projects, error, loading } = useApi<ApiProject[]>(apiPath("projects"));
  if (error) return <LoadError error={error} />;
  if (loading || !projects) return <Loading />;
  if (projects.length === 0) {
    return (
      <EmptyState title="No data yet">
        Import an OTLP JSON file: <Mono>wizardflow db import FILE</Mono>
        <br />
        Your own WizardFlow runs first become one with{" "}
        <Mono>wizardflow otel export run.jsonl --out run.otlp.jsonl</Mono>
      </EmptyState>
    );
  }
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 1.5,
        p: { xs: 1.5, sm: 2 },
      }}
    >
      {projects.map((project) => {
        const errorRate = project.traceCount
          ? Math.round((project.errorTraceCount / project.traceCount) * 100)
          : 0;
        return (
          // The grid stretches every card to its row's tallest; the button
          // fills the card so all of it highlights and clicks.
          <Paper key={project.id} variant="outlined" sx={{ overflow: "hidden", display: "flex" }}>
            <ButtonBase
              onClick={() => goTo({ view: "traces", project: project.name })}
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                justifyContent: "flex-start",
                textAlign: "left",
                gap: 1.25,
                p: 2,
                width: "100%",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography sx={{ fontWeight: 650, fontSize: 15 }}>{project.name}</Typography>
                {project.traceCount > 0 && <TraceBadges flags={project.flags} />}
              </Box>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1 }}>
                <Stat value={compact(project.traceCount)} label="traces" />
                <Stat value={compact(project.spanCount)} label="spans" />
                <Stat value={compact(project.logCount)} label="logs" />
                <Stat value={`${errorRate}%`} label="errors" danger={errorRate > 0} />
              </Box>
              {project.traceCount > 0 && <ActivityChart activity={project.activity} />}
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                {project.tokenCount > 0 && `${compact(project.tokenCount)} tokens · `}
                {project.lastSeenNs ? `last activity ${formatNsDateTime(project.lastSeenNs)}` : "no activity"}
                {project.services.length > 0 && ` · ${project.services.join(", ")}`}
              </Typography>
            </ButtonBase>
          </Paper>
        );
      })}
    </Box>
  );
}
