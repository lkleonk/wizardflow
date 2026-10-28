"use client";

import { useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useColorScheme } from "@mui/material/styles";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import NotesIcon from "@mui/icons-material/Notes";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import type { ApiMeta, ApiProject } from "@/types/otelstore";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import { apiPath, useApi } from "@/utils/otelApi";
import { goTo, parseOtelRoute, type OtelRoute } from "@/utils/otelRoute";
import { EmptyState, Loading, Mono } from "./OtelBits";
import LogsView from "./LogsView";
import ProjectsView from "./ProjectsView";
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
    <Box sx={{ display: "flex", height: "100dvh", minHeight: 0 }}>
      <Sidebar route={route} dbPath={meta.data.dbPath} />
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Header route={route} projects={projects.data ?? []} />
        <Box sx={{ flex: 1, minHeight: 0, overflow: route.view === "trace" ? "hidden" : "auto", display: "flex", flexDirection: "column" }}>
          <Content route={route} />
        </Box>
      </Box>
    </Box>
  );
}

function Content({ route }: { route: OtelRoute }) {
  const { project, trace } = route;
  if (route.view === "trace" && project && trace) return <TraceView key={trace} route={{ ...route, project, trace }} />;
  if (route.view === "logs" && project) return <LogsView route={{ ...route, project }} />;
  if ((route.view === "traces" || route.view === "trace") && project) return <TracesView route={{ ...route, project }} />;
  return <ProjectsView />;
}

const VIEW_LABELS: Record<string, string> = { traces: "Traces", trace: "Traces", logs: "Logs" };

function Header({ route, projects }: { route: OtelRoute; projects: ApiProject[] }) {
  const inProject = route.view !== "projects" && route.project;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 2,
        minHeight: 56,
        borderBottom: 1,
        borderColor: "divider",
        flexWrap: "wrap",
      }}
    >
      <Breadcrumbs aria-label="Breadcrumb" sx={{ flex: 1, minWidth: 0, "& ol": { flexWrap: "nowrap" } }}>
        {inProject ? (
          <Link component="button" underline="hover" color="text.secondary" onClick={() => goTo({ view: "projects" })}>
            All projects
          </Link>
        ) : (
          <Typography sx={{ fontWeight: 650 }}>All projects</Typography>
        )}
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

function Sidebar({ route, dbPath }: { route: OtelRoute; dbPath: string }) {
  const { mode, systemMode, setMode } = useColorScheme();
  const isDark = (mode === "system" ? systemMode : mode) !== "light";
  const project = route.view !== "projects" ? route.project : undefined;
  const active = route.view === "trace" ? "traces" : route.view;
  return (
    <Box
      component="nav"
      aria-label="Dashboard"
      sx={{
        width: 216,
        flex: "none",
        display: { xs: "none", md: "flex" },
        flexDirection: "column",
        borderRight: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.75 }}>
        <Box component="img" src="/icon.svg" alt="" sx={{ width: 22, height: 22 }} />
        <Typography sx={{ fontWeight: 650, fontSize: 15 }}>WizardFlow</Typography>
      </Box>
      {project && (
        <>
          <Typography sx={{ px: 2.25, pt: 0.5, fontSize: 11, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5 }} noWrap>
            {project}
          </Typography>
          <List dense sx={{ px: 1 }}>
            {(
              [
                ["traces", "Traces", <FormatListBulletedIcon key="t" fontSize="small" />],
                ["logs", "Logs", <NotesIcon key="l" fontSize="small" />],
              ] as const
            ).map(([view, label, icon]) => (
              <ListItemButton
                key={view}
                selected={active === view}
                onClick={() => goTo({ view, project })}
                sx={{ borderRadius: 1.5 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>{icon}</ListItemIcon>
                <ListItemText primary={label} />
              </ListItemButton>
            ))}
          </List>
        </>
      )}
      <Divider sx={{ mx: 1.5, my: 1 }} />
      <List dense sx={{ px: 1 }}>
        <ListItemButton component="a" href="/" sx={{ borderRadius: 1.5 }}>
          <ListItemIcon sx={{ minWidth: 32 }}>
            <UploadFileIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Open a JSONL file" />
        </ListItemButton>
      </List>
      <Box sx={{ mt: "auto", px: 2, py: 1.5, borderTop: 1, borderColor: "divider", display: "flex", alignItems: "center", gap: 1 }}>
        <Tooltip title={dbPath}>
          <Typography noWrap sx={{ flex: 1, fontSize: 11.5, color: "text.secondary", fontFamily: "var(--font-geist-mono), monospace" }}>
            {dbPath.split(/[\\/]/).slice(-2).join("/")}
          </Typography>
        </Tooltip>
        <Tooltip title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
          <IconButton size="small" onClick={() => setMode(isDark ? "light" : "dark")} aria-label="Toggle color mode">
            {isDark ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
