/*
 * TWIN of histogram-bins/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent; each difference is marked TWIN-DIFF.
 */

function checkSpec(min: number, max: number, bins: number): void {
  const binsOk = Number.isInteger(bins) && bins >= 1;
  if (!binsOk || !(min < max)) {
    // TWIN-DIFF: one combined check with other message text (messages are unspecified).
    throw new RangeError("invalid histogram specification");
  }
}

export function binIndex(value: number, min: number, max: number, bins: number): number {
  checkSpec(min, max, bins);
  if (!(min <= value && value <= max)) return -1;
  if (value === max) return bins - 1;
  return Math.min(bins - 1, Math.floor(((value - min) * bins) / (max - min)));
}

export function histogram(values: readonly number[], min: number, max: number, bins: number): number[] {
  checkSpec(min, max, bins);
  const counts: number[] = Array.from({ length: bins }, () => 0);
  // TWIN-DIFF: iterates with for-of instead of an index loop (same visiting order).
  for (const value of values) {
    const index = binIndex(value, min, max, bins);
    if (index !== -1) counts[index] = counts[index]! + 1;
  }
  return counts;
}

export function binEdges(min: number, max: number, bins: number): number[] {
  checkSpec(min, max, bins);
  return Array.from({ length: bins + 1 }, (_, k) => (k === bins ? max : min + (k * (max - min)) / bins));
}
