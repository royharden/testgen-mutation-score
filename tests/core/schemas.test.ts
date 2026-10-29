// M1 acceptance 2 (schema contracts), 6 (exit codes/statuses) and 8 (D1 purity of schemas.ts).
// Authored in Dirty Mode; executed only at activation (`vitest run`, offline, no keys).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_MAX_BYTES,
  EvalRowSchema,
  ExecutionProvenanceSchema,
  GateDecisionSchema,
  LedgerEntrySchema,
  LoopExecutionResultSchema,
  ModelOutputSchema,
  ProviderModeSchema,
  REJECTION_CODES,
  RUN_ERROR_KINDS,
  RejectionCodeSchema,
  ReplayFixtureSchema,
  RulingSchema,
  RunErrorSchema,
  RunRecordSchema,
  RunStatusSchema,
  ScoringExecutionResultSchema,
  SubjectManifestSchema,
  TrapSchema,
  TrapsFileSchema,
  isSubjectRelFile,
  normalizeRelPath,
  utf8ByteLength,
} from "../../cli/core/schemas.js";
import {
  EXIT_CODES,
  RUN_STATUS,
  defaultExitCodeForStatus,
  isExitCodeAllowedForStatus,
  isSuccess,
} from "../../cli/core/exitCodes.js";

/** Shallow copy without one key (for "field is required" cases). */
function omit(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const AT = "2026-10-24T12:00:00Z";

function runRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId: "run-20261024-001",
    createdAt: AT,
    providerMode: "mock",
    executionProvenance: "replay-executed",
    status: "complete",
    exitCode: 0,
    split: "dev",
    campaignId: null,
    sandbox: "docker",
    sandboxQualified: true,
    model: null,
    engine: "stryker",
    seed: 42,
    manifestEdition: 1,
    subjects: [{ id: "clamp-range", split: "dev", srcSha256: SHA_A }],
    arms: ["A0", "A5"],
    candidates: [],
    units: [],
    gateDecisions: [],
    runErrors: [],
    cells: [],
    missingCells: [],
    refusal: null,
    totals: { inputTokens: 0, outputTokens: 0, usd: null },
    ...overrides,
  };
}

function ruling(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "test-accept",
    runId: "run-20261024-001",
    subjectId: "clamp-range",
    subjectSha256: SHA_A,
    testSha256: SHA_B,
    decision: "approve",
    who: "roy",
    when: AT,
    why: "kills the boundary mutant and asserts contract behaviour",
    ...overrides,
  };
}

function rejectedDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "gate-decision",
    subjectId: "clamp-range",
    arm: "A5",
    repeat: 0,
    round: 1,
    candidateId: "clamp-range/A5/r1-c1",
    unitSha256: SHA_A,
    unitIndex: 0,
    testName: "clamps below",
    at: AT,
    decision: "rejected",
    code: "no-new-kill",
    subReason: null,
    detail: "passes twice, kills nothing new",
    ...overrides,
  };
}

function runError(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "run-error",
    kind: "sandbox-crash",
    fatal: true,
    subjectId: "clamp-range",
    arm: "A5",
    repeat: 0,
    round: 1,
    candidateId: null,
    message: "container exited 137",
    at: AT,
    rolledBack: [],
    ...overrides,
  };
}

