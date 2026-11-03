import { useSyncExternalStore } from "react";

// Dashboard display preferences: per browser (localStorage), not in the
// database, so they don't travel with the .db file. The attribute mapping is
// the opposite: it describes the data, so it lives in the db.

export type TimeRange = "1h" | "24h" | "7d" | "all";

export type DisplayPrefs = {
  /** Started column of the trace list. */
  time: "relative" | "absolute";
  /** The range a trace list opens with. */
  range: TimeRange;
  /** Attribute keys (or `prefix.*`) shown first on every span that has them. */
  pins: string[];
  /** Attribute keys (or `prefix.*`) collapsed into an "N hidden" line. */
  hidden: string[];
  /** Order of the attributes inside a group. */
  attrOrder: "sent" | "az";
};

export const DEFAULT_DISPLAY: DisplayPrefs = {
  time: "relative",
  range: "all",
  pins: [],
  hidden: [],
  attrOrder: "sent",
};

export const RANGE_MS: Record<TimeRange, number | null> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  all: null,
};

const KEY = "wf-otel-display";
const listeners = new Set<() => void>();
let cache: { raw: string | null; prefs: DisplayPrefs } | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function snapshot(): DisplayPrefs {
  const raw = readRaw();
  if (cache?.raw === raw) return cache.prefs;
  let stored: Partial<DisplayPrefs> = {};
  try {
    stored = raw ? (JSON.parse(raw) as Partial<DisplayPrefs>) : {};
  } catch {
    // a hand-edited or old value: fall back to the defaults
  }
  const prefs = { ...DEFAULT_DISPLAY, ...stored };
  cache = { raw, prefs };
  return prefs;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => event.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDisplayPrefs(): DisplayPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_DISPLAY);
}

export function setDisplayPrefs(change: Partial<DisplayPrefs>): void {
  const next = { ...snapshot(), ...change };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private window or blocked storage: the change lasts for this page only
    cache = { raw: readRaw(), prefs: next };
  }
  listeners.forEach((listener) => listener());
}

// --- the current time, for "5m ago" and time ranges ---------------------------
// A ticking store rather than Date.now() in render: renders stay pure, and
// every relative time on the page moves together.

const NOW_TICK_MS = 30_000;
const nowListeners = new Set<() => void>();
let nowMs = 0;
let nowTimer: number | undefined;

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === undefined) {
    // Stale after a while with no subscriber; React re-reads the snapshot
    // right after subscribing, so this lands in the first commit.
    nowMs = Date.now();
    nowTimer = window.setInterval(() => {
      nowMs = Date.now();
      nowListeners.forEach((l) => l());
    }, NOW_TICK_MS);
  }
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0) {
      window.clearInterval(nowTimer);
      nowTimer = undefined;
    }
  };
}

function nowSnapshot(): number {
  // Must return the same value until the store changes, so only the very
  // first read takes the time.
  if (nowMs === 0) nowMs = Date.now();
  return nowMs;
}

/** Wall-clock ms, updated every 30 s. */
export function useNow(): number {
  return useSyncExternalStore(subscribeNow, nowSnapshot, () => 0);
}

/** `pattern` is a key, or a `prefix.*` that matches every key under it. */
export function keyMatches(key: string, pattern: string): boolean {
  return pattern.endsWith("*") ? key.startsWith(pattern.slice(0, -1)) : key === pattern;
}

/** Letters, digits, dots, _ and -, with an optional trailing `*`. */
export function isAttributeKey(text: string): boolean {
  return /^[A-Za-z0-9_.-]+\*?$/.test(text);
}
