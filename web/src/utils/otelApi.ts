import { useEffect, useState } from "react";

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
// separately started `wizardflow serve --port 8765` with
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
 */
export function useApi<T>(path: string | null): {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
} {
  const [state, setState] = useState<ApiState<T>>({ key: null });
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    fetchApi<T>(path, controller.signal).then(
      (data) => setState({ key: path, data }),
      (error: Error) => {
        if (error.name !== "AbortError") setState({ key: path, error });
      }
    );
    return () => controller.abort();
  }, [path]);
  const current = state.key === path;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: path !== null && !current,
  };
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
