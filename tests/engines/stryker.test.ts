import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStrykerConfig, parseStrykerReport, programmaticRange } from "../../cli/engines/stryker.js";
const sample = JSON.parse(readFileSync(new URL("../fixtures/stryker-report.sample.json", import.meta.url), "utf8")) as {
  files: Record<string, { source: string; mutants: { id: string; status: string; replacement: string }[] }>;
};
const source = sample.files["src.ts"]!.source;

describe("Stryker pinned report adapter (sample, not measured)", () => {
  it("derives location-based keys, drops and counts compile errors", () => {
    const parsed = parseStrykerReport(sample, source);
    expect(parsed.compileErrorCount).toBe(1);
    expect(parsed.mutants).toHaveLength(1);
    expect(parsed.mutants[0]?.status).toBe("Killed");
    expect(parsed.mutants[0]?.mutant.key).toMatch(/^[0-9a-f]{64}$/);
    const copy = structuredClone(sample); copy.files["src.ts"]!.mutants[0]!.id = "different-ordinal";
    expect(parseStrykerReport(copy, source).mutants[0]?.mutant.key).toBe(parsed.mutants[0]?.mutant.key);
  });
  it("refuses foreign keys before filtering compile errors, and missing keys", () => {
    const key = parseStrykerReport(sample, source).mutants[0]!.mutant.key;
    expect(() => parseStrykerReport(sample, source, new Set([key]))).toThrow();
    const single = structuredClone(sample); single.files["src.ts"]!.mutants.splice(1);
    expect(() => parseStrykerReport(single, source, new Set([key, "0".repeat(64)]))).toThrow();
    expect(parseStrykerReport(single, source, new Set([key])).mutants).toHaveLength(1);
  });
  it("rejects malformed status, unknown fields, duplicate ids and stale source", () => {
    const bad = structuredClone(sample); bad.files["src.ts"]!.mutants[0]!.status = "Unexpected";
    expect(() => parseStrykerReport(bad, source)).toThrow();
    expect(() => parseStrykerReport({ ...sample, extra: true }, source)).toThrow();
    const duplicate = structuredClone(sample); duplicate.files["src.ts"]!.mutants[1]!.id = duplicate.files["src.ts"]!.mutants[0]!.id;
    expect(() => parseStrykerReport(duplicate, source)).toThrow();
    expect(() => parseStrykerReport(sample, `${source}\n`)).toThrow();
  });
  it("emits exact feedback range selectors and isolated attribution defaults", () => {
    const mutant = parseStrykerReport(sample, source).mutants[0]!.mutant;
    const config = buildStrykerConfig({ feedbackMutants: [mutant], vitestConfigFile: "vitest.config.mjs", reportFile: "report.json" });
    expect(config.mutate).toEqual(["src.ts:2:16-2:17"]);
    expect(config.coverageAnalysis).toBe("off");
    expect(config.concurrency).toBe(1);
    expect(programmaticRange({ start: { line: 1, column: 15 }, end: { line: 1, column: 16 } }, "zero")).toEqual(mutant.range);
  });
});
