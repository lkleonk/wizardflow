import { useEffect, useState, useSyncExternalStore } from "react";

/** Thrown for a non-2xx /api response; carries the server's message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

// Development only: `npm run dev` has no /api of its own, so point it at a
// separately started `wizardflow dashboard --port 8765` with
// NEXT_PUBLIC_WIZARDFLOW_API=http://127.0.0.1:8765. Unset in real builds,
// where the dashboard and its API share one origin.
const API_ORIGIN = process.env.NEXT_PUBLIC_WIZARDFLOW_API ?? "";

export async function fetchApi<T>(path: string, signal?: AbortSignal): Promise<T> {
  return readResponse<T>(
    await fetch(API_ORIGIN + path, { signal, headers: { Accept: "application/json" } })
  );
}

/** A settings write (PUT with a JSON body, or DELETE). */
export async function sendApi<T>(method: "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  return readResponse<T>(
    await fetch(API_ORIGIN + path, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // not JSON: e.g. the static host answering 404 for /api — no server
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

/** Build an /api path with query params, skipping empty values. */
export function apiPath(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return `/api/${path}${text ? `?${text}` : ""}`;
}

type ApiState<T> = { key: string | null; data?: T; error?: ApiError | Error };

/**
 * Fetch `path` (null = nothing to fetch). Loading is derived from whether the
 * held result belongs to the current path, so a path change never needs a
 * synchronous reset inside the effect.
 *
 * `live` refetches whenever new data lands in the database (see the poller
 * below), keeping the shown result until the new one is in, so a refresh
 * never flashes a spinner. A failed refresh keeps the old result too.
 */
export function useApi<T>(
  path: string | null,
  { live = false }: { live?: boolean } = {}
): {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
} {
  const [state, setState] = useState<ApiState<T>>({ key: null });
  const generation = useDataGeneration(live && path !== null);
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    fetchApi<T>(path, controller.signal).then(
      (data) => setState({ key: path, data }),
      (error: Error) => {
        if (error.name === "AbortError") return;
        setState((held) => (held.key === path && held.data !== undefined ? held : { key: path, error }));
      }
    );
    return () => controller.abort();
  }, [path, generation]);
  const current = state.key === path;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: path !== null && !current,
  };
}

// --- live refresh ------------------------------------------------------------

// One poller per tab watches /api/version, a token that changes whenever
// spans, logs or imports land in the database (from the OTLP receiver or a
// `wizardflow db import`). Each change bumps a generation that live useApi
// calls depend on. Same pacing as the replay viewer's live traces
// (traceWatcher.ts): fast while data arrives, slow once quiet, paused while
// the tab is hidden.
const POLL_FAST_MS = 2_000;
const POLL_SLOW_MS = 15_000;
const SLOWDOWN_AFTER_MS = 60_000;

let dataVersion: string | null = null;
let generation = 0;
let lastChangeMs = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

async function pollVersion() {
  timer = null;
  try {
    const next = (await fetchApi<{ dataVersion: string }>(apiPath("version"))).dataVersion;
    if (next !== dataVersion) {
      // The first answer is only the baseline: the views just fetched.
      if (dataVersion !== null) {
        generation += 1;
        lastChangeMs = Date.now();
        listeners.forEach((listener) => listener());
      }
      dataVersion = next;
    }
  } catch {
    // The server is gone or restarting: keep what is shown, try again later.
  }
  schedulePoll();
}

function schedulePoll() {
  if (timer !== null || listeners.size === 0 || document.hidden) return;
  const quiet = Date.now() - lastChangeMs > SLOWDOWN_AFTER_MS;
  timer = setTimeout(pollVersion, quiet ? POLL_SLOW_MS : POLL_FAST_MS);
}

function onVisibilityChange() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (!document.hidden) void pollVersion(); // catch up at once on return
}

function subscribeToData(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (dataVersion === null) void pollVersion();
    else schedulePoll();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

const subscribeToNothing = () => () => {};

function useDataGeneration(enabled: boolean): number {
  return useSyncExternalStore(
    enabled ? subscribeToData : subscribeToNothing,
    () => (enabled ? generation : 0),
    () => 0
  );
}

// --- nanosecond strings ------------------------------------------------------

/** Unix ns string → ms number (exact: drops only the sub-millisecond digits). */
export function nsToMs(ns: string): number {
  return ns.length > 6 ? Number(ns.slice(0, -6)) : 0;
}

/** Exact `a - b` of two ns strings, as a number of ns (offsets stay small). */
export function nsDiff(a: string, b: string): number {
  return Number(BigInt(a) - BigInt(b));
}

/** A duration in ns → "850 µs", "12 ms", "1.24 s", "2m 05s". */
export function formatNsDuration(ns: number): string {
  if (ns < 1_000_000) return `${Math.max(0, Math.round(ns / 1000))} µs`;
  const ms = ns / 1_000_000;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** Unix ns string → "Oct 11, 14:30:05" in the viewer's locale and zone. */
export function formatNsDateTime(ns: string): string {
  return new Date(nsToMs(ns)).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Unix ns string → "3m ago", "5h ago", "2d ago"; relative to `nowMs`. */
export function formatNsAgo(ns: string, nowMs: number = Date.now()): string {
  const seconds = Math.round((nowMs - nsToMs(ns)) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/** Unix ns string → "14:30:05.123". */
export function formatNsClock(ns: string): string {
  const date = new Date(nsToMs(ns));
  return (
    date.toLocaleTimeString(undefined, { hour12: false }) +
    "." +
    String(date.getMilliseconds()).padStart(3, "0")
  );
}

// --- severity ----------------------------------------------------------------

export type SeverityLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

/** OTel severity number (1–24) → its level; 0 (unset) counts as INFO. */
export function severityLevel(number: number): SeverityLevel {
  if (number >= 21) return "FATAL";
  if (number >= 17) return "ERROR";
  if (number >= 13) return "WARN";
  if (number >= 9 || number === 0) return "INFO";
  if (number >= 5) return "DEBUG";
  return "TRACE";
}
