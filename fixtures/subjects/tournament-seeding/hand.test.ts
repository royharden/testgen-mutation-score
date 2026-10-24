import { expect, test } from "vitest";
import { bracketPairs, nextBracketSize, qualified, seedPlayers } from "./src";

test("seeds follow decreasing ratings with consecutive numbers", () => {
  expect(seedPlayers([{ id: "low", rating: 10 }, { id: "high", rating: 30 }])).toEqual([
    { id: "high", rating: 30, seed: 1 }, { id: "low", rating: 10, seed: 2 },
  ]);
  expect(seedPlayers([{ id: "a", rating: 20 }, { id: "b", rating: 20 }]).map((p) => p.rating)).toEqual([20, 20]);
});

test("seeding creates objects without changing players", () => {
  const players = [{ id: "a", rating: 10 }, { id: "b", rating: 20 }];
  const seeded = seedPlayers(players);
  expect(players).toEqual([{ id: "a", rating: 10 }, { id: "b", rating: 20 }]);
  expect(seeded[1]).not.toBe(players[0]);
  expect(seedPlayers([])).toEqual([]);
});

test("qualification includes the exact cutoff seed", () => {
  const players = [{ id: "a", rating: 30 }, { id: "b", rating: 20 }, { id: "c", rating: 10 }];
  expect(qualified(players, 2).map((p) => p.id)).toEqual(["a", "b"]);
  expect(qualified(players, 0)).toEqual([]);
  expect(qualified(players, 9)).toHaveLength(3);
});

test("brackets pair outside seeds and assign an odd middle bye", () => {
  const players = [{ id: "a", rating: 30 }, { id: "b", rating: 20 }, { id: "c", rating: 10 }];
  expect(bracketPairs(players).map(([a, b]) => [a.seed, b?.seed ?? null])).toEqual([[1, 3], [2, null]]);
  expect(bracketPairs([])).toEqual([]);
});

test("bracket size rounds up to a power of two", () => {
  expect(nextBracketSize(1)).toBe(1);
  expect(nextBracketSize(4)).toBe(4);
  expect(nextBracketSize(5)).toBe(8);
  expect(nextBracketSize(65536)).toBe(65536);
});

test("invalid ratings and options throw RangeError", () => {
  expect(() => seedPlayers([{ id: "a", rating: NaN }])).toThrow(RangeError);
  expect(() => qualified([], -1)).toThrow(RangeError);
  expect(() => qualified([], 0.5)).toThrow(RangeError);
  expect(() => nextBracketSize(0)).toThrow(RangeError);
  expect(() => nextBracketSize(65537)).toThrow(RangeError);
});
