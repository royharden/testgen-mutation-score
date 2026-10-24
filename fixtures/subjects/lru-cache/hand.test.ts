import { expect, test } from "vitest";
import { LruCache } from "./src";

test("stores values and reports least to most recent order", () => {
  const cache = new LruCache<number>(3);
  expect(cache.set("a", 1)).toBeUndefined();
  cache.set("b", 2);
  expect(cache.size).toBe(2);
  expect(cache.keys()).toEqual(["a", "b"]);
  expect(cache.keyAt(0)).toBe("a");
});

test("get touches a key before eviction", () => {
  const cache = new LruCache<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  expect(cache.get("a")).toBe(1);
  expect(cache.set("c", 3)).toBe(2);
  expect(cache.keys()).toEqual(["a", "c"]);
});

test("peek leaves recency unchanged", () => {
  const cache = new LruCache<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  expect(cache.peek("a")).toBe(1);
  expect(cache.set("c", 3)).toBe(1);
  expect(cache.peek("a")).toBeUndefined();
});

test("updating a key replaces its value and touches it", () => {
  const cache = new LruCache<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  expect(cache.set("a", 9)).toBeUndefined();
  expect(cache.keys()).toEqual(["b", "a"]);
  expect(cache.peek("a")).toBe(9);
  expect(cache.size).toBe(2);
});

test("deletes keys and handles missing keys", () => {
  const cache = new LruCache<number | undefined>(1);
  cache.set("x", undefined);
  expect(cache.delete("x")).toBe(true);
  expect(cache.delete("x")).toBe(false);
  expect(cache.get("missing")).toBeUndefined();
  expect(cache.size).toBe(0);
});

test("keys returns a fresh array and keyAt checks malformed indexes", () => {
  const cache = new LruCache<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  const keys = cache.keys();
  keys.reverse();
  expect(cache.keys()).toEqual(["a", "b"]);
  expect(cache.keyAt(1)).toBe("b");
  expect(() => cache.keyAt(-1)).toThrow(RangeError);
  expect(() => cache.keyAt(0.5)).toThrow(RangeError);
});

test("rejects invalid capacity", () => {
  expect(() => new LruCache(0)).toThrow();
  expect(() => new LruCache(1.5)).toThrow();
});
