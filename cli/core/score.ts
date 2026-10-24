/** Post-freeze arithmetic only. No provider, prompt or gate imports. */
import { EvalRowSchema, REJECTION_CODES, ScoringRecordSchema, MutantInventorySchema, RunRecordSchema, TrapsFileSchema } from "./schemas.js";
import type { EvalRow, MutantStatus, ScoringExecutionResult } from "./schemas.js";
import { CellArtifactSchema, FrozenCellSuiteSchema, suiteHash } from "../arms/runner.js";
import { sha256Hex, mutantKey } from "./mutantKey.js";

export const fraction = (n: number, d: number): number | null => d === 0 ? null : n / d;
export function mutationScores(outcomes: readonly { status: MutantStatus; equivalent?: boolean }[]) {
  const counts = { killed: 0, timeout: 0, survived: 0, noCoverage: 0, compileError: 0, runtimeError: 0 };
  const count = (s: MutantStatus) => { switch (s) {
    case "Killed": counts.killed++; break; case "Timeout": counts.timeout++; break;
    case "Survived": counts.survived++; break; case "NoCoverage": counts.noCoverage++; break;
    case "CompileError": counts.compileError++; break; case "RuntimeError": counts.runtimeError++; break;
  } };
  outcomes.forEach((o) => count(o.status));
  const denominator = counts.killed + counts.timeout + counts.survived + counts.noCoverage;
  const adjusted = outcomes.filter((o) => !o.equivalent);
  const eligible = (s: MutantStatus) => ["Killed", "Timeout", "Survived", "NoCoverage"].includes(s);
  return { counts, labelledEquivalents: outcomes.filter((o) => o.equivalent).length,
    scoreRaw: fraction(counts.killed + counts.timeout, denominator), scoreKilledOnly: fraction(counts.killed, denominator),
    scoreWithoutEquivalents: fraction(adjusted.filter((o) => o.status === "Killed" || o.status === "Timeout").length,
      adjusted.filter((o) => eligible(o.status)).length) };
}

