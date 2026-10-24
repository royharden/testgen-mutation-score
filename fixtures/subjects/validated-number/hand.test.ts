import { expect, test } from "vitest";
import { isValidNumber, parseNumber, parseNumberList } from "./src";

test("parseNumber reads signed integers and decimals after trimming", () => {
  expect(parseNumber(" -12 ")).toBe(-12);
  expect(parseNumber("+3.5")).toBe(3.5);
  expect(parseNumber("0.25")).toBe(0.25);
});

test("parseNumber rejects text that is not a plain decimal number", () => {
  for (const bad of ["", "1e3", "12abc", "1,000", ".5", "5.", "--1"]) {
    expect(() => parseNumber(bad)).toThrow();
  }
});

test("the integer option rejects a fraction part", () => {
  expect(parseNumber("7", { integer: true })).toBe(7);
  expect(() => parseNumber("2.5", { integer: true })).toThrow();
});

test("the decimals option rounds to the requested places", () => {
  expect(parseNumber("3.14159", { decimals: 2 })).toBe(3.14);
  expect(parseNumber("2.5", { decimals: 0 })).toBe(3);
  expect(() => parseNumber("1", { decimals: 11 })).toThrow();
});

test("min and max bounds reject values outside them", () => {
  expect(parseNumber("10", { max: 10 })).toBe(10);
  expect(() => parseNumber("11", { max: 10 })).toThrow();
  expect(() => parseNumber("-1", { min: 0 })).toThrow();
  expect(parseNumber("4", { min: 0, max: 10 })).toBe(4);
});

test("isValidNumber reports whether parseNumber would succeed", () => {
  expect(isValidNumber("42")).toBe(true);
  expect(isValidNumber("forty-two")).toBe(false);
  expect(isValidNumber("42", { max: 40 })).toBe(false);
});

test("parseNumberList parses comma-separated items and treats blank text as empty", () => {
  expect(parseNumberList("1, 2.5 ,-3")).toEqual([1, 2.5, -3]);
  expect(parseNumberList("   ")).toEqual([]);
  expect(() => parseNumberList("1,,2")).toThrow();
});
