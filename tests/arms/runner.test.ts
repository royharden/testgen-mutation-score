/** Authored only: injected execution/provider results, no subject/process/container execution. */
import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runExperiment, runModelCell, recoverFrozenCell, CellArtifactSchema, suiteHash } from "../../cli/arms/runner.js";
import { emptyGateState } from "../../cli/core/gate.js";
import { normalizeMutations } from "../../cli/engines/engine.js";
import type { IsolatedRunRequest, FeedbackExecutor } from "../../cli/engines/engine.js";
import type { ExecutionResult, MutantInventory } from "../../cli/core/schemas.js";
import { sha256Hex } from "../../cli/core/mutantKey.js";
import { BudgetExceeded } from "../../cli/ledger/callledger.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const now = () => "2026-10-24T00:00:00Z";
const source = "export function add(value: number): number {\n  const delta = 1;\n  return value + delta;\n}\n";
const hand = 'import {test,expect} from "vitest";\nimport {add} from "./src";\ntest("adds",()=>{expect(add(1)).toBe(2);});';
const raw = [
  { relFile: "src.ts", range: { start: { line: 3, column: 16 }, end: { line: 3, column: 17 } }, mutator: "Arithmetic", replacement: "-" },
  { relFile: "src.ts", range: { start: { line: 2, column: 17 }, end: { line: 2, column: 18 } }, mutator: "NumericBoundary", replacement: "0" },
];
function inventory(id: string): MutantInventory {
  const mutants = normalizeMutations(source, "inhouse", raw);
  return { schemaVersion: 1, subjectId: id, srcSha256: sha256Hex(source), engine: "inhouse", engineVersion: "1", createdAt: now(), seed: 1,
    mutants, partition: { feedback: [mutants[0]!.key], scoring: [mutants[1]!.key] }, reservedGroups: [], compileErrorCount: 0, duplicatesRemoved: 0 };
}
function result(request: IsolatedRunRequest): ExecutionResult {
  const killed = request.target.kind === "planted";
  return { ...request.target, unitSha256s: request.units.map((u) => u.unitSha256), outcome: killed ? "failed" : "passed", durationMs: 1,
    shuffleSeed: request.shuffleSeed ?? null, tests: request.units.map((u) => ({ name: u.testName, unitSha256: u.unitSha256,
      status: killed ? "failed" : "passed", cause: killed ? "assertion" : null })), outputTruncated: false,
    ...("mutantKey" in request.target || request.target.kind === "planted" ? { mutantStatus: killed ? "Killed" : "Survived", killCause: killed ? "assertion" : null } : {}),
    ...(request.target.kind === "coverage" ? { coveredLines: [3] } : {}) } as ExecutionResult;
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "testgen-runner-")); roots.push(root);
  const entries = [];
  for (const id of ["dev-subject", "held-subject"]) {
    const dir = path.join(root, "fixtures/subjects", id); await mkdir(dir, { recursive: true });
    const traps = JSON.stringify({ schemaVersion: 1, subjectId: id, traps: [{ id: "canary", trap: "canary", file: "src.ts",
      range: raw[0]!.range, original: "+", replacement: "-", label: "killable" }] });
    for (const [file, text] of [["src.ts", source], ["hand.test.ts", hand], ["twin.ts", source], ["traps.json", traps]]) await writeFile(path.join(dir, file!), text!, "utf8");
    entries.push({ id, sha256: { src: sha256Hex(source), hand: sha256Hex(hand), twin: sha256Hex(source), traps: sha256Hex(traps) } });
    await mkdir(path.join(root, "results/mutants"), { recursive: true });
    await writeFile(path.join(root, "results/mutants", `${id}.json`), JSON.stringify(inventory(id)));
  }
  await mkdir(path.join(root, "gold")); await mkdir(path.join(root, "fixtures/replay")); await mkdir(path.join(root, "cli/ledger"), { recursive: true });
  await writeFile(path.join(root, "fixtures/replay/index.json"), '{"schemaVersion":1,"fixtures":[]}');
  await writeFile(path.join(root, "cli/ledger/prices.json"), "{}");
  await writeFile(path.join(root, "gold/manifest.json"), JSON.stringify({ schemaVersion: 1, edition: 1, splitMethod: "seeded-hash", splitRationale: "test fixture",
    seed: 1, freezeDate: "2026-10-24", dev: [entries[0]], heldout: [entries[1]] }));
  return root;
}

