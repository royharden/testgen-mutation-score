/**
 * Shared data contracts (zod) for the CLI, scripts, tests and the viewer.
 *
 * D1 PURITY: this module is bundled into the browser viewer. It imports ONLY `zod` — no `node:*`, no other
 * project module (in particular not `mutantKey.ts`, which uses node:crypto). Keep helpers here pure.
 * Enforced by eslint.config.js and by tests/core/schemas.test.ts.
 *
 * Every record that leaves the CLI as JSON/JSONL is validated against one of these schemas. Records are
 * strict (unknown keys are rejected) so a sanitized public projection (D12) cannot silently carry extra
 * fields such as absolute paths, env values or provider transport details.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------
// Versions and primitives
// ---------------------------------------------------------------------------------------------------------

export const SCHEMA_VERSION = 1 as const;
const schemaVersion = z.literal(SCHEMA_VERSION);

/** Lowercase hex sha256 (64 chars). */
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected lowercase hex sha256");
/** A sha256 that may not be computable yet in Dirty Mode construction (computed at activation). */
export const Sha256OrPendingSchema = z.union([Sha256HexSchema, z.literal("pending")]);

export const IsoTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/, "expected ISO-8601 timestamp");
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Subject ids are slugs (PLAN §2.4 C4: e.g. `clamp-range`). */
export const SlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug");

/** Opaque identifiers (candidate ids, call ids). May contain `/` and `:`; never used as a file name. */
export const IdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "expected an id of [A-Za-z0-9._:/-]");

/** Run and campaign ids become file names (`public/runs/<runId>.json`), so no separators at all. */
export const RunIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, "expected a run id of [A-Za-z0-9_-]");

/** uint32 seed (mulberry32 / seeded hash). */
export const SeedSchema = z.number().int().min(0).max(0xffffffff);

const NonNegInt = z.number().int().min(0);
const NonNegNumber = z.number().min(0);

/**
 * True for a repository-relative POSIX path with no traversal: no backslashes, no leading `/`, no drive
 * letter, no empty/`.`/`..` segments, no NUL. D12: public JSON never carries absolute paths.
 */
export function isSafeRelPath(p: string): boolean {
  if (p.length === 0 || p.includes("\\") || p.includes("\0")) return false;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
export const RelPathSchema = z.string().max(512).refine(isSafeRelPath, "expected a safe relative POSIX path");

/**
 * Normalise an engine- or author-supplied path to relative POSIX form: backslashes become `/` and leading
 * `./` segments are removed. Returns null when the result is not a safe relative path (see isSafeRelPath).
 * Pure; mutantKey.ts wraps it in a throwing variant (normalizeRelFile).
 */
export function normalizeRelPath(p: string): string | null {
  let out = p.replace(/\\/g, "/");
  while (out.startsWith("./")) out = out.slice(2);
  return isSafeRelPath(out) ? out : null;
}

/**
 * FILE-PATH CONVENTION (pinned in M2): a trap's `file` and a mutant's `relFile` are SUBJECT-RELATIVE, i.e.
 * relative to `fixtures/subjects/<id>/` — in practice always `src.ts` (subjects are single, import-free
 * files). Never repo-relative (`fixtures/subjects/<id>/src.ts`) and never absolute. Because subjects have no
 * sub-directories, a subject-relative file is a bare file name: a safe relative path with no `/`.
 */
export function isSubjectRelFile(p: string): boolean {
  return isSafeRelPath(p) && !p.includes("/");
}
export const SubjectRelFileSchema = z
  .string()
  .max(128)
  .refine(isSubjectRelFile, "expected a subject-relative file name such as src.ts (not a repo-relative path)");

/** The one specifier by which hand suites and candidates import the subject (PLAN §2.2 gate step 2). */
export const CANONICAL_SUBJECT_SPECIFIER = "./src" as const;
/** The subject file every trap and generated mutant refers to (subject-relative). */
export const SUBJECT_SOURCE_FILE = "src.ts" as const;

/** UTF-8 byte length without TextEncoder, so this module stays dependency- and platform-free. */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}

// ---------------------------------------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------------------------------------

export const SplitSchema = z.enum(["dev", "heldout"]);
export const ARM_IDS = ["A0", "A1", "A2", "A3", "A4", "A5", "A6"] as const;
export const ArmIdSchema = z.enum(ARM_IDS);
/** Arms that call a model (prompted, replayable). */
export const ModelArmIdSchema = z.enum(["A3", "A4", "A5", "A6"]);

/** PLAN §2.4: which provider produced candidates. */
export const PROVIDER_MODES = ["mock", "anthropic", "openai_compatible"] as const;
export const ProviderModeSchema = z.enum(PROVIDER_MODES);

/** PLAN §2.4: how the record's numbers came to exist. Samples can never pass as measurements. */
export const EXECUTION_PROVENANCES = ["measured", "replay-executed", "recorded-fixture"] as const;
export const ExecutionProvenanceSchema = z.enum(EXECUTION_PROVENANCES);

/** PLAN §2.5 C9: run status. */
export const RUN_STATUSES = ["complete", "partial-budget", "partial-error", "refused"] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);

