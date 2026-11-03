import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useColorScheme } from "@mui/material/styles";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { setDisplayPrefs, useDisplayPrefs } from "@/utils/otelDisplay";
import { goTo, otelHref, type OtelRoute } from "@/utils/otelRoute";

/**
 * The dashboard's sidebar. Graph replay (`replay`) shows it too, always folded
 * to the rail and without the fold toggle; it keeps the color mode toggle
 * (AppHeader hides its own beside it), and links back into the dashboard
 * instead of routing in place.
 */
export default function OtelSidebar({
  route,
  dbPath,
  replay = false,
}: {
  route: OtelRoute;
  dbPath?: string;
  replay?: boolean;
}) {
  const { mode, systemMode, setMode } = useColorScheme();
  const isDark = (mode === "system" ? systemMode : mode) !== "light";
  const prefs = useDisplayPrefs();
  const folded = replay || prefs.sidebarFolded;
  // In place inside the dashboard; a page load from the replay viewer.
  const go = (to: OtelRoute) =>
    replay
      ? { component: "a", href: otelHref(to) }
      : { onClick: () => goTo(to) };
  // Settings keeps the project in the URL, so its nav stays and "back" works.
  const project = route.view !== "projects" ? route.project : undefined;
  const active = route.view === "trace" ? "traces" : route.view;
  const item = {
    borderRadius: 1,
    minHeight: 32,
    ...(folded && { justifyContent: "center", px: 0 }),
  };
  const iconItem = (
    label: string,
    icon: React.ReactNode,
    props: object,
    selected = false
  ) => (
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
        // Attached to the window's left edge, full height: the page's frame,
        // not one more floating panel.
        borderRadius: 0,
        border: 0,
        borderRight: 1,
        borderColor: "divider",
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
        {replay ? (
          <Tooltip title="All projects" placement="right">
            <Box
              component="a"
              href={otelHref({ view: "projects" })}
              sx={{ display: "flex", p: 0.5 }}
            >
              <Box
                component="img"
                src="/icon.svg"
                alt="All projects"
                sx={{ width: 22, height: 22 }}
              />
            </Box>
          </Tooltip>
        ) : (
          <Box
            component="img"
            src="/icon.svg"
            alt=""
            sx={{ width: 22, height: 22 }}
          />
        )}
        {!folded && (
          <Typography sx={{ fontWeight: 650, fontSize: 15, flex: 1 }}>
            WizardFlow
          </Typography>
        )}
        {!replay && (
          <Tooltip
            title={folded ? "Expand the sidebar" : "Fold the sidebar"}
            placement="right"
          >
            <IconButton
              size="small"
              onClick={() => setDisplayPrefs({ sidebarFolded: !folded })}
              aria-label={folded ? "Expand the sidebar" : "Fold the sidebar"}
            >
              {folded ? (
                <KeyboardDoubleArrowRightIcon fontSize="small" />
              ) : (
                <KeyboardDoubleArrowLeftIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        )}
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
                {...go({ view, project })}
                sx={{ ...item, pl: folded ? 0 : 1.25 }}
              >
                <ListItemText
                  primary={label}
                  slotProps={{
                    primary: {
                      sx: {
                        fontSize: folded ? 12 : 13,
                        textAlign: folded ? "center" : "left",
                      },
                    },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </>
      )}
      <Divider sx={{ mx: 1.5, my: 0.5 }} />
      <List dense sx={{ px: 0.75 }}>
        {iconItem("Open a JSONL file", <UploadFileIcon fontSize="small" />, {
          component: "a",
          href: "/",
        })}
        {iconItem(
          "Settings",
          <SettingsOutlinedIcon fontSize="small" />,
          go({ view: "settings", project: route.project, scope: project }),
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
        {!folded && dbPath && (
          <Tooltip title={dbPath}>
            <Typography
              noWrap
              sx={{
                flex: 1,
                fontSize: 11.5,
                color: "text.secondary",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {dbPath.split(/[\\/]/).slice(-2).join("/")}
            </Typography>
          </Tooltip>
        )}
        <Tooltip
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          placement={folded ? "right" : "top"}
        >
          <IconButton
            size="small"
            onClick={() => setMode(isDark ? "light" : "dark")}
            aria-label="Toggle color mode"
          >
            {isDark ? (
              <LightModeOutlinedIcon fontSize="small" />
            ) : (
              <DarkModeOutlinedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  );
}
