/** Trusted orchestration owns inventory/scoring. runModelCell receives a feedback-only capability. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { a0 } from "./a0.js";
import { a2 } from "./a2.js";
import { a3 } from "./a3.js";
import { a4 } from "./a4.js";
import { a5 } from "./a5.js";
import { a6 } from "./a6.js";
import { characterise } from "../core/a1/characterise.js";
import { gateRound } from "../core/gate.js";
import type { GateState, GateRoundResult } from "../core/gate.js";
import { buildPrompt } from "../core/prompt.js";
import type { PromptInputs } from "../core/prompt.js";
import { readManifest, readInventory, assertFixtureFreeze, subjectEntries } from "../core/inventory.js";
import { preflight, PreflightRefusal } from "../core/preflight.js";
import { FileStagingStore, protectedFilesSnapshot, assertProtectedUnchanged } from "../core/staging.js";
import type { ProtectedSnapshot, StagingStore } from "../core/staging.js";
import { sha256Hex } from "../core/mutantKey.js";
import { cellKey, openCampaign } from "../core/campaign.js";
import type { JournalEntry } from "../core/campaign.js";
import { RunRecordSchema, RunIndexSchema, RunCellSchema, RunErrorSchema, TestUnitSchema, CandidateSchema, GateDecisionSchema,
  LoopExecutionResultSchema, ScoringRecordSchema, TrapsFileSchema, RunIdSchema, Sha256HexSchema, ArmIdSchema, SlugSchema } from "../core/schemas.js";
import type { ArmId, ModelArmId, Split, RunRecord, RunCell, TestUnit, MutantRecord, MutantInventory, ScoringRecord } from "../core/schemas.js";
import { createFeedbackExecutor, createScoringExecutor, validateRunResult } from "../engines/engine.js";
import type { FeedbackExecutor, IsolatedRunner } from "../engines/engine.js";
import { executePlanted } from "../engines/patchrun.js";
import { createSandboxRunner } from "../sandbox/sandboxrun.js";
import type { ModelProvider, ProviderRequest } from "../providers/index.js";
import { BudgetExceeded } from "../ledger/callledger.js";

export const FrozenCellSuiteSchema = z.strictObject({ schemaVersion: z.literal(1), runId: RunIdSchema,
  subjectId: SlugSchema, arm: ArmIdSchema, repeat: z.number().int().nonnegative(), inventorySha256: Sha256HexSchema,
  subjectSha256: Sha256HexSchema, frozenSuiteSha256: Sha256HexSchema, units: z.array(TestUnitSchema),
  unsupportedA1: z.array(z.string()) });
export type FrozenCellSuite = z.infer<typeof FrozenCellSuiteSchema>;
export const CellArtifactSchema = z.strictObject({ schemaVersion: z.literal(1), cell: RunCellSchema,
  candidates: z.array(CandidateSchema), units: z.array(TestUnitSchema), gateDecisions: z.array(GateDecisionSchema),
  runErrors: z.array(RunErrorSchema), loopExecutions: z.array(LoopExecutionResultSchema), frozen: FrozenCellSuiteSchema });
export type CellArtifact = z.infer<typeof CellArtifactSchema>;
export const suiteHash = (units: readonly TestUnit[]) => sha256Hex(units.map((u) => u.unitSha256).sort().join("\n"));
const policies = { A3: a3, A4: a4, A5: a5, A6: a6 };

/** No scoring/trap/twin fields can reach this prompt builder. Feedback patches are already filtered. */
export function buildRoundPromptInputs(input: { subjectId: string; arm: ModelArmId; source: string; round: number;
  maxOutputTokens: number; state: GateState; feedbackMutants: readonly Pick<MutantRecord, "key" | "range" | "replacement">[] }): PromptInputs {
  const common = { subjectId: input.subjectId, arm: input.arm, source: input.source, round: input.round,
    maxOutputTokens: input.maxOutputTokens, keptTests: input.state.keptUnits.map((unit) => unit.text) };
  if (input.arm === "A3") return { ...common, arm: "A3" };
  if (input.arm === "A4") return { ...common, arm: "A4", uncoveredLines: input.source.split("\n").flatMap((line, index) =>
    line.trim() && !input.state.coveredLines.includes(index + 1) ? [index + 1] : []) };
  return { ...common, arm: input.arm, survivors: input.feedbackMutants.filter((m) => !input.state.killedFeedbackKeys.includes(m.key)).slice(0, 10)
    .map((m) => ({ key: m.key, diff: `src.ts:${m.range.start.line}:${m.range.start.column}-${m.range.end.line}:${m.range.end.column}\nreplacement: ${m.replacement}` })) };
}

