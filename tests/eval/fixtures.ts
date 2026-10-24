/** Constructed evidence only; these values do not measure a subject. */
import { ARM_IDS, EvalRowSchema, REJECTION_CODES, SubjectManifestSchema } from "../../cli/core/schemas.js";
import type { ArmId } from "../../cli/core/schemas.js";
export const manifest = SubjectManifestSchema.parse({ schemaVersion: 1, edition: 1, splitMethod: "designed-stratified",
  splitRationale: "Synthetic paired regression subjects", seed: 39, freezeDate: "pending",
  dev: [{ id: "dev-one", sha256: { src: "pending", hand: "pending", twin: "pending", traps: "pending" } },
    { id: "dev-two", sha256: { src: "pending", hand: "pending", twin: "pending", traps: "pending" } }],
  heldout: [{ id: "held-one", partner: "dev-one", sha256: { src: "pending", hand: "pending", twin: "pending", traps: "pending" } },
    { id: "held-two", partner: "dev-two", sha256: { src: "pending", hand: "pending", twin: "pending", traps: "pending" } }] });
export function row(subjectId: string, arm: ArmId, repeat: number, scoreRaw = .5) {
  return EvalRowSchema.parse({ schemaVersion: 1, campaignId: "fixture-campaign", split: "heldout", subjectId, arm, repeat,
    providerMode: "mock", executionProvenance: "recorded-fixture", engine: "inhouse",
    counts: { killed: 1, timeout: 0, survived: 1, noCoverage: 0, compileError: 0, runtimeError: 0 }, labelledEquivalents: 0,
    scoreRaw, scoreKilledOnly: scoreRaw, scoreWithoutEquivalents: scoreRaw, planted: [],
    overfit: { accepted: 1, failingTwin: 0, twinIncomplete: 0, rate: 0 }, keptUnits: 1,
    rejectedByCode: Object.fromEntries(REJECTION_CODES.map((code) => [code, 0])), runErrors: 0,
    lineCoverage: null, inputTokens: 1, outputTokens: 1, usd: null, costPerAcceptedTestUsd: null,
    scoreGainPerDollarPp: null, gainBaseline: arm === "A6" ? "A2" : ["A3", "A4", "A5"].includes(arm) ? "A0" : null, naReasons: [] });
}
export const campaign = () => manifest.heldout.flatMap((subject) => ARM_IDS.flatMap((arm) =>
  Array.from({ length: ["A0", "A1", "A2"].includes(arm) ? 1 : 3 }, (_, repeat) => ({
    row: row(subject.id, arm, repeat, subject.id === "held-one" ? .25 : .75), complete: true }))));
