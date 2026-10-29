/** Engine contracts. Generation receives only FeedbackExecutor; scoring requires an explicit frozen suite. */
import { z } from "zod";
import { A1ProbeSchema, LoopExecutionResultSchema, MutantInventorySchema, ScoringExecutionResultSchema, TestUnitSchema } from "../core/schemas.js";
import type { A1Probe } from "../core/schemas.js";
import type { ExecutionResult, LoopExecutionResult, MutantInventory, MutantRecord, RunErrorKind, ScoringExecutionResult, SourcePosition, SourceRange, TestUnit } from "../core/schemas.js";
import { mutantKey, normalizeRelFile, sha256Hex } from "../core/mutantKey.js";
import { enclosingStatementRange } from "../core/ast.js";
import { locationGroupKey, splitMutants, assertMutantSplit } from "../core/split.js";
import type { TrapLocation } from "../core/split.js";

/** Messages deliberately exclude raw runner reports and foreign keys (which may belong to scoring). */
export class EngineExecutionError extends Error {
  override name = "EngineExecutionError";
  readonly exitCode: 3 | 5;
  constructor(readonly kind: RunErrorKind, message: string, readonly fatal = true) {
    super(message);
    this.exitCode = fatal ? 3 : 5;
  }
}

export type FeedbackRequest =
  | { kind: "pristine"; units: readonly TestUnit[]; attempt: 1 | 2 }
  | { kind: "pristine-union"; units: readonly TestUnit[]; shuffleSeed: number }
  | { kind: "feedback"; unit: TestUnit }
  | { kind: "coverage"; units: readonly TestUnit[] };

export interface FeedbackExecutor {
  execute(request: FeedbackRequest): Promise<LoopExecutionResult[]>;
}

const FeedbackRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pristine"), units: z.array(TestUnitSchema), attempt: z.union([z.literal(1), z.literal(2)]) }),
  z.strictObject({ kind: z.literal("pristine-union"), units: z.array(TestUnitSchema), shuffleSeed: z.number().int().min(0).max(0xffffffff) }),
  z.strictObject({ kind: z.literal("feedback"), unit: TestUnitSchema }),
  z.strictObject({ kind: z.literal("coverage"), units: z.array(TestUnitSchema) }),
]);

/** Trusted orchestration contract, never handed to a model or the generation controller. */
export type IsolatedTarget =
  | { kind: "pristine"; attempt: 1 | 2 }
  | { kind: "pristine-union" }
  | { kind: "coverage" }
  | { kind: "a1-capture" }
  | { kind: "feedback-mutant"; mutantKey: string }
  | { kind: "scoring-mutant"; mutantKey: string }
  | { kind: "planted"; trapId: string }
  | { kind: "twin" };

export interface IsolatedRunRequest {
  sourceText: string;
  units: readonly TestUnit[];
  target: IsolatedTarget;
  shuffleSeed?: number;
  /** Trusted AST-selected JSON argument probes, never model input. */
  probes?: readonly A1Probe[];
}

export interface IsolatedRunner {
  run(request: IsolatedRunRequest): Promise<ExecutionResult>;
}

/** Shared exact-patch primitives live in this contract module to avoid a runtime adapter import cycle. */
export function sourceOffset(source: string, position: SourcePosition): number {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.column) || position.line < 1 || position.column < 1)
    throw new EngineExecutionError("report-parse", "invalid source position");
  let start = 0;
  for (let line = 1; line < position.line; line++) {
    const next = source.indexOf("\n", start);
    if (next < 0) throw new EngineExecutionError("report-parse", "source line is out of bounds");
    start = next + 1;
  }
  const newline = source.indexOf("\n", start);
  let end = newline < 0 ? source.length : newline;
  if (end > start && source[end - 1] === "\r") end--;
  if (position.column > end - start + 1) throw new EngineExecutionError("report-parse", "source column is out of bounds");
  return start + position.column - 1;
}

export function sourceSlice(source: string, range: SourceRange): string {
  const start = sourceOffset(source, range.start), end = sourceOffset(source, range.end);
  if (end < start) throw new EngineExecutionError("report-parse", "reversed patch range");
  return source.slice(start, end);
}

export function applyExactPatch(source: string, range: SourceRange, original: string, replacement: string): string {
  if (original.length === 0 || sourceSlice(source, range) !== original)
    throw new EngineExecutionError("add-only-guard", "patch original does not match frozen source");
  if (original === replacement) throw new EngineExecutionError("report-parse", "refusing no-op patch");
  return source.slice(0, sourceOffset(source, range.start)) + replacement + source.slice(sourceOffset(source, range.end));
}

