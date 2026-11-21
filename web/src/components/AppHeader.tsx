import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import ListAltOutlinedIcon from "@mui/icons-material/ListAltOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import HelpCenterOutlinedIcon from "@mui/icons-material/HelpCenterOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import CodeIcon from "@mui/icons-material/Code";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SearchIcon from "@mui/icons-material/Search";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import TraceInfo from "@/components/TraceInfo";
import TraceUploader, { useTraceFilePicker } from "@/components/TraceUploader";
import LocalDataDialog from "@/components/LocalDataDialog";
import { LiveStatusDot } from "@/components/LiveDot";
import { rememberCrumbs } from "@/components/TracePendingScript";
import { OtelCrumbs, executionCrumbs } from "@/components/otel/OtelHeader";
import type { AgentTraceFile } from "@/types/agenttrace";
import { TOOLTIP_TIMING } from "@/theme/muiTheme";
import type { ApiProject } from "@/types/otelstore";
import { isHostedWizardFlow } from "@/utils/deploymentTarget";
import { executionChoices } from "@/utils/traceSelectors";
import { useDashboardBackHref, useViewerChrome } from "@/utils/viewerContext";

// Controls that move into the overflow menu on phones.
const wideOnly = { display: { xs: "none", sm: "inline-flex" } } as const;

/** The neighbouring part files of a rotated run, resolved by the caller. */
export type PartLinks = {
  prev?: string;
  next?: string;
  index: number;
};

export type DashboardReplayView = {
  executionIndex: number;
  executionCount: number;
  /** For the breadcrumb's project switcher. */
  projects: ApiProject[];
  onStep: (direction: -1 | 1) => void;
  onJump: (index: number) => void;
  /** The current step on the span timeline; unset without a database trace. */
  spanHref?: string;
};

type AppHeaderProps = {
  trace: AgentTraceFile;
  /** Whether a flow is actually loaded (an empty canvas can't be searched). */
  hasFlow: boolean;
  /** Whether there is a user-loaded flow to clear. */
  canClearFlow: boolean;
  /** A trace loaded from a URL — the only kind that can be watched or walked. */
  isServedTrace: boolean;
  isLiveWatching: boolean;
  partLinks: PartLinks | null;
  /** Position for a replay opened from the dashboard; ignored elsewhere. */
  dashboardView?: DashboardReplayView;
  onGoToPart: (name: string) => void;
  onClearFlow: () => void;
  onOpenGallery: () => void;
  onUploadLoad: (trace: AgentTraceFile) => void;
  onOpenTutorial: () => void;
  onOpenSearch: () => void;
  isDarkMode: boolean;
  onToggleColorMode: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  /** Any click in the header leaves the graph's arrange mode. */
  onInteract: () => void;
};

// Rotated trace: step between the run's part files. Only the active (last)
// part keeps growing, so walking back is history and walking forward is
// where the live tail continues.
function PartNavigator({
  links,
  onGoToPart,
}: {
  links: PartLinks;
  onGoToPart: (name: string) => void;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.25,
      }}
    >
      <Tooltip
        title={
          links.prev ? `Previous part (${links.prev})` : "This is the first part"
        }
      >
        <span>
          <IconButton
            size="small"
            disabled={!links.prev}
            onClick={() => links.prev && onGoToPart(links.prev)}
            aria-label="Previous trace part"
            sx={{ color: "text.secondary" }}
          >
            <ChevronLeftIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ whiteSpace: "nowrap" }}
      >
        Part {links.index}
      </Typography>
      <Tooltip
        title={
          links.next ? `Next part (${links.next})` : "This is the newest part"
        }
      >
        <span>
          <IconButton
            size="small"
            disabled={!links.next}
            onClick={() => links.next && onGoToPart(links.next)}
            aria-label="Next trace part"
            sx={{ color: "text.secondary" }}
          >
            <ChevronRightIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

// A replay opened from the dashboard: the very same breadcrumb as the span
// page, so moving between the two keeps your bearings.
function DashboardCrumbs({
  trace,
  view,
  back,
  live,
}: {
  trace: AgentTraceFile;
  view: DashboardReplayView;
  back: string | null;
  live: boolean;
}) {
  const project = typeof trace.meta?.project === "string" ? trace.meta.project : undefined;
  const conversation =
    typeof trace.meta?.conversationId === "string" ? trace.meta.conversationId : undefined;
  const { executionIndex: index, executionCount: count } = view;
  const shownConversation = conversation ?? (count <= 1 ? trace.name : undefined);
  const traceId = trace.messages[index]?.otelTraceId;
  useEffect(() => {
    if (traceId) {
      rememberCrumbs({ traceId, conversation: shownConversation, position: index + 1, total: count });
    }
  }, [traceId, shownConversation, index, count]);
  return (
    <OtelCrumbs
      route={{ view: "trace", project, back: back ?? undefined }}
      projects={view.projects}
      live={live}
      navigate={(href) => window.location.assign(href)}
      trail={executionCrumbs({
        conversation: shownConversation,
        execution: {
          position: index + 1,
          total: count,
          onPrev: index > 0 ? () => view.onStep(-1) : undefined,
          onNext: index < count - 1 ? () => view.onStep(1) : undefined,
          picker: { choices: executionChoices(trace.messages), onJump: view.onJump },
        },
      })}
    />
  );
}

