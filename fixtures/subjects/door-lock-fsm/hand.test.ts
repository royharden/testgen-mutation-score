import { expect, test } from "vitest";
import { allowedEvents, history, isSecure, replay, transition } from "./src";

test("unlock and lock complete a normal door cycle", () => {
  expect(transition("locked", "unlock")).toBe("unlocked");
  expect(transition("unlocked", "lock")).toBe("locked");
});

test("forcing either normal state triggers the alarm", () => {
  expect(transition("locked", "force")).toBe("alarm");
  expect(transition("unlocked", "force")).toBe("alarm");
  expect(transition("alarm", "reset")).toBe("locked");
});

test("invalid events throw Error without requiring message text", () => {
  expect(() => transition("locked", "lock")).toThrow(Error);
  expect(() => transition("alarm", "unlock")).toThrow(Error);
  expect(() => transition("unlocked", "reset")).toThrow(Error);
});

test("replay respects the default and explicit starting state", () => {
  expect(replay(["unlock", "force", "reset"])).toBe("locked");
  expect(replay(["lock"], "unlocked")).toBe("locked");
  expect(replay([])).toBe("locked");
  expect(() => replay(["unlock", "unlock"])).toThrow(Error);
});

test("history includes the initial state and every transition", () => {
  expect(history(["unlock", "force"])).toEqual(["locked", "unlocked", "alarm"]);
  expect(history([], "alarm")).toEqual(["alarm"]);
});

test("secure means locked or alarming", () => {
  expect(isSecure("locked")).toBe(true);
  expect(isSecure("alarm")).toBe(true);
  expect(isSecure("unlocked")).toBe(false);
});

test("allowed events are compared as sets", () => {
  expect(allowedEvents("locked").sort()).toEqual(["force", "unlock"]);
  expect(allowedEvents("alarm")).toEqual(["reset"]);
});