/** PLAN §2.5 / [C §2.9]: process exit codes. Named constants live in exitCodes.ts. */
export const EXIT_CODE_VALUES = [0, 2, 3, 4, 5] as const;
export const ExitCodeSchema = z.union([z.literal(0), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type ExitCodeValue = z.infer<typeof ExitCodeSchema>;

/**
 * Which exit codes a recorded run status may carry. A dry run writes no RunRecord.
 * partial-error covers protocol aborts (3), replay-miss/schema violations (4) and retained run errors (5).
 */
export const STATUS_EXIT_CODES: Readonly<Record<RunStatus, readonly ExitCodeValue[]>> = {
  complete: [0],
  "partial-budget": [5],
  "partial-error": [3, 4, 5],
  refused: [2],
};

/** The seven public gate reason codes, in gate order (PLAN §2.2). Nothing else is ever a reason code. */
export const REJECTION_CODES = [
  "syntax",
  "forbidden-import",
  "no-assertion",
  "fails-pristine",
  "flaky",
  "timeout",
  "no-new-kill",
] as const;
export const RejectionCodeSchema = z.enum(REJECTION_CODES);

/** Sub-reasons for `syntax` ([C §2.4]). */
export const SyntaxSubReasonSchema = z.enum(["unsupported-structure", "parse-error"]);
/** Sub-reasons for `forbidden-import` ([C §2.5] step 2, PLAN §2.2 C2): hygiene mapped onto the public code. */
export const ForbiddenImportSubReasonSchema = z.enum([
  "module",
  "require",
  "dynamic-import",
  "node-specifier",
  "identifier",
  "import-meta",
  "vi-mock",
  "vi-doMock",
  "vi-stubGlobal",
  "vi-spyOn",
  "only",
  "skip",
  "todo",
  "concurrent",
]);

/** Run errors are a SEPARATE event type: never a reason code, never "survived" (PLAN §2.2). */
export const RUN_ERROR_KINDS = [
  "provider-schema",
  "provider-oversize",
  "provider-truncated",
  "provider-http",
  "sandbox-crash",
  "runner-crash",
  "harness-compile-error",
  "report-parse",
  "storage-exhausted",
  "union-pristine-failure",
  "feedback-key-violation",
  "add-only-guard",
  "replay-miss",
  "schema-violation",
] as const;
export const RunErrorKindSchema = z.enum(RUN_ERROR_KINDS);

/** mutation-testing-report-schema statuses used here. */
export const MutantStatusSchema = z.enum([
  "Killed",
  "Survived",
  "NoCoverage",
  "Timeout",
  "CompileError",
  "RuntimeError",
  "Ignored",
]);
export const KillCauseSchema = z.enum(["assertion", "thrown"]);
export const PartitionSchema = z.enum(["feedback", "scoring"]);
export const MutantSourceSchema = z.enum(["stryker", "inhouse", "planted"]);
export const EngineSchema = z.enum(["stryker", "inhouse"]);

// ---------------------------------------------------------------------------------------------------------
// Source locations
// ---------------------------------------------------------------------------------------------------------

/** 1-based line and column, as in mutation-testing-report-schema. */
export const SourcePositionSchema = z.strictObject({
  line: z.number().int().min(1),
  column: z.number().int().min(1),
});
export type SourcePosition = z.infer<typeof SourcePositionSchema>;

/** Negative if a precedes b, 0 if equal, positive if a follows b. */
export function compareSourcePositions(a: SourcePosition, b: SourcePosition): number {
  return a.line !== b.line ? a.line - b.line : a.column - b.column;
}

export const SourceRangeSchema = z
  .strictObject({ start: SourcePositionSchema, end: SourcePositionSchema })
  .refine((r) => compareSourcePositions(r.end, r.start) >= 0, "range end precedes start");

/** UTF-16 code-unit offsets into a decoded candidate file (`text.slice(start, end)`). */
export const TextRangeSchema = z
  .strictObject({ start: NonNegInt, end: NonNegInt })
  .refine((r) => r.end >= r.start, "range end precedes start");

// ---------------------------------------------------------------------------------------------------------
// Traps (planted mutants) and canary — PLAN §2.3
// ---------------------------------------------------------------------------------------------------------

export const NAMED_TRAPS = [
  "boundary-off-by-one",
  "equivalent-loop-bound",
  "message-only",
  "exception-type-only",
  "infinite-loop",
  "dead-flag-branch",
  "float-rounding",
  "sort-stability",
  "quirk-trap",
] as const;
export const NamedTrapSchema = z.enum(NAMED_TRAPS);
/** A trap kind is one of the nine named traps or the per-subject disposable canary. */
export const TRAP_KINDS = [...NAMED_TRAPS, "canary"] as const;
export const TrapKindSchema = z.enum(TRAP_KINDS);
export const TrapLabelSchema = z.enum(["killable", "equivalent", "contract-silent"]);
export const MAX_SCORED_TRAPS_PER_SUBJECT = 3;

/** Trap kinds whose planted mutant may be labelled `equivalent` (it cannot change behaviour). */
export const EQUIVALENT_CAPABLE_TRAPS = ["equivalent-loop-bound", "dead-flag-branch"] as const;

/**
 * One planted mutant. `file` is subject-relative (see isSubjectRelFile). `range` uses 1-based lines and
 * columns (UTF-16 code units) with an EXCLUSIVE end column, as in mutation-testing-report-schema: for a
 * single-line range, `original === lineText.slice(start.column - 1, end.column - 1)`.
 * Labels: `equivalent-loop-bound` is always `equivalent`; `dead-flag-branch` may be `equivalent` (a mutation
 * inside a branch guarded by a constant-false flag) or `killable` (flipping the flag itself); no other trap
 * may be `equivalent`.
 */
export const TrapSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "expected a lowercase trap id"),
    trap: TrapKindSchema,
    file: SubjectRelFileSchema,
    range: SourceRangeSchema,
    /** Exact original text at `range`; patchrun verifies it before replacing. */
    original: z.string().min(1),
    replacement: z.string(),
    label: TrapLabelSchema,
    /** Only `infinite-loop` carries this; it must end as Timeout. */
    expectedStatus: z.literal("Timeout").optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((t, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    if (t.original === t.replacement) issue("replacement must differ from original", "replacement");
    if (t.trap === "infinite-loop" && t.expectedStatus !== "Timeout")
      issue("infinite-loop must declare expectedStatus: Timeout", "expectedStatus");
    if (t.trap !== "infinite-loop" && t.expectedStatus !== undefined)
      issue("only infinite-loop declares expectedStatus", "expectedStatus");
    if (t.trap === "equivalent-loop-bound" && t.label !== "equivalent")
      issue("equivalent-loop-bound must be labelled equivalent", "label");
    if (t.label === "equivalent" && !(EQUIVALENT_CAPABLE_TRAPS as readonly string[]).includes(t.trap))
      issue("label 'equivalent' is only for equivalent-loop-bound and dead-flag-branch", "label");
    if ((t.trap === "message-only" || t.trap === "exception-type-only") && t.label !== "contract-silent")
      issue(`${t.trap} must be labelled contract-silent`, "label");
    if (t.trap === "canary" && t.label !== "killable") issue("the canary is an obvious killable change", "label");
  });
export type Trap = z.infer<typeof TrapSchema>;

/** `fixtures/subjects/<id>/traps.json`. */
export const TrapsFileSchema = z
  .strictObject({
    schemaVersion,
    subjectId: SlugSchema,
    traps: z.array(TrapSchema).min(1),
  })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    for (const t of f.traps) {
      if (ids.has(t.id)) ctx.addIssue({ code: "custom", message: `duplicate trap id ${t.id}`, path: ["traps"] });
      ids.add(t.id);
    }
    const canaries = f.traps.filter((t) => t.trap === "canary").length;
    if (canaries !== 1) ctx.addIssue({ code: "custom", message: "exactly one canary per subject", path: ["traps"] });
    const scored = f.traps.length - canaries;
    if (scored > MAX_SCORED_TRAPS_PER_SUBJECT)
      ctx.addIssue({ code: "custom", message: `at most ${MAX_SCORED_TRAPS_PER_SUBJECT} scored traps`, path: ["traps"] });
  });
