import { useEffect, useSyncExternalStore } from "react";
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
import { LivePulse } from "@/components/LiveDot";
import type { ApiReceiver } from "@/types/otelstore";
import { setDisplayPrefs, useDisplayPrefs } from "@/utils/otelDisplay";
import { goTo, otelHref, type OtelRoute } from "@/utils/otelRoute";

type SidebarProps = {
  route: OtelRoute;
  dbPath?: string;
  receiver?: ApiReceiver;
  replay?: boolean;
};

const subscribeToNothing = () => () => {};
// TracePendingScript reads these keys too.
const DB_LABEL_KEY = "wf-otel-db-label";
const RECEIVER_KEY = "wf-otel-receiver";

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the detail just appears a moment later
  }
}

/**
 * The dashboard's sidebar. Graph replay (`replay`) shows it too, folded or not
 * by the same preference; it keeps the color mode toggle (AppHeader hides its
 * own beside it), and links back into the dashboard instead of routing in
 * place.
 *
 * The replay and /otel are separate static pages, painted before any
 * JavaScript runs, and the sidebar must look the same across a move between
 * them. So the static HTML (`replay` here, also used by OtelFirstFrame) holds
 * both foldings, and globals.css shows the right one from attributes
 * TracePendingScript sets before first paint; the same script supplies the
 * project and database labels as CSS variables.
 */
export default function OtelSidebar(props: SidebarProps) {
  const prefs = useDisplayPrefs();
  const folded = prefs.sidebarFolded;
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const { replay } = props;
  // Mirrors the fold once React knows it; the loading cover's edge reads it.
  useEffect(() => {
    if (replay && hydrated) {
      document.documentElement.toggleAttribute("data-sidebar-folded", folded);
    }
  }, [replay, hydrated, folded]);
  if (replay && !hydrated) {
    return (
      <>
        <Box className="wf-rail-unfolded" sx={{ display: "flex" }}>
          <SidebarBody {...props} folded={false} />
        </Box>
        <Box className="wf-rail-folded" sx={{ display: "flex" }}>
          <SidebarBody {...props} folded />
        </Box>
      </>
    );
  }
  return <SidebarBody {...props} folded={folded} />;
}

function SidebarBody({
  route,
  dbPath,
  receiver,
  replay = false,
  folded,
}: SidebarProps & { folded: boolean }) {
  const { mode, systemMode, setMode } = useColorScheme();
  const isDark = (mode === "system" ? systemMode : mode) !== "light";
  const dbLabel = dbPath?.split(/[\\/]/).slice(-2).join("/");
  // Remembered so the next page can show them in its first frame.
  useEffect(() => {
    if (dbLabel) remember(DB_LABEL_KEY, dbLabel);
  }, [dbLabel]);
  const receiverOn = receiver?.enabled;
  useEffect(() => {
    if (receiverOn !== undefined) remember(RECEIVER_KEY, receiverOn ? "1" : "0");
  }, [receiverOn]);
  // In place inside the dashboard; a page load from the replay viewer.
  const go = (to: OtelRoute) =>
    replay
      ? { component: "a", href: otelHref(to) }
      : { onClick: () => goTo(to) };
  // Settings keeps the project in the URL, so its nav stays and "back" works.
  const project = route.view !== "projects" ? route.project : undefined;
  // The replay is only ever opened from a project's traces. Decided here and
  // not from `route`, which the static first frame doesn't have yet.
  const active = replay || route.view === "trace" ? "traces" : route.view;
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
              // Negative margin: the hit area must not make this row taller
              // than the dashboard's.
              sx={{ display: "flex", p: 0.5, m: -0.5 }}
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
      </Box>
      {(project || replay) && (
        <Box className={replay ? "wf-rail-project-section" : undefined}>
          <Tooltip title={folded ? (project ?? "") : ""} placement="right">
            <Typography
              noWrap
              className="wf-rail-project"
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
        </Box>
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
          flexDirection: folded ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: folded ? 0.5 : 1,
        }}
      >
        {!folded && (
          <Tooltip title={dbPath ?? ""}>
            <Typography
              noWrap
              className="wf-rail-db"
              sx={{
                flex: 1,
                fontSize: 11.5,
                color: "text.secondary",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {dbLabel}
            </Typography>
          </Tooltip>
        )}
        {/* Until the server has answered: the dot as it was last time. */}
        {receiver === undefined && (
          <Box className="wf-rail-live-slot">
            <Box sx={{ display: "flex", p: 0.75 }}>
              <LivePulse />
            </Box>
          </Box>
        )}
        {receiver?.enabled && (
          <Tooltip title={`Receiving OTLP at ${receiver.endpoint}`} placement={folded ? "right" : "top"}>
            <Box
              component="button"
              onClick={() => {
                const live: OtelRoute = { view: "settings", project: route.project, sec: "live" };
                if (replay) window.location.assign(otelHref(live));
                else goTo(live);
              }}
              aria-label="Live receiver settings"
              sx={{ display: "flex", p: 0.75, border: 0, bgcolor: "transparent", cursor: "pointer" }}
            >
              <LivePulse />
            </Box>
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
