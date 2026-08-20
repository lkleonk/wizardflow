import { useEffect } from "react";

type TransportKeyHandlers = {
  stepIndex: number;
  stepCount: number;
  onTogglePlay: () => void;
  onPause: () => void;
  onGoToStep: (index: number) => void;
  onGoToAdjacentMessage: (direction: -1 | 1) => void;
  /** Any transport key leaves the graph's arrange mode. */
  onInteract: () => void;
};

// Keyboard transport: Space = play/pause, ←/→ = step, Home/End = jump.
// Up/down switches to the previous/next message.
// Ignored while typing or when a button/input is focused (so it doesn't
// double-fire with the focused control or hijack text entry).
export function useTransportKeys({
  stepIndex,
  stepCount,
  onTogglePlay,
  onPause,
  onGoToStep,
  onGoToAdjacentMessage,
  onInteract,
}: TransportKeyHandlers) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "BUTTON" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          onTogglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          onInteract();
          onGoToStep(stepIndex - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          onInteract();
          onGoToStep(stepIndex + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          onGoToAdjacentMessage(-1);
          break;
        case "ArrowDown":
          e.preventDefault();
          onGoToAdjacentMessage(1);
          break;
        case "Home":
          e.preventDefault();
          onInteract();
          onPause();
          onGoToStep(0);
          break;
        case "End":
          e.preventDefault();
          onInteract();
          onPause();
          onGoToStep(stepCount - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    onTogglePlay,
    onPause,
    onInteract,
    onGoToStep,
    onGoToAdjacentMessage,
    stepIndex,
    stepCount,
  ]);
}

// Ctrl/Cmd+K opens search from anywhere — the transport handler above ignores
// modified keys, so the two never collide. Kept as its own listener so it
// doesn't re-register on every step change.
export function useSearchHotkey(enabled: boolean, onOpenSearch: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (enabled) onOpenSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onOpenSearch]);
}
