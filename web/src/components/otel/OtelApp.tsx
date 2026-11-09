"use client";

import { useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import type { ApiMeta, ApiProject } from "@/types/otelstore";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import { apiPath, useApi } from "@/utils/otelApi";
import { parseOtelRoute, type OtelRoute } from "@/utils/otelRoute";
import { EmptyState, Loading, Mono } from "./OtelBits";
import LogsView from "./LogsView";
import OtelHeader from "./OtelHeader";
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
  const meta = useApi<ApiMeta>(isHostedWizardFlow ? null : apiPath("meta"), { live: true });
  const projects = useApi<ApiProject[]>(meta.data ? apiPath("projects") : null, { live: true });

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
  const { project, trace } = route;
  const projectList = projects.data ?? [];

  return (
    // Floating panels on the page background, like the replay view.
    <Box sx={{ display: "flex", height: "100dvh", minHeight: 0, bgcolor: "background.default" }}>
      <OtelSidebar route={route} dbPath={meta.data.dbPath} receiver={meta.data.receiver} />
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {route.view === "trace" && project && trace ? (
          // Renders its own header: only it knows the crumbs and the view switch.
          <TraceView key={trace} route={{ ...route, project, trace }} projects={projectList} />
        ) : (
          <>
            <OtelHeader route={route} projects={projectList} />
            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
              <Content route={route} meta={meta.data} />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

function Content({ route, meta }: { route: OtelRoute; meta: ApiMeta }) {
  const { project } = route;
  if (route.view === "settings") return <SettingsView route={route} meta={meta} />;
  if (route.view === "logs" && project) return <LogsView route={{ ...route, project }} />;
  if ((route.view === "traces" || route.view === "trace") && project) return <TracesView route={{ ...route, project }} />;
  return <ProjectsView />;
}
