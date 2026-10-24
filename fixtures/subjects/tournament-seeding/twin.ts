/* TWIN: same API and CONTRACT as src.ts. */
export interface Player {
  id: string;
  rating: number;
}

export interface SeededPlayer extends Player {
  seed: number;
}

export function seedPlayers(players: readonly Player[]): SeededPlayer[] {
  for (const player of players) {
    // TWIN-DIFF: rating error message text is unspecified.
    if (!Number.isFinite(player.rating)) throw new RangeError("invalid tournament rating");
  }
  const indexed = players.map((player, index) => ({ player, index }));
  indexed.sort((a, b) => b.player.rating - a.player.rating || a.index - b.index);
  return indexed.map(({ player }, index) => ({ id: player.id, rating: player.rating, seed: index + 1 }));
}

export function qualified(players: readonly Player[], cutoff: number): SeededPlayer[] {
  if (!Number.isInteger(cutoff) || cutoff < 0) throw new RangeError("invalid seed cutoff");
  return seedPlayers(players).filter((player) => player.seed <= cutoff);
}

export function bracketPairs(players: readonly Player[]): [SeededPlayer, SeededPlayer | null][] {
  const seeded = seedPlayers(players);
  const pairs: [SeededPlayer, SeededPlayer | null][] = [];
  let left = 0;
  let right = seeded.length - 1;
  while (left <= right) {
    pairs.push([seeded[left]!, left === right ? null : seeded[right]!]);
    left++;
    right--;
  }
  return pairs;
}

export function nextBracketSize(count: number): number {
  if (!Number.isInteger(count) || count < 1 || count > 65536) {
    throw new RangeError("count must be an integer from 1 to 65536");
  }
  let size = 1;
  while (size < count) size *= 2;
  return size;
}
