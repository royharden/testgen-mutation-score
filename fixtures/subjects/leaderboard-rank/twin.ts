/*
 * TWIN of leaderboard-rank/src.ts: same exported API and the same CONTRACT (see src.ts).
 * Differs only where the CONTRACT is silent; each difference is marked TWIN-DIFF.
 */

export interface Entry {
  name: string;
  score: number;
}

export interface RankedEntry extends Entry {
  rank: number;
}

export function rankEntries(entries: readonly Entry[]): RankedEntry[] {
  const bad = entries.find((entry) => !Number.isFinite(entry.score));
  if (bad !== undefined) {
    // TWIN-DIFF: different error message text (the CONTRACT leaves messages unspecified).
    throw new RangeError("non-finite score");
  }
  // TWIN-DIFF: relies on the stable built-in sort with a plain score comparator (same order).
  const sorted = [...entries].sort((a, b) => (a.score === b.score ? 0 : a.score > b.score ? -1 : 1));
  let rank = 0;
  return sorted.map((entry, i) => {
    if (i === 0 || sorted[i - 1]!.score !== entry.score) rank = i + 1;
    return { name: entry.name, score: entry.score, rank };
  });
}

export function topN(entries: readonly Entry[], n: number): RankedEntry[] {
  if (!Number.isInteger(n) || n < 0) {
    // TWIN-DIFF: different error message text.
    throw new RangeError("bad n");
  }
  const out: RankedEntry[] = [];
  for (const entry of rankEntries(entries)) {
    if (entry.rank > n) break;
    out.push(entry);
  }
  return out;
}

export function rankOf(entries: readonly Entry[], name: string): number | undefined {
  for (const entry of rankEntries(entries)) if (entry.name === name) return entry.rank;
  return undefined;
}

export function medalFor(rank: number): "gold" | "silver" | "bronze" | null {
  const medals = ["gold", "silver", "bronze"] as const;
  return Number.isInteger(rank) && rank >= 1 && rank <= 3 ? medals[rank - 1]! : null;
}
