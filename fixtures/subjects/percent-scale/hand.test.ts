import { expect, test } from "vitest";
import { fromPercent, isPercent, scaleAll, toPercent } from "./src";

test("maps interior values to percentages", () => {
  expect(toPercent(30, 10, 50)).toBe(50);
  expect(toPercent(-5, -10, 10)).toBe(25);
});

test("clamps values and includes both scale endpoints", () => {
  expect(toPercent(-5, 0, 20)).toBe(0);
  expect(toPercent(30, 0, 20)).toBe(100);
  expect(toPercent(0, 0, 20)).toBe(0);
  expect(toPercent(20, 0, 20)).toBe(100);
});

test("maps percentages back to values", () => {
  expect(fromPercent(25, 20, 60)).toBe(30);
  expect(fromPercent(0, 20, 60)).toBe(20);
  expect(fromPercent(100, 20, 60)).toBe(60);
});

test("clamps out of range percentages before mapping", () => {
  expect(fromPercent(-1, 20, 60)).toBe(20);
  expect(fromPercent(101, 20, 60)).toBe(60);
});

test("validates percentages and rejects nonfinite values", () => {
  expect(isPercent(0)).toBe(true);
  expect(isPercent(50)).toBe(true);
  expect(isPercent(-1)).toBe(false);
  expect(isPercent(101)).toBe(false);
  expect(isPercent(Number.NaN)).toBe(false);
  expect(isPercent(Infinity)).toBe(false);
});

test("maps arrays without modifying them", () => {
  const input = [0, 5, 10];
  expect(scaleAll(input, 0, 10)).toEqual([0, 50, 100]);
  expect(input).toEqual([0, 5, 10]);
  expect(scaleAll([], 0, 10)).toEqual([]);
});

test("rejects unordered and nonfinite bounds", () => {
  expect(() => toPercent(1, 2, 2)).toThrow(RangeError);
  expect(() => fromPercent(50, 3, 2)).toThrow(RangeError);
  expect(() => scaleAll([], 0, Infinity)).toThrow(RangeError);
  expect(() => toPercent(0, -Number.MAX_VALUE, Number.MAX_VALUE)).toThrow(RangeError);
});
