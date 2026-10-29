import { expect, test } from "vitest";
import { applyRate, formatMoney, splitEvenly } from "./src";

test("formatMoney groups thousands and always shows two decimals", () => {
  expect(formatMoney(123456)).toBe("$1,234.56");
  expect(formatMoney(5)).toBe("$0.05");
  expect(formatMoney(0)).toBe("$0.00");
  expect(formatMoney(100000000)).toBe("$1,000,000.00");
});

test("formatMoney puts the minus sign before the symbol", () => {
  expect(formatMoney(-5)).toBe("-$0.05");
  expect(formatMoney(-123456)).toBe("-$1,234.56");
});

test("formatMoney honours a custom symbol and separator", () => {
  expect(formatMoney(123456789, { symbol: "EUR ", separator: "." })).toBe("EUR 1.234.567.89");
});

test("formatMoney throws a TypeError for amounts that are not safe integers", () => {
  expect(() => formatMoney(1.5)).toThrow(TypeError);
  expect(() => formatMoney(Number.NaN)).toThrow(TypeError);
});

test("splitEvenly shares cents with the larger shares first", () => {
  expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
  expect(splitEvenly(9, 3)).toEqual([3, 3, 3]);
  expect(splitEvenly(2, 4)).toEqual([1, 1, 0, 0]);
});

test("splitEvenly throws a RangeError for a part count that is not a positive integer", () => {
  expect(() => splitEvenly(100, 0)).toThrow(RangeError);
  expect(() => splitEvenly(100, 1.5)).toThrow(RangeError);
});

test("applyRate applies a percentage and rounds halves up", () => {
  expect(applyRate(10000, 7.5)).toBe(750);
  expect(applyRate(250, 10)).toBe(25);
  expect(applyRate(5, 10)).toBe(1);
  expect(applyRate(1000, 0)).toBe(0);
});
