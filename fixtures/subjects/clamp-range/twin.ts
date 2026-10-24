/*
 * TWIN of clamp-range/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent, plus the planted quirk; each difference is marked TWIN-DIFF.
 */

function assertOrdered(min: number, max: number): void {
  if (min > max) {
    // TWIN-DIFF: different error message text (the CONTRACT leaves messages unspecified).
    throw new RangeError(`bounds out of order: ${min} > ${max}`);
  }
}

export function clamp(value: number, min: number, max: number): number {
  assertOrdered(min, max);
  // TWIN-DIFF quirk: NaN passes through as NaN here; src.ts accidentally returns min for NaN.
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clampAll(values: readonly number[], min: number, max: number): number[] {
  assertOrdered(min, max);
  const out: number[] = [];
  for (const value of values) out.push(clamp(value, min, max));
  return out;
}

export function inRange(value: number, min: number, max: number): boolean {
  assertOrdered(min, max);
  return min <= value && value <= max;
}

export function rangeFraction(value: number, min: number, max: number): number {
  assertOrdered(min, max);
  const span = max - min;
  return span === 0 ? 0 : (clamp(value, min, max) - min) / span;
}
