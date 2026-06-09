import type { AgentTraceFile } from "@/types/agenttrace";

// Per-tab persistence for an uploaded flow. Backed by sessionStorage so an
// accidental refresh doesn't lose the upload, while the data is still cleared
// when the tab closes (keeping potentially-sensitive flows off the disk
// long-term — see the Datenschutz copy). Exposed as a useSyncExternalStore
// source so the restore is hydration-safe: the server and the first client
// render both see `null`, then the saved flow is picked up right after.

const STORAGE_KEY = "wizardflow:flow";

let snapshot: AgentTraceFile | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function readFromStorage(): AgentTraceFile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AgentTraceFile) : null;
  } catch {
    return null;
  }
}

export function subscribeSavedFlow(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

// Client snapshot. Lazily hydrated from sessionStorage on first read, then held
// as a stable reference until setSavedFlow changes it — useSyncExternalStore
// requires getSnapshot to return a cached value, not a fresh parse each call.
export function getSavedFlow(): AgentTraceFile | null {
  if (!initialized) {
    initialized = true;
    snapshot = readFromStorage();
  }
  return snapshot;
}

// Server / initial-hydration snapshot: nothing restored yet, so both the server
// HTML and the first client render fall back to the bundled sample. This is
// what avoids a hydration mismatch.
export function getServerSavedFlow(): null {
  return null;
}

export function setSavedFlow(flow: AgentTraceFile | null): void {
  initialized = true;
  snapshot = flow;
  if (typeof window !== "undefined") {
    try {
      if (flow) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flow));
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Quota exceeded or storage unavailable (e.g. private mode): keep the flow
      // in memory for this session; it just won't survive a refresh.
    }
  }
  listeners.forEach((listener) => listener());
}

// --- Welcome dialog dismissal (per-tab) ---
//
// Remembers that the user has made their initial choice (use example / upload /
// dismiss) so the welcome dialog only appears once per session. Same
// useSyncExternalStore shape as the flow: `false` on the server and first
// client render, real value right after hydration.

const WELCOME_KEY = "wizardflow:welcome-dismissed";

let welcomeDismissed = false;
let welcomeInitialized = false;
const welcomeListeners = new Set<() => void>();

export function subscribeWelcomeDismissed(onChange: () => void): () => void {
  welcomeListeners.add(onChange);
  return () => welcomeListeners.delete(onChange);
}

export function getWelcomeDismissed(): boolean {
  if (!welcomeInitialized) {
    welcomeInitialized = true;
    if (typeof window !== "undefined") {
      try {
        welcomeDismissed = window.sessionStorage.getItem(WELCOME_KEY) === "1";
      } catch {
        welcomeDismissed = false;
      }
    }
  }
  return welcomeDismissed;
}

// Treat the welcome as dismissed during SSR and the first client render so the
// dialog starts *closed*. The client decides a beat later whether to actually
// show it. This matters: if it opened during hydration and then closed once a
// saved flow is restored, the modal's flash would leave a stuck backdrop that
// silently swallows every click.
export function getServerWelcomeDismissed(): true {
  return true;
}

export function setWelcomeDismissed(): void {
  welcomeInitialized = true;
  if (welcomeDismissed) return;
  welcomeDismissed = true;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(WELCOME_KEY, "1");
    } catch {
      // Storage unavailable: keep it dismissed in memory for this session.
    }
  }
  welcomeListeners.forEach((listener) => listener());
}
