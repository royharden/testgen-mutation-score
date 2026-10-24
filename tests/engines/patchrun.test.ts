import { describe, expect, it } from "vitest";
import { applyExactPatch, executeExactPatch, sourceSlice } from "../../cli/engines/patchrun.js";
import type { SourceRange } from "../../cli/core/schemas.js";

describe("exact patch fallback", () => {
  const source = "// Unicode: λ\r\nreturn value + 1;\r\n";
  const range: SourceRange = { start: { line: 2, column: 14 }, end: { line: 2, column: 15 } };
  it("uses one-based UTF-16 positions and end-exclusive slices over CRLF", () => {
    expect(sourceSlice(source, range)).toBe("1");
    expect(applyExactPatch(source, range, "1", "0")).toBe("// Unicode: λ\r\nreturn value + 0;\r\n");
  });
  it("refuses stale original, out-of-bounds, reversed and no-op patches", () => {
    expect(() => applyExactPatch(source, range, "2", "0")).toThrow();
    expect(() => applyExactPatch(source, range, "1", "1")).toThrow();
    expect(() => sourceSlice(source, { start: range.end, end: range.start })).toThrow();
    expect(() => sourceSlice(source, { start: { line: 9, column: 1 }, end: { line: 9, column: 2 } })).toThrow();
  });
  it("checks original before invoking any executor", async () => {
    let calls = 0;
    await expect(executeExactPatch({ async run() { calls++; throw new Error("unreachable"); } }, {
      sourceText: source, range, original: "not-original", replacement: "0", units: [], target: { kind: "feedback-mutant", mutantKey: "a".repeat(64) },
    })).rejects.toMatchObject({ kind: "add-only-guard" });
    expect(calls).toBe(0);
  });
});
