/*
 * CONTRACT - histogram-bins
 *
 * Every function takes (min, max, bins) and throws a RangeError unless bins is an integer >= 1
 * and min < max. The range [min, max] is cut into `bins` bins of equal width.
 * binIndex(value, min, max, bins): number
 *   - -1 when value is NaN or outside [min, max]
 *   - bins - 1 when value === max
 *   - otherwise Math.min(bins - 1, Math.floor(((value - min) * bins) / (max - min))),
 *     computed with exactly this expression
 * histogram(values, min, max, bins): number[]
 *   - `bins` counts; each value adds 1 to the count at binIndex(value); values with index -1
 *     are ignored; the input is not modified
 * binEdges(min, max, bins): number[]
 *   - bins + 1 edges: edge i is min + (i * (max - min)) / bins, and the last edge is exactly max
 *
 * Not specified: the text of error messages.
 */

function checkSpec(min: number, max: number, bins: number): void {
  if (!Number.isInteger(bins) || bins < 1) {
    throw new RangeError(`bins must be a positive integer, got ${bins}`);
  }
  if (!(min < max)) {
    throw new RangeError(`min must be below max, got [${min}, ${max}]`);
  }
}

export function binIndex(value: number, min: number, max: number, bins: number): number {
  checkSpec(min, max, bins);
  if (!(value >= min && value <= max)) return -1;
  if (value === max) return bins - 1;
  return Math.min(bins - 1, Math.floor(((value - min) * bins) / (max - min)));
}

export function histogram(values: readonly number[], min: number, max: number, bins: number): number[] {
  checkSpec(min, max, bins);
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i++) {
    const index = binIndex(values[i]!, min, max, bins);
    if (index >= 0) counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

export function binEdges(min: number, max: number, bins: number): number[] {
  checkSpec(min, max, bins);
  const edges: number[] = [];
  for (let k = 0; k < bins; k++) {
    edges.push(min + (k * (max - min)) / bins);
  }
  edges.push(max);
  return edges;
}
