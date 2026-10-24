import { expect, test } from "vitest";
import { RingBuffer } from "./src";

test("push appends items and toArray lists them oldest first", () => {
  const ring = new RingBuffer<number>(3);
  expect(ring.push(1)).toBeUndefined();
  expect(ring.push(2)).toBeUndefined();
  expect(ring.toArray()).toEqual([1, 2]);
  expect(ring.size).toBe(2);
  expect(ring.isFull()).toBe(false);
});

test("push on a full buffer evicts and returns the oldest item", () => {
  const ring = new RingBuffer<string>(2);
  ring.push("a");
  ring.push("b");
  expect(ring.isFull()).toBe(true);
  expect(ring.push("c")).toBe("a");
  expect(ring.toArray()).toEqual(["b", "c"]);
  expect(ring.size).toBe(2);
});

test("shift removes the oldest item and returns undefined when empty", () => {
  const ring = new RingBuffer<number>(4);
  ring.push(1);
  ring.push(2);
  expect(ring.shift()).toBe(1);
  expect(ring.shift()).toBe(2);
  expect(ring.shift()).toBeUndefined();
  expect(ring.size).toBe(0);
});

test("peek shows the oldest item without removing it", () => {
  const ring = new RingBuffer<number>(2);
  expect(ring.peek()).toBeUndefined();
  ring.push(7);
  ring.push(8);
  expect(ring.peek()).toBe(7);
  expect(ring.size).toBe(2);
});

test("at indexes from the oldest item after wrapping around", () => {
  const ring = new RingBuffer<number>(3);
  for (const n of [1, 2, 3, 4, 5]) ring.push(n);
  expect(ring.at(0)).toBe(3);
  expect(ring.at(2)).toBe(5);
  expect(() => ring.at(-1)).toThrow(RangeError);
  expect(() => ring.at(1.5)).toThrow(RangeError);
});

test("the constructor rejects a capacity that is not a positive integer", () => {
  expect(() => new RingBuffer(0)).toThrow();
  expect(() => new RingBuffer(2.5)).toThrow();
});

test("interleaved pushes and shifts keep first-in first-out order", () => {
  const ring = new RingBuffer<string>(2);
  ring.push("a");
  ring.push("b");
  expect(ring.shift()).toBe("a");
  ring.push("c");
  expect(ring.push("d")).toBe("b");
  expect(ring.toArray()).toEqual(["c", "d"]);
});
