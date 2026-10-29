/** Authored only in Dirty Mode. All runtime fixtures are local temporary files, never subject execution. */
import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyCommand, planApply, writeApplyPlan } from "../../cli/apply/apply.js";
import { parseArgs, runCli } from "../../cli/index.js";
import { FileStagingStore, sha256Bytes } from "../../cli/core/staging.js";
import { unitsFromFile } from "../../cli/core/preflight.js";
import { CellArtifactSchema, FrozenCellSuiteSchema, suiteHash } from "../../cli/arms/runner.js";
import { RunRecordSchema } from "../../cli/core/schemas.js";
import type { Ruling } from "../../cli/core/schemas.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const now = "2026-10-24T00:00:00Z", subjectId = "clamp-range", candidateId = "clamp-range:A5:0:1:1";
const source = "export const clamp = (n: number) => Math.min(2, n);\n";
const candidateText = 'import {test,expect} from "vitest";\r\nimport {clamp} from "./src";\r\ntest("café",()=>{expect(clamp(3)).toBe(2);});';
async function json(root: string, relative: string, value: unknown) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), JSON.stringify(value), "utf8");
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "testgen-apply-")); roots.push(root);
  await mkdir(path.join(root, "fixtures/subjects", subjectId), { recursive: true });
  await writeFile(path.join(root, "fixtures/subjects", subjectId, "src.ts"), source);
  return addRun(root, "run-one", source);
}
async function addRun(root: string, runId: string, src: string, testText = candidateText) {
  const unit = unitsFromFile(subjectId, testText, candidateId)[0]!;
  const [receipt] = await new FileStagingStore(root, subjectId).commit([unit]);
  const candidate = { candidateId, subjectId, arm: "A5" as const, repeat: 0, round: 1, slot: 1,
    fileSha256: sha256Bytes(testText), byteLength: Buffer.byteLength(testText, "utf8") };
  const decision = { type: "gate-decision" as const, subjectId, arm: "A5" as const, repeat: 0, round: 1, candidateId,
    unitSha256: unit.unitSha256, unitIndex: unit.index, testName: unit.testName, at: now, decision: "accepted" as const,
    newKills: ["a".repeat(64)], stagedAs: receipt!.stagedAs, coveredLinesGained: null };
  const cell = { subjectId, arm: "A5" as const, repeat: 0, state: "complete" as const, reason: null, rounds: 1,
    keptUnits: [unit.unitSha256], roundWallMs: [1], inputTokens: 0, outputTokens: 0, usd: 0 };
  const frozen = FrozenCellSuiteSchema.parse({ schemaVersion: 1, runId, subjectId, arm: "A5", repeat: 0,
    inventorySha256: "b".repeat(64), subjectSha256: sha256Bytes(src), frozenSuiteSha256: suiteHash([unit]), units: [unit], unsupportedA1: [] });
  const artifact = CellArtifactSchema.parse({ schemaVersion: 1, cell, candidates: [candidate], units: [unit], gateDecisions: [decision],
    runErrors: [], loopExecutions: [], frozen });
  const run = RunRecordSchema.parse({ schemaVersion: 1, runId, createdAt: now, providerMode: "mock", executionProvenance: "replay-executed",
    status: "complete", exitCode: 0, split: "dev", campaignId: null, sandbox: "none", sandboxQualified: false, model: "mock-replay",
    engine: "inhouse", seed: 1, manifestEdition: 1, subjects: [{ id: subjectId, split: "dev", srcSha256: sha256Bytes(src) }], arms: ["A5"],
    candidates: [candidate], units: [unit], gateDecisions: [decision], runErrors: [], cells: [cell], missingCells: [], refusal: null,
    totals: { inputTokens: 0, outputTokens: 0, usd: 0 } });
  const runPath = `results/mock/runs/${runId}.json`, cellPath = `results/mock/cells/${runId}/${subjectId}-A5-0.json`;
  const frozenPath = `results/mock/frozen/${runId}/${subjectId}-A5-0.json`;
  await json(root, runPath, run); await json(root, cellPath, artifact); await json(root, frozenPath, frozen);
  const ruling: Ruling = { schemaVersion: 1, kind: "test-accept", runId, subjectId, subjectSha256: sha256Bytes(src),
    testSha256: unit.unitSha256, decision: "approve", who: "reviewer", when: now, why: "Reviewed" };
  return { root, run, unit, ruling, artifact, runPath, cellPath, frozenPath, stagedAs: receipt!.stagedAs,
    destination: `approved/${subjectId}/${unit.unitSha256.slice(0, 12)}.test.ts` };
}
const logs = (...rulings: Ruling[]) => [{ name: "rulings.jsonl", text: rulings.map((ruling) => JSON.stringify(ruling)).join("\n") }];