export type Overfit = EvalRow["overfit"];
/** Timeouts, skipped/missing tests and runner failures are incomplete twin measurements, never overfit. */
export function twinOverfit(hashes: readonly string[], results: readonly ScoringExecutionResult[]): Overfit {
  let failingTwin = 0, twinIncomplete = 0;
  for (const hash of hashes) {
    const matches = results.filter((r) => r.kind === "twin" && r.unitSha256s.length === 1 && r.unitSha256s[0] === hash);
    const r = matches[0];
    if (matches.length !== 1 || !r || r.outputTruncated || (r.outcome !== "passed" && r.outcome !== "failed") ||
      r.tests.length !== 1 || r.tests[0]?.unitSha256 !== hash ||
      (r.outcome === "passed" && (r.tests[0]?.status !== "passed" || r.tests[0]?.cause !== null)) ||
      (r.outcome === "failed" && (r.tests[0]?.status !== "failed" || !["assertion", "thrown"].includes(r.tests[0]?.cause ?? "")))) twinIncomplete++;
    else if (r.outcome === "failed") failingTwin++;
  }
  return { accepted: hashes.length, failingTwin, twinIncomplete, rate: twinIncomplete ? null : fraction(failingTwin, hashes.length) };
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set(a).size === a.length && a.every((v) => b.includes(v));
export interface ScoreCellInput { run: unknown; artifact: unknown; loop: unknown; frozen: unknown; scoring: unknown; inventory: unknown; traps: unknown }
export interface ScoredCell { row: EvalRow; topUpOverfit: Overfit | null; complete: boolean; issues: string[] }

/** Fresh schema guards and cross references: an artifact's mere presence never makes a measurement valid. */
export function scoreCell(input: ScoreCellInput): ScoredCell {
  const run = RunRecordSchema.parse(input.run), artifact = CellArtifactSchema.parse(input.artifact), loop = CellArtifactSchema.parse(input.loop);
  const frozen = FrozenCellSuiteSchema.parse(input.frozen), scoring = ScoringRecordSchema.parse(input.scoring);
  const inventory = MutantInventorySchema.parse(input.inventory), traps = TrapsFileSchema.parse(input.traps), cell = artifact.cell;
  const issues: string[] = [];
  const fail = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  fail(frozen.runId === run.runId && scoring.runId === run.runId, "run identity mismatch");
  fail([frozen, scoring, inventory, traps].every((x) => x.subjectId === cell.subjectId) &&
    [frozen, scoring].every((x) => x.arm === cell.arm && x.repeat === cell.repeat), "cell identity mismatch");
  fail(run.cells.some((c) => JSON.stringify(c) === JSON.stringify(cell)), "terminal cell absent from run");
  fail(JSON.stringify(artifact.frozen) === JSON.stringify(frozen) && JSON.stringify(loop.frozen) === JSON.stringify(frozen), "frozen companion mismatch");
  fail(loop.cell.subjectId === cell.subjectId && loop.cell.arm === cell.arm && loop.cell.repeat === cell.repeat, "loop identity mismatch");
  for (const field of ["candidates", "units", "gateDecisions", "loopExecutions"] as const)
    fail(JSON.stringify(loop[field]) === JSON.stringify(artifact[field]), `loop ${field} changed after freeze`);
  fail(frozen.inventorySha256 === sha256Hex(JSON.stringify(inventory)) && frozen.subjectSha256 === inventory.srcSha256 &&
    run.engine === inventory.engine && run.subjects.some((s) => s.id === cell.subjectId && s.split === run.split && s.srcSha256 === frozen.subjectSha256), "inventory/source identity mismatch");
  fail(suiteHash(frozen.units) === frozen.frozenSuiteSha256, "suite hash mismatch");
  const hashes = frozen.units.map((u) => u.unitSha256);
  fail(same(hashes, scoring.suiteUnits) && same(hashes, cell.keptUnits), "scorer suite differs from frozen suite");
  for (const u of frozen.units) fail(u.subjectId === cell.subjectId && sha256Hex(u.text) === u.unitSha256 &&
    Buffer.byteLength(u.text, "utf8") === u.byteLength && artifact.units.some((a) => JSON.stringify(a) === JSON.stringify(u)), "frozen unit bytes mismatch");
  for (const u of artifact.units) fail(u.subjectId === cell.subjectId && sha256Hex(u.text) === u.unitSha256 &&
    Buffer.byteLength(u.text, "utf8") === u.byteLength && run.units.some((a) => JSON.stringify(a) === JSON.stringify(u)), "loop unit bytes or run reference mismatch");
  fail(inventory.mutants.every((m) => mutantKey(m) === m.key && m.srcSha256 === frozen.subjectSha256 && m.source === inventory.engine), "invalid inventory key");
  const generated = scoring.results.filter((r) => r.kind === "scoring-mutant"), planted = scoring.results.filter((r) => r.kind === "planted");
  const scoredTraps = traps.traps.filter((t) => t.trap !== "canary");
  fail(same(generated.map((r) => r.mutantKey), inventory.partition.scoring), "scoring mutants incomplete or duplicated");
  fail(same(planted.map((r) => r.trapId), scoredTraps.map((t) => t.id)), "planted outcomes incomplete or duplicated");
  for (const r of [...generated, ...planted]) {
    fail(same(r.unitSha256s, hashes) && r.tests.every((t) => t.unitSha256 !== null && hashes.includes(t.unitSha256)), "scorer attribution mismatch");
    if (r.tests.some((t) => t.status === "skipped" || t.cause === "compile-error" || t.cause === "runner-crash")) issues.push("incomplete scorer test attribution");
    if (r.outcome === "passed") fail(same(r.tests.map((t) => t.unitSha256 ?? ""), hashes) && r.tests.every((t) => t.status === "passed" && t.cause === null), "passing scorer suite omitted tests");
    if (r.outcome === "failed") fail(r.tests.filter((t) => t.status === "failed").every((t) => t.cause === "assertion" || t.cause === "thrown"), "scorer failure is not attributable");
    if (r.outputTruncated || r.mutantStatus === "RuntimeError" || r.mutantStatus === "Ignored" || r.outcome === "error") issues.push("unmeasurable scoring outcome");
    fail((r.mutantStatus !== "Killed" || (r.outcome === "failed" && r.tests.some((t) => t.status === "failed" && t.cause === r.killCause))) &&
      (r.mutantStatus !== "Timeout" || r.outcome === "timeout") &&
      (!["Survived", "NoCoverage"].includes(r.mutantStatus) || r.outcome === "passed"), "scoring status contradicts execution");
  }
  fail(scoring.results.filter((r) => r.kind === "twin").every((r) => r.unitSha256s.length === 1 && hashes.includes(r.unitSha256s[0] ?? "")), "foreign twin unit");
  for (const d of artifact.gateDecisions) {
    fail(d.subjectId === cell.subjectId && d.arm === cell.arm && d.repeat === cell.repeat, "foreign gate decision");
    if (d.decision === "accepted") fail(d.newKills.every((k) => inventory.partition.feedback.includes(k)), "scoring key leaked into gate");
  }
  for (const r of artifact.loopExecutions) if (r.kind === "feedback-mutant") fail(inventory.partition.feedback.includes(r.mutantKey), "foreign loop mutant");
  const plantedRows = planted.map((r) => {
    const trap = scoredTraps.find((t) => t.id === r.trapId)!;
    return { trapId: trap.id, trap: trap.trap, label: trap.label, status: r.mutantStatus };
  });
  const scores = mutationScores([...generated.map((r) => ({ status: r.mutantStatus })), ...plantedRows.map((r) => ({ status: r.status, equivalent: r.label === "equivalent" }))]);
  // Inventory compiler-filtered mutants lack partition assignments: show separately, never add to denominators.
  scores.counts.compileError += inventory.compileErrorCount;
  const overfit = twinOverfit(hashes, scoring.results);
  const acceptedHashes = new Set(artifact.gateDecisions.filter((d) => d.decision === "accepted").map((d) => d.unitSha256));
  const topUpOverfit = cell.arm === "A6" ? twinOverfit(hashes.filter((h) => acceptedHashes.has(h)), scoring.results) : null;
  const rejectedByCode = Object.fromEntries(REJECTION_CODES.map((code) => [code, 0])) as EvalRow["rejectedByCode"];
  for (const d of artifact.gateDecisions) if (d.decision === "rejected") rejectedByCode[d.code]++;
  if (cell.state !== "complete" || artifact.runErrors.length) issues.push("cell has retained run error or incomplete state");
  if (overfit.twinIncomplete) issues.push("incomplete twin measurement");
  if (scores.scoreRaw === null) issues.push("zero scoring denominator");
  const baseline = cell.arm === "A6" ? "A2" : ["A3", "A4", "A5"].includes(cell.arm) ? "A0" : null;
  // Only a measurement of the entire frozen suite may supply its coverage, never a rejected unit probe.
  const coverage = artifact.loopExecutions.filter((r) => r.kind === "coverage" && r.outcome === "passed" &&
    !r.outputTruncated && same(r.unitSha256s, hashes) && r.executableLines !== undefined).at(-1);
  const lineCoverage = coverage?.kind === "coverage" && coverage.executableLines !== undefined ?
    fraction(coverage.coveredLines.length, coverage.executableLines.length) : null;
  const naReasons: string[] = [];
  if (lineCoverage === null) naReasons.push("line coverage unavailable: no complete frozen-suite executable-line denominator");
  if (baseline) naReasons.push("score gain needs baseline and attributed nonzero ledger cost");
  if (scores.scoreRaw === null) naReasons.push("zero scoring denominator");
  if (overfit.accepted === 0) naReasons.push("zero accepted units");
  if (overfit.twinIncomplete) naReasons.push("twin errors are incomplete measurements");
  const row = EvalRowSchema.parse({ schemaVersion: 1, campaignId: run.campaignId, split: run.split, subjectId: cell.subjectId,
    arm: cell.arm, repeat: cell.repeat, providerMode: run.providerMode, executionProvenance: run.executionProvenance, engine: inventory.engine,
    ...scores, planted: plantedRows, overfit, keptUnits: hashes.length, rejectedByCode, runErrors: artifact.runErrors.length,
    lineCoverage, inputTokens: cell.inputTokens, outputTokens: cell.outputTokens, usd: null,
    costPerAcceptedTestUsd: null, scoreGainPerDollarPp: null, gainBaseline: baseline, naReasons });
  return { row, topUpOverfit, complete: issues.length === 0, issues };
}

/** Apply only an explicitly attributed ledger amount; never reconstruct USD from token prices. */
export function withCost(row: EvalRow, usd: number | null, baselineRaw: number | null, topUpAccepted?: number): EvalRow {
  const gain = row.gainBaseline && usd !== null && usd > 0 && baselineRaw !== null && row.scoreRaw !== null ? (row.scoreRaw - baselineRaw) * 100 / usd : null;
  return EvalRowSchema.parse({ ...row, usd, costPerAcceptedTestUsd: row.gainBaseline && usd !== null ? fraction(usd, row.arm === "A6" ? topUpAccepted ?? 0 : row.keptUnits) : null,
    scoreGainPerDollarPp: gain,
    naReasons: gain === null ? row.naReasons : row.naReasons.filter((r) => r !== "score gain needs baseline and attributed nonzero ledger cost") });
}