export async function executeExactPatch(runner: IsolatedRunner, options: {
  sourceText: string; range: SourceRange; original: string; replacement: string;
  units: readonly TestUnit[]; target: Extract<IsolatedTarget, { kind: "feedback-mutant" | "scoring-mutant" | "planted" }>;
}): Promise<ExecutionResult> {
  const request = { sourceText: applyExactPatch(options.sourceText, options.range, options.original, options.replacement),
    units: options.units, target: options.target };
  return validateRunResult(await runner.run(request), request);
}

export interface RawMutation {
  relFile: string;
  range: SourceRange;
  mutator: string;
  replacement: string;
}

/** Inventory normalization always derives source hash, stable keys and statement groups from source. */
export function normalizeMutations(sourceText: string, source: "stryker" | "inhouse", raw: readonly RawMutation[]): MutantRecord[] {
  const srcSha256 = sha256Hex(sourceText);
  return raw.map((m) => {
    const relFile = normalizeRelFile(m.relFile);
    if (relFile !== "src.ts") throw new EngineExecutionError("report-parse", "engine reported a non-subject file");
    const original = sourceSlice(sourceText, m.range);
    if (original === m.replacement) throw new EngineExecutionError("report-parse", "engine reported a no-op patch");
    const input = { relFile, srcSha256, range: m.range, mutator: m.mutator, replacement: m.replacement };
    const statementRange = enclosingStatementRange(sourceText, m.range);
    const grouped = { ...input, ...(statementRange === undefined ? {} : { statementRange }) };
    return { ...input, key: mutantKey(input), source, groupKey: locationGroupKey(grouped) };
  });
}

export function buildInventory(options: {
  sourceText: string; subjectId: string; engine: "stryker" | "inhouse"; engineVersion: string | null;
  createdAt: string; seed: number; mutations: readonly RawMutation[]; traps: readonly TrapLocation[]; compileErrorCount?: number;
}): MutantInventory {
  const normalized = normalizeMutations(options.sourceText, options.engine, options.mutations);
  const split = assertMutantSplit(splitMutants(normalized.map((m) => {
    const statementRange = enclosingStatementRange(options.sourceText, m.range);
    return { ...m, ...(statementRange === undefined ? {} : { statementRange }) };
  }), options.traps, { seed: options.seed }));
  const kept = new Set([...split.feedback, ...split.scoring]);
  const unique = new Map(normalized.filter((m) => kept.has(m.key)).map((m) => [m.key, m]));
  return MutantInventorySchema.parse({
    schemaVersion: 1, subjectId: options.subjectId, srcSha256: sha256Hex(options.sourceText), engine: options.engine,
    engineVersion: options.engineVersion, createdAt: options.createdAt, seed: options.seed,
    mutants: [...unique.values()].map((m) => ({ ...m, groupKey: split.groupOf[m.key] })),
    partition: { feedback: split.feedback, scoring: split.scoring }, reservedGroups: split.reservedGroups,
    compileErrorCount: options.compileErrorCount ?? 0, duplicatesRemoved: split.duplicates.length,
  });
}

function equalSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length && actual.every((k) => expected.includes(k));
}

function verifyUnits(units: readonly TestUnit[], subjectId: string): void {
  if (new Set(units.map((u) => u.unitSha256)).size !== units.length)
    throw new EngineExecutionError("add-only-guard", "execution suite contains duplicate units");
  for (const unit of units) {
    if (unit.subjectId !== subjectId || sha256Hex(unit.text) !== unit.unitSha256 || Buffer.byteLength(unit.text, "utf8") !== unit.byteLength)
      throw new EngineExecutionError("add-only-guard", "execution unit does not match its frozen subject or bytes");
  }
}

