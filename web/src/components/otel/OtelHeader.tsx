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
import type { ApiProject } from "@/types/otelstore";
import { goTo, goToHref, otelHref, type OtelRoute } from "@/utils/otelRoute";
import { Mono } from "./OtelBits";

const VIEW_LABELS: Record<string, string> = { traces: "Traces", trace: "Traces", logs: "Logs" };

/**
 * The dashboard's top row. The trace page renders it itself, because only it
 * knows the conversation and execution for `trail`.
 */
export default function OtelHeader({
  route,
  projects,
  trail,
  actions,
}: {
  route: OtelRoute;
  projects: ApiProject[];
  /** Crumbs after "Traces", each with a key; replaces the short trace id. */
  trail?: React.ReactNode[];
  actions?: React.ReactNode;
}) {
  const inProject = route.view !== "projects" && route.view !== "settings" && route.project;
  const tracesList = otelHref({ view: "traces", project: route.project });
  // A trace opened from Logs goes back there, but its "Traces" crumb can't.
  const crumbTarget = route.back?.startsWith("/otel?view=traces") ? route.back : tracesList;
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
      {inProject && route.view === "trace" && (
        <Tooltip title="Back">
          <IconButton size="small" onClick={() => goToHref(route.back ?? tracesList)} aria-label="Back" sx={{ ml: -0.5 }}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Breadcrumbs aria-label="Breadcrumb" sx={{ flex: 1, minWidth: 0, "& ol": { flexWrap: "nowrap" } }}>
        {inProject || route.view === "settings" ? (
          <Link component="button" underline="hover" color="text.secondary" onClick={() => goTo({ view: "projects" })}>
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
              goTo({ view: route.view === "logs" ? "logs" : "traces", project: String(e.target.value) })
            }
            displayEmpty
            renderValue={() => route.project}
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
            onClick={() => goToHref(crumbTarget)}
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
      {actions}
    </Box>
  );
}