describe("RunRecord provenance (acceptance 2)", () => {
  it("has exactly the providerMode values of PLAN §2.4", () => {
    expect(ProviderModeSchema.options).toEqual(["mock", "anthropic", "openai_compatible"]);
  });

  it("has exactly the executionProvenance values of PLAN §2.4", () => {
    expect(ExecutionProvenanceSchema.options).toEqual(["measured", "replay-executed", "recorded-fixture"]);
  });

  it("has exactly the four run statuses (C9)", () => {
    expect(RunStatusSchema.options).toEqual(["complete", "partial-budget", "partial-error", "refused"]);
  });

  it("round-trips a valid record unchanged", () => {
    const rec = runRecord();
    expect(RunRecordSchema.parse(rec)).toEqual(rec);
  });

  it("requires providerMode and executionProvenance", () => {
    expect(RunRecordSchema.safeParse(omit(runRecord(), "providerMode")).success).toBe(false);
    expect(RunRecordSchema.safeParse(omit(runRecord(), "executionProvenance")).success).toBe(false);
  });

  it("rejects values outside the enums", () => {
    expect(RunRecordSchema.safeParse(runRecord({ providerMode: "openai" })).success).toBe(false);
    expect(RunRecordSchema.safeParse(runRecord({ executionProvenance: "sample" })).success).toBe(false);
    expect(RunRecordSchema.safeParse(runRecord({ status: "partial" })).success).toBe(false);
  });

  it("never lets mock output pass as a measurement", () => {
    expect(RunRecordSchema.safeParse(runRecord({ executionProvenance: "measured" })).success).toBe(false);
  });

  it("never marks a --sandbox none run as sandbox-qualified", () => {
    expect(RunRecordSchema.safeParse(runRecord({ sandbox: "none", sandboxQualified: true })).success).toBe(false);
    expect(RunRecordSchema.safeParse(runRecord({ sandbox: "none", sandboxQualified: false })).success).toBe(true);
  });

  it("ties exit codes to statuses", () => {
    expect(RunRecordSchema.safeParse(runRecord({ exitCode: 5 })).success).toBe(false);
    expect(
      RunRecordSchema.safeParse(
        runRecord({
          status: "partial-budget",
          exitCode: 5,
          missingCells: [{ subjectId: "clamp-range", arm: "A5", repeat: 0, reason: "budget exhausted" }],
        }),
      ).success,
    ).toBe(true);
    expect(RunRecordSchema.safeParse(runRecord({ status: "refused", exitCode: 2 })).success).toBe(false); // no reason
  });

  it("is strict: unknown keys (env, absolute paths, transport details) are rejected (D12)", () => {
    expect(RunRecordSchema.safeParse(runRecord({ env: { ANTHROPIC_API_KEY: "x" } })).success).toBe(false);
  });
});

describe("reason codes and run errors (acceptance 2)", () => {
  it("has exactly the seven public reason codes, in gate order", () => {
    expect(RejectionCodeSchema.options).toEqual([
      "syntax",
      "forbidden-import",
      "no-assertion",
      "fails-pristine",
      "flaky",
      "timeout",
      "no-new-kill",
    ]);
    expect(REJECTION_CODES).toHaveLength(7);
  });

  it("keeps run-error kinds disjoint from reason codes", () => {
    const codes = new Set<string>(REJECTION_CODES);
    expect(RUN_ERROR_KINDS.filter((k) => codes.has(k))).toEqual([]);
    expect(RUN_ERROR_KINDS).not.toContain("survived");
  });

  it("refuses a run-error kind as a gate code and a gate code as a run-error kind", () => {
    expect(GateDecisionSchema.safeParse(rejectedDecision()).success).toBe(true);
    expect(GateDecisionSchema.safeParse(rejectedDecision({ code: "sandbox-crash" })).success).toBe(false);
    expect(RunErrorSchema.safeParse(runError()).success).toBe(true);
    expect(RunErrorSchema.safeParse(runError({ kind: "syntax" })).success).toBe(false);
  });

  it("keeps RunError a separate schema from GateDecision", () => {
    expect(RunErrorSchema.safeParse(rejectedDecision()).success).toBe(false);
    expect(GateDecisionSchema.safeParse(runError()).success).toBe(false);
  });

  it("requires a known sub-reason for syntax and forbidden-import", () => {
    expect(GateDecisionSchema.safeParse(rejectedDecision({ code: "syntax", subReason: null })).success).toBe(false);
    expect(
      GateDecisionSchema.safeParse(rejectedDecision({ code: "syntax", subReason: "unsupported-structure" })).success,
    ).toBe(true);
    expect(GateDecisionSchema.safeParse(rejectedDecision({ code: "forbidden-import", subReason: "vi-mock" })).success).toBe(
      true,
    );
    expect(GateDecisionSchema.safeParse(rejectedDecision({ code: "forbidden-import", subReason: "fs" })).success).toBe(false);
  });

  it("accepts in kill-gated arms only with a new feedback kill", () => {
    const base = omit(omit(omit(rejectedDecision(), "code"), "subReason"), "detail");
    const accepted = {
      ...base,
      decision: "accepted",
      newKills: [] as string[],
      stagedAs: `staging/clamp-range/${SHA_A}.test.ts`,
      coveredLinesGained: null,
    };
    expect(GateDecisionSchema.safeParse(accepted).success).toBe(false);
    expect(GateDecisionSchema.safeParse({ ...accepted, newKills: [SHA_B] }).success).toBe(true);
    expect(GateDecisionSchema.safeParse({ ...accepted, arm: "A3" }).success).toBe(true);
    expect(GateDecisionSchema.safeParse({ ...accepted, newKills: [SHA_B], stagedAs: "C:/abs/x.ts" }).success).toBe(false);
  });
});

