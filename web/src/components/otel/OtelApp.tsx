"use client";

import { useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import type { ApiMeta, ApiProject } from "@/types/otelstore";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import { apiPath, useApi } from "@/utils/otelApi";
import { goTo, parseOtelRoute, type OtelRoute } from "@/utils/otelRoute";
import { EmptyState, Loading, Mono } from "./OtelBits";
import LogsView from "./LogsView";
import OtelSidebar from "./OtelSidebar";
import ProjectsView from "./ProjectsView";
import SettingsView from "./SettingsView";
import TraceView from "./TraceView";
import TracesView from "./TracesView";

/**
 * The local OTel dashboard (`wizardflow serve`): projects → traces / logs →
 * one trace. Reads everything from the Python server's /api; on the website
 * there is no server, so it explains how to run it instead.
 */
export default function OtelApp() {
  const params = useSearchParams();
  const route = parseOtelRoute(new URLSearchParams(params.toString()));
  const meta = useApi<ApiMeta>(isHostedWizardFlow ? null : apiPath("meta"));
  const projects = useApi<ApiProject[]>(meta.data ? apiPath("projects") : null);

  if (isHostedWizardFlow || meta.error) {
    return (
      <EmptyState title="The OTel dashboard runs on your machine">
        It reads your local WizardFlow database, so it needs the local server:
        <br />
        <Mono>pip install wizardflow</Mono> then <Mono>wizardflow serve</Mono>
      </EmptyState>
    );
  }
  if (!meta.data) return <Loading />;

  return (
    // Floating panels on the page background, like the replay view.
    <Box sx={{ display: "flex", height: "100dvh", minHeight: 0, bgcolor: "background.default" }}>
      <OtelSidebar route={route} dbPath={meta.data.dbPath} />
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Header route={route} projects={projects.data ?? []} />
        <Box sx={{ flex: 1, minHeight: 0, overflow: route.view === "trace" ? "hidden" : "auto", display: "flex", flexDirection: "column" }}>
          <Content route={route} meta={meta.data} />
        </Box>
      </Box>
    </Box>
  );
}

function Content({ route, meta }: { route: OtelRoute; meta: ApiMeta }) {
  const { project, trace } = route;
  if (route.view === "settings") return <SettingsView route={route} meta={meta} />;
  if (route.view === "trace" && project && trace) return <TraceView key={trace} route={{ ...route, project, trace }} />;
  if (route.view === "logs" && project) return <LogsView route={{ ...route, project }} />;
  if ((route.view === "traces" || route.view === "trace") && project) return <TracesView route={{ ...route, project }} />;
  return <ProjectsView />;
}

const VIEW_LABELS: Record<string, string> = { traces: "Traces", trace: "Traces", logs: "Logs" };

function Header({ route, projects }: { route: OtelRoute; projects: ApiProject[] }) {
  const inProject = route.view !== "projects" && route.view !== "settings" && route.project;
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
            onClick={() => goTo({ view: "traces", project: route.project })}
          >
            Traces
          </Link>
        ) : (
          inProject && <Typography sx={{ fontWeight: 650 }}>{VIEW_LABELS[route.view]}</Typography>
        )}
        {inProject && route.view === "trace" && route.trace && (
          <Mono sx={{ fontWeight: 650 }}>{route.trace.slice(0, 12)}…</Mono>
        )}
      </Breadcrumbs>
    </Box>
  );
}
