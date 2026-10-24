/*
 * CONTRACT - clamp-range
 *
 * clamp(value, min, max): number
 *   - throws a RangeError when min > max
 *   - returns min when value < min, max when value > max, otherwise value
 *   - both bounds are inclusive
 * clampAll(values, min, max): number[]
 *   - a new array holding clamp(v, min, max) for each v, in the same order
 *   - the input array is not modified; throws a RangeError when min > max
 * inRange(value, min, max): boolean
 *   - true exactly when min <= value <= max (both bounds inclusive)
 *   - throws a RangeError when min > max
 * rangeFraction(value, min, max): number
 *   - (clamp(value, min, max) - min) / (max - min), always within [0, 1]
 *   - returns 0 when min === max; throws a RangeError when min > max
 *
 * Not specified: results for NaN inputs; the text of error messages.
 */

function assertOrdered(min: number, max: number): void {
  if (min > max) {
    throw new RangeError(`min (${min}) must not exceed max (${max})`);
  }
}

export function clamp(value: number, min: number, max: number): number {
  assertOrdered(min, max);
  if (!(value >= min)) return min;
  if (value > max) return max;
  return value;
}

export function clampAll(values: readonly number[], min: number, max: number): number[] {
  assertOrdered(min, max);
  const out: number[] = [];
  for (const value of values) {
    out.push(clamp(value, min, max));
  }
  return out;
}

export function inRange(value: number, min: number, max: number): boolean {
  assertOrdered(min, max);
  return value >= min && value <= max;
}

export function rangeFraction(value: number, min: number, max: number): number {
  assertOrdered(min, max);
  const span = max - min;
  if (span === 0) return 0;
  return (clamp(value, min, max) - min) / span;
}
