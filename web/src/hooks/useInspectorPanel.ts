import { useCallback, useMemo, useState } from "react";

export type InspectorPanelState = {
  open: boolean;
  toggle: () => void;
  width: number;
  maximized: boolean;
  setMaximized: (maximized: boolean) => void;
  /** One-shot payload-tab focus request (see InspectorPanel's `focusPayload`). */
  focus: { index: number; seq: number } | undefined;
  /** Open the panel and ask it to focus one payload tab. */
  revealPayload: (index: number) => void;
  /** mousedown on the drag handle along the panel's left edge. */
  startResize: (e: React.MouseEvent) => void;
};

// Everything about the inspector panel's frame — whether it's showing, how
// wide, maximized or docked, and which payload tab it was last pointed at.
// None of it depends on the trace, so it stays independent of the replay.
export function useInspectorPanel(onInteract: () => void): InspectorPanelState {
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(360);
  const [maximized, setMaximized] = useState(false);
  const [focus, setFocus] = useState<{ index: number; seq: number }>();

  const toggle = useCallback(() => setOpen((current) => !current), []);

  // Bumping `seq` is what makes a repeat jump to the same payload register as
  // a new request rather than a no-op.
  const revealPayload = useCallback((index: number) => {
    setOpen(true);
    setFocus((prev) => ({ index, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  // Drag the handle on the inspector's left edge to resize it (clamped).
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onInteract();
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: MouseEvent) => {
        const next = startWidth + (startX - ev.clientX); // drag left → wider
        // Viewport-relative cap so wide monitors aren't stuck at a fixed max,
        // while the graph always keeps at least ~a third of the width.
        const maxWidth = Math.min(900, Math.round(window.innerWidth * 0.65));
        setWidth(Math.max(280, Math.min(maxWidth, next)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onInteract, width]
  );

  // Memoized so callers can safely depend on the whole object — otherwise a
  // handler that reads it (the search jump) would change identity every
  // render.
  return useMemo(
    () => ({
      open,
      toggle,
      width,
      maximized,
      setMaximized,
      focus,
      revealPayload,
      startResize,
    }),
    [open, toggle, width, maximized, focus, revealPayload, startResize]
  );
}