it("budget-blocked journal contains only schema fields and retains missing cell instead of throwing", async () => {
  const root = await fixture();
  const run = await runExperiment({ root, split: "heldout", arms: ["A3", "A4"], repeats: 1, campaignId: "budget-campaign", heldoutConfirm: true,
    model: "mock-replay", maxOutputTokens: 100, sandbox: "docker", now,
    provider: { mode: "mock", async generate() { throw new BudgetExceeded("bounded injected cap"); } }, run: { async run(request) { return result(request); } } });
  expect(run.status).toBe("partial-budget"); expect(run.exitCode).toBe(5); expect(run.missingCells).toHaveLength(2);
  const journal = (await readFile(path.join(root, "results/budget-campaign.journal.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(journal.at(-1)).toMatchObject({ event: "budget-blocked", subjectId: "held-subject", arm: "A3" });
  expect(journal.at(-1)).not.toHaveProperty("entry");
});

it("red pristine hand preflight records refusal before any model call", async () => {
  const root = await fixture(); let calls = 0;
  const record = await runExperiment({ root, split: "dev", arms: ["A3"], repeats: 1, heldoutConfirm: false,
    model: "mock-replay", maxOutputTokens: 100, sandbox: "docker", now,
    provider: { mode: "mock", async generate() { calls++; throw new Error("must not call"); } },
    run: { async run(request) { return { ...result(request), outcome: "failed", tests: request.units.map((u) => ({ name: u.testName,
      unitSha256: u.unitSha256, status: "failed", cause: "assertion" })) }; } } });
  expect(record.status).toBe("refused"); expect(record.exitCode).toBe(2); expect(calls).toBe(0);
  expect(record.refusal?.reason).toContain("hand suite fails pristine");
});

it("failed scorer is retained before terminal journal and resume never repeats model generation", async () => {
  const root = await fixture(); let calls = 0;
  const provider = { mode: "mock" as const, async generate() { calls++; return { output: { testFile: hand }, usage: null }; } };
  const options = { root, split: "heldout" as const, arms: ["A3" as const], repeats: 1, campaignId: "score-campaign", heldoutConfirm: true,
    model: "mock-replay", maxOutputTokens: 100, sandbox: "docker" as const, now, provider,
    run: { async run(request: IsolatedRunRequest) { if (request.target.kind === "scoring-mutant") throw new Error("injected scorer failure"); return result(request); } } };
  const first = await runExperiment(options); expect(first.status).toBe("partial-error"); expect(first.runErrors[0]?.message).toContain("post-freeze");
  expect((await readFile(path.join(root, "results/score-campaign.journal.jsonl"), "utf8"))).toContain('"event":"error"');
  const resumed = await runExperiment({ ...options, resume: "score-campaign" }); expect(resumed.cells[0]?.state).toBe("error"); expect(calls).toBe(1);
});

it("an interrupted durable frozen loop repairs scoring only, while missing loop refuses", async () => {
  const root = await fixture(), inv = inventory("held-subject");
  const frozen = { schemaVersion: 1 as const, runId: "old-run", subjectId: "held-subject", arm: "A0" as const, repeat: 0,
    inventorySha256: sha256Hex(JSON.stringify(inv)), subjectSha256: sha256Hex(source), frozenSuiteSha256: suiteHash([]), units: [], unsupportedA1: [] };
  const artifact = CellArtifactSchema.parse({ schemaVersion: 1, cell: { subjectId: "held-subject", arm: "A0", repeat: 0, state: "complete", reason: null,
    rounds: 0, keptUnits: [], roundWallMs: [], inputTokens: 0, outputTokens: 0, usd: 0 }, candidates: [], units: [], gateDecisions: [], runErrors: [], loopExecutions: [], frozen });
  for (const type of ["loops", "frozen"]) {
    const dir = path.join(root, "results/mock", type, "old-run"); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "held-subject-A0-0.json"), JSON.stringify(type === "loops" ? artifact : frozen));
  }
  const kinds: string[] = [];
  const input = { root, modeRoot: "results/mock", started: { schemaVersion: 1 as const, event: "started" as const, subjectId: "held-subject",
    arm: "A0" as const, repeat: 0, runId: "old-run", artifact: null, suiteSha256: null, at: now() }, inventory: inv, source, twin: source,
    traps: { schemaVersion: 1 as const, subjectId: "held-subject", traps: [] }, now,
    run: { async run(request: IsolatedRunRequest) { kinds.push(request.target.kind); return result(request); } } };
  await recoverFrozenCell(input); expect(kinds).toEqual(["scoring-mutant"]);
  await expect(recoverFrozenCell({ ...input, started: { ...input.started, runId: "missing-run" } })).rejects.toThrow("generation will not be resent");
});

it("A3 sends exactly one prompt; A5 retains three feedback-only rounds and fresh state", async () => {
  const requests: string[] = [];
  const executor: FeedbackExecutor = { async execute(request) {
    if (request.kind === "feedback") return [];
    return [result({ sourceText: source, units: request.units, target: request.kind === "pristine" ? { kind: "pristine", attempt: request.attempt } : { kind: request.kind },
      ...(request.kind === "pristine-union" ? { shuffleSeed: request.shuffleSeed } : {}) }) as never];
  } };
  const deps = { executor, staging: { async commit() { return []; } }, snapshotProtected: async () => ({ source: "s", hand: "h", twin: "t" }), now,
    provider: { mode: "mock" as const, async generate(request: { prompt: { text: string } }) { requests.push(request.prompt.text); return { output: { testFile: "broken (" }, usage: null }; } } };
  const input = { subjectId: "dev-subject", repeat: 0, source, seed: 1, model: "mock-replay", maxOutputTokens: 100, initialState: emptyGateState(), feedbackMutants: [] };
  await runModelCell({ ...input, arm: "A3" }, deps); expect(requests).toHaveLength(1);
  requests.length = 0; const generated = await runModelCell({ ...input, arm: "A5" }, deps);
  expect(requests).toHaveLength(3); expect(generated.state.keptUnits).toEqual([]);
  expect(requests.join("\n")).not.toContain("twin.ts");
});