export type TrapsFile = z.infer<typeof TrapsFileSchema>;

// ---------------------------------------------------------------------------------------------------------
// Subjects and the manifest (gold/manifest.json) — PLAN D10, D13
// ---------------------------------------------------------------------------------------------------------

export const SubjectHashesSchema = z.strictObject({
  src: Sha256OrPendingSchema,
  hand: Sha256OrPendingSchema,
  twin: Sha256OrPendingSchema,
  traps: Sha256OrPendingSchema,
});

export const DevSubjectEntrySchema = z.strictObject({ id: SlugSchema, sha256: SubjectHashesSchema });
export const HeldoutSubjectEntrySchema = z.strictObject({
  id: SlugSchema,
  /** Trap-matched dev partner; required when splitMethod is designed-stratified (D10). */
  partner: SlugSchema.optional(),
  sha256: SubjectHashesSchema,
});

/** D10: edition 1 uses a designed, stratified assignment; split.ts keeps a seeded split for later editions. */
export const SplitMethodSchema = z.enum(["designed-stratified", "seeded-hash"]);

export const SubjectManifestSchema = z
  .strictObject({
    schemaVersion,
    /** D13: any change to subjects, hand suites or twins after the first inventory is a new edition. */
    edition: z.number().int().min(1),
    splitMethod: SplitMethodSchema,
    splitRationale: z.string().min(1),
    /** Seed used for mutant splitting and bootstrap (and for the subject split if splitMethod is seeded-hash). */
    seed: SeedSchema,
    freezeDate: z.union([IsoDateSchema, z.literal("pending")]),
    dev: z.array(DevSubjectEntrySchema).min(1),
    heldout: z.array(HeldoutSubjectEntrySchema).min(1),
  })
  .superRefine((m, ctx) => {
    const devIds = new Set<string>();
    const all = new Set<string>();
    for (const s of [...m.dev, ...m.heldout]) {
      if (all.has(s.id)) ctx.addIssue({ code: "custom", message: `subject ${s.id} listed twice`, path: ["dev"] });
      all.add(s.id);
    }
    for (const s of m.dev) devIds.add(s.id);
    if (m.splitMethod === "designed-stratified") {
      const partners = new Set<string>();
      for (const h of m.heldout) {
        if (h.partner === undefined) {
          ctx.addIssue({ code: "custom", message: `held-out ${h.id} needs a dev partner`, path: ["heldout"] });
          continue;
        }
        if (!devIds.has(h.partner))
          ctx.addIssue({ code: "custom", message: `partner ${h.partner} is not a dev subject`, path: ["heldout"] });
        if (partners.has(h.partner))
          ctx.addIssue({ code: "custom", message: `dev ${h.partner} partners twice`, path: ["heldout"] });
        partners.add(h.partner);
      }
    }
  });
export type SubjectManifest = z.infer<typeof SubjectManifestSchema>;

/** A subject as referenced by a run record. */
export const SubjectSchema = z.strictObject({
  id: SlugSchema,
  split: SplitSchema,
  srcSha256: Sha256OrPendingSchema,
});
export type Subject = z.infer<typeof SubjectSchema>;

// ---------------------------------------------------------------------------------------------------------
// Mutants — PLAN §2.3 (key computed in mutantKey.ts, CLI-only)
// ---------------------------------------------------------------------------------------------------------

const NoPipe = (s: string) => !s.includes("|");

/**
 * Exactly the inputs of the mutant key; there is deliberately no ordinal/engine id field.
 * `relFile` is subject-relative (isSubjectRelFile), the same convention as Trap.file.
 */
export const MutantKeyInputSchema = z.strictObject({
  relFile: SubjectRelFileSchema.refine(NoPipe, "relFile may not contain '|'"),
  srcSha256: Sha256HexSchema,
  range: SourceRangeSchema,
  mutator: z.string().min(1).max(128).refine(NoPipe, "mutator may not contain '|'"),
  replacement: z.string(),
});
export type MutantKeyInput = z.infer<typeof MutantKeyInputSchema>;

export const MutantRecordSchema = z.strictObject({
  key: Sha256HexSchema,
  /** Subject-relative (isSubjectRelFile). */
  relFile: SubjectRelFileSchema,
  srcSha256: Sha256HexSchema,
  range: SourceRangeSchema,
  mutator: z.string().min(1).max(128),
  replacement: z.string(),
  source: MutantSourceSchema,
  /** Location group (enclosing statement, fallback file+line) used by the split. */
  groupKey: z.string().min(1),
});
export type MutantRecord = z.infer<typeof MutantRecordSchema>;

