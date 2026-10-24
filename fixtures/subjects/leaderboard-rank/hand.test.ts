import { expect, test } from "vitest";
import { medalFor, rankEntries, rankOf, topN } from "./src";

test("rankEntries orders distinct scores from highest to lowest", () => {
  const ranked = rankEntries([
    { name: "x", score: 1 },
    { name: "y", score: 3 },
    { name: "z", score: 2 },
  ]);
  expect(ranked.map((e) => e.name)).toEqual(["y", "z", "x"]);
  expect(ranked.map((e) => e.rank)).toEqual([1, 2, 3]);
});

test("equal scores share a rank and the next rank is skipped", () => {
  const board = [
    { name: "ana", score: 10 },
    { name: "ben", score: 20 },
    { name: "cai", score: 20 },
    { name: "dee", score: 5 },
  ];
  expect(rankEntries(board).map((e) => e.rank)).toEqual([1, 1, 3, 4]);
  expect(rankEntries(board).map((e) => e.score)).toEqual([20, 20, 10, 5]);
});

test("rankEntries does not modify its input", () => {
  const input = [
    { name: "ana", score: 10 },
    { name: "ben", score: 20 },
  ];
  rankEntries(input);
  expect(input).toEqual([
    { name: "ana", score: 10 },
    { name: "ben", score: 20 },
  ]);
  expect(input[0]).not.toHaveProperty("rank");
});

test("topN keeps every entry tied at the cut-off", () => {
  const scores = [50, 40, 40, 30].map((score, i) => ({ name: `p${i}`, score }));
  expect(topN(scores, 2).map((e) => e.rank)).toEqual([1, 2, 2]);
  expect(topN(scores, 0)).toEqual([]);
  expect(() => topN(scores, -1)).toThrow(RangeError);
});

test("rankOf finds the rank of a name or returns undefined", () => {
  const board = [
    { name: "ana", score: 10 },
    { name: "ben", score: 20 },
    { name: "cai", score: 20 },
  ];
  expect(rankOf(board, "ana")).toBe(3);
  expect(rankOf(board, "ben")).toBe(1);
  expect(rankOf(board, "zed")).toBeUndefined();
});

test("medalFor names the first three ranks only", () => {
  expect(medalFor(1)).toBe("gold");
  expect(medalFor(2)).toBe("silver");
  expect(medalFor(3)).toBe("bronze");
  expect(medalFor(4)).toBeNull();
});

test("a score that is not a finite number throws a RangeError", () => {
  expect(() => rankEntries([{ name: "bad", score: Number.NaN }])).toThrow(RangeError);
});
