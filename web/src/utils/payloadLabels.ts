/**
 * Disambiguate repeated payload labels so each is unique for display.
 * The first occurrence keeps its label; subsequent ones get "_2", "_3", …
 * Generic so any extra fields on the payload (e.g. a timestamp) pass through.
 */
export function withUniqueLabels<T extends { label: string }>(
  payloads: T[]
): (T & { displayLabel: string })[] {
  const counts = new Map<string, number>();
  return payloads.map((payload) => {
    const seen = counts.get(payload.label) ?? 0;
    counts.set(payload.label, seen + 1);
    const displayLabel =
      seen === 0 ? payload.label : `${payload.label}_${seen + 1}`;
    return { ...payload, displayLabel };
  });
}