/** Frozen inventory `results/mutants/<id>.json`, written once by `mutants --execute --split all`. */
export const MutantInventorySchema = z
  .strictObject({
    schemaVersion,
    subjectId: SlugSchema,
    srcSha256: Sha256HexSchema,
    engine: EngineSchema,
    engineVersion: z.string().min(1).nullable(),
    createdAt: IsoTimestampSchema,
    seed: SeedSchema,
    mutants: z.array(MutantRecordSchema),
    partition: z.strictObject({ feedback: z.array(Sha256HexSchema), scoring: z.array(Sha256HexSchema) }),
    reservedGroups: z.array(z.string().min(1)),
    compileErrorCount: NonNegInt,
    duplicatesRemoved: NonNegInt,
  })
  .superRefine((inv, ctx) => {
    const keys = new Set(inv.mutants.map((m) => m.key));
    const fb = new Set(inv.partition.feedback);
    for (const k of inv.partition.scoring)
      if (fb.has(k)) ctx.addIssue({ code: "custom", message: `key in both partitions: ${k}`, path: ["partition"] });
    for (const k of [...inv.partition.feedback, ...inv.partition.scoring])
      if (!keys.has(k)) ctx.addIssue({ code: "custom", message: `partition key not in inventory: ${k}`, path: ["partition"] });
  });
export type MutantInventory = z.infer<typeof MutantInventorySchema>;

// ---------------------------------------------------------------------------------------------------------
// Candidates and test units — PLAN §2.1
// ---------------------------------------------------------------------------------------------------------

/** Byte cap on a model-returned test file. Oversize output is a RunError (provider-oversize), never repaired. */
export const CANDIDATE_MAX_BYTES = 32 * 1024;
/** C1: 1–8 tests per candidate file, same cap for A3–A6. */
export const MAX_TESTS_PER_FILE = 8;

/** The model's only output: `{testFile}` (spec). */
export const ModelOutputSchema = z.strictObject({
  testFile: z
    .string()
    .min(1)
    .refine((s) => utf8ByteLength(s) <= CANDIDATE_MAX_BYTES, `testFile exceeds ${CANDIDATE_MAX_BYTES} bytes`),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

/** One candidate file as produced for (subject, arm, repeat, round, slot). */
export const CandidateSchema = z.strictObject({
  candidateId: IdSchema,
  subjectId: SlugSchema,
  arm: ArmIdSchema,
  repeat: NonNegInt,
  round: NonNegInt,
  slot: z.number().int().min(1),
  fileSha256: Sha256HexSchema,
  byteLength: NonNegInt,
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** A unit = exact slice `imports + "\n" + one test statement` of the parent file; content-hashed. */
export const TestUnitSchema = z.strictObject({
  unitSha256: Sha256HexSchema,
  candidateId: IdSchema,
  parentFileSha256: Sha256HexSchema,
  subjectId: SlugSchema,
  index: z
    .number()
    .int()
    .min(0)
    .max(MAX_TESTS_PER_FILE - 1),
  testName: z.string().min(1),
  importsRange: TextRangeSchema.nullable(),
  testRange: TextRangeSchema,
  byteLength: NonNegInt,
  /** The unit bytes as text (rendered escaped by the viewer, never executed there). */
  text: z.string().min(1),
});
export type TestUnit = z.infer<typeof TestUnitSchema>;

// ---------------------------------------------------------------------------------------------------------
// Execution results. Loop-side and scorer-side are distinct types (scoring boundary, PLAN §2.2):
// loop-side kinds have no field that can hold a scoring-mutant, planted-trap or twin outcome.
// ---------------------------------------------------------------------------------------------------------

const TestOutcomeSchema = z.strictObject({
  name: z.string().min(1),
  unitSha256: Sha256HexSchema.nullable(),
  status: z.enum(["passed", "failed", "skipped"]),
  cause: z.enum(["assertion", "thrown", "timeout", "compile-error", "runner-crash"]).nullable(),
});

const executionBase = {
  unitSha256s: z.array(Sha256HexSchema),
  outcome: z.enum(["passed", "failed", "timeout", "error"]),
  durationMs: NonNegNumber,
  /** vitest sequence.shuffle seed when shuffling was applied (union-of-kept check, PLAN C3). */
  shuffleSeed: SeedSchema.nullable(),
  tests: z.array(TestOutcomeSchema),
  outputTruncated: z.boolean(),
};

/** JSON strings keep captured prototype keys and text out of executable source. */
export const A1ProbeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-zA-Z0-9_-]{0,79}$/),
  exportName: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
  argsJson: z.string().max(16384),
});
export const A1ObservationSchema = z.strictObject({
  probeId: z.string().min(1), outcome: z.enum(["return", "throw", "unsupported"]),
  valueJson: z.string().max(16384).nullable(), errorName: z.string().max(200).nullable(),
  message: z.string().max(1000).nullable(),
});
export type A1Probe = z.infer<typeof A1ProbeSchema>;
export type A1Observation = z.infer<typeof A1ObservationSchema>;

const mutantOutcome = {
  mutantKey: Sha256HexSchema,
  mutantStatus: MutantStatusSchema,
  /** Non-null exactly when mutantStatus is Killed (assertion failure or thrown error in tested code). */
  killCause: KillCauseSchema.nullable(),
};

/** Kill = Killed status attributable to an assertion failure or thrown error; nothing else carries a cause. */
function killCauseConsistent(v: object): boolean {
  if (!("mutantStatus" in v)) return true;
  const killed = v.mutantStatus === "Killed";
  const cause = "killCause" in v ? v.killCause : null;
  return killed === (cause !== null && cause !== undefined);
}
const KILL_CAUSE_MESSAGE = "killCause is set exactly when mutantStatus is Killed";

export const LoopExecutionResultSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("pristine"), attempt: z.union([z.literal(1), z.literal(2)]), ...executionBase }),
    z.strictObject({ kind: z.literal("pristine-union"), ...executionBase }),
    z.strictObject({ kind: z.literal("feedback-mutant"), ...executionBase, ...mutantOutcome }),
    z.strictObject({ kind: z.literal("coverage"), coveredLines: z.array(z.number().int().min(1)),
      /** Actual instrumented executable lines. Optional only for legacy/constructed evidence. */
      executableLines: z.array(z.number().int().min(1)).optional(), ...executionBase }).superRefine((r, ctx) => {
        if (new Set(r.coveredLines).size !== r.coveredLines.length ||
          (r.executableLines !== undefined && (new Set(r.executableLines).size !== r.executableLines.length ||
            r.coveredLines.some((line) => !r.executableLines!.includes(line)))))
          ctx.addIssue({ code: "custom", message: "coverage lines must be unique and covered lines executable" });
      }),
    z.strictObject({ kind: z.literal("a1-capture"), observations: z.array(A1ObservationSchema).max(64), ...executionBase }),
  ])
  .refine(killCauseConsistent, { message: KILL_CAUSE_MESSAGE, path: ["killCause"] });