/** Validate before any result is admitted to gate arithmetic. A runner crash is never survival. */
export function validateRunResult(result: unknown, request: IsolatedRunRequest): ExecutionResult {
  const schema = request.target.kind === "scoring-mutant" || request.target.kind === "planted" || request.target.kind === "twin"
    ? ScoringExecutionResultSchema : LoopExecutionResultSchema;
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new EngineExecutionError("report-parse", "runner returned malformed execution data");
  const value = parsed.data;
  if (request.target.kind === "a1-capture") {
    const probes = (request.probes ?? []).map((probe) => A1ProbeSchema.parse(probe));
    if (request.units.length !== 0 || probes.length > 64 || new Set(probes.map((p) => p.id)).size !== probes.length ||
        value.kind !== "a1-capture" || !equalSet(value.observations.map((o) => o.probeId), probes.map((p) => p.id)))
      throw new EngineExecutionError("report-parse", "A1 capture attribution is incomplete or duplicated");
  } else if (request.probes !== undefined) throw new EngineExecutionError("report-parse", "probes are only allowed in A1 capture");
  const hashes = request.units.map((u) => u.unitSha256);
  if (value.kind !== request.target.kind || !equalSet(value.unitSha256s, hashes))
    throw new EngineExecutionError("report-parse", "runner returned a mismatched target or suite");
  if (value.shuffleSeed !== (request.shuffleSeed ?? null))
    throw new EngineExecutionError("report-parse", "runner returned a mismatched shuffle seed");
  if (request.target.kind === "pristine" && (value.kind !== "pristine" || value.attempt !== request.target.attempt))
    throw new EngineExecutionError("report-parse", "runner returned a mismatched pristine attempt");
  if ("mutantKey" in request.target && (!("mutantKey" in value) || value.mutantKey !== request.target.mutantKey))
    throw new EngineExecutionError("feedback-key-violation", "runner returned an unexpected mutant key");
  if (request.target.kind === "planted" && (value.kind !== "planted" || value.trapId !== request.target.trapId))
    throw new EngineExecutionError("report-parse", "runner returned an unexpected trap");
  if (value.tests.some((t) => t.unitSha256 === null || !hashes.includes(t.unitSha256)))
    throw new EngineExecutionError("report-parse", "runner returned an unknown test identity");
  if (value.outputTruncated) throw new EngineExecutionError("report-parse", "runner output was truncated");
  if (value.outcome === "error") throw new EngineExecutionError("runner-crash", "isolated runner reported an execution error");
  if (value.tests.some((t) => t.cause === "compile-error"))
    throw new EngineExecutionError("harness-compile-error", "isolated harness failed to compile");
  if (value.tests.some((t) => t.cause === "runner-crash"))
    throw new EngineExecutionError("runner-crash", "isolated runner failed");
  const failures = value.tests.filter((t) => t.status === "failed");
  if ((value.outcome === "failed" && (failures.length === 0 || failures.some((t) => t.cause !== "assertion" && t.cause !== "thrown"))) ||
      value.tests.some((t) => t.status === "passed" && t.cause !== null))
    throw new EngineExecutionError("report-parse", "runner failure lacks attributable test evidence");
  if ("mutantStatus" in value) {
    if (["CompileError", "RuntimeError", "Ignored"].includes(value.mutantStatus))
      throw new EngineExecutionError(value.mutantStatus === "CompileError" ? "harness-compile-error" : "runner-crash", "mutant execution was not measurable");
    if ((value.mutantStatus === "Killed" && value.outcome !== "failed") ||
        (value.mutantStatus === "Timeout" && value.outcome !== "timeout") ||
        (["Survived", "NoCoverage"].includes(value.mutantStatus) && value.outcome !== "passed"))
      throw new EngineExecutionError("report-parse", "mutant status contradicts execution outcome");
    if (value.mutantStatus === "Killed" && !failures.some((t) => t.cause === value.killCause))
      throw new EngineExecutionError("report-parse", "kill cause contradicts test evidence");
  }
  if (value.outcome === "passed" && (value.tests.some((t) => t.status !== "passed") ||
      !equalSet(value.tests.map((t) => t.unitSha256 ?? ""), hashes)))
    throw new EngineExecutionError("report-parse", "runner omitted or skipped tests in a passing suite");
  return value;
}

function verifyInventory(sourceText: string, input: MutantInventory): MutantInventory {
  // Clone through the strict schema so mutation of caller-owned arrays cannot alter this capability.
  const inventory = MutantInventorySchema.parse(input);
  if (inventory.srcSha256 !== sha256Hex(sourceText)) throw new EngineExecutionError("add-only-guard", "inventory source hash changed");
  const keys = inventory.mutants.map((m) => m.key);
  const all = [...inventory.partition.feedback, ...inventory.partition.scoring];
  if (!equalSet(all, keys) || new Set(keys).size !== keys.length || inventory.partition.feedback.length === 0 || inventory.partition.scoring.length === 0)
    throw new EngineExecutionError("feedback-key-violation", "inventory partition is incomplete, duplicated or empty");
  const feedbackGroups = new Set<string>();
  const scoringGroups = new Set<string>();
  for (const m of inventory.mutants) {
    if (m.source !== inventory.engine || m.srcSha256 !== inventory.srcSha256 || mutantKey(m) !== m.key)
      throw new EngineExecutionError("feedback-key-violation", "inventory contains an invalid generated mutant");
    sourceSlice(sourceText, m.range);
    const statementRange = enclosingStatementRange(sourceText, m.range);
    const expectedGroup = locationGroupKey({ ...m, ...(statementRange === undefined ? {} : { statementRange }) });
    if (m.groupKey !== expectedGroup) throw new EngineExecutionError("feedback-key-violation", "inventory has an invalid location group");
    (inventory.partition.feedback.includes(m.key) ? feedbackGroups : scoringGroups).add(m.groupKey);
  }
  if ([...feedbackGroups].some((group) => scoringGroups.has(group)))
    throw new EngineExecutionError("feedback-key-violation", "inventory splits an enclosing statement across partitions");
  return inventory;
}

