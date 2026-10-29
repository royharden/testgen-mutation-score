import { expect, test } from "vitest";
import { mean, movingAverage, roundedMean } from "./src";

test("mean averages positive and negative samples", () => {
  expect(mean([2, 4, 6])).toBe(4);
  expect(mean([-4, 0, 4])).toBe(0);
  expect(mean([7])).toBe(7);
});

test("empty series has no mean and no complete windows", () => {
  expect(mean([])).toBeUndefined();
  expect(roundedMean([])).toBeUndefined();
  expect(movingAverage([], 2)).toEqual([]);
  expect(movingAverage([1, 2], 3)).toEqual([]);
});

test("moving averages enumerate complete windows without changing input", () => {
  const values = [2, 4, 6, 8];
  expect(movingAverage(values, 2)).toEqual([3, 5, 7]);
  expect(movingAverage(values, 4)).toEqual([5]);
  expect(movingAverage(values, 1)).toEqual(values);
  expect(values).toEqual([2, 4, 6, 8]);
});

test("roundedMean retains means already exact at the requested precision", () => {
  expect(roundedMean([2, 4], 1)).toBe(3);
  expect(roundedMean([1, 2, 3])).toBe(2);
});

test("invalid samples throw RangeError", () => {
  expect(() => mean([NaN])).toThrow(RangeError);
  expect(() => movingAverage([Infinity], 1)).toThrow(RangeError);
  expect(() => roundedMean([1e101])).toThrow(RangeError);
});

test("invalid windows and decimal places throw RangeError", () => {
  expect(() => movingAverage([1], 0)).toThrow(RangeError);
  expect(() => movingAverage([1], 1.5)).toThrow(RangeError);
  expect(() => movingAverage([], 10001)).toThrow(RangeError);
  expect(() => roundedMean([1], -1)).toThrow(RangeError);
  expect(() => roundedMean([1], 7)).toThrow(RangeError);
});