export type LoopExecutionResult = z.infer<typeof LoopExecutionResultSchema>;

export const ScoringExecutionResultSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("scoring-mutant"), ...executionBase, ...mutantOutcome }),
    z.strictObject({
      kind: z.literal("planted"),
      trapId: z.string().min(1),
      mutantStatus: MutantStatusSchema,
      killCause: KillCauseSchema.nullable(),
      ...executionBase,
    }),
    z.strictObject({ kind: z.literal("twin"), ...executionBase }),
  ])
  .refine(killCauseConsistent, { message: KILL_CAUSE_MESSAGE, path: ["killCause"] });
export type ScoringExecutionResult = z.infer<typeof ScoringExecutionResultSchema>;

export const ExecutionResultSchema = z.union([LoopExecutionResultSchema, ScoringExecutionResultSchema]);
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

// ---------------------------------------------------------------------------------------------------------
// Gate decisions and run errors
// ---------------------------------------------------------------------------------------------------------

const gateBase = {
  type: z.literal("gate-decision"),
  subjectId: SlugSchema,
  arm: ArmIdSchema,
  repeat: NonNegInt,
  round: NonNegInt,
  candidateId: IdSchema,
  /** null only when a whole file is rejected `syntax` before units could be formed. */
  unitSha256: Sha256HexSchema.nullable(),
  unitIndex: NonNegInt.nullable(),
  testName: z.string().min(1).nullable(),
  at: IsoTimestampSchema,
};

export const GateDecisionSchema = z
  .discriminatedUnion("decision", [
    z.strictObject({
      ...gateBase,
      decision: z.literal("accepted"),
      /** FEEDBACK-set mutant keys newly killed (never scoring keys). */
      newKills: z.array(Sha256HexSchema),
      /** Staged immutable file, relative to the repo (content-hash named). */
      stagedAs: RelPathSchema,
      coveredLinesGained: NonNegInt.nullable(),
    }),
    z.strictObject({
      ...gateBase,
      decision: z.literal("rejected"),
      code: RejectionCodeSchema,
      subReason: z.string().min(1).nullable(),
      detail: z.string().max(2000),
    }),
  ])
  .superRefine((g, ctx) => {
    if (g.decision === "accepted") {
      if (g.unitSha256 === null) ctx.addIssue({ code: "custom", message: "accepted decisions name a unit", path: ["unitSha256"] });
      if ((g.arm === "A5" || g.arm === "A6") && g.newKills.length === 0)
        ctx.addIssue({ code: "custom", message: "kill-gated arms accept only with a new kill", path: ["newKills"] });
      return;
    }
    if (g.unitSha256 === null && g.code !== "syntax")
      ctx.addIssue({ code: "custom", message: "only syntax rejections may lack a unit", path: ["unitSha256"] });
    if (g.code === "syntax" && !SyntaxSubReasonSchema.safeParse(g.subReason).success)
      ctx.addIssue({ code: "custom", message: "syntax needs subReason unsupported-structure|parse-error", path: ["subReason"] });
    if (g.code === "forbidden-import" && !ForbiddenImportSubReasonSchema.safeParse(g.subReason).success)
      ctx.addIssue({ code: "custom", message: "forbidden-import needs a known subReason", path: ["subReason"] });
  });
export type GateDecision = z.infer<typeof GateDecisionSchema>;

export const RunErrorSchema = z.strictObject({
  type: z.literal("run-error"),
  kind: RunErrorKindSchema,
  /** Fatal errors abort the run (exit 3/4); non-fatal ones leave the cell partial (exit 5). */
  fatal: z.boolean(),
  subjectId: SlugSchema.nullable(),
  arm: ArmIdSchema.nullable(),
  repeat: NonNegInt.nullable(),
  round: NonNegInt.nullable(),
  candidateId: IdSchema.nullable(),
  message: z.string().max(2000),
  at: IsoTimestampSchema,
  /** Units whose admissions were rolled back (union-pristine-failure). */
  rolledBack: z.array(Sha256HexSchema),
});
export type RunError = z.infer<typeof RunErrorSchema>;

// ---------------------------------------------------------------------------------------------------------
// Run records (loop-side, published as a sanitized projection under public/runs/, D12)
// ---------------------------------------------------------------------------------------------------------

export const RunCellSchema = z.strictObject({
  subjectId: SlugSchema,
  arm: ArmIdSchema,
  repeat: NonNegInt,
  state: z.enum(["complete", "missing", "refused", "error"]),
  reason: z.string().max(500).nullable(),
  rounds: NonNegInt,
  keptUnits: z.array(Sha256HexSchema),
  /** Wall time per round, ms. */
  roundWallMs: z.array(NonNegNumber),
  inputTokens: NonNegInt,
  outputTokens: NonNegInt,
  /** From the ledger only; null when unknown or not applicable. */
  usd: NonNegNumber.nullable(),
});
export type RunCell = z.infer<typeof RunCellSchema>;