export function createFeedbackExecutor(options: { sourceText: string; inventory: MutantInventory; run: IsolatedRunner }): FeedbackExecutor {
  const inventory = verifyInventory(options.sourceText, options.inventory);
  const allowed = new Set(inventory.partition.feedback);
  const mutants = inventory.mutants.filter((m) => allowed.has(m.key));
  const invoke = async (request: IsolatedRunRequest): Promise<LoopExecutionResult> => {
    const result = validateRunResult(await options.run.run(request), request);
    const parsed = LoopExecutionResultSchema.safeParse(result);
    if (!parsed.success) throw new EngineExecutionError("feedback-key-violation", "scorer result reached generation");
    return parsed.data;
  };
  return {
    async execute(input) {
      const parsedRequest = FeedbackRequestSchema.safeParse(input);
      if (!parsedRequest.success) throw new EngineExecutionError("schema-violation", "invalid feedback-only execution request");
      const request = parsedRequest.data;
      verifyUnits(request.kind === "feedback" ? [request.unit] : request.units, inventory.subjectId);
      if (request.kind === "feedback") {
        const results: LoopExecutionResult[] = [];
        for (const m of mutants) {
          const result = await executeExactPatch(options.run, {
            sourceText: options.sourceText, range: m.range, original: sourceSlice(options.sourceText, m.range), replacement: m.replacement,
            units: [request.unit], target: { kind: "feedback-mutant", mutantKey: m.key },
          });
          const parsed = LoopExecutionResultSchema.safeParse(result);
          if (!parsed.success || parsed.data.kind !== "feedback-mutant" || !allowed.has(parsed.data.mutantKey))
            throw new EngineExecutionError("feedback-key-violation", "executor produced a key outside frozen feedback");
          results.push(parsed.data);
        }
        const returned = results.flatMap((r) => r.kind === "feedback-mutant" ? [r.mutantKey] : []);
        if (!equalSet(returned, [...allowed])) throw new EngineExecutionError("feedback-key-violation", "feedback results are incomplete or duplicated");
        return results;
      }
      const target: IsolatedTarget = request.kind === "pristine" ? { kind: "pristine", attempt: request.attempt } : { kind: request.kind };
      return [await invoke({ sourceText: options.sourceText, units: request.units, target,
        ...(request.kind === "pristine-union" ? { shuffleSeed: request.shuffleSeed } : {}) })];
    },
  };
}

/** Separate post-freeze capability. It never returns loop-side results. No scoring before immutable hash check. */
export function createScoringExecutor(options: {
  sourceText: string; inventory: MutantInventory; run: IsolatedRunner;
  frozenUnits: readonly TestUnit[]; frozenSuiteSha256: string;
}): { execute(): Promise<ScoringExecutionResult[]> } {
  const inventory = verifyInventory(options.sourceText, options.inventory);
  const units = options.frozenUnits.map((u) => TestUnitSchema.parse(u));
  verifyUnits(units, inventory.subjectId);
  if (sha256Hex(units.map((u) => u.unitSha256).sort().join("\n")) !== options.frozenSuiteSha256)
    throw new EngineExecutionError("add-only-guard", "scoring suite is not frozen");
  return { async execute() {
    const scoring = new Set(inventory.partition.scoring);
    const results: ScoringExecutionResult[] = [];
    for (const m of inventory.mutants.filter((m) => scoring.has(m.key))) {
      const result = await executeExactPatch(options.run, { sourceText: options.sourceText, range: m.range,
        original: sourceSlice(options.sourceText, m.range), replacement: m.replacement, units,
        target: { kind: "scoring-mutant", mutantKey: m.key } });
      results.push(ScoringExecutionResultSchema.parse(result));
    }
    return results;
  } };
}
