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

type StepSliderProps = Pick<
  PlaybackControlsProps,
  "stepIndex" | "stepCount" | "onSeek"
> & {
  mobile?: boolean;
};

function StepSlider({ stepIndex, stepCount, onSeek, mobile }: StepSliderProps) {
  return (
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
      sx={
        mobile
          ? {
              display: { xs: "block", sm: "none" },
              mx: 0.5,
              my: -0.25,
              width: "auto",
            }
          : { display: { xs: "none", sm: "block" }, mx: 1, width: "auto" }
      }
    />
  );
}

type PlaybackModeButtonProps = {
  playbackMode: PlaybackMode;
  playbackModeLabel: string;
  playbackModeToggleLabel: string;
  stepCount: number;
  compact?: boolean;
  onTogglePlaybackMode: () => void;
};

function PlaybackModeButton({
  playbackMode,
  playbackModeLabel,
  playbackModeToggleLabel,
  stepCount,
  compact,
  onTogglePlaybackMode,
}: PlaybackModeButtonProps) {
  const icon =
    playbackMode === "repeat-message" ? (
      <RepeatOneIcon fontSize="small" />
    ) : (
      <RepeatIcon fontSize="small" />
    );
  const label = `${playbackModeLabel}. ${playbackModeToggleLabel}.`;

  return (
    <Tooltip title={label} placement="top">
      <span style={{ display: "inline-flex" }}>
        <IconButton
          size="small"
          onClick={onTogglePlaybackMode}
          disabled={stepCount === 0}
          color={playbackMode === "stop-at-message-end" ? "default" : "primary"}
          aria-label={label}
          sx={compact ? { width: 30, height: 30 } : undefined}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

type PlaybackSpeedButtonProps = {
  playbackSpeedLabel: string;
  nextPlaybackSpeedLabel: string;
  stepCount: number;
  compact?: boolean;
  onCyclePlaybackSpeed: () => void;
};

function PlaybackSpeedButton({
  playbackSpeedLabel,
  nextPlaybackSpeedLabel,
  stepCount,
  compact,
  onCyclePlaybackSpeed,
}: PlaybackSpeedButtonProps) {
  const label = `Playback speed: ${playbackSpeedLabel}. Switch to ${nextPlaybackSpeedLabel}.`;

  return (
    <Tooltip title={label} placement="top">
      <span style={{ display: "inline-flex" }}>
        <Button
          size="small"
          variant="text"
          onClick={onCyclePlaybackSpeed}
          disabled={stepCount === 0}
          aria-label={label}
          sx={{
            minWidth: compact ? 38 : 48,
            width: compact ? 38 : 48,
            px: 0.75,
            ...(compact ? { fontSize: 12 } : null),
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
  );
}

function StepReadout({
  stepIndex,
  stepCount,
  compact,
}: {
  stepIndex: number;
  stepCount: number;
  compact?: boolean;
}) {
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      sx={
        compact
          ? {
              flexShrink: 0,
              fontSize: 12,
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }
          : {
              ml: 1,
              minWidth: 72,
              flexBasis: "auto",
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
            }
      }
    >
      Step {stepCount === 0 ? 0 : stepIndex + 1} / {stepCount}
    </Typography>
  );
}

function TimeReadouts({
  deltaMs,
  elapsedMs,
  compact,
}: {
  deltaMs?: number;
  elapsedMs?: number;
  compact?: boolean;
}) {
  const readoutSx = compact
    ? {
        color: "text.secondary",
        display: "inline-flex",
        justifyContent: "flex-end",
        whiteSpace: "nowrap",
      }
    : {
        color: "text.secondary",
        display: "inline-flex",
        justifyContent: "flex-end",
        whiteSpace: "nowrap",
        width: TIME_READOUT_WIDTH,
      };

  return (
    <Box
      sx={
        compact
          ? {
              display: "flex",
              justifyContent: "center",
              gap: 0.75,
              minWidth: 0,
              fontVariantNumeric: "tabular-nums",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11.5,
              whiteSpace: "nowrap",
            }
          : {
              display: "flex",
              justifyContent: "center",
              flexBasis: "auto",
              gap: 1.5,
              fontVariantNumeric: "tabular-nums",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 12,
            }
      }
    >
      <Tooltip title="Time since previous step" placement="top">
        <Box component="span" sx={readoutSx}>
          Δ {deltaMs !== undefined ? formatDuration(deltaMs) : "—"}
        </Box>
      </Tooltip>
      <Tooltip title="Elapsed since message start" placement="top">
        <Box component="span" sx={{ ...readoutSx, color: "primary.main" }}>
          Σ {elapsedMs !== undefined ? formatDuration(elapsedMs) : "—"}
        </Box>
      </Tooltip>
    </Box>
  );
}

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
      ? "Switch to play next message"
      : playbackMode === "play-next-message"
        ? "Switch to repeat current message"
        : "Switch to stop at message end";
  const playbackSpeedLabel = formatPlaybackSpeed(playbackSpeed);
  const nextPlaybackSpeedLabel = formatPlaybackSpeed(
    nextPlaybackSpeed(playbackSpeed)
  );

  const modeButton = (compact = false) => (
    <PlaybackModeButton
      playbackMode={playbackMode}
      playbackModeLabel={playbackModeLabel}
      playbackModeToggleLabel={playbackModeToggleLabel}
      stepCount={stepCount}
      compact={compact}
      onTogglePlaybackMode={onTogglePlaybackMode}
    />
  );
  const speedButton = (compact = false) => (
    <PlaybackSpeedButton
      playbackSpeedLabel={playbackSpeedLabel}
      nextPlaybackSpeedLabel={nextPlaybackSpeedLabel}
      stepCount={stepCount}
      compact={compact}
      onCyclePlaybackSpeed={onCyclePlaybackSpeed}
    />
  );
  const playButton = (
    <IconButton
      size="small"
      onClick={onTogglePlay}
      disabled={stepCount === 0}
      color="primary"
      sx={{ justifySelf: { xs: "center", sm: "auto" } }}
    >
      {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
    </IconButton>
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        px: { xs: 1, sm: 2 },
        py: { xs: 0.5, sm: 1 },
        gap: { xs: 0.25, sm: 0.5 },
      }}
    >
      <StepSlider stepIndex={stepIndex} stepCount={stepCount} onSeek={onSeek} />

      <Box
        sx={{
          display: { xs: "grid", sm: "none" },
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          columnGap: 0.5,
        }}
      >
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5 }}>
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
        </Box>
        {playButton}
        <Box sx={{ display: "flex", justifyContent: "flex-start", gap: 0.5 }}>
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
        </Box>
      </Box>

      <StepSlider
        stepIndex={stepIndex}
        stepCount={stepCount}
        onSeek={onSeek}
        mobile
      />

      <Box
        sx={{
          display: { xs: "flex", sm: "none" },
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "nowrap",
          gap: 0.75,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {modeButton(true)}
        {speedButton(true)}
        <StepReadout stepIndex={stepIndex} stepCount={stepCount} compact />
        <TimeReadouts deltaMs={deltaMs} elapsedMs={elapsedMs} compact />
      </Box>

      <Box
        sx={{
          display: { xs: "none", sm: "flex" },
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
        {playButton}
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
        {modeButton()}
        {speedButton()}
        <StepReadout stepIndex={stepIndex} stepCount={stepCount} />
        <TimeReadouts deltaMs={deltaMs} elapsedMs={elapsedMs} />
      </Box>
    </Box>
  );
}
