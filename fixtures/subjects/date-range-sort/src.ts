/*
 * CONTRACT - date-range-sort
 * A range is YYYY-MM-DD/YYYY-MM-DD, optionally followed by '#LABEL', where LABEL
 * is one or more ASCII letters, digits, '_' or '-'. Labels do not affect ordering.
 * Dates use the proleptic Gregorian calendar, years 0001..9999; start <= end.
 * Invalid syntax or dates throw an error, whose class and message are unspecified.
 * parseRange(text) returns { start, end } as ISO date strings, discarding labels.
 * compareRanges(a, b) returns -1, 0 or 1: compare start dates, then end dates.
 * sortRanges(list) returns a new ascending array, preserving input order on ties.
 * maxRange(list) returns the greatest range, first among ties, or undefined for [].
 * Every range in sortRanges and maxRange is validated, even a sole entry.
 * None of these functions modifies an input array.
 */

export interface DateRange {
  start: string;
  end: string;
}

const RANGE = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})(?:#[A-Za-z0-9_-]+)?(?![\s\S])/;

function validDate(text: string): boolean {
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1]!;
}

export function parseRange(text: string): DateRange {
  const match = RANGE.exec(text);
  if (match === null || !validDate(match[1]!) || !validDate(match[2]!) || match[1]! > match[2]!) {
    throw new TypeError(`invalid calendar range: ${text}`);
  }
  return { start: match[1]!, end: match[2]! };
}

export function compareRanges(a: string, b: string): -1 | 0 | 1 {
  const left = parseRange(a);
  const right = parseRange(b);
  if (left.start !== right.start) return left.start < right.start ? -1 : 1;
  return left.end < right.end ? -1 : left.end > right.end ? 1 : 0;
}

function mergeSort(list: readonly string[]): string[] {
  if (list.length < 2) return [...list];
  const middle = Math.floor(list.length / 2);
  const left = mergeSort(list.slice(0, middle));
  const right = mergeSort(list.slice(middle));
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (compareRanges(left[i]!, right[j]!) <= 0) out.push(left[i++]!);
    else out.push(right[j++]!);
  }
  return out.concat(left.slice(i), right.slice(j));
}

export function sortRanges(list: readonly string[]): string[] {
  list.forEach((range) => parseRange(range));
  return mergeSort(list);
}

export function maxRange(list: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const range of list) {
    parseRange(range);
    if (best === undefined || compareRanges(range, best) > 0) best = range;
  }
  return best;
}
