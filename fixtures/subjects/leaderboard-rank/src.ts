/*
 * CONTRACT - leaderboard-rank
 *
 * Entry = { name: string; score: number }; RankedEntry = Entry & { rank: number }.
 * rankEntries(entries): RankedEntry[]
 *   - every score must be a finite number, otherwise throws a RangeError
 *   - ordered by score, highest first; entries with equal scores keep their input order
 *   - competition ranking: equal scores share a rank and the next rank skips (1, 2, 2, 4)
 *   - returns new objects; the input array and its entries are not modified
 * topN(entries, n): RankedEntry[]
 *   - n must be an integer >= 0, otherwise throws a RangeError
 *   - the ranked entries whose rank is <= n (so ties at the cut-off are all included)
 * rankOf(entries, name): number | undefined - rank of the first ranked entry with that name
 * medalFor(rank): "gold" | "silver" | "bronze" | null - for ranks 1, 2, 3; null for any other value
 *
 * Not specified: the text of error messages.
 */

export interface Entry {
  name: string;
  score: number;
}

export interface RankedEntry extends Entry {
  rank: number;
}

export function rankEntries(entries: readonly Entry[]): RankedEntry[] {
  for (const entry of entries) {
    if (!Number.isFinite(entry.score)) {
      throw new RangeError(`score of ${entry.name} is not a finite number`);
    }
  }
  const decorated = entries.map((entry, position) => ({ entry, position }));
  decorated.sort((a, b) => b.entry.score - a.entry.score || a.position - b.position);
  const ranked: RankedEntry[] = [];
  decorated.forEach(({ entry }, i) => {
    const previous = ranked[i - 1];
    const rank = previous !== undefined && previous.score === entry.score ? previous.rank : i + 1;
    ranked.push({ name: entry.name, score: entry.score, rank });
  });
  return ranked;
}

export function topN(entries: readonly Entry[], n: number): RankedEntry[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`n must be a non-negative integer, got ${n}`);
  }
  return rankEntries(entries).filter((entry) => entry.rank <= n);
}

export function rankOf(entries: readonly Entry[], name: string): number | undefined {
  return rankEntries(entries).find((entry) => entry.name === name)?.rank;
}

export function medalFor(rank: number): "gold" | "silver" | "bronze" | null {
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return null;
}
