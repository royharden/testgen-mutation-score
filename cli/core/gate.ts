/** Mutgate: a round transaction with injected execution, storage, clock and protected-file snapshots. */
import { inspectUnit } from "./ast.js";
import { parseCandidate } from "./grammar.js";
import { assertProtectedUnchanged, sha256Bytes, StagingError } from "./staging.js";
import type { ProtectedSnapshot, StagingStore } from "./staging.js";
import { CANDIDATE_MAX_BYTES, CandidateSchema, GateDecisionSchema, LoopExecutionResultSchema, RunErrorSchema, TestUnitSchema } from "./schemas.js";
import type { ArmId, Candidate, GateDecision, LoopExecutionResult, RejectionCode, RunError, RunErrorKind, TestUnit } from "./schemas.js";
import type { FeedbackExecutor, FeedbackRequest } from "../engines/engine.js";

export type AcceptancePolicy = "pristine" | "coverage" | "kill";
export interface GateState {
  readonly keptUnits: readonly TestUnit[];
  readonly killedFeedbackKeys: readonly string[];
  readonly coveredLines: readonly number[];
}
export function emptyGateState(): GateState { return { keptUnits: [], killedFeedbackKeys: [], coveredLines: [] }; }
/** A3/A1 pass twice; A4 adds coverage; A5/A6 adds a proven feedback kill. */
export function policyForArm(arm: ArmId): AcceptancePolicy { return arm === "A4" ? "coverage" : arm === "A5" || arm === "A6" ? "kill" : "pristine"; }
export interface GateRoundInput {
  subjectId: string;
  arm: ArmId;
  repeat: number;
  round: number;
  slot: number;
  candidateId: string;
  testFile: string;
  shuffleSeed: number;
  /** Only frozen feedback keys; no scoring inventory or scoring results are accepted by this API. */
  feedbackKeys: readonly string[];
  state: GateState;
  policy?: AcceptancePolicy;
}
export interface GateDependencies {
  executor: FeedbackExecutor;
  staging: StagingStore;
  snapshotProtected: ProtectedSnapshot;
  now: () => string;
}
export interface GateRoundResult {
  state: GateState;
  /** Directly usable RunRecord fragment; it carries no scoring outcomes. */
  candidates: Candidate[];
  units: TestUnit[];
  gateDecisions: GateDecision[];
  runErrors: RunError[];
  executions: LoopExecutionResult[];
  exitCode: 0 | 3 | 5;
}
class GateFailure extends Error {
  constructor(readonly kind: RunErrorKind, message: string, readonly fatal = true) { super(message); }
}
function executionFailure(result: LoopExecutionResult): void {
  if (result.outputTruncated) throw new GateFailure("report-parse", "bounded execution output was truncated");
  if (result.outcome === "error" || result.tests.some((t) => t.cause === "runner-crash" || t.cause === "compile-error")) throw new GateFailure(result.tests.some((t) => t.cause === "compile-error") ? "harness-compile-error" : "runner-crash", "execution could not produce a usable test result");
  if (result.kind === "feedback-mutant" && (result.mutantStatus === "CompileError" || result.mutantStatus === "RuntimeError")) throw new GateFailure(result.mutantStatus === "CompileError" ? "harness-compile-error" : "runner-crash", "feedback execution is an error, never a survivor");
}

