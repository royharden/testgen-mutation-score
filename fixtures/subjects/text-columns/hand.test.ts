import { expect, test } from "vitest";
import { columnRowCount, textColumns } from "./src";

test("lays words into padded fixed width columns", () => {
  expect(textColumns("a bb c d", 3)).toEqual(["a    bb", "c    d"]);
});

test("leaves a partial row unpadded at the end", () => {
  expect(textColumns("a b c", 2)).toEqual(["a   b", "c"]);
});

test("accepts words that exactly fill the width", () => {
  expect(textColumns("abc def", 3, 2, 1)).toEqual(["abc def"]);
});

test("supports custom column count and zero gap", () => {
  expect(textColumns("a bb c d", 2, 3, 0)).toEqual(["a bbc", "d"]);
  expect(textColumns("a b", 2, 1)).toEqual(["a", "b"]);
});

test("uses only the specified ASCII whitespace separators", () => {
  expect(textColumns(" \ta\r\nb\t ", 1)).toEqual(["a  b"]);
  expect(textColumns(" \t\r\n", 3)).toEqual([]);
});

test("rejects oversized words and invalid dimensions", () => {
  expect(() => textColumns("abcd", 3)).toThrow(RangeError);
  expect(() => textColumns("a", 0)).toThrow(RangeError);
  expect(() => textColumns("a", 2, 1.5)).toThrow(RangeError);
  expect(() => textColumns("a", 2, 2, -1)).toThrow(RangeError);
});

test("counts rows including the final partial row", () => {
  expect(columnRowCount("a b c d e", 1)).toBe(3);
  expect(columnRowCount("", 1)).toBe(0);
});
