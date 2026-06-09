/** Format an ISO timestamp as a wall-clock time, e.g. "10:00:01.100". */
export function formatClock(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Format a duration in ms as a "+"-prefixed, human-readable offset:
 * 120 -> "+120ms", 680 -> "+0.68s", 4200 -> "+4.2s", 75000 -> "+1m15s".
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `+${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const whole = Math.round(seconds);
  return `+${Math.floor(whole / 60)}m${whole % 60}s`;
}
