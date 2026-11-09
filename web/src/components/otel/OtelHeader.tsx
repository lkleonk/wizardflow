import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { LiveStatusDot } from "@/components/LiveDot";
import type { ApiProject } from "@/types/otelstore";
import { goToHref, isReplayUrl, otelHref, type OtelRoute } from "@/utils/otelRoute";
import { Mono } from "./OtelBits";

const VIEW_LABELS: Record<string, string> = { traces: "Traces", trace: "Traces", logs: "Logs" };

/** The crumbs after "Traces": a conversation, then which execution this is. */
export function executionCrumbs({
  conversation,
  execution,
}: {
  conversation?: React.ReactNode;
  execution?: {
    position: number;
    total: number;
    /** Replaces "Execution 3 of 5"; for the first frame's empty slot. */
    label?: React.ReactNode;
    onPrev?: () => void;
    onNext?: () => void;
  };
}): React.ReactNode[] {
  const crumbs: React.ReactNode[] = [];
  if (conversation) {
    crumbs.push(
      <Mono
        key="conversation"
        sx={{
          display: "inline-block",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          verticalAlign: "bottom",
          color: "text.secondary",
        }}
      >
        <span title={typeof conversation === "string" ? conversation : undefined}>{conversation}</span>
      </Mono>
    );
  }
  if (execution && execution.total > 1) {
    const step = (label: string, onClick: (() => void) | undefined, icon: React.ReactNode) => (
      <Tooltip title={onClick ? `${label} execution` : ""}>
        <span>
          <IconButton
            size="small"
            disabled={!onClick}
            onClick={onClick}
            aria-label={`${label} execution`}
            className={`wf-crumb-${label.toLowerCase()}`}
            sx={{ p: 0.25 }}
          >
            {icon}
          </IconButton>
        </span>
      </Tooltip>
    );
    crumbs.push(
      <Box key="execution" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, whiteSpace: "nowrap" }}>
        <Typography component="span" sx={{ fontWeight: 650 }}>
          {execution.label ?? `Execution ${execution.position} of ${execution.total}`}
        </Typography>
        {step("Previous", execution.onPrev, <ChevronLeftIcon fontSize="small" />)}
        {step("Next", execution.onNext, <ChevronRightIcon fontSize="small" />)}
      </Box>
    );
  }
  return crumbs;
}

/**
 * The dashboard's top row. The trace page renders it itself, because only it
 * knows the conversation and execution for `trail`.
 */
export default function OtelHeader({
  route,
  projects,
  trail,
  actions,
  projectLabel,
  live,
}: {
  route: OtelRoute;
  projects: ApiProject[];
  /** Crumbs after "Traces", each with a key; replaces the short trace id. */
  trail?: React.ReactNode[];
  actions?: React.ReactNode;
  /** What the project switcher shows instead of the route's project. */
  projectLabel?: React.ReactNode;
  live?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 2,
        minHeight: 56,
        flexWrap: "wrap",
      }}
    >
      <OtelCrumbs route={route} projects={projects} trail={trail} projectLabel={projectLabel} live={live} />
      {actions}
    </Box>
  );
}

/**
 * Back arrow and breadcrumb, shared with the graph replay's header so the two
 * read the same. The replay is another page, so it passes its own `navigate`.
 */
export function OtelCrumbs({
  route,
  projects,
  trail,
  navigate = goToHref,
  projectLabel,
  live,
}: {
  route: OtelRoute;
  projects: ApiProject[];
  trail?: React.ReactNode[];
  navigate?: (href: string) => void;
  projectLabel?: React.ReactNode;
  /** Left out: no dot. False: the dot is out, its place kept. */
  live?: boolean;
}) {
  const inProject = route.view !== "projects" && route.view !== "settings" && route.project;
  const tracesList = otelHref({ view: "traces", project: route.project });
  // A trace opened from Logs goes back there, but its "Traces" crumb can't;
  // one opened from a replay looks through it, to the list the replay came from.
  const origin =
    route.back && isReplayUrl(route.back)
      ? new URLSearchParams(route.back.slice(2)).get("back")
      : route.back;
  const crumbTarget = origin?.startsWith("/otel?view=traces") ? origin : tracesList;
  return (
    <>
      {inProject && route.view === "trace" && (
        <Tooltip title="Back">
          <IconButton size="small" onClick={() => navigate(route.back ?? tracesList)} aria-label="Back" sx={{ ml: -0.5 }}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {/* Not stretched, so the live dot follows the last crumb on both pages. */}
      <Breadcrumbs aria-label="Breadcrumb" sx={{ minWidth: 0, "& ol": { flexWrap: "nowrap" } }}>
        {inProject || route.view === "settings" ? (
          <Link component="button" underline="hover" color="text.secondary" onClick={() => navigate(otelHref({ view: "projects" }))}>
            All projects
          </Link>
        ) : (
          <Typography sx={{ fontWeight: 650 }}>All projects</Typography>
        )}
        {route.view === "settings" && <Typography sx={{ fontWeight: 650 }}>Settings</Typography>}
        {inProject && (
          <Select
            size="small"
            value={projects.some((p) => p.name === route.project) ? route.project : ""}
            onChange={(e) =>
              navigate(otelHref({ view: route.view === "logs" ? "logs" : "traces", project: String(e.target.value) }))
            }
            displayEmpty
            renderValue={() => projectLabel ?? route.project}
            sx={{ fontWeight: 650, "& .MuiSelect-select": { py: 0.5 } }}
            aria-label="Switch project"
          >
            {projects.map((project) => (
              <MenuItem key={project.id} value={project.name}>
                <ListItemText primary={project.name} secondary={`${project.traceCount} traces`} />
              </MenuItem>
            ))}
          </Select>
        )}
        {inProject && route.view === "trace" ? (
          <Link
            component="button"
            underline="hover"
            color="text.secondary"
            onClick={() => navigate(crumbTarget)}
          >
            Traces
          </Link>
        ) : (
          inProject && <Typography sx={{ fontWeight: 650 }}>{VIEW_LABELS[route.view]}</Typography>
        )}
        {inProject && route.view === "trace" && route.trace && !trail && (
          <Mono sx={{ fontWeight: 650 }}>{route.trace.slice(0, 12)}…</Mono>
        )}
        {inProject && route.view === "trace" && trail}
      </Breadcrumbs>
      {live !== undefined && (
        <LiveStatusDot watching={live} title="Live — new data shows up here automatically" />
      )}
    </>
  );
}
