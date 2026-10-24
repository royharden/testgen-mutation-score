import { expect, test } from "vitest";
import { buildQuery, pairCount, parseQuery } from "./src";

test("empty input and empty segments produce no pairs", () => {
  expect(parseQuery("")).toEqual([]);
  expect(parseQuery("?&&")).toEqual([]);
});

test("parsing preserves duplicates and empty components", () => {
  expect(parseQuery("?x=1&x=2&=blank&empty=")).toEqual([
    ["x", "1"], ["x", "2"], ["", "blank"], ["empty", ""],
  ]);
});

test("percent escapes and plus signs decode in keys and values", () => {
  expect(parseQuery("a+b=c%20d&%E2%98%83=%2B")).toEqual([["a b", "c d"], ["\u2603", "+"]]);
  expect(parseQuery("eq=a=b")).toEqual([["eq", "a=b"]]);
});

test("malformed encodings throw without fixing the error class", () => {
  expect(() => parseQuery("x=%Q0")).toThrow();
  expect(() => parseQuery("x=%")).toThrow();
  expect(() => parseQuery("x=%FF")).toThrow();
});

test("building escapes separators and round trips without mutation", () => {
  const pairs: [string, string][] = [["a b", "x&y=z"], ["a b", "+"]];
  expect(buildQuery(pairs)).toBe("a%20b=x%26y%3Dz&a%20b=%2B");
  expect(parseQuery(buildQuery(pairs))).toEqual(pairs);
  expect(pairs).toEqual([["a b", "x&y=z"], ["a b", "+"]]);
  expect(buildQuery([])).toBe("");
});

test("pairCount counts parsed pairs rather than separators", () => {
  expect(pairCount("a=1&&b=2&")).toBe(2);
  expect(pairCount("")).toBe(0);
});