export interface CellDependencies {
  executor: FeedbackExecutor; staging: StagingStore; snapshotProtected: ProtectedSnapshot; now: () => string;
  provider: ModelProvider; onPrompt?: (request: ProviderRequest) => void;
}
export async function runModelCell(input: { subjectId: string; arm: ModelArmId; repeat: number; source: string;
  seed: number; model: string; maxOutputTokens: number; initialState: GateState;
  feedbackMutants: readonly Pick<MutantRecord, "key" | "range" | "replacement">[] }, deps: CellDependencies) {
  let state: GateState = { keptUnits: [...input.initialState.keptUnits], killedFeedbackKeys: [...input.initialState.killedFeedbackKeys], coveredLines: [...input.initialState.coveredLines] };
  const rounds: GateRoundResult[] = [], roundWallMs: number[] = [];
  let inputTokens = 0, outputTokens = 0, error: unknown, budgetBlocked = false, terminalExit: 0 | 3 | 4 | 5 = 0;
  for (let round = 1; round <= policies[input.arm].rounds; round++) {
    const started = Date.now();
    const request: ProviderRequest = { context: { subjectId: input.subjectId, arm: input.arm, round, slot: 1 }, model: input.model,
      maxOutputTokens: input.maxOutputTokens, prompt: buildPrompt(buildRoundPromptInputs({ ...input, round, state })) };
    try {
      const before = await deps.snapshotProtected();
      deps.onPrompt?.(request);
      const response = await deps.provider.generate(request);
      assertProtectedUnchanged(before, await deps.snapshotProtected());
      inputTokens += response.usage?.inputTokens ?? 0; outputTokens += response.usage?.outputTokens ?? 0;
      const result = await gateRound({ subjectId: input.subjectId, arm: input.arm, repeat: input.repeat, round, slot: 1,
        candidateId: `${input.subjectId}:${input.arm}:${input.repeat}:${round}:1`, testFile: response.output.testFile,
        shuffleSeed: (input.seed + input.repeat * 31 + round) >>> 0,
        feedbackKeys: input.feedbackMutants.map((m) => m.key), state }, deps);
      rounds.push(result); state = result.state;
      if (result.exitCode !== 0) { terminalExit = result.exitCode; break; }
    } catch (caught) {
      error = caught; budgetBlocked = caught instanceof BudgetExceeded;
      terminalExit = caught instanceof Error && "exitCode" in caught && [3, 4, 5].includes(Number(caught.exitCode)) ? Number(caught.exitCode) as 3 | 4 | 5 : 3;
      break;
    } finally { roundWallMs.push(Date.now() - started); }
  }
  return { state, rounds, roundWallMs, inputTokens, outputTokens, error, budgetBlocked, terminalExit };
}

