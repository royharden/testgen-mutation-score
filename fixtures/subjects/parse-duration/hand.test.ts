import { expect, test } from "vitest";
import { durationList, isDuration, parseDuration } from "./src";

test("converts mixed units to seconds", () => {
  expect(parseDuration("1h30m5s")).toBe(5405);
  expect(parseDuration("2m1h2m")).toBe(3840);
});

test("accepts signs decimals and outer whitespace", () => {
  expect(parseDuration(" +1.5m ")).toBe(90);
  expect(parseDuration("-2s")).toBe(-2);
});

test("rejects missing units and incomplete or extra text", () => {
  expect(() => parseDuration("")).toThrow();
  expect(() => parseDuration("1h 2m")).toThrow();
  expect(() => parseDuration("1e2s")).toThrow();
  expect(() => parseDuration("1. s")).toThrow();
  expect(() => parseDuration("1h!" )).toThrow();
  expect(() => parseDuration("5")).toThrow();
});

test("rounds positive durations and ordinary negative fractions", () => {
  expect(parseDuration("1.25s", { decimals: 1 })).toBe(1.3);
  expect(parseDuration("-1.24s", { decimals: 1 })).toBe(-1.2);
  expect(parseDuration("1" + "0".repeat(300) + "s", { decimals: 6 })).toBe(1e300);
});

test("checks bounds after rounding", () => {
  expect(parseDuration("2.2s", { decimals: 0, min: 1, max: 2 })).toBe(2);
  expect(() => parseDuration("0s", { min: 1 })).toThrow();
  expect(() => parseDuration("3s", { max: 2 })).toThrow();
});

test("reports validity and rejects invalid options", () => {
  expect(isDuration("20s")).toBe(true);
  expect(isDuration("bad")).toBe(false);
  expect(isDuration("1s", { decimals: 7 })).toBe(false);
  expect(isDuration("1s", { min: 2, max: 1 })).toBe(false);
  expect(isDuration("1s", { max: Infinity })).toBe(false);
});

test("parses duration lists and empty input", () => {
  expect(durationList("1m, 2s,-1h")).toEqual([60, 2, -3600]);
  expect(durationList("  ")).toEqual([]);
  expect(() => durationList("1s,bad")).toThrow();
});
