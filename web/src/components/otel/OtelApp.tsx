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
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useColorScheme } from "@mui/material/styles";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import type { ApiMeta, ApiProject } from "@/types/otelstore";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import { apiPath, useApi } from "@/utils/otelApi";
import { setDisplayPrefs, useDisplayPrefs } from "@/utils/otelDisplay";
import { goTo, parseOtelRoute, type OtelRoute } from "@/utils/otelRoute";
import { EmptyState, Loading, Mono } from "./OtelBits";
import LogsView from "./LogsView";
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
      <Sidebar route={route} dbPath={meta.data.dbPath} />
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

function Sidebar({ route, dbPath }: { route: OtelRoute; dbPath: string }) {
  const { mode, systemMode, setMode } = useColorScheme();
  const isDark = (mode === "system" ? systemMode : mode) !== "light";
  const { sidebarFolded: folded } = useDisplayPrefs();
  // Settings keeps the project in the URL, so its nav stays and "back" works.
  const project = route.view !== "projects" ? route.project : undefined;
  const active = route.view === "trace" ? "traces" : route.view;
  const item = { borderRadius: 1, minHeight: 32, ...(folded && { justifyContent: "center", px: 0 }) };
  const iconItem = (label: string, icon: React.ReactNode, props: object, selected = false) => (
    <Tooltip title={folded ? label : ""} placement="right">
      <ListItemButton selected={selected} sx={item} {...props}>
        <ListItemIcon sx={{ minWidth: folded ? 0 : 30 }}>{icon}</ListItemIcon>
        {!folded && <ListItemText primary={label} />}
      </ListItemButton>
    </Tooltip>
  );
  return (
    <Paper
      component="nav"
      aria-label="Dashboard"
      sx={{
        width: folded ? 64 : 176,
        flex: "none",
        display: { xs: "none", md: "flex" },
        flexDirection: "column",
        overflow: "hidden",
        m: 1.5,
        mr: 0,
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: folded ? "column" : "row",
          alignItems: "center",
          gap: folded ? 0.5 : 1,
          pl: folded ? 0 : 1.75,
          pr: folded ? 0 : 0.75,
          py: 1.25,
        }}
      >
        <Box component="img" src="/icon.svg" alt="" sx={{ width: 22, height: 22 }} />
        {!folded && <Typography sx={{ fontWeight: 650, fontSize: 15, flex: 1 }}>WizardFlow</Typography>}
        <Tooltip title={folded ? "Expand the sidebar" : "Fold the sidebar"} placement="right">
          <IconButton
            size="small"
            onClick={() => setDisplayPrefs({ sidebarFolded: !folded })}
            aria-label={folded ? "Expand the sidebar" : "Fold the sidebar"}
          >
            {folded ? <KeyboardDoubleArrowRightIcon fontSize="small" /> : <KeyboardDoubleArrowLeftIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      {project && (
        <>
          <Tooltip title={folded ? project : ""} placement="right">
            <Typography
              noWrap
              sx={{
                px: folded ? 0.75 : 2,
                pt: 0.5,
                fontSize: 11,
                color: "text.secondary",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                textAlign: folded ? "center" : "left",
              }}
            >
              {project}
            </Typography>
          </Tooltip>
          {/* Text only: no icon tells traces and logs apart, and the words
              still fit when the sidebar is folded. */}
          <List dense sx={{ px: 0.75 }}>
            {(
              [
                ["traces", "Traces"],
                ["logs", "Logs"],
              ] as const
            ).map(([view, label]) => (
              <ListItemButton
                key={view}
                selected={active === view}
                onClick={() => goTo({ view, project })}
                sx={{ ...item, pl: folded ? 0 : 1.25 }}
              >
                <ListItemText
                  primary={label}
                  slotProps={{ primary: { sx: { fontSize: folded ? 12 : 13, textAlign: folded ? "center" : "left" } } }}
                />
              </ListItemButton>
            ))}
          </List>
        </>
      )}
      <Divider sx={{ mx: 1.5, my: 0.5 }} />
      <List dense sx={{ px: 0.75 }}>
        {iconItem("Open a JSONL file", <UploadFileIcon fontSize="small" />, { component: "a", href: "/" })}
        {iconItem(
          "Settings",
          <SettingsOutlinedIcon fontSize="small" />,
          { onClick: () => goTo({ view: "settings", project: route.project, scope: project }) },
          active === "settings"
        )}
      </List>
      <Box
        sx={{
          mt: "auto",
          px: folded ? 0 : 1.75,
          py: 1,
          borderTop: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
        }}
      >
        {!folded && (
          <Tooltip title={dbPath}>
            <Typography noWrap sx={{ flex: 1, fontSize: 11.5, color: "text.secondary", fontFamily: "var(--font-geist-mono), monospace" }}>
              {dbPath.split(/[\\/]/).slice(-2).join("/")}
            </Typography>
          </Tooltip>
        )}
        <Tooltip title={isDark ? "Switch to light mode" : "Switch to dark mode"} placement={folded ? "right" : "top"}>
          <IconButton size="small" onClick={() => setMode(isDark ? "light" : "dark")} aria-label="Toggle color mode">
            {isDark ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  );
}
