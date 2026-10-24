import { expect, test } from "vitest";
import { lineCount, padLines, wrapText } from "./src";

test("wrapText fills lines greedily at word boundaries", () => {
  expect(wrapText("the quick brown fox", 10)).toEqual(["the quick", "brown fox"]);
});

test("a line may be exactly as long as the width", () => {
  expect(wrapText("ab cd ef", 5)).toEqual(["ab cd", "ef"]);
});

test("runs of whitespace separate words and are not kept", () => {
  expect(wrapText("  a\t\tb \n c  ", 80)).toEqual(["a b c"]);
});

test("words longer than the width are cut into width-sized pieces", () => {
  expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
});

test("empty and whitespace-only text give no lines", () => {
  expect(wrapText("", 3)).toEqual([]);
  expect(wrapText(" \t ", 3)).toEqual([]);
});

test("wrapText throws a RangeError for a width that is not a positive integer", () => {
  expect(() => wrapText("a", 0)).toThrow(RangeError);
  expect(() => wrapText("a", 2.5)).toThrow(RangeError);
});

test("lineCount is the number of wrapped lines", () => {
  expect(lineCount("the quick brown fox", 10)).toBe(2);
});

test("padLines pads short lines to the width and keeps the others", () => {
  expect(padLines(["ab", "abcd", "abcdef"], 4)).toEqual(["ab  ", "abcd", "abcdef"]);
});
