// M1 acceptance 3: the mutant key hashes exactly (relFile, srcSha256, range, mutator, replacement); no ordinal.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MutantKeyError,
  formatRange,
  mutantKey,
  mutantKeyPreimage,
  normalizeRelFile,
  sha256Hex,
} from "../../cli/core/mutantKey.js";
import type { MutantKeyInput } from "../../cli/core/mutantKey.js";

const SRC_SHA = "0123456789abcdef".repeat(4);

const base: MutantKeyInput = {
  relFile: "src.ts",
  srcSha256: SRC_SHA,
  range: { start: { line: 12, column: 9 }, end: { line: 12, column: 15 } },
  mutator: "EqualityOperator",
  replacement: "x <= max",
};

describe("sha256Hex", () => {
  it("matches the FIPS 180-2 test vector for 'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("mutantKey", () => {
  it("hashes exactly relFile|srcSha256|startLine:startCol-endLine:endCol|mutator|replacement", () => {
    const pre = `src.ts|${SRC_SHA}|12:9-12:15|EqualityOperator|x <= max`;
    expect(formatRange(base.range)).toBe("12:9-12:15");
    expect(mutantKeyPreimage(base)).toBe(pre);
    expect(mutantKey(base)).toBe(createHash("sha256").update(pre, "utf8").digest("hex"));
    expect(mutantKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for equal inputs and independent of engine ordinals or extra fields", () => {
    const fromStrykerRun1 = { ...base, id: "17", status: "Survived" };
    const fromStrykerRun2 = { ...base, id: "3", status: "Killed" };
    expect(mutantKey(fromStrykerRun1)).toBe(mutantKey(fromStrykerRun2));
    expect(mutantKey({ ...base })).toBe(mutantKey(base));
  });

  it("changes when any one of the five inputs changes", () => {
    const k = mutantKey(base);
    const variants: MutantKeyInput[] = [
      { ...base, relFile: "other.ts" },
      { ...base, srcSha256: "f".repeat(64) },
      { ...base, range: { start: { line: 12, column: 9 }, end: { line: 12, column: 16 } } },
      { ...base, range: { start: { line: 13, column: 9 }, end: { line: 13, column: 15 } } },
      { ...base, mutator: "ConditionalExpression" },
      { ...base, replacement: "x < max" },
    ];
    const keys = variants.map(mutantKey);
    for (const v of keys) expect(v).not.toBe(k);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("allows '|' inside the replacement without ambiguity", () => {
    expect(() => mutantKey({ ...base, replacement: "a || b" })).not.toThrow();
    expect(mutantKey({ ...base, replacement: "a || b" })).not.toBe(mutantKey({ ...base, replacement: "a | b" }));
  });

  it("refuses inputs that would make the pre-image ambiguous or platform-dependent", () => {
    expect(() => mutantKey({ ...base, relFile: "a|b.ts" })).toThrow(MutantKeyError);
    expect(() => mutantKey({ ...base, mutator: "Equality|Operator" })).toThrow(MutantKeyError);
    expect(() => mutantKey({ ...base, relFile: "lib\\src.ts" })).toThrow(MutantKeyError);
    expect(() => mutantKey({ ...base, relFile: "./src.ts" })).toThrow(MutantKeyError);
    expect(() => mutantKey({ ...base, relFile: "/abs/src.ts" })).toThrow(MutantKeyError);
    // Subject-relative convention (M2): repo-relative or nested paths are refused, not silently keyed.
    expect(() => mutantKey({ ...base, relFile: "fixtures/subjects/clamp-range/src.ts" })).toThrow(MutantKeyError);
    expect(() => mutantKey({ ...base, relFile: "lib/src.ts" })).toThrow(MutantKeyError);
    expect(() => mutantKey({ ...base, srcSha256: SRC_SHA.toUpperCase() })).toThrow(MutantKeyError);
    expect(() => mutantKey({ ...base, range: { start: { line: 0, column: 1 }, end: { line: 1, column: 1 } } })).toThrow(
      MutantKeyError,
    );
    expect(() => mutantKey({ ...base, range: { start: { line: 5, column: 4 }, end: { line: 5, column: 3 } } })).toThrow(
      MutantKeyError,
    );
  });
});

describe("normalizeRelFile", () => {
  it("normalises engine paths to relative POSIX form (separators and leading ./ only)", () => {
    expect(normalizeRelFile("src.ts")).toBe("src.ts");
    expect(normalizeRelFile("./src.ts")).toBe("src.ts");
    expect(normalizeRelFile(".\\src.ts")).toBe("src.ts");
    // Normalisation does not strip directories; mutantKey then refuses the non-subject-relative result.
    expect(normalizeRelFile(".\\fixtures\\subjects\\clamp-range\\src.ts")).toBe("fixtures/subjects/clamp-range/src.ts");
  });

  it("refuses traversal and absolute paths", () => {
    expect(() => normalizeRelFile("../src.ts")).toThrow(MutantKeyError);
    expect(() => normalizeRelFile("C:\\repo\\src.ts")).toThrow(MutantKeyError);
    expect(() => normalizeRelFile("/repo/src.ts")).toThrow(MutantKeyError);
  });
});