/** The only post-freeze bridge. Never handed to runModelCell, buildPrompt, or the gate. */
export async function scoreFrozenCell(input: { frozen: FrozenCellSuite; inventory: MutantInventory; source: string;
  twin: string; traps: ReturnType<typeof TrapsFileSchema.parse>; run: IsolatedRunner; now: () => string }): Promise<ScoringRecord> {
  const frozen = FrozenCellSuiteSchema.parse(input.frozen);
  if (sha256Hex(JSON.stringify(input.inventory)) !== frozen.inventorySha256 || sha256Hex(input.source) !== frozen.subjectSha256 ||
      suiteHash(frozen.units) !== frozen.frozenSuiteSha256) throw new Error("post-freeze scorer input changed");
  const results = await createScoringExecutor({ sourceText: input.source, inventory: input.inventory, run: input.run,
    frozenUnits: frozen.units, frozenSuiteSha256: frozen.frozenSuiteSha256 }).execute();
  for (const trap of input.traps.traps.filter((trap) => trap.trap !== "canary")) {
    const result = await executePlanted(input.run, input.source, frozen.units, trap);
    if (result.kind !== "planted") throw new Error("post-freeze planted result mismatch");
    results.push(result);
  }
  for (const unit of frozen.units) {
    const request = { sourceText: input.twin, units: [unit], target: { kind: "twin" as const } };
    const result = validateRunResult(await input.run.run(request), request);
    if (result.kind !== "twin") throw new Error("post-freeze twin result mismatch");
    results.push(result);
  }
  return ScoringRecordSchema.parse({ schemaVersion: 1, runId: frozen.runId, scoredAt: input.now(), subjectId: frozen.subjectId,
    arm: frozen.arm, repeat: frozen.repeat, suiteUnits: frozen.units.map((u) => u.unitSha256), results });
}

