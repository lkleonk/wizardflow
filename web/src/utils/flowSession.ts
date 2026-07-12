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

// --- Message timeline density (per-tab) ---
//
// Whether the message strip shows expanded cards (title + preview + meta)
// instead of compact chips. Same useSyncExternalStore shape as the flow:
// compact on the server and first client render, real value after hydration.

const TIMELINE_EXPANDED_KEY = "wizardflow:timeline-expanded";

let timelineExpanded = false;
let timelineInitialized = false;
const timelineListeners = new Set<() => void>();

export function subscribeTimelineExpanded(onChange: () => void): () => void {
  timelineListeners.add(onChange);
  return () => timelineListeners.delete(onChange);
}

export function getTimelineExpanded(): boolean {
  if (!timelineInitialized) {
    timelineInitialized = true;
    if (typeof window !== "undefined") {
      try {
        timelineExpanded =
          window.sessionStorage.getItem(TIMELINE_EXPANDED_KEY) === "1";
      } catch {
        timelineExpanded = false;
      }
    }
  }
  return timelineExpanded;
}

export function getServerTimelineExpanded(): false {
  return false;
}

export function setTimelineExpanded(expanded: boolean): void {
  timelineInitialized = true;
  timelineExpanded = expanded;
  if (typeof window !== "undefined") {
    try {
      if (expanded) {
        window.sessionStorage.setItem(TIMELINE_EXPANDED_KEY, "1");
      } else {
        window.sessionStorage.removeItem(TIMELINE_EXPANDED_KEY);
      }
    } catch {
      // Storage unavailable: keep the choice in memory for this session.
    }
  }
  timelineListeners.forEach((listener) => listener());
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

// --- Inspector payload display settings (per-tab) ---
//
// Two independent toggles for how the inspector renders a payload's raw text:
// highlighting JSON object keys, and turning literal `\n` sequences (from
// JSON.stringify-ing a multi-line string) into real line breaks. Both default
// to on — off is the explicit "show me the exact raw text" choice. Same
// useSyncExternalStore shape as the other settings above, generalized here
// since a default-`true` boolean needs to distinguish "never set" from
// "explicitly turned off", which the default-`false` settings above don't.
function createPersistedBooleanSetting(storageKey: string, defaultValue: boolean) {
  let value = defaultValue;
  let isInitialized = false;
  const listeners = new Set<() => void>();

  function get(): boolean {
    if (!isInitialized) {
      isInitialized = true;
      if (typeof window !== "undefined") {
        try {
          const raw = window.sessionStorage.getItem(storageKey);
          if (raw !== null) value = raw === "1";
        } catch {
          // Storage unavailable: fall back to the default for this session.
        }
      }
    }
    return value;
  }

  function getServer(): boolean {
    return defaultValue;
  }

  function set(next: boolean): void {
    isInitialized = true;
    value = next;
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Storage unavailable: keep the choice in memory for this session.
      }
    }
    listeners.forEach((listener) => listener());
  }

  function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  }

  return { get, getServer, set, subscribe };
}

const inspectorHighlightKeysSetting = createPersistedBooleanSetting(
  "wizardflow:inspector-highlight-keys",
  true
);
export const getInspectorHighlightKeys = inspectorHighlightKeysSetting.get;
export const getServerInspectorHighlightKeys = inspectorHighlightKeysSetting.getServer;
export const setInspectorHighlightKeys = inspectorHighlightKeysSetting.set;
export const subscribeInspectorHighlightKeys = inspectorHighlightKeysSetting.subscribe;

const inspectorRenderNewlinesSetting = createPersistedBooleanSetting(
  "wizardflow:inspector-render-newlines",
  true
);
export const getInspectorRenderNewlines = inspectorRenderNewlinesSetting.get;
export const getServerInspectorRenderNewlines = inspectorRenderNewlinesSetting.getServer;
export const setInspectorRenderNewlines = inspectorRenderNewlinesSetting.set;
export const subscribeInspectorRenderNewlines = inspectorRenderNewlinesSetting.subscribe;

// Off by default — this replaces the familiar raw-JSON view with a flattened
// `key: value` tree (no braces/brackets/quoted keys), so it's an opt-in
// rather than a "turn this off to get back to normal" toggle like the two
// above.
const inspectorCompactViewSetting = createPersistedBooleanSetting(
  "wizardflow:inspector-compact-view",
  false
);
export const getInspectorCompactView = inspectorCompactViewSetting.get;
export const getServerInspectorCompactView = inspectorCompactViewSetting.getServer;
export const setInspectorCompactView = inspectorCompactViewSetting.set;
export const subscribeInspectorCompactView = inspectorCompactViewSetting.subscribe;
