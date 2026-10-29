import { expect, it } from "vitest";
import { mutationScores, twinOverfit, withCost } from "../../cli/core/score.js";
import { ScoringExecutionResultSchema } from "../../cli/core/schemas.js";
import { row } from "../eval/fixtures.js";

it("includes Timeout only in raw numerator and removes equivalent numerator as well as denominator", () => {
  const scored = mutationScores([{ status: "Killed", equivalent: true }, { status: "Timeout" }, { status: "Survived" },
    { status: "NoCoverage" }, { status: "CompileError" }]);
  expect(scored.scoreRaw).toBe(.5); expect(scored.scoreKilledOnly).toBe(.25);
  expect(scored.scoreWithoutEquivalents).toBeCloseTo(1 / 3); expect(scored.counts.compileError).toBe(1);
});
it("never invents a score for an empty or compiler-only denominator", () => {
  expect(mutationScores([]).scoreRaw).toBeNull();
  expect(mutationScores([{ status: "CompileError" }]).scoreKilledOnly).toBeNull();
  expect(mutationScores([{ status: "Killed", equivalent: true }]).scoreWithoutEquivalents).toBeNull();
});
it("counts attributed unit twin failure while making missing, duplicate and timeout twins incomplete", () => {
  const hash = "1".repeat(64), base = { kind: "twin", unitSha256s: [hash], outcome: "failed", durationMs: 1,
    shuffleSeed: null, outputTruncated: false, tests: [{ name: "witness", unitSha256: hash, status: "failed", cause: "assertion" }] };
  const failure = ScoringExecutionResultSchema.parse(base);
  expect(twinOverfit([hash], [failure])).toEqual({ accepted: 1, failingTwin: 1, twinIncomplete: 0, rate: 1 });
  expect(twinOverfit([hash], []).rate).toBeNull();
  expect(twinOverfit([hash], [failure, failure]).twinIncomplete).toBe(1);
  expect(twinOverfit([hash], [ScoringExecutionResultSchema.parse({ ...base, outcome: "timeout", tests: [] })]).failingTwin).toBe(0);
  expect(twinOverfit([], []).rate).toBeNull();
});
it("computes pp per ledger dollar using A0 or A2, top-up accepted cost for A6, and zero cost n/a", () => {
  const a5 = withCost(row("held-one", "A5", 0, .75), 2, .25);
  expect(a5.scoreGainPerDollarPp).toBe(25); expect(a5.costPerAcceptedTestUsd).toBe(2);
  const a6 = withCost(row("held-one", "A6", 0, .75), 2, .5, 2);
  expect(a6.gainBaseline).toBe("A2"); expect(a6.scoreGainPerDollarPp).toBe(12.5); expect(a6.costPerAcceptedTestUsd).toBe(1);
  expect(withCost(row("held-one", "A5", 0), 0, 0).scoreGainPerDollarPp).toBeNull();
  expect(withCost(row("held-one", "A1", 0), null, 0).costPerAcceptedTestUsd).toBeNull();
});
