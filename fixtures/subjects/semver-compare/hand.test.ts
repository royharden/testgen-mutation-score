import { expect, test } from "vitest";
import { compareVersions, maxVersion, parseVersion, sortVersions } from "./src";

test("parseVersion reads the numbers and the pre-release identifiers", () => {
  expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, pre: [] });
  expect(parseVersion("1.0.0-alpha.1+build.5")).toEqual({ major: 1, minor: 0, patch: 0, pre: ["alpha", "1"] });
  expect(parseVersion("9007199254740991.9007199254740991.9007199254740991")).toEqual({
    major: Number.MAX_SAFE_INTEGER, minor: Number.MAX_SAFE_INTEGER, patch: Number.MAX_SAFE_INTEGER, pre: [],
  });
});

test("parseVersion rejects malformed versions", () => {
  for (const bad of [
    "1.2", "01.2.3", "1.2.3-", "v1.2.3", "1.2.3.4", "1.2.3+", "1.2.3-01", "1.2.3-alpha.01",
    "1.2.3\n", "1.2.3\r", "1.2.3\r\n", "1.2.3\u2028", "1.2.3\u2029",
    "9007199254740992.0.0", "0.9007199254740992.0", "0.0.9007199254740992", `1.2.${"9".repeat(400)}`,
  ]) {
    expect(() => parseVersion(bad)).toThrow();
  }
});

test("compareVersions compares major, minor and patch numerically", () => {
  expect(compareVersions("1.2.3", "1.10.0")).toBe(-1);
  expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  expect(compareVersions("9007199254740990.0.0", "9007199254740991.0.0")).toBe(-1);
});

test("pre-release precedence follows the Semantic Versioning example chain", () => {
  const chain = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];
  for (let i = 1; i < chain.length; i++) {
    expect(compareVersions(chain[i - 1]!, chain[i]!)).toBe(-1);
    expect(compareVersions(chain[i]!, chain[i - 1]!)).toBe(1);
  }
  const numeric = ["9007199254740992", "9007199254740993", "8".repeat(400), "9".repeat(400), `1${"0".repeat(400)}`];
  for (let i = 1; i < numeric.length; i++) {
    const lower = `1.0.0-${numeric[i - 1]!}`;
    const higher = `1.0.0-${numeric[i]!}`;
    expect(compareVersions(lower, higher)).toBe(-1);
    expect(compareVersions(higher, lower)).toBe(1);
    expect(compareVersions(higher, higher)).toBe(0);
  }
});

test("build metadata does not affect precedence", () => {
  expect(compareVersions("1.0.0+a", "1.0.0+b")).toBe(0);
  expect(compareVersions("1.0.0+01", "1.0.0+1")).toBe(0);
  expect(compareVersions("1.0.0-0", "1.0.0-1")).toBe(-1);
  expect(compareVersions("1.0.0-01a", "1.0.0-1a")).toBe(-1);
});

test("sortVersions sorts ascending and leaves the input alone", () => {
  const input = ["1.10.0", "1.2.0", "1.0.0-rc.1", "1.0.0"];
  expect(sortVersions(input)).toEqual(["1.0.0-rc.1", "1.0.0", "1.2.0", "1.10.0"]);
  expect(input).toEqual(["1.10.0", "1.2.0", "1.0.0-rc.1", "1.0.0"]);
});

test("maxVersion picks the highest version and is undefined for none", () => {
  expect(maxVersion(["1.2.0", "1.10.0", "1.9.9"])).toBe("1.10.0");
  expect(maxVersion([])).toBeUndefined();
});
