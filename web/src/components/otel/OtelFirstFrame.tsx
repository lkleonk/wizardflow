"use client";

import Box from "@mui/material/Box";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import OtelSidebar from "./OtelSidebar";

/**
 * What /otel's static HTML shows until OtelApp can read the URL: the sidebar,
 * so arriving from the replay doesn't blink it away. The website has no
 * dashboard, so nothing there.
 */
export default function OtelFirstFrame() {
  if (isHostedWizardFlow) return null;
  return (
    <Box sx={{ display: "flex", height: "100dvh", minHeight: 0, bgcolor: "background.default" }}>
      <OtelSidebar route={{ view: "traces" }} replay />
    </Box>
  );
}
