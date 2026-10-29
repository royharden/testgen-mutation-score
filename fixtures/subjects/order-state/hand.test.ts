import { expect, test } from "vitest";
import { allowedEvents, history, isTerminal, replay, transition } from "./src";

test("an order moves forward through every state to delivered", () => {
  expect(transition("draft", "place")).toBe("placed");
  expect(replay(["place", "pay", "ship", "deliver"])).toBe("delivered");
});

test("cancel is accepted in draft, placed and paid", () => {
  expect(transition("draft", "cancel")).toBe("cancelled");
  expect(transition("placed", "cancel")).toBe("cancelled");
  expect(transition("paid", "cancel")).toBe("cancelled");
});

test("every other transition throws an Error", () => {
  expect(() => transition("draft", "pay")).toThrow(Error);
  expect(() => transition("shipped", "cancel")).toThrow(Error);
  expect(() => transition("cancelled", "place")).toThrow(Error);
  expect(() => transition("delivered", "deliver")).toThrow(Error);
});

test("replay starts from draft or a given state and throws on the first bad event", () => {
  expect(replay([])).toBe("draft");
  expect(replay(["pay"], "placed")).toBe("paid");
  expect(() => replay(["place", "ship"])).toThrow(Error);
});

test("history lists the start state and the state after each event", () => {
  expect(history(["place", "pay"])).toEqual(["draft", "placed", "paid"]);
  expect(history([], "shipped")).toEqual(["shipped"]);
});

test("only delivered and cancelled are terminal", () => {
  expect(isTerminal("delivered")).toBe(true);
  expect(isTerminal("cancelled")).toBe(true);
  expect(isTerminal("draft")).toBe(false);
  expect(isTerminal("shipped")).toBe(false);
});

test("allowedEvents names the accepted events in any order", () => {
  expect([...allowedEvents("placed")].sort()).toEqual(["cancel", "pay"]);
  expect([...allowedEvents("shipped")].sort()).toEqual(["deliver"]);
  expect(allowedEvents("delivered")).toEqual([]);
});
