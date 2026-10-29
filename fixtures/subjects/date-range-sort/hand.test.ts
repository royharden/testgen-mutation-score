import { expect, test } from "vitest";
import { compareRanges, maxRange, parseRange, sortRanges } from "./src";

test("parsing validates dates and discards an optional label", () => {
  expect(parseRange("2024-02-29/2024-03-01#trip_1")).toEqual({ start: "2024-02-29", end: "2024-03-01" });
  expect(parseRange("0001-01-01/9999-12-31")).toEqual({ start: "0001-01-01", end: "9999-12-31" });
});

test("Gregorian leap rules distinguish century years", () => {
  expect(parseRange("2000-02-29/2000-02-29").start).toBe("2000-02-29");
  expect(() => parseRange("1900-02-29/1900-03-01")).toThrow();
  expect(() => parseRange("2023-02-29/2023-03-01")).toThrow();
});

test("malformed dates and reversed ranges throw without fixing the error class", () => {
  expect(() => parseRange("2024-04-31/2024-05-01")).toThrow();
  expect(() => parseRange("0000-01-01/2024-01-01")).toThrow();
  expect(() => parseRange("2024-02-01/2024-01-01")).toThrow();
  expect(() => parseRange("2024-1-01/2024-01-02")).toThrow();
  expect(() => parseRange("2024-01-01/2024-01-02\n")).toThrow();
});

test("comparison uses the start first and then the end, ignoring labels", () => {
  expect(compareRanges("2023-01-01/2025-01-01", "2024-01-01/2024-01-01")).toBe(-1);
  expect(compareRanges("2024-01-01/2024-02-01", "2024-01-01/2024-01-31")).toBe(1);
  expect(compareRanges("2024-01-01/2024-01-02#a", "2024-01-01/2024-01-02#b")).toBe(0);
});

test("sorting returns a new array in ascending date order", () => {
  const ranges = ["2024-02-01/2024-02-02", "2024-01-01/2024-01-03", "2024-01-01/2024-01-02"];
  expect(sortRanges(ranges)).toEqual([ranges[2], ranges[1], ranges[0]]);
  expect(ranges[0]).toBe("2024-02-01/2024-02-02");
  expect(sortRanges(ranges)).not.toBe(ranges);
});

test("maximum and empty arrays have defined results", () => {
  expect(maxRange(["2024-01-01/2024-01-02", "2024-02-01/2024-02-02"])).toBe("2024-02-01/2024-02-02");
  expect(maxRange([])).toBeUndefined();
  expect(sortRanges([])).toEqual([]);
});

test("single invalid entries still throw in sorting and maximum", () => {
  expect(() => sortRanges(["invalid"])).toThrow();
  expect(() => maxRange(["invalid"])).toThrow();
});
