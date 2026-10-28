import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { ApiProject } from "@/types/otelstore";
import { apiPath, formatNsDateTime, useApi } from "@/utils/otelApi";
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
          <Paper key={project.id} variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
            <ButtonBase
              onClick={() => goTo({ view: "traces", project: project.name })}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
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
