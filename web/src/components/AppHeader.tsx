import { useCallback, useState } from "react";
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
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SearchIcon from "@mui/icons-material/Search";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import TraceInfo from "@/components/TraceInfo";
import TraceUploader, { useTraceFilePicker } from "@/components/TraceUploader";
import type { AgentTraceFile } from "@/types/agenttrace";

// Controls that move into the overflow menu on phones.
const wideOnly = { display: { xs: "none", sm: "inline-flex" } } as const;

/** The neighbouring part files of a rotated run, resolved by the caller. */
export type PartLinks = {
  prev?: string;
  next?: string;
  index: number;
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

// The live-watch indicator, next to the file name it describes: is this part
// still growing? The slot is kept even when the dot is out, so a rotation
// does not shift everything beside it sideways.
function LiveStatusDot({ watching }: { watching: boolean }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", px: 0.75 }}>
      {watching ? (
        <Tooltip title="Live — watching the trace file for new messages">
          <Box
            role="status"
            aria-label="Watching trace for updates"
            sx={{ display: "flex" }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: "success.main",
                "@keyframes livePulse": {
                  "0%": {
                    boxShadow: "0 0 0 0 rgba(102, 187, 106, 0.55)",
                  },
                  "70%": {
                    boxShadow: "0 0 0 6px rgba(102, 187, 106, 0)",
                  },
                  "100%": {
                    boxShadow: "0 0 0 0 rgba(102, 187, 106, 0)",
                  },
                },
                animation: "livePulse 2s ease-out infinite",
                "@media (prefers-reduced-motion: reduce)": {
                  animation: "none",
                },
              }}
            />
          </Box>
        </Tooltip>
      ) : (
        <Box sx={{ width: 8, height: 8 }} />
      )}
    </Box>
  );
}

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

export default function AppHeader({
  trace,
  hasFlow,
  canClearFlow,
  isServedTrace,
  isLiveWatching,
  partLinks,
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
  const closeMenu = useCallback(() => setMenuAnchor(null), []);
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
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { xs: "stretch", sm: "center" },
        justifyContent: "space-between",
        gap: 1,
        px: { xs: 1, sm: 2 },
        py: { xs: 1, sm: 1.25 },
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: { xs: "space-between", sm: "flex-start" },
          gap: 1,
          minWidth: 0,
          width: { xs: "100%", sm: "auto" },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "baseline",
            gap: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
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
        </Box>
        {/* Flow actions sit together as a tight, center-aligned cluster so the
            info and clear icons read as a pair rather than drifting apart. */}
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {isServedTrace && <LiveStatusDot watching={isLiveWatching} />}
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
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: { xs: "flex-end", sm: "flex-start" },
          gap: 1,
          flexWrap: "wrap",
          width: { xs: "100%", sm: "auto" },
        }}
      >
        <Button
          size="small"
          variant="outlined"
          startIcon={<GridViewOutlinedIcon />}
          onClick={onOpenGallery}
          sx={wideOnly}
        >
          Examples
        </Button>
        <TraceUploader onLoad={onUploadLoad} sx={wideOnly} />
        {/* Labeled and framed like its neighbours — a tooltip-only icon would
            be undiscoverable for something you reach for once. */}
        <Button
          size="small"
          variant="outlined"
          startIcon={<MenuBookOutlinedIcon />}
          onClick={onOpenTutorial}
          sx={wideOnly}
        >
          Tutorial
        </Button>
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
            sx={wideOnly}
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
          <MoreVertIcon fontSize="small" />
        </IconButton>
        {traceFileInput}
        <Menu
          anchorEl={menuAnchor}
          open={menuOpen}
          onClose={closeMenu}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
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
      </Box>
    </Box>
  );
}