export async function gateRound(input: GateRoundInput, deps: GateDependencies): Promise<GateRoundResult> {
  const original: GateState = { keptUnits: [...input.state.keptUnits], killedFeedbackKeys: [...input.state.killedFeedbackKeys], coveredLines: [...input.state.coveredLines] };
  const result: GateRoundResult = { state: original, candidates: [], units: [], gateDecisions: [], runErrors: [], executions: [], exitCode: 0 };
  const feedback = new Set(input.feedbackKeys);
  const pending: { unit: TestUnit; kills: string[]; coverage: number[] }[] = [];
  const killed = new Set(original.killedFeedbackKeys), covered = new Set(original.coveredLines);
  const context = { subjectId: input.subjectId, arm: input.arm, repeat: input.repeat, round: input.round, candidateId: input.candidateId };
  const decisionBase = (unit: TestUnit | null) => ({ type: "gate-decision" as const, ...context, unitSha256: unit?.unitSha256 ?? null, unitIndex: unit?.index ?? null, testName: unit?.testName ?? null, at: deps.now() });
  const reject = (unit: TestUnit | null, code: RejectionCode, subReason: string | null, detail: string): void => { result.gateDecisions.push(GateDecisionSchema.parse({ ...decisionBase(unit), decision: "rejected", code, subReason, detail })); };
  const execute = async (request: FeedbackRequest): Promise<LoopExecutionResult[]> => {
    const raw = await deps.executor.execute(request);
    const parsed = raw.map((r) => { const value = LoopExecutionResultSchema.safeParse(r); if (!value.success) throw new GateFailure("report-parse", "execution result violates the loop-only schema"); return value.data; });
    const expectedHashes = (request.kind === "feedback" ? [request.unit] : request.units).map((u) => u.unitSha256);
    const actualKeys = new Set<string>();
    for (const value of parsed) {
      if (value.unitSha256s.length !== expectedHashes.length || new Set(value.unitSha256s).size !== expectedHashes.length || value.unitSha256s.some((h) => !expectedHashes.includes(h))) throw new GateFailure("report-parse", "execution unit attribution mismatch");
      if (value.tests.some((test) => test.unitSha256 !== null && !expectedHashes.includes(test.unitSha256))) throw new GateFailure("report-parse", "test attribution does not belong to this execution");
      if (value.outcome === "passed" && (value.tests.length !== expectedHashes.length || new Set(value.tests.map((t) => t.unitSha256)).size !== expectedHashes.length || value.tests.some((t) => t.unitSha256 === null || t.status !== "passed" || t.cause !== null))) throw new GateFailure("report-parse", "passing execution lacks a complete, unskipped test set");
      const kind = request.kind === "feedback" ? "feedback-mutant" : request.kind;
      if (value.kind !== kind) throw new GateFailure("report-parse", "execution target mismatch");
      if (request.kind === "pristine" && value.kind === "pristine" && value.attempt !== request.attempt) throw new GateFailure("report-parse", "pristine attempt mismatch");
      if (request.kind === "pristine-union" && value.shuffleSeed !== request.shuffleSeed) throw new GateFailure("report-parse", "union shuffle seed mismatch");
      if (value.kind === "feedback-mutant") {
        // Never log the foreign key or raw payload, even on failure.
        if (!feedback.has(value.mutantKey)) throw new GateFailure("feedback-key-violation", "executor produced a key outside the frozen feedback set");
        if (actualKeys.has(value.mutantKey)) throw new GateFailure("report-parse", "executor duplicated feedback attribution");
        actualKeys.add(value.mutantKey);
        if ((value.mutantStatus === "Killed" && (value.outcome !== "failed" || !value.tests.some((t) => t.status === "failed" && t.cause === value.killCause))) || (value.mutantStatus === "Timeout" && value.outcome !== "timeout") || (["Survived", "NoCoverage"].includes(value.mutantStatus) && value.outcome !== "passed")) throw new GateFailure("report-parse", "mutant status contradicts test outcome");
        if (value.mutantStatus === "Ignored") throw new GateFailure("runner-crash", "ignored feedback result is not a measured survival");
      }
      executionFailure(value);
    }
    if (request.kind === "feedback" ? actualKeys.size !== feedback.size : parsed.length !== 1) throw new GateFailure("report-parse", "execution result set is incomplete");
    result.executions.push(...parsed);
    return parsed;
  };
  let before: Awaited<ReturnType<ProtectedSnapshot>> | undefined;
  try {
    before = await deps.snapshotProtected();
    if (Buffer.byteLength(input.testFile, "utf8") > CANDIDATE_MAX_BYTES) throw new GateFailure("provider-oversize", "candidate file exceeds its byte cap");
    for (const unit of original.keptUnits) if (!TestUnitSchema.safeParse(unit).success || sha256Bytes(unit.text) !== unit.unitSha256 || unit.subjectId !== input.subjectId) throw new GateFailure("schema-violation", "initial kept units do not match their immutable bytes");
    if (new Set(original.keptUnits.map((u) => u.unitSha256)).size !== original.keptUnits.length || original.killedFeedbackKeys.some((key) => !feedback.has(key))) throw new GateFailure("feedback-key-violation", "initial gate state is inconsistent with the feedback inventory");
    if ((input.arm === "A5" || input.arm === "A6") && input.policy !== undefined && input.policy !== "kill") throw new GateFailure("schema-violation", "kill-gated arms cannot override the kill acceptance policy");
    const fileSha256 = sha256Bytes(input.testFile);
    const candidate = CandidateSchema.parse({ ...context, slot: input.slot, fileSha256, byteLength: Buffer.byteLength(input.testFile, "utf8") });
    result.candidates.push(candidate);
    const grammar = parseCandidate(input.testFile);
    if (!grammar.ok) reject(null, "syntax", grammar.subReason, grammar.detail);
    else {
      const units = grammar.units.map((s) => TestUnitSchema.parse({ unitSha256: sha256Bytes(s.text), candidateId: input.candidateId, parentFileSha256: fileSha256, subjectId: input.subjectId, index: s.index, testName: s.testName, importsRange: s.importsRange, testRange: s.testRange, byteLength: Buffer.byteLength(s.text, "utf8"), text: s.text }));
      result.units.push(...units);
      for (const unit of units) {
        const staticIssue = inspectUnit(unit.text);
        if (staticIssue) { reject(unit, staticIssue.code, staticIssue.subReason, staticIssue.detail); continue; }
        const [first] = await execute({ kind: "pristine", units: [unit], attempt: 1 });
        if (!first) throw new GateFailure("report-parse", "missing pristine execution");
        if (first.outcome === "timeout") { reject(unit, "timeout", null, "first pristine execution timed out"); continue; }
        if (first.outcome !== "passed") { reject(unit, "fails-pristine", null, "first pristine execution failed"); continue; }
        const [second] = await execute({ kind: "pristine", units: [unit], attempt: 2 });
        if (!second) throw new GateFailure("report-parse", "missing second pristine execution");
        if (second.outcome === "timeout") { reject(unit, "timeout", null, "second pristine execution timed out"); continue; }
        if (second.outcome !== "passed") { reject(unit, "flaky", null, "first pristine run passed but second failed"); continue; }
        if ([...original.keptUnits, ...pending.map((p) => p.unit)].some((u) => u.unitSha256 === unit.unitSha256)) { reject(unit, "no-new-kill", "duplicate-unit", "identical immutable unit already kept"); continue; }
        const policy = input.policy ?? policyForArm(input.arm);
        let newKills: string[] = [], newLines: number[] = [];
        if (policy === "kill") {
          const outcomes = await execute({ kind: "feedback", unit });
          newKills = outcomes.flatMap((o) => o.kind === "feedback-mutant" && o.mutantStatus === "Killed" && (o.killCause === "assertion" || o.killCause === "thrown") && !killed.has(o.mutantKey) ? [o.mutantKey] : []);
          if (newKills.length === 0) {
            const timeoutOnly = outcomes.some((o) => o.kind === "feedback-mutant" && o.mutantStatus === "Timeout") && !outcomes.some((o) => o.kind === "feedback-mutant" && o.mutantStatus === "Killed");
            reject(unit, timeoutOnly ? "timeout" : "no-new-kill", null, timeoutOnly ? "only feedback timeout effects, with no attributable kill" : "no feedback kill beyond the cumulative kept set");
            continue;
          }
        } else if (policy === "coverage") {
          const [coverage] = await execute({ kind: "coverage", units: [unit] });
          if (!coverage || coverage.kind !== "coverage") throw new GateFailure("report-parse", "missing coverage result");
          if (coverage.outcome === "timeout") { reject(unit, "timeout", null, "coverage execution timed out"); continue; }
          if (coverage.outcome !== "passed") throw new GateFailure("runner-crash", "coverage execution failed after pass-twice");
          newLines = [...new Set(coverage.coveredLines)].filter((line) => !covered.has(line));
          if (newLines.length === 0) { reject(unit, "no-new-kill", "no-new-coverage", "coverage policy observed no new covered lines"); continue; }
        }
        pending.push({ unit, kills: newKills, coverage: newLines });
        newKills.forEach((key) => killed.add(key)); newLines.forEach((line) => covered.add(line));
      }
      if (pending.length > 0) {
        const [union] = await execute({ kind: "pristine-union", units: [...original.keptUnits, ...pending.map((p) => p.unit)], shuffleSeed: input.shuffleSeed });
        if (!union || union.outcome !== "passed") throw new GateFailure("union-pristine-failure", "combined kept suite failed pristine; round admissions rolled back", false);
      }
    }
    assertProtectedUnchanged(before, await deps.snapshotProtected());
    if (pending.length > 0) {
      const staged = await deps.staging.commit(pending.map((p) => p.unit));
      assertProtectedUnchanged(before, await deps.snapshotProtected());
      if (staged.length !== pending.length || new Set(staged.map((s) => s.unitSha256)).size !== pending.length) throw new GateFailure("storage-exhausted", "staging receipt is incomplete");
      for (const p of pending) {
        const receipt = staged.find((s) => s.unitSha256 === p.unit.unitSha256);
        if (!receipt) throw new GateFailure("storage-exhausted", "staging receipt omitted an admitted unit");
        result.gateDecisions.push(GateDecisionSchema.parse({ ...decisionBase(p.unit), decision: "accepted", newKills: p.kills, stagedAs: receipt.stagedAs, coveredLinesGained: (input.policy ?? policyForArm(input.arm)) === "coverage" ? p.coverage.length : null }));
      }
      result.state = { keptUnits: [...original.keptUnits, ...pending.map((p) => p.unit)], killedFeedbackKeys: [...killed], coveredLines: [...covered] };
    }
  } catch (error) {
    let kind: RunErrorKind = "runner-crash", fatal = true;
    if (error instanceof GateFailure) { kind = error.kind; fatal = error.fatal; }
    else if (error instanceof StagingError) kind = error.kind;
    else if (error instanceof Error && "kind" in error && typeof error.kind === "string") {
      const known = RunErrorSchema.shape.kind.safeParse(error.kind);
      if (known.success) kind = known.data;
      if ("fatal" in error && error.fatal === false) fatal = false;
    }
    // A crash never prevents the after-round guard; its violation takes precedence.
    if (before) try { assertProtectedUnchanged(before, await deps.snapshotProtected()); } catch { kind = "add-only-guard"; fatal = true; }
    result.state = original;
    result.gateDecisions = result.gateDecisions.filter((d) => d.decision !== "accepted");
    result.runErrors.push(RunErrorSchema.parse({ type: "run-error", kind, fatal, ...context, at: deps.now(), message: `gate round aborted: ${kind}; no admissions from this round committed`, rolledBack: pending.map((p) => p.unit.unitSha256) }));
    result.exitCode = fatal ? 3 : 5;
  }
  result.gateDecisions.sort((a, b) => (a.unitIndex ?? -1) - (b.unitIndex ?? -1));
  return result;
}
