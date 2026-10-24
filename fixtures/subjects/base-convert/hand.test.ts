import { expect, test } from "vitest";
import { digitsFor, fromBase, isBaseNumber, toBase } from "./src";

test("formatting uses uppercase digits in different bases", () => {
  expect(toBase(42, 2)).toBe("101010");
  expect(toBase(255, 16)).toBe("FF");
  expect(toBase(35, 36)).toBe("Z");
  expect(toBase(0, 10)).toBe("0");
});

test("negative numbers round trip in their requested base", () => {
  expect(toBase(-42, 16)).toBe("-2A");
  expect(fromBase("-2A", 16)).toBe(-42);
  expect(fromBase("101010", 2)).toBe(42);
  expect(fromBase("Z", 36)).toBe(35);
});

test("safe integer endpoints round trip", () => {
  expect(fromBase(toBase(Number.MAX_SAFE_INTEGER, 16), 16)).toBe(Number.MAX_SAFE_INTEGER);
  expect(fromBase(toBase(Number.MIN_SAFE_INTEGER, 2), 2)).toBe(Number.MIN_SAFE_INTEGER);
});

test("only canonical spellings and valid digits parse", () => {
  expect(() => fromBase("00", 10)).toThrow(SyntaxError);
  expect(() => fromBase("-0", 10)).toThrow(SyntaxError);
  expect(() => fromBase("ff", 16)).toThrow(SyntaxError);
  expect(() => fromBase("2", 2)).toThrow(SyntaxError);
  expect(() => fromBase("", 10)).toThrow(SyntaxError);
  expect(() => fromBase("9007199254740992", 10)).toThrow(SyntaxError);
});

test("invalid bases and nonsafe values throw RangeError", () => {
  expect(() => toBase(2, 1)).toThrow(RangeError);
  expect(() => fromBase("1", 37)).toThrow(RangeError);
  expect(() => digitsFor(2.5)).toThrow(RangeError);
  expect(() => isBaseNumber("1", 0)).toThrow(RangeError);
  expect(() => toBase(1.5, 10)).toThrow(RangeError);
});

test("digit alphabets stop at the requested base", () => {
  expect(digitsFor(2)).toBe("01");
  expect(digitsFor(16)).toBe("0123456789ABCDEF");
});

test("isBaseNumber recognizes canonical strings", () => {
  expect(isBaseNumber("FF", 16)).toBe(true);
  expect(isBaseNumber("-101", 2)).toBe(true);
  expect(isBaseNumber("+1", 10)).toBe(false);
  expect(isBaseNumber("01", 10)).toBe(false);
});
