import { expect, test } from "vitest";
import { clamp, clampAll, inRange, rangeFraction } from "./src";

test("clamp returns a value that lies inside the range unchanged", () => {
  expect(clamp(5, 0, 10)).toBe(5);
  expect(clamp(-2.5, -5, 5)).toBe(-2.5);
});

test("clamp raises values below min and lowers values above max", () => {
  expect(clamp(-3, 0, 10)).toBe(0);
  expect(clamp(42, 0, 10)).toBe(10);
});

test("clamp keeps the inclusive bounds themselves", () => {
  expect(clamp(0, 0, 10)).toBe(0);
  expect(clamp(10, 0, 10)).toBe(10);
});

test("clamp throws a RangeError when min exceeds max", () => {
  expect(() => clamp(1, 5, 2)).toThrow(RangeError);
});

test("clampAll clamps every element in order and leaves the input alone", () => {
  const input = [-1, 4, 11];
  expect(clampAll(input, 0, 10)).toEqual([0, 4, 10]);
  expect(input).toEqual([-1, 4, 11]);
});

test("inRange accepts the lower bound and rejects values outside the range", () => {
  expect(inRange(0, 0, 10)).toBe(true);
  expect(inRange(5, 0, 10)).toBe(true);
  expect(inRange(-1, 0, 10)).toBe(false);
  expect(inRange(11, 0, 10)).toBe(false);
});

test("rangeFraction maps the range onto 0..1 and is 0 for an empty span", () => {
  expect(rangeFraction(5, 0, 10)).toBe(0.5);
  expect(rangeFraction(20, 0, 10)).toBe(1);
  expect(rangeFraction(3, 3, 3)).toBe(0);
});
