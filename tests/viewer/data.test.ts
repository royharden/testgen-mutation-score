/** Authored for activation; not executed during Dirty Mode construction. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateAnalysis, validateRun } from "../../src/lib/runData.js";

const sample = () => JSON.parse(readFileSync(new URL("../../public/runs/sample-workbench.json", import.meta.url), "utf8")) as unknown;
const companion = () => JSON.parse(readFileSync(new URL("../../public/analysis/sample-workbench.json", import.meta.url), "utf8")) as unknown;
describe("viewer public artifact boundary", () => {
  it("accepts the fictional sample and matching post-freeze companion", async () => {
    const run = await validateRun(sample(), "sample-workbench");
    const analysis = validateAnalysis(companion(), run);
    expect(run.executionProvenance).toBe("recorded-fixture");
    expect(run.providerMode).toBe("mock");
    expect(analysis.cells.some((c) => c.state === "incomplete" && c.row === null)).toBe(true);
    expect(analysis.cells.some((c) => c.row?.usd === null)).toBe(true);
  });
  it("refuses a run returned under another URL identity", async () => {
    await expect(validateRun(sample(), "another-run")).rejects.toThrow("identity");
  });
  it("refuses changed unit bytes even when JSON shape remains valid", async () => {
    const run = await validateRun(sample(), "sample-workbench");
    run.units[0]!.text = run.units[0]!.text.replace("boundary", "BOUNDARY");
    await expect(validateRun(run, run.runId)).rejects.toThrow("hash mismatch");
  });
  it("refuses an analysis companion from another source snapshot", async () => {
    const run = await validateRun(sample(), "sample-workbench");
    const analysis = validateAnalysis(companion(), run);
    analysis.inventories[0]!.srcSha256 = "a".repeat(64);
    expect(() => validateAnalysis(analysis, run)).toThrow("source hash");
  });
  it("refuses a matrix unit not published in the referenced run", async () => {
    const run = await validateRun(sample(), "sample-workbench");
    const analysis = validateAnalysis(companion(), run);
    analysis.cells.find((c) => c.matrix.length)!.matrix[0]!.unitSha256s = ["b".repeat(64)];
    expect(() => validateAnalysis(analysis, run)).toThrow("Analysis unit");
  });
  it("keeps duplicate content identity separate from proposal identity", async () => {
    const run = await validateRun(sample(), "sample-workbench");
    const first = run.gateDecisions.find((d) => d.decision === "accepted" && d.arm === "A5")!;
    const original = run.candidates.find((c) => c.candidateId === first.candidateId)!;
    const duplicate = { ...original, candidateId: "sample-repeated-proposal", slot: 99 };
    run.candidates.push(duplicate);
    run.gateDecisions.push({ ...first, candidateId: duplicate.candidateId });
    expect((await validateRun(run, run.runId)).gateDecisions).toHaveLength(run.gateDecisions.length);
  });
});
