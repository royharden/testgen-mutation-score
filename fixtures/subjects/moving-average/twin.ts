/* TWIN: same API and CONTRACT as src.ts. */
function checkValues(values: readonly number[]): void {
  if (values.length > 10000 || values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e100)) {
    // TWIN-DIFF: sample error message text is unspecified.
    throw new RangeError("invalid sample series");
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