export interface ExperimentOptions {
  root: string; split: Split; subjectIds?: readonly string[]; arms: readonly ArmId[]; repeats: number; runId?: string;
  campaignId?: string; resume?: string; heldoutConfirm: boolean; model: string; maxOutputTokens: number;
  sandbox: "docker" | "none"; provider: ModelProvider; run: IsolatedRunner; now?: () => string;
  /** Persistent ledger snapshots include failed and explicitly retried paid calls. */
  accounting?: () => { inputTokens: number; outputTokens: number; usd: number; unknownUsageCalls?: number };
  frozenConfig?: unknown; onPrompt?: (request: ProviderRequest) => void;
  onScoring?: (records: readonly ScoringRecord[]) => void;
}
const uniqueUnits = (units: readonly TestUnit[]) => [...new Map(units.map((unit) => [unit.unitSha256, unit])).values()];
async function writeNewJson(root: string, relative: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
export async function publishRunRecord(root: string, record: RunRecord): Promise<void> {
  const run = RunRecordSchema.parse(record), modeRoot = run.providerMode === "mock" ? "results/mock" : "results/measured";
  await writeNewJson(root, `${modeRoot}/runs/${run.runId}.json`, run);
  await writeNewJson(root, `public/runs/${run.runId}.json`, run);
  const indexPath = path.join(root, "public/runs/index.json");
  let index: ReturnType<typeof RunIndexSchema.parse> = { schemaVersion: 1, runs: [] };
  try { index = RunIndexSchema.parse(JSON.parse(await readFile(indexPath, "utf8"))); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (!index.runs.includes(run.runId)) index.runs.push(run.runId);
  await writeFile(indexPath, `${JSON.stringify(RunIndexSchema.parse(index), null, 2)}\n`, "utf8");
}
/** An interrupted frozen loop may repair scoring; an unfrozen/ambiguous loop is never regenerated. */
export async function recoverFrozenCell(input: { root: string; modeRoot: string; started: JournalEntry;
  inventory: MutantInventory; source: string; twin: string; traps: ReturnType<typeof TrapsFileSchema.parse>;
  run: IsolatedRunner; now: () => string; onScoring?: (records: readonly ScoringRecord[]) => void }): Promise<{ artifact: CellArtifact; relative: string }> {
  const name = `${input.started.subjectId}-${input.started.arm}-${input.started.repeat}.json`;
  const relative = `${input.modeRoot}/cells/${input.started.runId}/${name}`;
  try {
    const final = CellArtifactSchema.parse(JSON.parse(await readFile(path.join(input.root, relative), "utf8")));
    if (cellKey(final.cell) !== cellKey(input.started) || final.frozen.inventorySha256 !== sha256Hex(JSON.stringify(input.inventory)) ||
        final.frozen.subjectSha256 !== sha256Hex(input.source) || suiteHash(final.frozen.units) !== final.frozen.frozenSuiteSha256)
      throw new PreflightRefusal("retained cell artifact differs from its frozen inputs");
    return { artifact: final, relative };
  } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  let artifact: CellArtifact;
  try {
    artifact = CellArtifactSchema.parse(JSON.parse(await readFile(path.join(input.root, `${input.modeRoot}/loops/${input.started.runId}/${name}`), "utf8")));
    const frozen = FrozenCellSuiteSchema.parse(JSON.parse(await readFile(path.join(input.root, `${input.modeRoot}/frozen/${input.started.runId}/${name}`), "utf8")));
    if (cellKey(artifact.cell) !== cellKey(input.started) || JSON.stringify(artifact.frozen) !== JSON.stringify(frozen)) throw new Error("frozen loop mismatch");
  } catch { throw new PreflightRefusal("interrupted started cell has no complete durable frozen loop; reconcile ledger/artifacts before resume; generation will not be resent"); }
  if (!artifact.runErrors.length && artifact.cell.state === "complete") {
    const scoreRelative = `${input.modeRoot}/scoring/${input.started.runId}/${name}`;
    try {
      let score: ScoringRecord;
      try {
        score = ScoringRecordSchema.parse(JSON.parse(await readFile(path.join(input.root, scoreRelative), "utf8")));
        if (score.runId !== artifact.frozen.runId || score.subjectId !== artifact.cell.subjectId || score.arm !== artifact.cell.arm || score.repeat !== artifact.cell.repeat ||
            suiteHash(artifact.frozen.units) !== artifact.frozen.frozenSuiteSha256 || score.suiteUnits.join("\n") !== artifact.frozen.units.map((u) => u.unitSha256).join("\n")) throw new Error("retained scorer mismatch");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        score = await scoreFrozenCell({ ...input, frozen: artifact.frozen });
        await writeNewJson(input.root, scoreRelative, score);
      }
      input.onScoring?.([score]);
    } catch {
      artifact.cell.state = "error"; artifact.cell.reason = "post-freeze scoring recovery error";
      artifact.runErrors.push(RunErrorSchema.parse({ type: "run-error", kind: "runner-crash", fatal: true,
        subjectId: artifact.cell.subjectId, arm: artifact.cell.arm, repeat: artifact.cell.repeat, round: null, candidateId: null,
        message: "post-freeze scoring recovery failed; no generation was repeated", at: input.now(), rolledBack: [] }));
    }
  }
  await writeNewJson(input.root, relative, CellArtifactSchema.parse(artifact));
  return { artifact, relative };
}
export async function runExperiment(options: ExperimentOptions): Promise<RunRecord> {
  if (options.provider.mode !== "mock" && options.sandbox !== "docker") throw new PreflightRefusal("paid experiments require Docker");
  const manifest = await readManifest(options.root), now = options.now ?? (() => new Date().toISOString());
  await assertFixtureFreeze(options.root, manifest);
  const entries = subjectEntries(manifest, options.split).filter((entry) => !options.subjectIds || options.subjectIds.includes(entry.id));
  if (!entries.length || options.subjectIds?.some((id) => !entries.some((entry) => entry.id === id))) throw new PreflightRefusal("subjects must belong to selected split");
  if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 3) throw new PreflightRefusal("repeats must be 1..3");
  const runId = RunIdSchema.parse(options.runId ?? `run-${randomUUID()}`);
  const campaignId = options.split === "heldout" ? RunIdSchema.parse(options.resume ?? options.campaignId ?? `campaign-${randomUUID()}`) : null;
  const campaign = campaignId ? await openCampaign({ root: options.root, campaignId, ...(options.resume ? { resume: options.resume } : {}),
    confirm: options.heldoutConfirm, config: options.frozenConfig ?? { split: options.split, subjects: entries.map((e) => e.id), arms: options.arms,
      repeats: options.repeats, model: options.model, maxOutputTokens: options.maxOutputTokens, sandbox: options.sandbox, provider: options.provider.mode }, now }) : null;
  const modeRoot = options.provider.mode === "mock" ? "results/mock" : "results/measured";
  const artifacts: CellArtifact[] = [];
  const missing: RunRecord["missingCells"] = [];
  let budgetBlocked = false, exitCode: 0 | 3 | 4 | 5 = 0;
  const tasks = entries.flatMap((entry) => options.arms.flatMap((arm) => Array.from({ length: ["A0", "A1", "A2"].includes(arm) ? 1 : options.repeats }, (_, repeat) => ({ entry, subjectId: entry.id, arm, repeat }))));
  // Every selected subject must pass all preflight checks before the first paid/model call.
  const prepared = new Map<string, { source: string; hand: TestUnit[]; inventory: MutantInventory;
    feedback: FeedbackExecutor; snapshot: ProtectedSnapshot; traps: ReturnType<typeof TrapsFileSchema.parse> }>();
  try { for (const entry of entries) {
    const base = path.join(options.root, "fixtures/subjects", entry.id), source = await readFile(path.join(base, "src.ts"), "utf8");
    const inventory = await readInventory(options.root, entry.id);
    if (!inventory) throw new PreflightRefusal(`not inventoried: ${entry.id}`);
    if (prepared.size && inventory.engine !== [...prepared.values()][0]!.inventory.engine) throw new PreflightRefusal("one generated-mutant engine is required per experiment");
    const traps = TrapsFileSchema.parse(JSON.parse(await readFile(path.join(base, "traps.json"), "utf8")));
    const feedback = createFeedbackExecutor({ sourceText: source, inventory, run: options.run });
    const snapshot = protectedFilesSnapshot({ source: path.join(base, "src.ts"), hand: path.join(base, "hand.test.ts"), twin: path.join(base, "twin.ts") });
    const before = await snapshot();
    const hand = await preflight({ source, hand: await readFile(path.join(base, "hand.test.ts"), "utf8"), inventory,
      canary: traps.traps.find((trap) => trap.trap === "canary")!, feedback, run: options.run });
    assertProtectedUnchanged(before, await snapshot());
    prepared.set(entry.id, { source, hand, inventory, feedback, snapshot, traps });
  } } catch (error) {
    const refused = RunRecordSchema.parse({ schemaVersion: 1, runId, createdAt: now(), providerMode: options.provider.mode,
      executionProvenance: options.provider.mode === "mock" ? "replay-executed" : "measured", status: "refused", exitCode: 2,
      split: options.split, campaignId, sandbox: options.sandbox, sandboxQualified: options.sandbox === "docker", model: options.model,
      engine: null, seed: manifest.seed, manifestEdition: manifest.edition, subjects: entries.map((entry) => ({ id: entry.id, split: entry.split, srcSha256: entry.sha256.src })),
      arms: [...options.arms], candidates: [], units: [], gateDecisions: [], runErrors: [], cells: [], missingCells: [],
      refusal: { reason: error instanceof PreflightRefusal ? error.message : "subject preflight could not produce validated evidence", subjectId: null },
      totals: { inputTokens: 0, outputTokens: 0, usd: options.provider.mode === "mock" ? 0 : null } });
    await publishRunRecord(options.root, refused); return refused;
  }
  for (const task of tasks) {
    const key = cellKey(task);
    const started = campaign?.started.get(key);
    if (started && campaign) {
      const preparedSubject = prepared.get(task.subjectId)!;
      const recovery = await recoverFrozenCell({ root: options.root, modeRoot, started, inventory: preparedSubject.inventory,
        source: preparedSubject.source, twin: await readFile(path.join(options.root, "fixtures/subjects", task.subjectId, "twin.ts"), "utf8"),
        traps: preparedSubject.traps, run: options.run, now, ...(options.onScoring ? { onScoring: options.onScoring } : {}) });
      await campaign.append({ event: recovery.artifact.cell.state === "complete" ? "complete" : recovery.artifact.cell.state === "missing" ? "budget-blocked" : "error",
        subjectId: task.subjectId, arm: task.arm, repeat: task.repeat, runId: started.runId,
        artifact: recovery.relative, suiteSha256: recovery.artifact.frozen.frozenSuiteSha256 });
    }
    const observed = campaign?.observed.get(key);
    if (observed) {
      if (!observed.artifact || !observed.artifact.startsWith(`${modeRoot}/cells/`) || observed.artifact.includes("..") || observed.artifact.includes("\\")) throw new PreflightRefusal("invalid campaign artifact path");
      const artifact = CellArtifactSchema.parse(JSON.parse(await readFile(path.join(options.root, observed.artifact), "utf8")));
      if (cellKey(artifact.cell) !== key || artifact.frozen.frozenSuiteSha256 !== observed.suiteSha256 || suiteHash(artifact.frozen.units) !== observed.suiteSha256)
        throw new PreflightRefusal("campaign cell artifact differs from journal");
      artifacts.push(artifact);
      if (artifact.cell.state === "missing") {
        missing.push({ subjectId: task.subjectId, arm: task.arm, repeat: task.repeat, reason: artifact.cell.reason ?? "budget cap" });
        budgetBlocked = true;
      }
      if (artifact.cell.state === "error") exitCode = 5;
      continue;
    }
    if (budgetBlocked || exitCode === 3 || exitCode === 4) { missing.push({ subjectId: task.subjectId, arm: task.arm, repeat: task.repeat, reason: budgetBlocked ? "budget cap" : "protocol abort" }); continue; }
    await campaign?.append({ event: "started", subjectId: task.subjectId, arm: task.arm, repeat: task.repeat, runId, artifact: null, suiteSha256: null });
    const preparedSubject = prepared.get(task.subjectId)!;
    const { source, hand, inventory, feedback, snapshot, traps } = preparedSubject;
    const before = await snapshot(), accountBefore = options.accounting?.();
    let state = task.arm === "A2" || task.arm === "A6" ? a2(hand) : a0();
    const rounds: GateRoundResult[] = [], unsupportedA1: string[] = [], roundWallMs: number[] = [];
    let cellError: unknown, inputTokens = 0, outputTokens = 0;
    const staging = new FileStagingStore(options.root, task.subjectId);
    try {
      if (task.arm === "A1") {
        const generated = await characterise(source, manifest.seed, options.run);
        unsupportedA1.push(...generated.unsupported);
        for (const [index, testFile] of generated.testFiles.entries()) {
          const started = Date.now();
          const result = await gateRound({ subjectId: task.subjectId, arm: "A1", repeat: 0, round: index + 1, slot: 1,
            candidateId: `${task.subjectId}:A1:0:${index + 1}:1`, testFile, shuffleSeed: (manifest.seed + index) >>> 0,
            feedbackKeys: inventory.partition.feedback, state }, { executor: feedback, staging, snapshotProtected: snapshot, now });
          rounds.push(result); state = result.state; roundWallMs.push(Date.now() - started);
          if (result.exitCode) { exitCode = result.exitCode; break; }
        }
      } else if (task.arm !== "A0" && task.arm !== "A2") {
        if (task.arm === "A6") {
          const killed = new Set<string>();
          for (const unit of hand) for (const result of await feedback.execute({ kind: "feedback", unit }))
            if (result.kind === "feedback-mutant" && result.mutantStatus === "Killed") killed.add(result.mutantKey);
          state = { ...state, killedFeedbackKeys: [...killed] };
        }
        const result = await runModelCell({ subjectId: task.subjectId, arm: task.arm, repeat: task.repeat, source, seed: manifest.seed,
          model: options.model, maxOutputTokens: options.maxOutputTokens, initialState: state,
          feedbackMutants: inventory.mutants.filter((m) => inventory.partition.feedback.includes(m.key)) },
        { executor: feedback, staging, snapshotProtected: snapshot, now, provider: options.provider, ...(options.onPrompt ? { onPrompt: options.onPrompt } : {}) });
        state = result.state; rounds.push(...result.rounds); roundWallMs.push(...result.roundWallMs);
        inputTokens = result.inputTokens; outputTokens = result.outputTokens; cellError = result.error;
        if (result.budgetBlocked) budgetBlocked = true;
        if (result.terminalExit) exitCode = result.terminalExit;
      }
      assertProtectedUnchanged(before, await snapshot());
    } catch (error) { cellError = error; exitCode = 3; }
    const errors = rounds.flatMap((round) => round.runErrors);
    if (cellError && !budgetBlocked) {
      const kind = cellError instanceof Error && "kind" in cellError ? RunErrorSchema.shape.kind.safeParse(cellError.kind) : null;
      errors.push(RunErrorSchema.parse({ type: "run-error", kind: kind?.success ? kind.data : "runner-crash", fatal: exitCode === 3 || exitCode === 4,
        subjectId: task.subjectId, arm: task.arm, repeat: task.repeat, round: null, candidateId: null,
        message: "cell aborted; provider transport and raw sandbox diagnostics omitted", at: now(), rolledBack: [] }));
    }
    const accountAfter = options.accounting?.();
    if (accountAfter && accountBefore && (accountAfter.unknownUsageCalls ?? 0) > (accountBefore.unknownUsageCalls ?? 0)) {
      errors.push(RunErrorSchema.parse({ type: "run-error", kind: "provider-schema", fatal: false, subjectId: task.subjectId,
        arm: task.arm, repeat: task.repeat, round: null, candidateId: null,
        message: "provider usage unavailable; token totals include only reported usage and USD includes conservative reservations", at: now(), rolledBack: [] }));
      if (exitCode === 0) exitCode = 5;
    }
    const cell: RunCell = RunCellSchema.parse({ subjectId: task.subjectId, arm: task.arm, repeat: task.repeat,
      state: budgetBlocked ? "missing" : errors.length ? "error" : "complete", reason: budgetBlocked ? "budget cap" : errors.length ? "cell run error" : null,
      rounds: rounds.length, keptUnits: state.keptUnits.map((u) => u.unitSha256), roundWallMs,
      inputTokens: accountAfter && accountBefore ? accountAfter.inputTokens - accountBefore.inputTokens : inputTokens,
      outputTokens: accountAfter && accountBefore ? accountAfter.outputTokens - accountBefore.outputTokens : outputTokens,
      usd: accountAfter && accountBefore ? accountAfter.usd - accountBefore.usd : options.provider.mode === "mock" ? 0 : null });
    const frozen = FrozenCellSuiteSchema.parse({ schemaVersion: 1, runId, subjectId: task.subjectId, arm: task.arm, repeat: task.repeat,
      inventorySha256: sha256Hex(JSON.stringify(inventory)), subjectSha256: sha256Hex(source), frozenSuiteSha256: suiteHash(state.keptUnits),
      units: state.keptUnits, unsupportedA1 });
    // Durable suite freeze precedes every post-freeze execution, even if scoring later fails.
    await writeNewJson(options.root, `${modeRoot}/frozen/${runId}/${task.subjectId}-${task.arm}-${task.repeat}.json`, frozen);
    await writeNewJson(options.root, `${modeRoot}/loops/${runId}/${task.subjectId}-${task.arm}-${task.repeat}.json`, CellArtifactSchema.parse({
      schemaVersion: 1, cell, candidates: rounds.flatMap((r) => r.candidates), units: uniqueUnits([...state.keptUnits, ...rounds.flatMap((r) => r.units)]),
      gateDecisions: rounds.flatMap((r) => r.gateDecisions), runErrors: errors, loopExecutions: rounds.flatMap((r) => r.executions), frozen }));
    if (!errors.length && !budgetBlocked) {
      try {
        const score = await scoreFrozenCell({ frozen, inventory, source, twin: await readFile(path.join(options.root, "fixtures/subjects", task.subjectId, "twin.ts"), "utf8"), traps, run: options.run, now });
        await writeNewJson(options.root, `${modeRoot}/scoring/${runId}/${task.subjectId}-${task.arm}-${task.repeat}.json`, score);
        options.onScoring?.([score]);
      } catch {
        errors.push(RunErrorSchema.parse({ type: "run-error", kind: "runner-crash", fatal: true, subjectId: task.subjectId,
          arm: task.arm, repeat: task.repeat, round: null, candidateId: null, message: "post-freeze scoring failed; frozen suite retained", at: now(), rolledBack: [] }));
        cell.state = "error"; cell.reason = "post-freeze scoring error"; exitCode = 3;
      }
    }
    const artifact = CellArtifactSchema.parse({ schemaVersion: 1, cell, candidates: rounds.flatMap((r) => r.candidates),
      units: uniqueUnits([...state.keptUnits, ...rounds.flatMap((r) => r.units)]), gateDecisions: rounds.flatMap((r) => r.gateDecisions),
      runErrors: errors, loopExecutions: rounds.flatMap((r) => r.executions), frozen });
    artifacts.push(artifact);
    const relative = `${modeRoot}/cells/${runId}/${task.subjectId}-${task.arm}-${task.repeat}.json`;
    await writeNewJson(options.root, relative, artifact);
    if (budgetBlocked) {
      missing.push({ subjectId: task.subjectId, arm: task.arm, repeat: task.repeat, reason: "budget cap" });
      await campaign?.append({ event: "budget-blocked", subjectId: task.subjectId, arm: task.arm, repeat: task.repeat,
        runId, artifact: relative, suiteSha256: frozen.frozenSuiteSha256 });
      continue;
    }
    await campaign?.append({ event: errors.length ? "error" : "complete", subjectId: task.subjectId, arm: task.arm,
      repeat: task.repeat, runId, artifact: relative, suiteSha256: frozen.frozenSuiteSha256 });
  }
  const cells = artifacts.map((artifact) => artifact.cell);
  const run = RunRecordSchema.parse({ schemaVersion: 1, runId, createdAt: now(), providerMode: options.provider.mode,
    executionProvenance: options.provider.mode === "mock" ? "replay-executed" : "measured", status: budgetBlocked ? "partial-budget" : exitCode ? "partial-error" : "complete",
    exitCode: budgetBlocked ? 5 : exitCode, split: options.split, campaignId, sandbox: options.sandbox,
    sandboxQualified: options.sandbox === "docker", model: options.model, engine: prepared.values().next().value?.inventory.engine ?? null,
    seed: manifest.seed, manifestEdition: manifest.edition, subjects: entries.map((entry) => ({ id: entry.id, split: entry.split, srcSha256: entry.sha256.src })), arms: [...options.arms],
    candidates: artifacts.flatMap((a) => a.candidates), units: uniqueUnits(artifacts.flatMap((a) => a.units)), gateDecisions: artifacts.flatMap((a) => a.gateDecisions),
    runErrors: artifacts.flatMap((a) => a.runErrors), cells, missingCells: missing, refusal: null,
    totals: { inputTokens: cells.reduce((sum, cell) => sum + cell.inputTokens, 0), outputTokens: cells.reduce((sum, cell) => sum + cell.outputTokens, 0),
      usd: cells.every((cell) => cell.usd !== null) ? cells.reduce((sum, cell) => sum + (cell.usd ?? 0), 0) : null } });
  // Strict public projection contains no scorer records, provider transport, absolute paths or env.
  await publishRunRecord(options.root, run);
  return run;
}

/** Activation replay: actual controller/gate/sandbox traversal, no paid provider, exactly thirty calls. */
export async function runReplayCheckJourney(input: { root: string; provider: ModelProvider; run?: IsolatedRunner;
  onScoring?: (records: readonly ScoringRecord[]) => void }): Promise<RunRecord[]> {
  if (input.provider.mode !== "mock") throw new PreflightRefusal("replay check requires the mock provider");
  const run = input.run ?? createSandboxRunner({ mode: "execute", provider: "mock", sandbox: "docker", dockerAvailable: true,
    image: process.env.TESTGEN_SANDBOX_IMAGE ?? "" });
  return [await runExperiment({ root: input.root, split: "dev", subjectIds: ["clamp-range", "stable-sort", "validated-number"],
    arms: ["A3", "A4", "A5", "A6"], repeats: 1, heldoutConfirm: false, model: "mock-replay", maxOutputTokens: 2048,
    sandbox: "docker", provider: input.provider, run, ...(input.onScoring ? { onScoring: input.onScoring } : {}) })];
}