export const RunRecordSchema = z
  .strictObject({
    schemaVersion,
    runId: RunIdSchema,
    createdAt: IsoTimestampSchema,
    providerMode: ProviderModeSchema,
    executionProvenance: ExecutionProvenanceSchema,
    status: RunStatusSchema,
    exitCode: ExitCodeSchema,
    split: SplitSchema,
    campaignId: RunIdSchema.nullable(),
    sandbox: z.enum(["docker", "none"]),
    /** false whenever sandbox is none: the run is disqualified from sandbox-qualified reports. */
    sandboxQualified: z.boolean(),
    model: z.string().min(1).nullable(),
    engine: EngineSchema.nullable(),
    seed: SeedSchema,
    manifestEdition: z.number().int().min(1),
    subjects: z.array(SubjectSchema),
    arms: z.array(ArmIdSchema),
    candidates: z.array(CandidateSchema),
    units: z.array(TestUnitSchema),
    gateDecisions: z.array(GateDecisionSchema),
    runErrors: z.array(RunErrorSchema),
    cells: z.array(RunCellSchema),
    missingCells: z.array(
      z.strictObject({ subjectId: SlugSchema, arm: ArmIdSchema, repeat: NonNegInt, reason: z.string().min(1) }),
    ),
    refusal: z.strictObject({ reason: z.string().min(1), subjectId: SlugSchema.nullable() }).nullable(),
    totals: z.strictObject({ inputTokens: NonNegInt, outputTokens: NonNegInt, usd: NonNegNumber.nullable() }),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    if (!STATUS_EXIT_CODES[r.status].includes(r.exitCode)) issue(`exit ${r.exitCode} not allowed for ${r.status}`, "exitCode");
    if (r.sandbox === "none" && r.sandboxQualified) issue("sandbox none can never be sandbox-qualified", "sandboxQualified");
    if (r.providerMode === "mock" && r.executionProvenance === "measured") issue("mock output is never a measurement", "executionProvenance");
    if (r.executionProvenance === "measured" && r.sandbox !== "docker") issue("measurements require the docker sandbox", "sandbox");
    if (r.status === "refused" && r.refusal === null) issue("refused runs record a refusal reason", "refusal");
    if (r.status === "partial-budget" && r.missingCells.length === 0) issue("partial-budget lists its missing cells", "missingCells");
    if (r.split === "heldout" && r.campaignId === null && r.status !== "refused") issue("held-out runs belong to a campaign", "campaignId");
  });
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** Public run catalog. Entries derive their URL from the safe run id, never a caller path. */
export const RunIndexSchema = z.strictObject({ schemaVersion, runs: z.array(RunIdSchema) });

/** Scorer-owned record, written only after the subject × arm × repeat suite is immutable. The loop never reads it. */
export const ScoringRecordSchema = z.strictObject({
  schemaVersion,
  runId: RunIdSchema,
  scoredAt: IsoTimestampSchema,
  subjectId: SlugSchema,
  arm: ArmIdSchema,
  repeat: NonNegInt,
  suiteUnits: z.array(Sha256HexSchema),
  results: z.array(ScoringExecutionResultSchema),
});
export type ScoringRecord = z.infer<typeof ScoringRecordSchema>;

// ---------------------------------------------------------------------------------------------------------
// Evaluation rows — PLAN §2.8 (null means n/a; never 0% or 100% for an empty denominator)
// ---------------------------------------------------------------------------------------------------------

const Fraction = z.number().min(0).max(1).nullable();

export const EvalRowSchema = z
  .strictObject({
    schemaVersion,
    campaignId: RunIdSchema.nullable(),
    split: SplitSchema,
    subjectId: SlugSchema,
    arm: ArmIdSchema,
    repeat: NonNegInt,
    providerMode: ProviderModeSchema,
    executionProvenance: ExecutionProvenanceSchema,
    engine: EngineSchema,
    counts: z.strictObject({
      killed: NonNegInt,
      timeout: NonNegInt,
      survived: NonNegInt,
      noCoverage: NonNegInt,
      compileError: NonNegInt,
      runtimeError: NonNegInt,
    }),
    labelledEquivalents: NonNegInt,
    /** (Killed+Timeout)/(Killed+Timeout+Survived+NoCoverage). */
    scoreRaw: Fraction,
    scoreKilledOnly: Fraction,
    scoreWithoutEquivalents: Fraction,
    planted: z.array(
      z.strictObject({ trapId: z.string().min(1), trap: NamedTrapSchema, label: TrapLabelSchema, status: MutantStatusSchema }),
    ),
    overfit: z.strictObject({ accepted: NonNegInt, failingTwin: NonNegInt, twinIncomplete: NonNegInt, rate: Fraction }),
    keptUnits: NonNegInt,
    rejectedByCode: z.record(RejectionCodeSchema, NonNegInt),
    runErrors: NonNegInt,
    lineCoverage: Fraction,
    inputTokens: NonNegInt,
    outputTokens: NonNegInt,
    usd: NonNegNumber.nullable(),
    costPerAcceptedTestUsd: NonNegNumber.nullable(),
    /** Percentage points per USD: A3–A5 vs A0, A6 vs A2; null for non-model arms or zero cost. */
    scoreGainPerDollarPp: z.number().nullable(),
    gainBaseline: z.enum(["A0", "A2"]).nullable(),
    naReasons: z.array(z.string().min(1)),
  })
  .superRefine((e, ctx) => {
    const expected = e.arm === "A6" ? "A2" : e.arm === "A3" || e.arm === "A4" || e.arm === "A5" ? "A0" : null;
    if (e.gainBaseline !== expected)
      ctx.addIssue({ code: "custom", message: `gainBaseline for ${e.arm} must be ${String(expected)}`, path: ["gainBaseline"] });
    if (expected === null && e.scoreGainPerDollarPp !== null)
      ctx.addIssue({ code: "custom", message: "non-model arms have no per-dollar gain", path: ["scoreGainPerDollarPp"] });
    if (e.overfit.accepted === 0 && e.overfit.rate !== null)
      ctx.addIssue({ code: "custom", message: "overfit is n/a with zero accepted units", path: ["overfit"] });
  });
export type EvalRow = z.infer<typeof EvalRowSchema>;

