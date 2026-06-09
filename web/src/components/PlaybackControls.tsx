"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";
import FirstPageIcon from "@mui/icons-material/FirstPage";
import LastPageIcon from "@mui/icons-material/LastPage";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import RepeatIcon from "@mui/icons-material/Repeat";
import RepeatOneIcon from "@mui/icons-material/RepeatOne";
import Tooltip from "@mui/material/Tooltip";
import { formatDuration } from "@/utils/formatTime";

export type PlaybackMode =
  | "stop-at-message-end"
  | "repeat-message"
  | "play-next-message";
export type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;

const TIME_READOUT_WIDTH = "11ch";

function formatPlaybackSpeed(speed: PlaybackSpeed): string {
  return `${speed}x`;
}

function nextPlaybackSpeed(speed: PlaybackSpeed): PlaybackSpeed {
  if (speed === 0.5) return 1;
  if (speed === 1) return 1.5;
  if (speed === 1.5) return 2;
  return 0.5;
}

type PlaybackControlsProps = {
  stepIndex: number;
  stepCount: number;
  isPlaying: boolean;
  playbackMode: PlaybackMode;
  playbackSpeed: PlaybackSpeed;
  /** Per-step delta (ms): time this step took since the previous one. */
  deltaMs?: number;
  /** Cumulative ms since the first step; the playhead position. */
  elapsedMs?: number;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onTogglePlaybackMode: () => void;
  onCyclePlaybackSpeed: () => void;
  /** Jump directly to a step (scrubber). */
  onSeek: (index: number) => void;
};

export default function PlaybackControls({
  stepIndex,
  stepCount,
  isPlaying,
  playbackMode,
  playbackSpeed,
  deltaMs,
  elapsedMs,
  onPrev,
  onNext,
  onTogglePlay,
  onTogglePlaybackMode,
  onCyclePlaybackSpeed,
  onSeek,
}: PlaybackControlsProps) {
  const atStart = stepIndex <= 0;
  const atEnd = stepIndex >= stepCount - 1;
  const playbackModeLabel =
    playbackMode === "stop-at-message-end"
      ? "Stop at message end"
      : playbackMode === "repeat-message"
        ? "Repeat current message"
        : "Play next message";
  const playbackModeToggleLabel =
    playbackMode === "stop-at-message-end"
      ? "Switch to repeat current message"
      : playbackMode === "repeat-message"
        ? "Switch to play next message"
        : "Switch to stop at message end";
  const playbackSpeedLabel = formatPlaybackSpeed(playbackSpeed);
  const nextPlaybackSpeedLabel = formatPlaybackSpeed(nextPlaybackSpeed(playbackSpeed));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", px: 2, py: 1, gap: 0.5 }}>
      <Slider
        value={stepCount > 0 ? stepIndex : 0}
        min={0}
        max={Math.max(stepCount - 1, 0)}
        step={1}
        marks={stepCount > 1}
        disabled={stepCount <= 1}
        onChange={(_, value) => onSeek(value as number)}
        size="small"
        aria-label="Scrub steps"
        sx={{ mx: 1, width: "auto" }}
      />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
        }}
      >
        <IconButton
          size="small"
          onClick={() => onSeek(0)}
          disabled={atStart}
          aria-label="Jump to start"
        >
          <FirstPageIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={onPrev} disabled={atStart}>
          <SkipPreviousIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={onTogglePlay}
          disabled={stepCount === 0}
          color="primary"
        >
          {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <IconButton size="small" onClick={onNext} disabled={atEnd}>
          <SkipNextIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => onSeek(Math.max(stepCount - 1, 0))}
          disabled={atEnd}
          aria-label="Jump to end"
        >
          <LastPageIcon fontSize="small" />
        </IconButton>
        <Tooltip title={`${playbackModeLabel}. ${playbackModeToggleLabel}.`} placement="top">
          <span style={{ display: "inline-flex" }}>
            <IconButton
              size="small"
              onClick={onTogglePlaybackMode}
              disabled={stepCount === 0}
              color={playbackMode === "stop-at-message-end" ? "default" : "primary"}
              aria-label={`${playbackModeLabel}. ${playbackModeToggleLabel}.`}
            >
              {playbackMode === "stop-at-message-end" ? (
                <RepeatIcon fontSize="small" />
              ) : playbackMode === "repeat-message" ? (
                <RepeatOneIcon fontSize="small" />
              ) : (
                <PlaylistPlayIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip
          title={`Playback speed: ${playbackSpeedLabel}. Switch to ${nextPlaybackSpeedLabel}.`}
          placement="top"
        >
          <span style={{ display: "inline-flex" }}>
            <Button
              size="small"
              variant="text"
              onClick={onCyclePlaybackSpeed}
              disabled={stepCount === 0}
              aria-label={`Playback speed: ${playbackSpeedLabel}. Switch to ${nextPlaybackSpeedLabel}.`}
              sx={{
                minWidth: 48,
                width: 48,
                px: 0.75,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                textTransform: "none",
                whiteSpace: "nowrap",
              }}
            >
              {playbackSpeedLabel}
            </Button>
          </span>
        </Tooltip>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ ml: 1, minWidth: 72, fontVariantNumeric: "tabular-nums" }}
        >
          Step {stepCount === 0 ? 0 : stepIndex + 1} / {stepCount}
        </Typography>
        <Box
          sx={{
            display: "flex",
            gap: 1.5,
            fontVariantNumeric: "tabular-nums",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 12,
          }}
        >
          <Tooltip title="Time since previous step" placement="top">
            <Box
              component="span"
              sx={{
                color: "text.secondary",
                display: "inline-flex",
                justifyContent: "flex-end",
                whiteSpace: "nowrap",
                width: TIME_READOUT_WIDTH,
              }}
            >
              Δ {deltaMs !== undefined ? formatDuration(deltaMs) : "—"}
            </Box>
          </Tooltip>
          <Tooltip title="Elapsed since message start" placement="top">
            <Box
              component="span"
              sx={{
                color: "primary.main",
                display: "inline-flex",
                justifyContent: "flex-end",
                whiteSpace: "nowrap",
                width: TIME_READOUT_WIDTH,
              }}
            >
              Σ {elapsedMs !== undefined ? formatDuration(elapsedMs) : "—"}
            </Box>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  );
}
