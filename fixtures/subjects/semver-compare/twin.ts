/*
 * TWIN of semver-compare/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent; each difference is marked TWIN-DIFF.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const NUMBER = "(0|[1-9][0-9]*)";
const IDENTS = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
const PATTERN = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(${IDENTS}))?(?:\\+${IDENTS})?(?![\\s\\S])`);

export function parseVersion(text: string): Version {
  const m = PATTERN.exec(text);
  if (m === null || m.slice(1, 4).some((part) => !Number.isSafeInteger(Number(part))) ||
      m[4]?.split(".").some((id) => /^0[0-9]+$/.test(id))) {
    // TWIN-DIFF: throws SyntaxError with other text (the CONTRACT leaves class and message unspecified).
    throw new SyntaxError(`bad semver ${text}`);
  }
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4] ? m[4].split(".") : [] };
}

function sign(n: number): -1 | 0 | 1 {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

function compareParsed(x: Version, y: Version): -1 | 0 | 1 {
  const core = sign(x.major - y.major) || sign(x.minor - y.minor) || sign(x.patch - y.patch);
  if (core !== 0) return core;
  if (x.pre.length === 0 || y.pre.length === 0) return sign(y.pre.length - x.pre.length);
  const shared = Math.min(x.pre.length, y.pre.length);
  for (let i = 0; i < shared; i++) {
    const a = x.pre[i]!;
    const b = y.pre[i]!;
    if (a === b) continue;
    const aNum = /^[0-9]+$/.test(a);
    const bNum = /^[0-9]+$/.test(b);
    if (aNum && bNum) {
      return a.length === b.length ? (a < b ? -1 : 1) : sign(a.length - b.length);
    }
    if (aNum || bNum) return aNum ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return sign(x.pre.length - y.pre.length);
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  return compareParsed(parseVersion(a), parseVersion(b));
}

export function sortVersions(list: readonly string[]): string[] {
  // TWIN-DIFF: stable built-in sort over pre-parsed versions instead of a hand-written merge sort.
  const parsed = list.map((text) => ({ text, version: parseVersion(text) }));
  parsed.sort((p, q) => compareParsed(p.version, q.version));
  return parsed.map((p) => p.text);
}

export function maxVersion(list: readonly string[]): string | undefined {
  const sorted = sortVersions(list);
  if (sorted.length === 0) return undefined;
  const top = sorted[sorted.length - 1]!;
  // The first one among equals: sortVersions is stable, so scan for the earliest equal entry.
  return sorted.find((text) => compareVersions(text, top) === 0);
}