describe("execution results keep the scoring boundary in the types", () => {
  const base = { unitSha256s: [SHA_A], outcome: "failed", durationMs: 12, shuffleSeed: null, tests: [], outputTruncated: false };

  it("loop-side results cannot carry scoring, planted or twin outcomes", () => {
    for (const kind of ["scoring-mutant", "planted", "twin"]) {
      expect(LoopExecutionResultSchema.safeParse({ ...base, kind, mutantKey: SHA_B, mutantStatus: "Killed", killCause: "assertion" }).success).toBe(false);
    }
    expect(ScoringExecutionResultSchema.safeParse({ ...base, kind: "twin" }).success).toBe(true);
  });

  it("counts a kill only with an assertion or thrown-error cause", () => {
    const fm = { ...base, kind: "feedback-mutant", mutantKey: SHA_B };
    expect(LoopExecutionResultSchema.safeParse({ ...fm, mutantStatus: "Killed", killCause: "assertion" }).success).toBe(true);
    expect(LoopExecutionResultSchema.safeParse({ ...fm, mutantStatus: "Killed", killCause: null }).success).toBe(false);
    expect(LoopExecutionResultSchema.safeParse({ ...fm, mutantStatus: "Timeout", killCause: "thrown" }).success).toBe(false);
    expect(LoopExecutionResultSchema.safeParse({ ...fm, mutantStatus: "Timeout", killCause: null }).success).toBe(true);
  });
});

describe("Ruling (acceptance 2, PLAN §2.7)", () => {
  it("round-trips a valid ruling", () => {
    const r = ruling();
    expect(RulingSchema.parse(r)).toEqual(r);
  });

  it("has exactly the fields of §2.7 (strict)", () => {
    expect(Object.keys(RulingSchema.shape).sort()).toEqual(
      ["schemaVersion", "kind", "runId", "subjectId", "subjectSha256", "testSha256", "decision", "who", "when", "why"].sort(),
    );
    expect(RulingSchema.safeParse(ruling({ destination: "approved/x.test.ts" })).success).toBe(false);
  });

  it("validates kind, decision and hashes", () => {
    expect(RulingSchema.safeParse(ruling({ kind: "accept" })).success).toBe(false);
    expect(RulingSchema.safeParse(ruling({ decision: "maybe" })).success).toBe(false);
    expect(RulingSchema.safeParse(ruling({ decision: "reject" })).success).toBe(true);
    expect(RulingSchema.safeParse(ruling({ testSha256: "pending" })).success).toBe(false);
    expect(RulingSchema.safeParse(ruling({ subjectSha256: SHA_A.toUpperCase() })).success).toBe(false);
  });
});

