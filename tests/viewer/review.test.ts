/** Authored for activation; not executed during Dirty Mode construction. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RunRecordSchema } from "../../cli/core/schemas.js";
import { isRolledBack, reviewItems } from "../../src/lib/review.js";

const sample = () => RunRecordSchema.parse(JSON.parse(readFileSync(new URL("../../public/runs/sample-workbench.json", import.meta.url), "utf8")));
describe("admission rollback scope", () => {
  it("keeps a retained A5/r1 unit reviewable when identical bytes roll back in A6/r2", () => {
    const run = sample();
    const decision = run.gateDecisions.find((d) => d.decision === "accepted" && d.arm === "A5")!;
    run.runErrors.push({ type: "run-error", kind: "union-pristine-failure", fatal: false, subjectId: decision.subjectId,
      arm: "A6", repeat: 2, round: decision.round, candidateId: null, message: "Injected rollback in another cell.",
      at: "2026-10-24T13:00:00Z", rolledBack: [decision.unitSha256!] });
    expect(isRolledBack(run, decision)).toBe(false);
    expect(reviewItems(run).some((item) => item.decision === decision)).toBe(true);
    const sameCellLaterRound = { ...decision, round: decision.round + 1 };
    run.runErrors[0]!.arm = decision.arm; run.runErrors[0]!.repeat = decision.repeat;
    expect(isRolledBack(run, sameCellLaterRound)).toBe(false);
    expect(isRolledBack(run, decision)).toBe(true);
    expect(reviewItems(run).some((item) => item.decision === decision)).toBe(false);
  });
  it("requires retention in the matching final cell", () => {
    const run = sample();
    const decision = run.gateDecisions.find((d) => d.decision === "accepted" && d.arm === "A5")!;
    const cell = run.cells.find((c) => c.subjectId === decision.subjectId && c.arm === decision.arm && c.repeat === decision.repeat)!;
    cell.keptUnits = cell.keptUnits.filter((key) => key !== decision.unitSha256);
    expect(reviewItems(run).some((item) => item.decision === decision)).toBe(false);
  });
});
