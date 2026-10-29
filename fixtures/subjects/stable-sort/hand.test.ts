import { expect, test } from "vitest";
import { isSortedBy, sortBy, sortByDesc } from "./src";

test("sortBy orders numbers ascending and leaves the input alone", () => {
  const input = [3, 1, 2];
  expect(sortBy(input, (n) => n)).toEqual([1, 2, 3]);
  expect(input).toEqual([3, 1, 2]);
});

test("sortBy orders records by the key function", () => {
  const people = [
    { name: "ada", age: 36 },
    { name: "bob", age: 25 },
    { name: "cy", age: 51 },
  ];
  expect(sortBy(people, (p) => p.age).map((p) => p.name)).toEqual(["bob", "ada", "cy"]);
});

test("sortByDesc orders by descending key", () => {
  expect(sortByDesc([2, 9, -4, 5], (n) => n)).toEqual([9, 5, 2, -4]);
});

test("sortBy handles empty and single-item lists and returns a new array", () => {
  const one = [7];
  const sorted = sortBy(one, (n) => n);
  expect(sorted).toEqual([7]);
  expect(sorted).not.toBe(one);
  expect(sortBy([], (n: number) => n)).toEqual([]);
});

test("isSortedBy accepts non-decreasing keys and rejects a descent", () => {
  expect(isSortedBy([1, 2, 2, 3], (n) => n)).toBe(true);
  expect(isSortedBy([], (n: number) => n)).toBe(true);
  expect(isSortedBy([1, 3, 2], (n) => n)).toBe(false);
});

test("every function throws when the key is not a finite number", () => {
  expect(() => sortBy(["x"], () => Number.NaN)).toThrow();
  expect(() => sortByDesc([1], () => Number.POSITIVE_INFINITY)).toThrow();
  expect(() => isSortedBy([1, 2], () => Number.NaN)).toThrow();
});