describe("other contracts", () => {
  it("caps model output by UTF-8 bytes, not UTF-16 length", () => {
    expect(utf8ByteLength("aé€😀")).toBe(1 + 2 + 3 + 4);
    expect(ModelOutputSchema.safeParse({ testFile: "a".repeat(CANDIDATE_MAX_BYTES) }).success).toBe(true);
    expect(ModelOutputSchema.safeParse({ testFile: "a".repeat(CANDIDATE_MAX_BYTES + 1) }).success).toBe(false);
    expect(ModelOutputSchema.safeParse({ testFile: "é".repeat(CANDIDATE_MAX_BYTES / 2 + 1) }).success).toBe(false);
    expect(ModelOutputSchema.safeParse({ testFile: "x", extra: 1 }).success).toBe(false);
  });

  it("enforces trap labels and the infinite-loop Timeout expectation", () => {
    const trap = {
      id: "t1",
      trap: "infinite-loop",
      file: "src.ts",
      range: { start: { line: 10, column: 5 }, end: { line: 10, column: 12 } },
      original: "i += 1",
      replacement: "i += 0",
      label: "killable",
      expectedStatus: "Timeout",
    };
    expect(TrapSchema.safeParse(trap).success).toBe(true);
    expect(TrapSchema.safeParse(omit(trap, "expectedStatus")).success).toBe(false);
    expect(TrapSchema.safeParse({ ...trap, trap: "message-only", expectedStatus: undefined, label: "killable" }).success).toBe(false);
    expect(TrapSchema.safeParse({ ...trap, trap: "equivalent-loop-bound", expectedStatus: undefined, label: "equivalent" }).success).toBe(true);
    expect(TrapSchema.safeParse({ ...trap, trap: "not-a-trap" }).success).toBe(false);
  });

  it("allows 'equivalent' only for equivalent-loop-bound (always) and dead-flag-branch (optionally)", () => {
    const base = {
      id: "t1",
      file: "src.ts",
      range: { start: { line: 3, column: 5 }, end: { line: 3, column: 9 } },
      original: "a > b",
      replacement: "a >= b",
    };
    const parse = (trap: string, label: string) => TrapSchema.safeParse({ ...base, trap, label }).success;
    expect(parse("equivalent-loop-bound", "equivalent")).toBe(true);
    expect(parse("equivalent-loop-bound", "killable")).toBe(false);
    expect(parse("dead-flag-branch", "equivalent")).toBe(true); // mutation inside a constant-false branch
    expect(parse("dead-flag-branch", "killable")).toBe(true); // flipping the flag itself
    expect(parse("boundary-off-by-one", "equivalent")).toBe(false);
    expect(parse("quirk-trap", "equivalent")).toBe(false);
    expect(parse("canary", "equivalent")).toBe(false);
  });

  it("pins trap files to the subject-relative convention", () => {
    const trap = {
      id: "t1",
      trap: "boundary-off-by-one",
      file: "src.ts",
      range: { start: { line: 3, column: 5 }, end: { line: 3, column: 9 } },
      original: "a > b",
      replacement: "a >= b",
      label: "killable",
    };
    expect(TrapSchema.safeParse(trap).success).toBe(true);
    expect(TrapSchema.safeParse({ ...trap, file: "fixtures/subjects/clamp-range/src.ts" }).success).toBe(false);
    expect(TrapSchema.safeParse({ ...trap, file: "./src.ts" }).success).toBe(false);
    expect(TrapSchema.safeParse({ ...trap, file: "C:\\src.ts" }).success).toBe(false);
    expect(isSubjectRelFile("src.ts")).toBe(true);
    expect(normalizeRelPath(".\\src.ts")).toBe("src.ts");
    expect(normalizeRelPath("../src.ts")).toBeNull();
  });

  it("requires exactly one canary and at most three scored traps per subject", () => {
    const t = (id: string, trap: string, label = "killable") => ({
      id,
      trap,
      file: "src.ts",
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
      original: "a",
      replacement: "b",
      label,
    });
    const ok = { schemaVersion: 1, subjectId: "clamp-range", traps: [t("c", "canary"), t("b1", "boundary-off-by-one")] };
    expect(TrapsFileSchema.safeParse(ok).success).toBe(true);
    expect(TrapsFileSchema.safeParse({ ...ok, traps: [t("b1", "boundary-off-by-one")] }).success).toBe(false);
    const four = [t("c", "canary"), t("a", "boundary-off-by-one"), t("b", "float-rounding"), t("d", "sort-stability"), t("e", "dead-flag-branch")];
    expect(TrapsFileSchema.safeParse({ ...ok, traps: four }).success).toBe(false);
  });

  it("requires a trap-matched dev partner for designed-stratified manifests (D10)", () => {
    const hashes = { src: "pending", hand: "pending", twin: "pending", traps: "pending" };
    const m = {
      schemaVersion: 1,
      edition: 1,
      splitMethod: "designed-stratified",
      splitRationale: "trap-matched pairs authored dev-first",
      seed: 20261024,
      freezeDate: "pending",
      dev: [{ id: "clamp-range", sha256: hashes }],
      heldout: [{ id: "clamp-window", partner: "clamp-range", sha256: hashes }],
    };
    expect(SubjectManifestSchema.safeParse(m).success).toBe(true);
    expect(SubjectManifestSchema.safeParse({ ...m, heldout: [{ id: "clamp-window", sha256: hashes }] }).success).toBe(false);
    expect(SubjectManifestSchema.safeParse({ ...m, heldout: [{ id: "clamp-range", partner: "clamp-range", sha256: hashes }] }).success).toBe(false);
    expect(SubjectManifestSchema.safeParse({ ...m, splitMethod: "seeded-hash", heldout: [{ id: "clamp-window", sha256: hashes }] }).success).toBe(true);
  });

  it("allows promptSha256 'pending' and ties probabilistic to the flaky fixture", () => {
    const f = {
      schemaVersion: 1,
      subjectId: "clamp-range",
      arm: "A5",
      round: 1,
      slot: 1,
      promptSha256: "pending",
      kind: "accept",
      probabilistic: false,
      response: { testFile: 'import { test, expect } from "vitest";\ntest("a", () => { expect(1).toBe(1); });' },
      expected: [{ testName: "a", decision: "accepted", code: null, subReason: null }],
      expectTwinFailure: false,
    };
    expect(ReplayFixtureSchema.safeParse(f).success).toBe(true);
    expect(ReplayFixtureSchema.safeParse({ ...f, promptSha256: "abc" }).success).toBe(false);
    expect(ReplayFixtureSchema.safeParse({ ...f, probabilistic: true }).success).toBe(false);
    expect(
      ReplayFixtureSchema.safeParse({
        ...f,
        kind: "flaky-probabilistic",
        probabilistic: true,
        expected: [{ testName: "a", decision: "rejected", code: "flaky", subReason: null }],
      }).success,
    ).toBe(true);
    expect(ReplayFixtureSchema.safeParse({ ...f, kind: "quirk-pin" }).success).toBe(false); // needs expectTwinFailure
  });

  it("requires a reservation amount and a reason for blocked calls in the ledger", () => {
    const l = {
      schemaVersion: 1,
      event: "reserved",
      callId: "call-1",
      runId: "ledger-schema-test",
      repeat: 0,
      at: AT,
      provider: "anthropic",
      model: "pinned-model",
      priceTableDate: "2026-10-24",
      budgetScope: "dev",
      subjectId: "clamp-range",
      arm: "A5",
      round: 1,
      attempt: 0,
      reservedUsd: 0.01,
      actualUsd: null,
      inputTokens: null,
      outputTokens: null,
      reason: null,
    };
    expect(LedgerEntrySchema.safeParse(l).success).toBe(true);
    expect(LedgerEntrySchema.safeParse({ ...l, runId: undefined }).success).toBe(false);
    expect(LedgerEntrySchema.safeParse({ ...l, repeat: undefined }).success).toBe(false);
    expect(LedgerEntrySchema.safeParse({ ...l, subjectId: null }).success).toBe(false);
    expect(LedgerEntrySchema.safeParse({ ...l, repeat: -1 }).success).toBe(false);
    expect(LedgerEntrySchema.safeParse({ ...l, reservedUsd: null }).success).toBe(false);
    expect(LedgerEntrySchema.safeParse({ ...l, event: "blocked", reservedUsd: null }).success).toBe(false);
    expect(LedgerEntrySchema.safeParse({ ...l, event: "blocked", reservedUsd: null, reason: "unknown price" }).success).toBe(true);
  });

  it("reports n/a (null) per-dollar gain for non-model arms", () => {
    const row = {
      schemaVersion: 1,
      campaignId: null,
      split: "dev",
      subjectId: "clamp-range",
      arm: "A2",
      repeat: 0,
      providerMode: "mock",
      executionProvenance: "replay-executed",
      engine: "stryker",
      counts: { killed: 3, timeout: 1, survived: 2, noCoverage: 0, compileError: 1, runtimeError: 0 },
      labelledEquivalents: 0,
      scoreRaw: 4 / 6,
      scoreKilledOnly: 3 / 6,
      scoreWithoutEquivalents: 4 / 6,
      planted: [],
      overfit: { accepted: 0, failingTwin: 0, twinIncomplete: 0, rate: null },
      keptUnits: 6,
      rejectedByCode: Object.fromEntries(REJECTION_CODES.map((c) => [c, 0])),
      runErrors: 0,
      lineCoverage: null,
      inputTokens: 0,
      outputTokens: 0,
      usd: null,
      costPerAcceptedTestUsd: null,
      scoreGainPerDollarPp: null,
      gainBaseline: null,
      naReasons: ["non-model arm"],
    };
    expect(EvalRowSchema.safeParse(row).success).toBe(true);
    expect(EvalRowSchema.safeParse({ ...row, scoreGainPerDollarPp: 1.5 }).success).toBe(false);
    expect(EvalRowSchema.safeParse({ ...row, arm: "A6", gainBaseline: "A2" }).success).toBe(true);
    expect(EvalRowSchema.safeParse({ ...row, overfit: { accepted: 0, failingTwin: 0, twinIncomplete: 0, rate: 0 } }).success).toBe(false);
  });
});

