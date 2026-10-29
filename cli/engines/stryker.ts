/** Stryker config/report adapter. API shapes and attribution remain unverified until the activation spike. */
import { z } from "zod";
import { SourceRangeSchema, MutantStatusSchema } from "../core/schemas.js";
import type { MutantRecord, MutantStatus, SourceRange } from "../core/schemas.js";
import { EngineExecutionError, normalizeMutations } from "./engine.js";
import type { RawMutation } from "./engine.js";
import { formatRange } from "../core/mutantKey.js";

const ReportMutantSchema = z.strictObject({
  id: z.string(), mutatorName: z.string().min(1), replacement: z.string(), location: SourceRangeSchema,
  status: MutantStatusSchema, description: z.string().optional(), statusReason: z.string().optional(),
  coveredBy: z.array(z.string()).optional(), killedBy: z.array(z.string()).optional(),
  testsCompleted: z.number().int().nonnegative().optional(), static: z.boolean().optional(),
});
/** Public report v1 projection used by this adapter. Unknown fields fail closed for version reconciliation. */
export const StrykerReportSchema = z.strictObject({
  $schema: z.string().optional(), schemaVersion: z.literal("1.0"),
  thresholds: z.strictObject({ high: z.number(), low: z.number() }).optional(),
  projectRoot: z.string().optional(),
  files: z.record(z.string(), z.strictObject({ language: z.string().optional(), source: z.string(), mutants: z.array(ReportMutantSchema) })),
});

export interface StrykerParsedMutant { mutant: MutantRecord; status: MutantStatus; killedBy: string[] }
export interface StrykerParsedReport { mutants: StrykerParsedMutant[]; compileErrorCount: number }

export function parseStrykerReport(input: unknown, sourceText: string, allowedKeys?: ReadonlySet<string>): StrykerParsedReport {
  const parsed = StrykerReportSchema.safeParse(input);
  if (!parsed.success) throw new EngineExecutionError("report-parse", "Stryker report does not match pinned report projection");
  const files = Object.entries(parsed.data.files);
  if (files.length !== 1 || files[0]?.[0].replace(/\\/g, "/").replace(/^\.\//, "") !== "src.ts")
    throw new EngineExecutionError("report-parse", "Stryker report must contain exactly the subject file");
  const file = files[0]?.[1];
  if (file === undefined || file.source !== sourceText) throw new EngineExecutionError("add-only-guard", "Stryker source differs from frozen subject");
  const ids = new Set<string>();
  const keys = new Set<string>();
  let compileErrorCount = 0;
  const mutants: StrykerParsedMutant[] = [];
  for (const m of file.mutants) {
    if (ids.has(m.id)) throw new EngineExecutionError("report-parse", "duplicate Stryker mutant ordinal");
    ids.add(m.id);
    const raw: RawMutation = { relFile: "src.ts", range: m.location, mutator: m.mutatorName, replacement: m.replacement };
    const mutant = normalizeMutations(sourceText, "stryker", [raw])[0];
    if (mutant === undefined) throw new EngineExecutionError("report-parse", "missing normalized Stryker mutant");
    // Verify membership BEFORE status filtering: compile errors and ignored foreign mutants are leaks too.
    if (allowedKeys !== undefined && !allowedKeys.has(mutant.key))
      throw new EngineExecutionError("feedback-key-violation", "Stryker produced a key outside frozen feedback");
    if (keys.has(mutant.key)) throw new EngineExecutionError("report-parse", "duplicate stable Stryker mutant key");
    keys.add(mutant.key);
    if (m.status === "CompileError") { compileErrorCount++; continue; }
    if (m.status === "RuntimeError" || m.status === "Ignored")
      throw new EngineExecutionError("runner-crash", "Stryker produced an unmeasurable mutant");
    mutants.push({ mutant, status: m.status, killedBy: m.killedBy ?? [] });
  }
  if (allowedKeys !== undefined && (keys.size !== allowedKeys.size || [...allowedKeys].some((k) => !keys.has(k))))
    throw new EngineExecutionError("feedback-key-violation", "Stryker feedback report omitted frozen keys");
  if (allowedKeys !== undefined && compileErrorCount > 0)
    throw new EngineExecutionError("harness-compile-error", "a frozen feedback mutant failed compilation");
  return { mutants, compileErrorCount };
}

export function buildStrykerConfig(options: { feedbackMutants?: readonly MutantRecord[]; vitestConfigFile: string; reportFile: string }) {
  if (options.feedbackMutants !== undefined && options.feedbackMutants.length === 0)
    throw new EngineExecutionError("feedback-key-violation", "cannot select empty feedback ranges");
  const mutate = options.feedbackMutants === undefined ? ["src.ts"] : [...new Set(options.feedbackMutants.map((m) => {
    if (m.relFile !== "src.ts" || m.source !== "stryker") throw new EngineExecutionError("feedback-key-violation", "invalid Stryker feedback selection");
    return `src.ts:${formatRange(m.range)}`;
  }))];
  return {
    mutate, testRunner: "vitest", checkers: ["typescript"],
    plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
    vitest: { configFile: options.vitestConfigFile }, reporters: ["json"], jsonReporter: { fileName: options.reportFile },
    coverageAnalysis: "off", concurrency: 1, cleanTempDir: true, incremental: false,
    // Isolated per-unit passes are mandatory by default. No batched killedBy attribution is trusted.
  };
}

/** Programmatic location conversion is explicit; select a base only after CHECK 3 of the spike. */
export function programmaticRange(location: SourceRange, base: "zero" | "one"): SourceRange {
  const d = base === "zero" ? 1 : 0;
  return SourceRangeSchema.parse({ start: { line: location.start.line + d, column: location.start.column + d },
    end: { line: location.end.line + d, column: location.end.column + d } });
}

/** Run Stryker only INSIDE the trusted container runner, never with model candidates on the host. */
export async function runStrykerProgrammatic(config: ReturnType<typeof buildStrykerConfig>): Promise<void> {
  const { Stryker } = await import("@stryker-mutator/core");
  type Options = NonNullable<ConstructorParameters<typeof Stryker>[0]>;
  await new Stryker(config as Options).runMutationTest();
}