export default function AppHeader({
  trace,
  hasFlow,
  canClearFlow,
  isServedTrace,
  isLiveWatching,
  partLinks,
  dashboardView,
  onGoToPart,
  onClearFlow,
  onOpenGallery,
  onUploadLoad,
  onOpenTutorial,
  onOpenSearch,
  isDarkMode,
  onToggleColorMode,
  inspectorOpen,
  onToggleInspector,
  onInteract,
}: AppHeaderProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [localDataOpen, setLocalDataOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  // What this context shows (website / `wizardflow ui` / from the dashboard).
  const { context, chrome } = useViewerChrome();
  const dashboardHref = useDashboardBackHref();
  const hasGuideItems = chrome.examples || chrome.upload || chrome.tutorial;
  const spanHref = context === "from-dashboard" && hasFlow ? dashboardView?.spanHref : undefined;
  // The menu's Upload row drives its own file input, since the header's
  // TraceUploader button is display:none at the width the menu appears at.
  const { input: traceFileInput, pick: pickTraceFile } =
    useTraceFilePicker(onUploadLoad);

  // The trigger is hidden from `sm` up, so rotating a phone into landscape
  // would otherwise leave the menu anchored to an invisible button. Folded
  // into `open` rather than closed from an effect: the width is known during
  // render, so there is nothing to synchronize.
  const isWide = useMediaQuery(useTheme().breakpoints.up("sm"));
  const menuOpen = Boolean(menuAnchor) && !isWide;

  return (
    <Box
      onClickCapture={onInteract}
      sx={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: { xs: 0.5, sm: 1 },
        px: { xs: 1, sm: 2 },
        // From the dashboard: the same row as its span page, at the same height.
        ...(context === "from-dashboard"
          ? { minHeight: 56 }
          : { py: { xs: 1, sm: 1.25 }, borderBottom: 1, borderColor: "divider" }),
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: { xs: "space-between", sm: "flex-start" },
          gap: 1,
          minWidth: 0,
          flex: 1,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: context === "from-dashboard" ? "center" : "baseline",
            gap: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {context === "from-dashboard" && dashboardView ? (
            <DashboardCrumbs trace={trace} view={dashboardView} back={dashboardHref} live={isLiveWatching} />
          ) : (
            <>
              <Typography
                variant="h6"
                sx={{ flexShrink: 0, fontWeight: 600, letterSpacing: -0.2 }}
              >
                WizardFlow
              </Typography>
              {trace.name && (
                <>
                  <Typography component="span" color="text.secondary">
                    /
                  </Typography>
                  <Typography
                    component="span"
                    color="text.secondary"
                    noWrap
                    title={trace.name}
                    sx={{
                      minWidth: 0,
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 13,
                    }}
                  >
                    {trace.name}
                  </Typography>
                </>
              )}
            </>
          )}
        </Box>
        {/* Flow actions sit together as a tight, center-aligned cluster so the
            info and clear icons read as a pair rather than drifting apart.
            Not from the dashboard: there the breadcrumb has the live dot, the
            span page has these facts, and there's no file to clear. */}
        {context !== "from-dashboard" && (
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {isServedTrace && (
            <LiveStatusDot
              watching={isLiveWatching}
              title="Live — watching the trace file for new executions"
            />
          )}
          {partLinks && (
            <PartNavigator links={partLinks} onGoToPart={onGoToPart} />
          )}
          {/* Splits status (what you're looking at) from the actions on it,
              so the two stop reading as one row of same-sized icons. */}
          {isServedTrace && (
            <Box
              sx={{
                width: "1px",
                height: 16,
                mx: 0.75,
                bgcolor: "divider",
              }}
            />
          )}
          <TraceInfo trace={trace} />
          {canClearFlow && (
            <Tooltip title="Clear flow">
              <IconButton
                size="small"
                onClick={onClearFlow}
                aria-label="Clear flow"
                sx={{ color: "text.secondary" }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        )}
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 1,
          flexWrap: "wrap",
          width: "auto",
          flexShrink: 0,
        }}
      >
        {chrome.examples && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<GridViewOutlinedIcon />}
            onClick={onOpenGallery}
            sx={wideOnly}
          >
            Examples
          </Button>
        )}
        {chrome.upload && <TraceUploader onLoad={onUploadLoad} sx={wideOnly} />}
        {/* Labeled and framed like its neighbours — a tooltip-only icon would
            be undiscoverable for something you reach for once. */}
        {chrome.tutorial && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<MenuBookOutlinedIcon />}
            onClick={onOpenTutorial}
            sx={wideOnly}
          >
            Tutorial
          </Button>
        )}
        <Tooltip title="Search trace (Ctrl+K)">
          {/* span so the Tooltip still anchors while the button is disabled */}
          <span>
            <IconButton
              size="small"
              onClick={onOpenSearch}
              disabled={!hasFlow}
              aria-label="Search trace"
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip
          title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          <IconButton
            size="small"
            onClick={onToggleColorMode}
            aria-label="Toggle color mode"
            // From the dashboard, its sidebar (md up) has the toggle, in the
            // same corner as on every dashboard page.
            sx={
              context === "from-dashboard"
                ? { display: { xs: "none", sm: "inline-flex", md: "none" } }
                : wideOnly
            }
          >
            {isDarkMode ? (
              <LightModeOutlinedIcon fontSize="small" />
            ) : (
              <DarkModeOutlinedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title={inspectorOpen ? "Hide inspector" : "Show inspector"}>
          <IconButton
            size="small"
            onClick={onToggleInspector}
            color={inspectorOpen ? "primary" : "default"}
            aria-label="Toggle inspector panel"
          >
            <ViewSidebarOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {/* Last in the row: the same corner and look as "Open graph replay"
            on the span page, so the two views mirror each other. */}
        {spanHref && (
          <Tooltip
            title="Leave graph replay and see this step on the span timeline"
            {...TOOLTIP_TIMING.explain}
          >
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<ListAltOutlinedIcon />}
              href={spanHref}
              sx={{ ...wideOnly, whiteSpace: "nowrap" }}
            >
              Open span timeline
            </Button>
          </Tooltip>
        )}
        {/* A phone can't fit three labeled buttons and three icons on one row,
            so the rare actions collapse in here — keeping their labels, since
            a touch screen has no hover to reveal a tooltip. Search and the
            inspector toggle stay outside: they're used repeatedly while
            reading a trace, and the inspector is how you give the graph the
            rest of the screen. */}
        <IconButton
          size="small"
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          aria-label="More actions"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          sx={{ display: { xs: "inline-flex", sm: "none" } }}
        >
          <MenuIcon fontSize="small" />
        </IconButton>
        {traceFileInput}
        <Menu
          anchorEl={menuAnchor}
          open={menuOpen}
          onClose={closeMenu}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          {/* MUI's Menu wants direct children, not fragments, so each optional
              row is its own conditional. */}
          {chrome.examples && (
            <MenuItem
              onClick={() => {
                closeMenu();
                onOpenGallery();
              }}
            >
              <ListItemIcon>
                <GridViewOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Examples</ListItemText>
            </MenuItem>
          )}
          {chrome.upload && (
            <MenuItem
              onClick={() => {
                // Close first: the menu restores focus when it unmounts, which
                // would fight the file dialog if that opened first.
                closeMenu();
                pickTraceFile();
              }}
            >
              <ListItemIcon>
                <UploadFileIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Upload trace</ListItemText>
            </MenuItem>
          )}
          {chrome.tutorial && (
            <MenuItem
              onClick={() => {
                closeMenu();
                onOpenTutorial();
              }}
            >
              <ListItemIcon>
                <MenuBookOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Tutorial</ListItemText>
            </MenuItem>
          )}
          {spanHref && (
            <MenuItem component="a" href={spanHref} onClick={closeMenu}>
              <ListItemIcon>
                <ListAltOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Open span timeline</ListItemText>
            </MenuItem>
          )}
          {hasGuideItems && <Divider />}
          {chrome.whyWizardFlow && (
            <MenuItem
              component="a"
              href={isHostedWizardFlow ? "/why-wizardflow" : "/why-wizardflow.html"}
              onClick={closeMenu}
            >
              <ListItemIcon>
                <HelpCenterOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Why WizardFlow?</ListItemText>
            </MenuItem>
          )}
          {chrome.localDataPromise && (
            <MenuItem
              onClick={() => {
                closeMenu();
                setLocalDataOpen(true);
              }}
            >
              <ListItemIcon>
                <LockOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Data stays local</ListItemText>
            </MenuItem>
          )}
          <MenuItem
            component="a"
            href="https://github.com/lkleonk/wizardflow"
            target="_blank"
            rel="noreferrer"
            onClick={closeMenu}
          >
            <ListItemIcon>
              <CodeIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>GitHub</ListItemText>
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              closeMenu();
              onToggleColorMode();
            }}
          >
            <ListItemIcon>
              {isDarkMode ? (
                <LightModeOutlinedIcon fontSize="small" />
              ) : (
                <DarkModeOutlinedIcon fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText>
              {isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
            </ListItemText>
          </MenuItem>
        </Menu>
        {chrome.localDataPromise && (
          <LocalDataDialog
            open={localDataOpen}
            onClose={() => setLocalDataOpen(false)}
          />
        )}
      </Box>
    </Box>
  );
}
