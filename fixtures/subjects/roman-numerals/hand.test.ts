import { expect, test } from "vitest";
import { fromRoman, isRoman, toRoman } from "./src";

test("toRoman writes small numbers in subtractive form", () => {
  expect(toRoman(1)).toBe("I");
  expect(toRoman(4)).toBe("IV");
  expect(toRoman(9)).toBe("IX");
  expect(toRoman(14)).toBe("XIV");
  expect(toRoman(40)).toBe("XL");
  expect(toRoman(90)).toBe("XC");
  expect(toRoman(400)).toBe("CD");
  expect(toRoman(900)).toBe("CM");
});

test("toRoman writes large numbers", () => {
  expect(toRoman(1994)).toBe("MCMXCIV");
  expect(toRoman(2024)).toBe("MMXXIV");
  expect(toRoman(3999)).toBe("MMMCMXCIX");
});

test("toRoman throws a RangeError outside 1..3999 and for fractions", () => {
  expect(() => toRoman(0)).toThrow(RangeError);
  expect(() => toRoman(4000)).toThrow(RangeError);
  expect(() => toRoman(1.5)).toThrow(RangeError);
});

test("fromRoman reads canonical numerals", () => {
  expect(fromRoman("XIV")).toBe(14);
  expect(fromRoman("MCMXCIV")).toBe(1994);
  expect(fromRoman("MMMCMXCIX")).toBe(3999);
});

test("fromRoman throws a SyntaxError for anything that is not canonical", () => {
  for (const bad of ["IIII", "IC", "xiv", "", "MMMM", "ABC", "VX"]) {
    expect(() => fromRoman(bad)).toThrow(SyntaxError);
  }
});

test("fromRoman undoes toRoman", () => {
  for (const n of [1, 3, 8, 49, 444, 1666, 3888]) {
    expect(fromRoman(toRoman(n))).toBe(n);
  }
});

test("isRoman tells canonical numerals from other text", () => {
  expect(isRoman("XLII")).toBe(true);
  expect(isRoman("XXXX")).toBe(false);
});
