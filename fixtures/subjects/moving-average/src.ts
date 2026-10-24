/*
 * CONTRACT - moving-average
 * Values must be finite numbers with absolute value <= 1e100; at most 10000 values.
 * Invalid values or options throw RangeError; error message text is unspecified.
 * mean(values): undefined for []; otherwise sum values left-to-right starting at 0,
 * then divide that sum by values.length (ordinary JavaScript number arithmetic).
 * movingAverage(values, window): window must be an integer from 1 to 10000.
 * Return means of all complete consecutive windows, in start-index order.
 * If window exceeds values.length return []; do not modify values.
 * roundedMean(values, places = 0): places must be an integer from 0 to 6.
 * Return undefined for []; otherwise Math.round(mean(values) * 10 ** places)
 * divided by 10 ** places, with exactly that rounding order.
 */

function checkValues(values: readonly number[]): void {
  if (values.length > 10000 || values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e100)) {
    throw new RangeError("unsupported sample values");
  }
}

export function mean(values: readonly number[]): number | undefined {
  checkValues(values);
  if (values.length === 0) return undefined;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
  }
  return sum / values.length;
}

export function movingAverage(values: readonly number[], window: number): number[] {
  checkValues(values);
  if (!Number.isInteger(window) || window < 1 || window > 10000) {
    throw new RangeError("window must be an integer from 1 to 10000");
  }
  const averages: number[] = [];
  for (let start = 0; start + window <= values.length; start++) {
    averages.push(mean(values.slice(start, start + window))!);
  }
  return averages;
}

export function roundedMean(values: readonly number[], places = 0): number | undefined {
  checkValues(values);
  if (!Number.isInteger(places) || places < 0 || places > 6) {
    throw new RangeError("places must be an integer from 0 to 6");
  }
  const average = mean(values);
  if (average === undefined) return undefined;
  const scale = 10 ** places;
  return Math.round(average * scale) / scale;
}