describe("exit codes and statuses (acceptance 6)", () => {
  it("defines 0/2/3/4/5", () => {
    expect(Object.values(EXIT_CODES).sort()).toEqual([0, 2, 3, 4, 5]);
    expect(isSuccess(EXIT_CODES.OK)).toBe(true);
    expect(isSuccess(EXIT_CODES.FATAL)).toBe(false);
    expect(isSuccess(EXIT_CODES.INCOMPLETE)).toBe(false);
  });

  it("names the four statuses and maps them to allowed codes", () => {
    expect(Object.values(RUN_STATUS).sort()).toEqual([...RunStatusSchema.options].sort());
    expect(defaultExitCodeForStatus("complete")).toBe(0);
    expect(defaultExitCodeForStatus("refused")).toBe(2);
    expect(defaultExitCodeForStatus("partial-budget")).toBe(5);
    expect(isExitCodeAllowedForStatus("partial-error", 3)).toBe(true);
    expect(isExitCodeAllowedForStatus("complete", 5)).toBe(false);
  });
});

describe("D1 purity of schemas.ts (acceptance 8)", () => {
  const source = readFileSync(new URL("../../cli/core/schemas.ts", import.meta.url), "utf8");

  it("imports only zod", () => {
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    const bare = [...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect([...specifiers, ...bare]).toEqual(["zod"]);
  });

  it("has no dynamic import, require, node: builtin or mutantKey reference", () => {
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/["']node:/);
    // Comments may mention mutantKey.ts; no import statement may name it.
    expect(source).not.toMatch(/\bfrom\s*["'][^"']*mutantKey/);
  });
});
