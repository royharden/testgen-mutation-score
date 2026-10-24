import { expect, test } from "vitest";
import { binEdges, binIndex, histogram } from "./src";

test("binIndex places values into equal-width bins", () => {
  expect(binIndex(0, 0, 10, 5)).toBe(0);
  expect(binIndex(3, 0, 10, 5)).toBe(1);
  expect(binIndex(9.99, 0, 10, 5)).toBe(4);
});

test("an inner edge belongs to the upper bin and max to the last bin", () => {
  expect(binIndex(2, 0, 10, 5)).toBe(1);
  expect(binIndex(10, 0, 10, 5)).toBe(4);
});

test("binIndex is -1 outside the range and for NaN", () => {
  expect(binIndex(-1, 0, 10, 5)).toBe(-1);
  expect(binIndex(11, 0, 10, 5)).toBe(-1);
  expect(binIndex(Number.NaN, 0, 10, 5)).toBe(-1);
});

test("histogram counts the values in each bin and ignores the rest", () => {
  const values = [0, 1, 2, 2.5, 9, 10, 11];
  expect(histogram(values, 0, 10, 5)).toEqual([2, 2, 0, 0, 2]);
  expect(values).toEqual([0, 1, 2, 2.5, 9, 10, 11]);
});

test("histogram of no values is all zeros", () => {
  expect(histogram([], 0, 1, 3)).toEqual([0, 0, 0]);
});

test("an invalid bin specification throws a RangeError", () => {
  expect(() => binIndex(1, 0, 10, 0)).toThrow(RangeError);
  expect(() => histogram([1], 5, 5, 2)).toThrow(RangeError);
  expect(() => binEdges(0, 1, 2.5)).toThrow(RangeError);
});

test("binEdges lists bins + 1 edges ending exactly at max", () => {
  expect(binEdges(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
});