it("default CLI apply prints a patch, then --write creates only exact staged bytes", async () => {
  const f = await fixture(), output: string[] = [];
  await writeFile(path.join(f.root, "approval.jsonl"), JSON.stringify(f.ruling));
  expect(await runCli(["apply", "--rulings", "approval.jsonl"], { root: f.root, stdout: (line) => output.push(line), stderr: (line) => output.push(line) })).toBe(0);
  expect(output.join("\n")).toContain(`+++ b/${f.destination}`); expect(output.join("\n")).toContain("DRY RUN");
  expect(await readdir(f.root)).not.toContain("approved");
  expect(await runCli(["apply", "--rulings", "approval.jsonl", "--write"], { root: f.root, stdout: () => {}, stderr: () => {} })).toBe(0);
  expect(await readFile(path.join(f.root, f.destination))).toEqual(Buffer.from(f.unit.text, "utf8"));
  await expect(planApply(f.root, logs(f.ruling))).rejects.toThrow("destination already exists");
});
it("validates every JSONL line in every log before creating output directories", async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, "one.jsonl"), JSON.stringify(f.ruling));
  await writeFile(path.join(f.root, "two.jsonl"), `\n${JSON.stringify(f.ruling)}\n{broken`);
  const output: string[] = [];
  expect(await runCli(["apply", "--rulings", "one.jsonl", "two.jsonl", "--write"], { root: f.root,
    stdout: (line) => output.push(line), stderr: (line) => output.push(line) })).toBe(2);
  expect(output.join("\n")).toContain("two.jsonl:3:"); expect(await readdir(f.root)).not.toContain("approved");
});
it("resolves source-v1 approval and source-v2 rejection independently across two logs", async () => {
  const f = await fixture(), v2 = `${source}// edition two\n`, second = await addRun(f.root, "run-two", v2);
  const twoLogs = [logs(f.ruling)[0]!, { name: "second.jsonl", text: JSON.stringify({ ...second.ruling, decision: "reject" }) }];
  // v2 rejection does not revoke v1; it is separately invalidated against the current v1 bytes.
  let plan = await planApply(f.root, twoLogs); expect(plan.files).toHaveLength(1); expect(plan.invalidated).toHaveLength(1);
  await writeFile(path.join(f.root, "fixtures/subjects", subjectId, "src.ts"), v2);
  plan = await planApply(f.root, twoLogs); expect(plan.files).toHaveLength(0); expect(plan.invalidated).toHaveLength(1); expect(plan.revoked).toHaveLength(1);
});
it("same-source rejection revokes; changed source invalidates", async () => {
  const f = await fixture();
  expect((await planApply(f.root, logs(f.ruling, { ...f.ruling, decision: "reject" }))).revoked).toHaveLength(1);
  await writeFile(path.join(f.root, "fixtures/subjects", subjectId, "src.ts"), `${source}\n`);
  const plan = await planApply(f.root, logs(f.ruling)); expect(plan.files).toHaveLength(0); expect(plan.invalidated).toHaveLength(1);
});
it("rejects unknown run/test references, including superseded log entries", async () => {
  const f = await fixture();
  for (const wrong of [{ ...f.ruling, runId: "missing" }, { ...f.ruling, testSha256: "0".repeat(64) }]) {
    await expect(planApply(f.root, logs(wrong, f.ruling))).rejects.toThrow(/rulings.jsonl:1:.*(unknown|unaccepted)/);
  }
  expect(await readdir(f.root)).not.toContain("approved");
});
it("uses immutable staged bytes, refusing a correct-looking supplied JSON unit with a tampered staged file", async () => {
  const f = await fixture(); await writeFile(path.join(f.root, f.stagedAs), `${f.unit.text}\n`);
  await expect(planApply(f.root, logs(f.ruling))).rejects.toThrow("immutable staged bytes");
});
it("checks accepted candidate and frozen identities rather than accepting a hash-only reference", async () => {
  const f = await fixture(); f.artifact.candidates[0]!.fileSha256 = "d".repeat(64);
  await json(f.root, f.cellPath, f.artifact);
  await expect(planApply(f.root, logs(f.ruling))).rejects.toThrow("candidate identity");
});
it("takes candidate identity from the frozen cell when the run summary has a hash-deduplicated unit from another cell", async () => {
  const f = await fixture();
  f.run.units[0]!.candidateId = "another-subject:A3:0:1:1"; f.run.units[0]!.subjectId = "another-subject";
  await json(f.root, f.runPath, f.run);
  expect((await planApply(f.root, logs(f.ruling))).files).toHaveLength(1);
});
it("refuses traversal in rulings, canonical stage path violations and modified plans", async () => {
  const f = await fixture();
  await expect(planApply(f.root, logs({ ...f.ruling, subjectId: "../escape" }))).rejects.toThrow("invalid ruling");
  const plan = await planApply(f.root, logs(f.ruling)); plan.files[0]!.relative = "../escape.test.ts";
  await expect(writeApplyPlan(f.root, plan)).rejects.toThrow("modified after verification");
  const decision = f.run.gateDecisions[0]!; if (decision.decision !== "accepted") throw new Error("fixture");
  decision.stagedAs = "staged/other/anything.test.ts"; await json(f.root, f.runPath, f.run);
  f.artifact.gateDecisions = f.run.gateDecisions; await json(f.root, f.cellPath, f.artifact);
  await expect(planApply(f.root, logs(f.ruling))).rejects.toThrow("staged path is not canonical");
});
it("refuses symlink/junction ancestors and existing destinations", async () => {
  const f = await fixture(), outside = await mkdtemp(path.join(tmpdir(), "testgen-outside-")); roots.push(outside);
  await symlink(outside, path.join(f.root, "approved"), process.platform === "win32" ? "junction" : "dir");
  await expect(planApply(f.root, logs(f.ruling))).rejects.toThrow(/symlink|junction/);
  expect(await readdir(outside)).toEqual([]);
});
it("revalidates the entire batch before first write and refuses a source change after planning", async () => {
  const f = await fixture(), plan = await planApply(f.root, logs(f.ruling));
  await writeFile(path.join(f.root, "fixtures/subjects", subjectId, "src.ts"), `${source}\n`);
  await expect(writeApplyPlan(f.root, plan)).rejects.toThrow("changed after approval planning");
  expect(await readdir(f.root)).not.toContain("approved");
});
it("refuses a bad second file before creating any output for a valid first file", async () => {
  const f = await fixture(), second = await addRun(f.root, "run-two", source, candidateText.replace("café", "second"));
  const plan = await planApply(f.root, logs(f.ruling, second.ruling)); expect(plan.files).toHaveLength(2);
  await writeFile(path.join(f.root, second.stagedAs), "tampered after planning");
  await expect(writeApplyPlan(f.root, plan)).rejects.toThrow("changed after approval planning");
  expect(await readdir(f.root)).not.toContain("approved");
});
it("resolves a resumed run through canonical campaign lineage and checks its journal suite hash", async () => {
  const f = await fixture(), oldRunId = f.run.runId;
  f.run.runId = "resumed-run"; f.run.campaignId = "campaign"; f.run.split = "heldout";
  f.run.subjects[0]!.split = "heldout";
  await json(f.root, "results/mock/runs/resumed-run.json", f.run);
  const entry = { schemaVersion: 1, event: "complete", subjectId, arm: "A5", repeat: 0, runId: oldRunId,
    artifact: f.cellPath, suiteSha256: suiteHash([f.unit]), at: now };
  const journalPath = path.join(f.root, "results/campaign.journal.jsonl");
  await writeFile(journalPath, `${JSON.stringify(entry)}\n`);
  const ruling = { ...f.ruling, runId: "resumed-run" };
  expect((await planApply(f.root, logs(ruling))).files).toHaveLength(1);
  await writeFile(journalPath, `${JSON.stringify({ ...entry, suiteSha256: "c".repeat(64) })}\n`);
  await expect(planApply(f.root, logs(ruling))).rejects.toThrow("frozen suite disagree");
});
it("refuses an ancestor swapped to a junction after planning without writing through it", async () => {
  const f = await fixture(), plan = await planApply(f.root, logs(f.ruling));
  const outside = await mkdtemp(path.join(tmpdir(), "testgen-swap-")); roots.push(outside);
  await symlink(outside, path.join(f.root, "approved"), process.platform === "win32" ? "junction" : "dir");
  await expect(writeApplyPlan(f.root, plan)).rejects.toThrow(/symlink|junction/);
  expect(await readdir(outside)).toEqual([]);
});
it("no ruling files is a concrete default-handler refusal; --write is independent of execution", async () => {
  const f = await fixture(), output: string[] = [];
  await expect(applyCommand({ repoRoot: f.root, args: parseArgs(["apply"]), stdout: (line) => output.push(line), stderr: () => {} }))
    .rejects.toThrow("requires --rulings");
  expect(() => parseArgs(["apply", "--execute"])).toThrow("execution modes are invalid");
  expect(() => parseArgs(["run", "--rulings", "a.jsonl"])).toThrow("only valid for apply");
});
