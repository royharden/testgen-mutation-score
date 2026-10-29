/** Authored artifact journey with injected runners; no subject or process is executed by this test. */
import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runExperiment } from "../../cli/arms/runner.js";
import { normalizeMutations } from "../../cli/engines/engine.js";
import type { ExecutionResult } from "../../cli/core/schemas.js";
import { PublicAnalysisSchema } from "../../cli/core/schemas.js";
import { sha256Hex } from "../../cli/core/mutantKey.js";
import { evalCommand, publishRunAnalysis } from "../../cli/evalkit/command.js";
import { parseArgs } from "../../cli/index.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const now = () => "2026-10-24T00:00:00Z";
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "testgen-eval-")); roots.push(root);
  const source = "export function add(value: number): number {\n  const delta = 1;\n  return value + delta;\n}\n";
  const hand = 'import {test,expect} from "vitest";\nimport {add} from "./src";\ntest("adds",()=>{expect(add(1)).toBe(2);});';
  const mutations = normalizeMutations(source, "inhouse", [
    { relFile: "src.ts", range: { start: { line: 3, column: 16 }, end: { line: 3, column: 17 } }, mutator: "Arithmetic", replacement: "-" },
    { relFile: "src.ts", range: { start: { line: 2, column: 17 }, end: { line: 2, column: 18 } }, mutator: "Number", replacement: "0" }]);
  const entries = [];
  for (const id of ["dev-subject", "held-subject"]) {
    const traps = JSON.stringify({ schemaVersion: 1, subjectId: id, traps: [{ id: "canary", trap: "canary", file: "src.ts",
      range: mutations[0]!.range, original: "+", replacement: "-", label: "killable" }] });
    const files = { "src.ts": source, "hand.test.ts": hand, "twin.ts": source, "traps.json": traps };
    await mkdir(path.join(root, "fixtures/subjects", id), { recursive: true });
    for (const [file, text] of Object.entries(files)) await writeFile(path.join(root, "fixtures/subjects", id, file), text);
    entries.push({ id, sha256: { src: sha256Hex(source), hand: sha256Hex(hand), twin: sha256Hex(source), traps: sha256Hex(traps) } });
    await mkdir(path.join(root, "results/mutants"), { recursive: true });
    await writeFile(path.join(root, `results/mutants/${id}.json`), JSON.stringify({ schemaVersion: 1, subjectId: id,
      srcSha256: sha256Hex(source), engine: "inhouse", engineVersion: "fixture", createdAt: now(), seed: 39,
      mutants: mutations, partition: { feedback: [mutations[0]!.key], scoring: [mutations[1]!.key] },
      reservedGroups: [], compileErrorCount: 0, duplicatesRemoved: 0 }));
  }
  await mkdir(path.join(root, "gold"));
  await writeFile(path.join(root, "gold/manifest.json"), JSON.stringify({ schemaVersion: 1, edition: 1, splitMethod: "seeded-hash",
    splitRationale: "synthetic injected fixture", seed: 39, freezeDate: "2026-10-24", dev: [entries[0]], heldout: [entries[1]] }));
  await writeFile(path.join(root, "results/results.md"), "not yet measured\n");
  const run = await runExperiment({ root, runId: "injected-run", split: "dev", arms: ["A0", "A2"], repeats: 1,
    heldoutConfirm: false, model: "mock-replay", maxOutputTokens: 100, sandbox: "docker", now,
    provider: { mode: "mock", async generate() { throw new Error("nonmodel fixture never calls"); } },
    run: { async run(request): Promise<ExecutionResult> {
      const killed = request.target.kind === "planted";
      const base = { unitSha256s: request.units.map((u) => u.unitSha256), outcome: killed ? "failed" as const : "passed" as const,
        durationMs: 1, shuffleSeed: request.shuffleSeed ?? null, outputTruncated: false,
        tests: request.units.map((u) => ({ name: u.testName, unitSha256: u.unitSha256, status: killed ? "failed" as const : "passed" as const,
          cause: killed ? "assertion" as const : null })) };
      switch (request.target.kind) {
        case "coverage": return { kind: "coverage", ...base, coveredLines: request.units.length ? [3] : [], executableLines: [2, 3] };
        case "pristine": return { ...request.target, ...base };
        case "pristine-union": return { ...request.target, ...base };
        case "twin": return { ...request.target, ...base };
        case "planted": return { ...request.target, ...base, mutantStatus: "Killed", killCause: "assertion" };
        case "feedback-mutant": case "scoring-mutant": return { ...request.target, ...base, mutantStatus: "Survived", killCause: null };
        case "a1-capture": return { ...request.target, ...base, observations: [] };
      }
    } } });
  return { root, run };
}

it("derives frozen rows and real coverage, writes MOCK reports, preserves measured placeholder and publishes sanitized companion", async () => {
  const { root, run } = await fixture(), stdout: string[] = [];
  const analysis = await publishRunAnalysis(root, run);
  expect(analysis.cells.find((c) => c.arm === "A0")?.row?.lineCoverage).toBe(0);
  expect(analysis.cells.find((c) => c.arm === "A2")?.row?.lineCoverage).toBe(.5);
  expect(analysis.cells.find((c) => c.arm === "A2")?.row?.overfit.rate).toBe(0);
  expect(await evalCommand({ repoRoot: root, args: parseArgs(["eval", run.runId]), stdout: (line) => stdout.push(line), stderr: () => {} })).toBe(5);
  expect(await readFile(path.join(root, "results/results.md"), "utf8")).toBe("not yet measured\n");
  expect(await readFile(path.join(root, "results/mock/dev/results.md"), "utf8")).toContain("MOCK / REPLAY");
  expect(stdout[0]).toContain("incomplete campaign");
  const publicJson = await readFile(path.join(root, `public/analysis/${run.runId}.json`), "utf8");
  expect(PublicAnalysisSchema.parse(JSON.parse(publicJson)).providerMode).toBe("mock");
  expect(publicJson).not.toContain(root); expect(publicJson).not.toContain("environment");
  expect(JSON.stringify(run)).not.toContain("scoreRaw");
});
it("foreign scorer identity and changed frozen fixture fail closed, retaining accounting without zero-filling scores", async () => {
  const { root, run } = await fixture();
  const scoringPath = path.join(root, `results/mock/scoring/${run.runId}/dev-subject-A2-0.json`);
  const scoring = JSON.parse(await readFile(scoringPath, "utf8")) as Record<string, unknown>;
  await writeFile(scoringPath, JSON.stringify({ ...scoring, repeat: 2 }));
  let analysis = await publishRunAnalysis(root, run);
  expect(analysis.cells.find((c) => c.arm === "A2")).toMatchObject({ state: "incomplete", row: null, issues: ["invalid-artifact"] });
  await writeFile(path.join(root, "fixtures/subjects/dev-subject/twin.ts"), "changed frozen twin\n");
  analysis = await publishRunAnalysis(root, run);
  expect(analysis.cells.every((c) => c.row === null)).toBe(true);
});
