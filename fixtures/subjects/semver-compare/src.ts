/*
 * CONTRACT - semver-compare
 *
 * parseVersion(text): Version { major, minor, patch, pre: string[] }
 *   - "MAJOR.MINOR.PATCH", optional "-" pre-release identifiers and optional "+" build metadata;
 *     major, minor and patch are integers from 0 to Number.MAX_SAFE_INTEGER without leading zeros;
 *     numeric pre-release identifiers have no length bound and no leading zeros; identifiers are
 *     [0-9A-Za-z-]+ separated by "."; build metadata is dropped; anything else throws an error
 * compareVersions(a, b): -1 | 0 | 1 - precedence as in Semantic Versioning 2.0.0:
 *   - compare major, minor, patch numerically; a version with pre-release identifiers is lower
 *     than the same version without them; identifiers are compared left to right, numerically
 *     when both are digits only, otherwise in ASCII order, and digits-only is lower than
 *     alphanumeric; when all shared identifiers are equal the shorter list is lower
 *   - build metadata is ignored: "1.0.0+a" and "1.0.0+b" compare as 0
 * sortVersions(list): string[] - a new array ascending by precedence; versions of equal
 *   precedence keep their input order
 * maxVersion(list): string | undefined - the highest version, the first one among equals;
 *   undefined for an empty list
 * sortVersions and maxVersion throw the parse error when any entry is not a valid version.
 *
 * Not specified: the class and message of the parse error.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![\s\S])/;

export function parseVersion(text: string): Version {
  const m = PATTERN.exec(text);
  if (m === null || m.slice(1, 4).some((part) => !Number.isSafeInteger(Number(part))) ||
      m[4]?.split(".").some((id) => /^0\d+$/.test(id))) {
    throw new TypeError(`invalid version: "${text}"`);
  }
  const pre = m[4] === undefined ? [] : m[4].split(".");
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

function compareIdentifiers(a: string, b: string): -1 | 0 | 1 {
  const aDigits = /^\d+$/.test(a);
  const bDigits = /^\d+$/.test(b);
  if (aDigits && bDigits && a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (aDigits !== bDigits) return aDigits ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  if (x.pre.length === 0 || y.pre.length === 0) {
    return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const c = compareIdentifiers(x.pre[i]!, y.pre[i]!);
    if (c !== 0) return c;
  }
  return x.pre.length === y.pre.length ? 0 : x.pre.length < y.pre.length ? -1 : 1;
}

function mergeSort(items: readonly string[]): string[] {
  if (items.length <= 1) return [...items];
  const middle = Math.floor(items.length / 2);
  const left = mergeSort(items.slice(0, middle));
  const right = mergeSort(items.slice(middle));
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (compareVersions(left[i]!, right[j]!) <= 0) out.push(left[i++]!);
    else out.push(right[j++]!);
  }
  return out.concat(left.slice(i), right.slice(j));
}

export function sortVersions(list: readonly string[]): string[] {
  list.forEach((version) => parseVersion(version));
  return mergeSort(list);
}

export function maxVersion(list: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const version of list) {
    parseVersion(version);
    if (best === undefined || compareVersions(version, best) > 0) best = version;
  }
  return best;
}