/** Post-freeze public companion. Never read by prompts, gate or generation. No paths, transport or environment fields. */
export const PublicAnalysisSchema = z.strictObject({
  schemaVersion,
  runId: RunIdSchema,
  campaignId: RunIdSchema.nullable(),
  split: SplitSchema,
  providerMode: ProviderModeSchema,
  executionProvenance: ExecutionProvenanceSchema,
  sandboxQualified: z.boolean(),
  manifestEdition: z.number().int().min(1),
  seed: SeedSchema,
  inventories: z.array(z.strictObject({
    subjectId: SlugSchema, srcSha256: Sha256HexSchema,
    engine: EngineSchema, compileErrorCount: NonNegInt,
    mutants: z.array(z.strictObject({ key: Sha256HexSchema, range: SourceRangeSchema,
      partition: PartitionSchema, source: MutantSourceSchema })),
    planted: z.array(z.strictObject({ trapId: SlugSchema, trap: NamedTrapSchema, label: TrapLabelSchema, range: SourceRangeSchema })),
  })),
  cells: z.array(z.strictObject({ subjectId: SlugSchema, arm: ArmIdSchema, repeat: NonNegInt,
    state: z.enum(["complete", "incomplete"]),
    issues: z.array(z.enum(["missing-artifact", "invalid-artifact", "incomplete-measurement"])),
    accounting: z.strictObject({ inputTokens: NonNegInt, outputTokens: NonNegInt, usd: NonNegNumber.nullable(), runErrors: NonNegInt }),
    row: EvalRowSchema.nullable(),
    /** A6 generated top-up only; row.overfit is the combined hand + top-up suite. */
    topUpOverfit: z.strictObject({ accepted: NonNegInt, failingTwin: NonNegInt, twinIncomplete: NonNegInt, rate: Fraction }).nullable(),
    matrix: z.array(z.strictObject({ kind: z.enum(["feedback", "scoring", "planted"]),
      mutantKey: Sha256HexSchema.nullable(), trapId: SlugSchema.nullable(),
      unitSha256s: z.array(Sha256HexSchema), status: MutantStatusSchema })),
    twinFailures: z.array(Sha256HexSchema),
  })),
}).superRefine((a, ctx) => {
  if (a.providerMode === "mock" && a.executionProvenance === "measured")
    ctx.addIssue({ code: "custom", message: "mock analysis cannot be measured" });
  const ids = new Set(a.inventories.map((i) => i.subjectId));
  if (ids.size !== a.inventories.length) ctx.addIssue({ code: "custom", message: "duplicate inventory" });
  const cells = new Set<string>();
  for (const c of a.cells) {
    const key = `${c.subjectId}/${c.arm}/${c.repeat}`;
    if (cells.has(key)) ctx.addIssue({ code: "custom", message: "duplicate analysis cell" });
    cells.add(key);
    if (c.state === "complete" && (c.row === null || c.issues.length > 0)) ctx.addIssue({ code: "custom", message: "complete analysis needs an observed row without issues" });
    if (c.row && (c.row.subjectId !== c.subjectId || c.row.arm !== c.arm || c.row.repeat !== c.repeat ||
      c.row.providerMode !== a.providerMode || c.row.executionProvenance !== a.executionProvenance ||
      c.row.campaignId !== a.campaignId || c.row.split !== a.split || !ids.has(c.subjectId)))
      ctx.addIssue({ code: "custom", message: "analysis row identity mismatch" });
    const inventory = a.inventories.find((i) => i.subjectId === c.subjectId);
    for (const m of c.matrix) {
      if ((m.kind === "planted") !== (m.trapId !== null) || (m.kind !== "planted") !== (m.mutantKey !== null))
        ctx.addIssue({ code: "custom", message: "matrix target identity mismatch" });
      if (m.kind === "planted" ? !inventory?.planted.some((t) => t.trapId === m.trapId) :
        !inventory?.mutants.some((m2) => m2.key === m.mutantKey && m2.partition === m.kind))
        ctx.addIssue({ code: "custom", message: "matrix target absent from its inventory partition" });
    }
  }
});
export type PublicAnalysis = z.infer<typeof PublicAnalysisSchema>;

// ---------------------------------------------------------------------------------------------------------
// Rulings (approvals) — PLAN §2.7
// ---------------------------------------------------------------------------------------------------------

export const RulingSchema = z.strictObject({
  schemaVersion,
  kind: z.literal("test-accept"),
  runId: RunIdSchema,
  subjectId: SlugSchema,
  subjectSha256: Sha256HexSchema,
  testSha256: Sha256HexSchema,
  decision: z.enum(["approve", "reject"]),
  /** Self-declared local label, not an authenticated identity. */
  who: z.string().min(1).max(100),
  when: IsoTimestampSchema,
  why: z.string().min(1).max(2000),
});
export type Ruling = z.infer<typeof RulingSchema>;

// ---------------------------------------------------------------------------------------------------------
// Call ledger (JSONL) — budget reserved before every call, retries included (D14)
// ---------------------------------------------------------------------------------------------------------

export const LEDGER_EVENTS = ["reserved", "settled", "failed-billable", "released", "blocked"] as const;

export const LedgerEntrySchema = z
  .strictObject({
    schemaVersion,
    event: z.enum(LEDGER_EVENTS),
    callId: IdSchema,
    /** Exact owning run/cell. Missing legacy provenance is invalid, never inferred from cached USD. */
    runId: RunIdSchema,
    repeat: NonNegInt,
    at: IsoTimestampSchema,
    provider: ProviderModeSchema,
    model: z.string().min(1),
    /** Date of the price table row used; null when the price is unknown (which blocks live calls). */
    priceTableDate: IsoDateSchema.nullable(),
    budgetScope: SplitSchema,
    subjectId: SlugSchema,
    arm: ModelArmIdSchema,
    round: z.number().int().min(1),
    /** 0 for the first attempt; each explicit retry is reserved separately. */
    attempt: NonNegInt,
    reservedUsd: NonNegNumber.nullable(),
    actualUsd: NonNegNumber.nullable(),
    inputTokens: NonNegInt.nullable(),
    outputTokens: NonNegInt.nullable(),
    reason: z.string().min(1).max(500).nullable(),
  })
  .superRefine((l, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    if (l.event === "reserved" && l.reservedUsd === null) issue("a reservation states its worst-case USD", "reservedUsd");
    if ((l.event === "settled" || l.event === "failed-billable") && l.actualUsd === null)
      issue("settled and failed-billable calls record actual USD", "actualUsd");
    if (l.event === "blocked" && l.reason === null) issue("a blocked call records why (unknown price, cap)", "reason");
  });
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

