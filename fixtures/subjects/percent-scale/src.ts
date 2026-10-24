/*
 * CONTRACT - percent-scale
 * toPercent(value, min, max): number maps the clamped value linearly onto [0, 100].
 * fromPercent(percent, min, max): number maps a clamped percentage onto [min, max].
 * isPercent(percent): boolean is true exactly for finite numbers in inclusive [0, 100].
 * scaleAll(values, min, max): number[] maps toPercent in order into a new array.
 * Bounds must be finite, min < max, and max - min finite; otherwise throws RangeError.
 * Inputs other than bounds are finite numbers unless stated otherwise by isPercent.
 * The input array is not modified.
 * Not specified: NaN behaviour of toPercent/fromPercent; error message text.
 */

function checkBounds(min: number, max: number): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || !Number.isFinite(max - min)) {
    throw new RangeError("percentage bounds must be finite and increasing");
  }
}

export function toPercent(value: number, min: number, max: number): number {
  checkBounds(min, max);
  if (!(value >= min)) return 0;
  if (value > max) return 100;
  return ((value - min) / (max - min)) * 100;
}

export function fromPercent(percent: number, min: number, max: number): number {
  checkBounds(min, max);
  const bounded = Math.max(0, Math.min(100, percent));
  return min + (bounded / 100) * (max - min);
}

export function isPercent(percent: number): boolean {
  return Number.isFinite(percent) && percent >= 0 && percent <= 100;
}

export function scaleAll(values: readonly number[], min: number, max: number): number[] {
  checkBounds(min, max);
  return values.map((value) => toPercent(value, min, max));
}
