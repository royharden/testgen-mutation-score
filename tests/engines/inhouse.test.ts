import { describe, expect, it } from "vitest";
import { enumerateInhouse, INHOUSE_OPERATORS, inhouseMutants } from "../../cli/engines/inhouse.js";

const source = "export function f(x: number, flag: boolean) {\n const y = flag ? x + 1 : x - 2;\n if (x < y && !flag) return true;\n return x === 0 || false;\n}\n";
describe("AST fallback inventory", () => {
  it("enumerates the eight fixed operator families deterministically", () => {
    const first = enumerateInhouse(source);
    expect(first).toEqual(enumerateInhouse(source));
    expect(new Set(first.map((m) => m.mutator))).toEqual(new Set(INHOUSE_OPERATORS));
    expect(first.every((m) => m.relFile === "src.ts")).toBe(true);
  });
  it("groups neighbouring patches in the same enclosing statement, not engine ordinals", () => {
    const records = inhouseMutants(source);
    const secondLine = records.filter((m) => m.range.start.line === 2);
    expect(secondLine.length).toBeGreaterThan(1);
    expect(new Set(secondLine.map((m) => m.groupKey)).size).toBe(1);
    expect(records.every((m) => /^[0-9a-f]{64}$/.test(m.key))).toBe(true);
  });
  it("rejects parse errors and never mutates numeric type literals", () => {
    expect(() => enumerateInhouse("export function {" )).toThrow();
    expect(enumerateInhouse("export function f(x: 1) { return x; }")).toEqual([]);
  });
});