// ---------------------------------------------------------------------------------------------------------
// Replay fixtures — PLAN §2.4
// ---------------------------------------------------------------------------------------------------------

export const REPLAY_KINDS = [
  "syntax",
  "unsupported-structure",
  "forbidden-import-module",
  "forbidden-import-vi-mock",
  "no-assertion",
  "fails-pristine",
  "no-new-kill",
  "timeout-only",
  "quirk-pin",
  "accept",
  "duplicate-kill",
  "flaky-probabilistic",
] as const;
export const ReplayKindSchema = z.enum(REPLAY_KINDS);

/** The reason code each replay kind is designed to produce (null = accepted). */
export const REPLAY_KIND_EXPECTED_CODE: Readonly<Record<z.infer<typeof ReplayKindSchema>, RejectionCode | null>> = {
  syntax: "syntax",
  "unsupported-structure": "syntax",
  "forbidden-import-module": "forbidden-import",
  "forbidden-import-vi-mock": "forbidden-import",
  "no-assertion": "no-assertion",
  "fails-pristine": "fails-pristine",
  "no-new-kill": "no-new-kill",
  "timeout-only": "timeout",
  "quirk-pin": null,
  accept: null,
  "duplicate-kill": "no-new-kill",
  "flaky-probabilistic": "flaky",
};

const ReplayExpectedUnitSchema = z.strictObject({
  testName: z.string().min(1).nullable(),
  decision: z.enum(["accepted", "rejected"]),
  code: RejectionCodeSchema.nullable(),
  subReason: z.string().min(1).nullable(),
});

/**
 * `fixtures/replay/<subjectId>/<arm>/r<round>-c<slot>.json`. The mock provider returns only `response`;
 * `expected` is for tests and replay:check, never shown to a prompt.
 */
export const ReplayFixtureSchema = z
  .strictObject({
    schemaVersion,
    subjectId: SlugSchema,
    arm: ModelArmIdSchema,
    round: z.number().int().min(1),
    slot: z.number().int().min(1),
    /** Full prompt hash; "pending" during construction, computed once by replay:check at activation. */
    promptSha256: Sha256OrPendingSchema,
    kind: ReplayKindSchema,
    /** True only for the Math.random-based flaky candidate; its outcome is not deterministic. */
    probabilistic: z.boolean(),
    response: z.strictObject({ testFile: z.string().min(1) }),
    expected: z.array(ReplayExpectedUnitSchema).min(1),
    /** quirk-pin: accepted by the gate but expected to fail on twin.ts. */
    expectTwinFailure: z.boolean(),
    note: z.string().max(500).optional(),
  })
  .superRefine((f, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });
    if (f.probabilistic !== (f.kind === "flaky-probabilistic")) issue("probabilistic is true exactly for flaky-probabilistic", "probabilistic");
    if (f.expectTwinFailure !== (f.kind === "quirk-pin")) issue("expectTwinFailure is true exactly for quirk-pin", "expectTwinFailure");
    const code = REPLAY_KIND_EXPECTED_CODE[f.kind];
    const matches =
      code === null
        ? f.expected.some((u) => u.decision === "accepted")
        : f.expected.some((u) => u.decision === "rejected" && u.code === code);
    if (!matches) issue(`kind ${f.kind} must expect ${code ?? "an accepted unit"}`, "expected");
    for (const u of f.expected)
      if ((u.decision === "rejected") !== (u.code !== null)) issue("rejected units carry a code; accepted units do not", "expected");
  });
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;

/** `fixtures/replay/index.json`: slot index; runtime lookup is still by full promptSha256. */
export const ReplayIndexSchema = z
  .strictObject({
    schemaVersion,
    fixtures: z.array(
      z.strictObject({
        subjectId: SlugSchema,
        arm: ModelArmIdSchema,
        round: z.number().int().min(1),
        slot: z.number().int().min(1),
        path: RelPathSchema,
        promptSha256: Sha256OrPendingSchema,
      }),
    ),
  })
  .superRefine((idx, ctx) => {
    const seen = new Set<string>();
    for (const f of idx.fixtures) {
      const slot = `${f.subjectId}/${f.arm}/r${f.round}-c${f.slot}`;
      if (seen.has(slot)) ctx.addIssue({ code: "custom", message: `duplicate slot ${slot}`, path: ["fixtures"] });
      seen.add(slot);
    }
  });
export type ReplayIndex = z.infer<typeof ReplayIndexSchema>;

// ---------------------------------------------------------------------------------------------------------
// Inferred enum types
// ---------------------------------------------------------------------------------------------------------

export type Split = z.infer<typeof SplitSchema>;
export type ArmId = z.infer<typeof ArmIdSchema>;
export type ModelArmId = z.infer<typeof ModelArmIdSchema>;
export type ProviderMode = z.infer<typeof ProviderModeSchema>;
export type ExecutionProvenance = z.infer<typeof ExecutionProvenanceSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RejectionCode = z.infer<typeof RejectionCodeSchema>;
export type SyntaxSubReason = z.infer<typeof SyntaxSubReasonSchema>;
export type ForbiddenImportSubReason = z.infer<typeof ForbiddenImportSubReasonSchema>;
export type RunErrorKind = z.infer<typeof RunErrorKindSchema>;
export type MutantStatus = z.infer<typeof MutantStatusSchema>;
export type KillCause = z.infer<typeof KillCauseSchema>;
export type Partition = z.infer<typeof PartitionSchema>;
export type MutantSource = z.infer<typeof MutantSourceSchema>;
export type Engine = z.infer<typeof EngineSchema>;
export type TrapKind = z.infer<typeof TrapKindSchema>;
export type NamedTrap = z.infer<typeof NamedTrapSchema>;
export type TrapLabel = z.infer<typeof TrapLabelSchema>;
export type SourceRange = z.infer<typeof SourceRangeSchema>;
export type TextRange = z.infer<typeof TextRangeSchema>;
export type SplitMethod = z.infer<typeof SplitMethodSchema>;
export type ReplayKind = z.infer<typeof ReplayKindSchema>;
