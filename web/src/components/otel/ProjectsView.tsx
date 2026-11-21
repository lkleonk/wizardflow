import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ApiActivity, ApiProject, ApiSource } from "@/types/otelstore";
import FileCopyOutlinedIcon from "@mui/icons-material/FileCopyOutlined";
import SensorsOutlinedIcon from "@mui/icons-material/SensorsOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import { TOOLTIP_TIMING } from "@/theme/muiTheme";
import { apiPath, formatNsDateTime, nsToMs, useApi } from "@/utils/otelApi";
import { goTo } from "@/utils/otelRoute";
import { EmptyState, LoadError, Loading, Mono, TraceBadges } from "./OtelBits";

const SOURCE_KIND: Record<ApiSource["kind"], string> = {
  upload: "uploaded in the dashboard",
  file: "imported from the command line",
  receiver: "sent by an app to the dashboard's OTLP receiver",
};

const ICON_SX = { fontSize: 14, flex: "none" } as const;

/**
 * Where a project's data came from, on one line that never wraps: how it got
 * in (uploaded, CLI import, OTLP receiver) and, for a single file, its name,
 * cut with "…". The tooltip lists every source with its path.
 */
function Sources({ sources }: { sources: ApiSource[] }) {
  const files = sources.filter((source) => source.kind !== "receiver");
  const received = sources.some((source) => source.kind === "receiver");
  const uploads = files.filter((source) => source.kind === "upload").length;
  const cli = files.length - uploads;
  const how =
    uploads && cli ? `${uploads} uploaded, ${cli} CLI import` : uploads ? "uploaded" : "CLI import";
  const icon = received ? (
    <SensorsOutlinedIcon sx={ICON_SX} />
  ) : uploads && cli ? (
    <FileCopyOutlinedIcon sx={ICON_SX} />
  ) : uploads ? (
    <UploadFileOutlinedIcon sx={ICON_SX} />
  ) : (
    <TerminalIcon sx={ICON_SX} />
  );
  // Only a single file's name can run long; it is the part that gets cut.
  const name = files.length === 1 ? files[0].name : files.length > 1 ? `${files.length} files` : null;
  return (
    <Tooltip
      {...TOOLTIP_TIMING.explain}
      title={
        <Box component="span" sx={{ display: "block" }}>
          {sources.map((source, i) => (
            <Box component="span" key={i} sx={{ display: "block" }}>
              <b>{source.name}</b>, {SOURCE_KIND[source.kind]}
              {source.path && (
                <Box component="span" sx={{ display: "block", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11 }}>
                  {source.path}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      }
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, fontSize: 12, color: "text.secondary" }}>
        {icon}
        {received && <Box component="span" sx={{ flex: "none" }}>OTLP receiver{name && ", plus"}</Box>}
        {name && (
          <>
            <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </Box>
            <Box component="span" sx={{ flex: "none" }}>· {how}</Box>
          </>
        )}
      </Box>
    </Tooltip>
  );
}

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
  const { data: projects, error, loading } = useApi<ApiProject[]>(apiPath("projects"), { live: true });
  if (error) return <LoadError error={error} />;
  if (loading || !projects) return <Loading />;
  if (projects.length === 0) {
    return (
      <EmptyState title="No data yet">
        Import a WizardFlow run or an OTLP JSON file:{" "}
        <Mono>wizardflow db import run.jsonl</Mono>
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
        const services = project.services.filter((service) => service !== project.name);
        return (
          // The grid stretches every card to its row's tallest; the button
          // fills the card so all of it highlights and clicks.
          // minWidth 0 on both: the one-line texts would otherwise widen the
          // card past its grid column instead of being cut.
          <Paper key={project.id} variant="outlined" sx={{ overflow: "hidden", display: "flex", minWidth: 0 }}>
            <ButtonBase
              onClick={() => goTo({ view: "traces", project: project.name })}
              sx={{
                flex: 1,
                minWidth: 0,
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
              {/* Every card has the same shape, whatever its names: a one-line
                  header, and a two-line footer pinned to the bottom, each
                  line cut with "…" rather than wrapped. */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                <Tooltip title={project.name}>
                  <Typography noWrap sx={{ fontWeight: 650, fontSize: 15, minWidth: 0 }}>
                    {project.name}
                  </Typography>
                </Tooltip>
                {project.traceCount > 0 && (
                  <Box sx={{ flex: "none", display: "flex" }}>
                    <TraceBadges flags={project.flags} />
                  </Box>
                )}
              </Box>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1 }}>
                <Stat value={compact(project.traceCount)} label="traces" />
                <Stat value={compact(project.spanCount)} label="spans" />
                <Stat value={compact(project.logCount)} label="logs" />
                <Stat value={`${errorRate}%`} label="errors" danger={errorRate > 0} />
              </Box>
              {project.traceCount > 0 && <ActivityChart activity={project.activity} />}
              <Box
                sx={{
                  mt: "auto",
                  pt: 1,
                  borderTop: 1,
                  borderColor: "divider",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.5,
                  minWidth: 0,
                }}
              >
                <Typography noWrap sx={{ fontSize: 12, color: "text.secondary" }}>
                  {project.tokenCount > 0 && `${compact(project.tokenCount)} tokens · `}
                  {project.lastSeenNs ? `last activity ${formatNsDateTime(project.lastSeenNs)}` : "no activity"}
                  {/* A service named like its project (every WizardFlow run) adds nothing. */}
                  {services.length > 0 && ` · ${services.join(", ")}`}
                </Typography>
                {project.sources.length > 0 && <Sources sources={project.sources} />}
              </Box>
            </ButtonBase>
          </Paper>
        );
      })}
    </Box>
  );
}
