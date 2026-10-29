import { expect, test } from "vitest";
import { isSortedByKeys, sortByKeys } from "./src";

test("orders a numeric primary key", () => {
  expect(sortByKeys([3, 1, 2], [{ key: (n) => n }])).toEqual([1, 2, 3]);
});

test("uses a secondary key and its direction", () => {
  const items = [{ group: 2, score: 1 }, { group: 1, score: 2 }, { group: 1, score: 4 }];
  expect(sortByKeys(items, [{ key: (x) => x.group }, { key: (x) => x.score, direction: "desc" }])).toEqual([items[2], items[1], items[0]]);
});

test("supports a descending primary key", () => {
  expect(sortByKeys([1, 3, 2], [{ key: (n) => n, direction: "desc" }])).toEqual([3, 2, 1]);
});

test("returns a new array without changing input", () => {
  const input = [2, 1];
  const output = sortByKeys(input, [{ key: (n) => n }]);
  expect(output).toEqual([1, 2]);
  expect(output).not.toBe(input);
  expect(input).toEqual([2, 1]);
});

test("handles empty and singleton inputs", () => {
  expect(sortByKeys([], [])).toEqual([]);
  expect(sortByKeys([7], [])).toEqual([7]);
  expect(isSortedByKeys([], [])).toBe(true);
});

test("checks adjacent order", () => {
  expect(isSortedByKeys([1, 2, 3], [{ key: (n) => n }])).toBe(true);
  expect(isSortedByKeys([1, 3, 2], [{ key: (n) => n }])).toBe(false);
});

test("rejects nonfinite keys", () => {
  expect(() => sortByKeys([1], [{ key: () => Number.NaN }])).toThrow();
  expect(() => isSortedByKeys([1], [{ key: () => Infinity }])).toThrow();
});
