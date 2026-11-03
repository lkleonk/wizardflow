import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useDashboardBackHref } from "@/utils/viewerContext";

const centered = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 1.5,
  p: 3,
  textAlign: "center",
} as const;

/** The graph pane when a `?trace=` URL couldn't be loaded. */
export function TraceLoadError({ message }: { message: string }) {
  const dashboardHref = useDashboardBackHref();
  return (
    <Box role="alert" sx={centered}>
      <ErrorOutlineIcon sx={{ fontSize: 40, color: "error.main" }} />
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        Couldn&apos;t open this run
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 420, overflowWrap: "anywhere" }}>
        {message}
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mt: 0.5, flexWrap: "wrap", justifyContent: "center" }}>
        {dashboardHref && (
          <Button variant="contained" startIcon={<ArrowBackIcon />} href={dashboardHref}>
            Back to the dashboard
          </Button>
        )}
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => window.location.reload()}>
          Try again
        </Button>
      </Box>
    </Box>
  );
}
