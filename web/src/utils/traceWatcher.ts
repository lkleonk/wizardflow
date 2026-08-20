import type { AgentTraceFile } from "@/types/agenttrace";
import { parseAgentTrace } from "@/utils/agentTraceFile";

// Live-update polling for the SDK launcher (`?trace=`): fast while the trace
// is changing, slowing down once it goes quiet. A finished run is
// indistinguishable from a paused one (a normally-completed part has no seal
// record), so polling never stops on its own — it only gets cheap: every poll
// revalidates with If-None-Match, so an unchanged file costs one 304 round
// trip. The one true stop condition is rotation (`meta.nextPart`): a sealed
// part can never grow again.
const LIVE_POLL_FAST_MS = 2_000;
const LIVE_POLL_SLOW_MS = 15_000;
const LIVE_POLL_SLOWDOWN_AFTER_MS = 60_000;

// A live update can only append messages — the graph and every other field
// live in the JSONL header line, written once — so "same run, newer snapshot"
// reduces to: the previous message list is a prefix of the new one. Checked
// via ids at the prefix edges only; a false positive merely preserves view
// state it could have reset, never the data shown (the trace is always
// replaced wholesale).
export function isTraceExtension(
  prev: AgentTraceFile,
  next: AgentTraceFile
): boolean {
  if (next.messages.length < prev.messages.length) return false;
  const lastIndex = prev.messages.length - 1;
  if (lastIndex < 0) return true;
  return (
    prev.messages[0].id === next.messages[0]?.id &&
    prev.messages[lastIndex].id === next.messages[lastIndex]?.id
  );
}

export type TraceWatcherOptions = {
  /** The URL the trace was served from; polled as-is. */
  href: string;
  /** ETag from the initial load, so the first poll can already revalidate. */
  initialEtag: string | null;
  /**
   * Hand a freshly polled snapshot to the app. Return whether it changed
   * anything: the backoff only counts real changes, because on a host that
   * sends no ETag every poll is a 200 carrying identical data.
   */
  onSnapshot: (trace: AgentTraceFile) => boolean;
  /** The watch has ended — by rotation, or because `stop()` was called. */
  onStopped: () => void;
};

export type TraceWatcher = {
  /** Ends the watch and detaches every listener. Safe to call twice. */
  stop: () => void;
};

// Watch a served trace file for new messages. Everything here is plain
// browser work — no React — so the caller only has to decide what a new
// snapshot means for its own state.
export function watchTrace({
  href,
  initialEtag,
  onSnapshot,
  onStopped,
}: TraceWatcherOptions): TraceWatcher {
  let stopped = false;
  let polling = false;
  let timer: number | undefined;
  let etag: string | null = initialEtag;
  let lastChangeAt = Date.now();

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
    onStopped();
  }

  function schedule() {
    if (stopped) return;
    const quiet = Date.now() - lastChangeAt >= LIVE_POLL_SLOWDOWN_AFTER_MS;
    timer = window.setTimeout(
      poll,
      quiet ? LIVE_POLL_SLOW_MS : LIVE_POLL_FAST_MS
    );
  }

  async function poll() {
    if (stopped || polling) return;
    // A hidden tab skips the fetch but keeps the loop alive; the
    // visibilitychange listener below polls immediately on return.
    if (document.hidden) {
      schedule();
      return;
    }
    polling = true;
    try {
      const response = await fetch(href, {
        cache: "no-store",
        credentials: "same-origin",
        headers: etag ? { "If-None-Match": etag } : undefined,
      });
      if (stopped) return;
      if (response.ok) {
        const parsed = parseAgentTrace(await response.text());
        if (stopped) return;
        if (parsed) {
          etag = response.headers.get("ETag");
          if (onSnapshot(parsed)) {
            lastChangeAt = Date.now();
          }
          if (parsed.meta?.nextPart) {
            // The part rotated away: it is sealed and can never grow again.
            stop();
            return;
          }
        }
      }
      // 304 (unchanged) and error statuses both just wait for the next
      // tick — the server may be mid-restart.
    } catch {
      // Network hiccup (server stopped or restarting): keep polling quietly.
    } finally {
      polling = false;
    }
    schedule();
  }

  function onVisibilityChange() {
    if (document.hidden || stopped || polling) return;
    if (timer !== undefined) window.clearTimeout(timer);
    poll();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  schedule();

  return { stop };
}
