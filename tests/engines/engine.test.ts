/** Authored in Dirty Mode; injected results only, no process execution. */
import { describe, expect, it } from "vitest";
import { createFeedbackExecutor, createScoringExecutor, EngineExecutionError, normalizeMutations, validateRunResult } from "../../cli/engines/engine.js";
import type { FeedbackRequest, IsolatedRunner, IsolatedRunRequest } from "../../cli/engines/engine.js";
import { sha256Hex } from "../../cli/core/mutantKey.js";
import type { ExecutionResult, MutantInventory, TestUnit } from "../../cli/core/schemas.js";

const sourceText = "export function add(value: number): number {\n  const delta = 1;\n  return value + delta;\n}\n";
const text = 'import { test, expect } from "vitest";\nimport { add } from "./src";\ntest("adds", () => { expect(add(1)).toBe(2); });';
const unit: TestUnit = { unitSha256: sha256Hex(text), parentFileSha256: sha256Hex(text), candidateId: "c1", subjectId: "clamp-range",
  index: 0, testName: "adds", importsRange: null, testRange: { start: 0, end: text.length }, byteLength: Buffer.byteLength(text), text };
const mutants = normalizeMutations(sourceText, "inhouse", [
  { relFile: "src.ts", range: { start: { line: 3, column: 16 }, end: { line: 3, column: 17 } }, mutator: "Arithmetic", replacement: "-" },
  { relFile: "src.ts", range: { start: { line: 2, column: 17 }, end: { line: 2, column: 18 } }, mutator: "NumericBoundary", replacement: "0" },
]);
const feedback = mutants[0]!, scoring = mutants[1]!;
function inventory(): MutantInventory {
  return { schemaVersion: 1, subjectId: "clamp-range", srcSha256: sha256Hex(sourceText), engine: "inhouse", engineVersion: "1",
    createdAt: "2026-10-24T00:00:00Z", seed: 1, mutants, partition: { feedback: [feedback.key], scoring: [scoring.key] },
    reservedGroups: [], compileErrorCount: 0, duplicatesRemoved: 0 };
}
function passed(request: IsolatedRunRequest): ExecutionResult {
  const base = { ...request.target, unitSha256s: request.units.map((u) => u.unitSha256), outcome: "passed" as const, durationMs: 1,
    shuffleSeed: request.shuffleSeed ?? null, tests: request.units.map((u) => ({ name: u.testName, unitSha256: u.unitSha256, status: "passed" as const, cause: null })), outputTruncated: false };
  if ("mutantKey" in request.target || request.target.kind === "planted") return { ...base, mutantStatus: "Survived", killCause: null } as ExecutionResult;
  return (request.target.kind === "coverage" ? { ...base, coveredLines: [2] } : base) as ExecutionResult;
}

describe("feedback capability", () => {
  it("executes only exact frozen feedback patches, with no request-side mutant key", async () => {
    const calls: IsolatedRunRequest[] = [];
    const run: IsolatedRunner = { async run(request) { calls.push(request); return passed(request); } };
    const executor = createFeedbackExecutor({ sourceText, inventory: inventory(), run });
    const results = await executor.execute({ kind: "feedback", unit });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sourceText).toContain("return value - delta");
    expect(calls[0]?.target).toEqual({ kind: "feedback-mutant", mutantKey: feedback.key });
    expect(results[0]?.kind).toBe("feedback-mutant");
    const illegal = { kind: "feedback", unit, mutantKey: scoring.key } as unknown as FeedbackRequest;
    await expect(executor.execute(illegal)).rejects.toMatchObject({ kind: "schema-violation", fatal: true });
    expect(calls).toHaveLength(1);
  });

  it.each(["scoring", "foreign", "missing-tests", "wrong-unit", "truncated"])("refuses %s result instead of survival", async (bad) => {
    const executor = createFeedbackExecutor({ sourceText, inventory: inventory(), run: { async run(request) {
      const result = passed(request);
      if (bad === "scoring") return { ...result, kind: "scoring-mutant" } as ExecutionResult;
      if (bad === "foreign") return { ...result, mutantKey: scoring.key } as ExecutionResult;
      if (bad === "missing-tests") return { ...result, tests: [] };
      if (bad === "wrong-unit") return { ...result, unitSha256s: ["a".repeat(64)] };
      return { ...result, outputTruncated: true };
    } } });
    await expect(executor.execute({ kind: "feedback", unit })).rejects.toBeInstanceOf(EngineExecutionError);
  });

  it("returns Timeout as Timeout with no kill cause", async () => {
    const executor = createFeedbackExecutor({ sourceText, inventory: inventory(), run: { async run(request) {
      return { ...passed(request), outcome: "timeout", tests: [], mutantStatus: "Timeout", killCause: null } as ExecutionResult;
    } } });
    expect(await executor.execute({ kind: "feedback", unit })).toMatchObject([{ mutantStatus: "Timeout", killCause: null }]);
  });

  it("refuses inconsistent partitions and changed source before execution", () => {
    const run: IsolatedRunner = { async run() { throw new Error("must not run"); } };
    const inv = inventory(); inv.partition.feedback.push(scoring.key);
    expect(() => createFeedbackExecutor({ sourceText, inventory: inv, run })).toThrow();
    expect(() => createFeedbackExecutor({ sourceText: `${sourceText}\n`, inventory: inventory(), run })).toThrow();
  });

  it("does not expose planted/twin/scoring request kinds", async () => {
    const executor = createFeedbackExecutor({ sourceText, inventory: inventory(), run: { async run() { throw new Error("must not run"); } } });
    for (const kind of ["scoring-mutant", "planted", "twin"]) await expect(executor.execute({ kind, units: [unit] } as unknown as FeedbackRequest)).rejects.toThrow();
  });
  it("refuses changed unit bytes or the wrong subject before invoking a runner", async () => {
    const executor = createFeedbackExecutor({ sourceText, inventory: inventory(), run: { async run() { throw new Error("must not run"); } } });
    await expect(executor.execute({ kind: "feedback", unit: { ...unit, text: `${unit.text}\n` } })).rejects.toMatchObject({ kind: "add-only-guard" });
    await expect(executor.execute({ kind: "feedback", unit: { ...unit, subjectId: "wrong-subject" } })).rejects.toMatchObject({ kind: "add-only-guard" });
  });
});

describe("result validation and scoring separation", () => {
  it("rejects a claimed Killed result without attributable failed-test evidence", () => {
    const request: IsolatedRunRequest = { sourceText, units: [unit], target: { kind: "feedback-mutant", mutantKey: feedback.key } };
    expect(() => validateRunResult({ ...passed(request), outcome: "failed", tests: [], mutantStatus: "Killed", killCause: "assertion" }, request)).toThrow();
  });
  it("requires a suite hash before returning a scorer capability", async () => {
    const calls: IsolatedRunRequest[] = [];
    const options = { sourceText, inventory: inventory(), frozenUnits: [unit], frozenSuiteSha256: sha256Hex(unit.unitSha256),
      run: { async run(request: IsolatedRunRequest) { calls.push(request); return passed(request); } } };
    expect(() => createScoringExecutor({ ...options, frozenSuiteSha256: "0".repeat(64) })).toThrow();
    const results = await createScoringExecutor(options).execute();
    expect(results).toMatchObject([{ kind: "scoring-mutant", mutantKey: scoring.key }]);
    expect(calls).toHaveLength(1);
  });
});
