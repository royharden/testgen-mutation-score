import { ARM_IDS, EvalRowSchema, SubjectManifestSchema } from "../core/schemas.js";
import type { ArmId, EvalRow, Split, SubjectManifest } from "../core/schemas.js";
import { mulberry32, randomIntBelow } from "../core/prng.js";

export const INCOMPLETE = "not computable — incomplete campaign" as const;
export interface Observation { row: EvalRow; complete: boolean }
export interface Comparison {
  status: "complete" | typeof INCOMPLETE; requiredSubjects: string[]; missing: string[]; seed: number;
  aggregates: { arm: ArmId; repeats: (number | null)[]; min: number | null; median: number | null; max: number | null;
    pooled: { killed: number; timeout: number; survived: number; noCoverage: number } }[];
  bootstrap: { samples: 10000; seed: number; estimand: string; mean: number | null; low: number | null; high: number | null };
  hypothesis: "supported (exploratory proposal)" | "not supported (exploratory proposal)" | typeof INCOMPLETE;
}
const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
/** Subjects are the resampling unit. Repeats are averaged within subject before pairing. */
export function pairedBootstrap(differences: readonly number[], seed: number) {
  if (!differences.length || differences.some((d) => !Number.isFinite(d))) throw new Error("bootstrap requires finite paired subjects");
  const random = mulberry32(seed), draws: number[] = [];
  for (let i = 0; i < 10000; i++) {
    let sum = 0;
    for (let j = 0; j < differences.length; j++) sum += differences[randomIntBelow(random, differences.length)]!;
    draws.push(sum / differences.length);
  }
  draws.sort((a, b) => a - b);
  // Inverse empirical CDF (nearest rank), documented for reproducible percentile bounds.
  return { mean: mean(differences), low: draws[249]!, high: draws[9749]! };
}

/** No observed-subject fallback and no complete-case substitution, even for one absent repeat. */
export function compareCampaign(manifestInput: SubjectManifest, split: Split, observations: readonly Observation[]): Comparison {
  const manifest = SubjectManifestSchema.parse(manifestInput), subjects = manifest[split].map((s) => s.id);
  const byKey = new Map<string, Observation>();
  let experiment: string | undefined;
  for (const observation of observations) {
    const row = EvalRowSchema.parse(observation.row), key = `${row.subjectId}/${row.arm}/${row.repeat}`;
    const current = JSON.stringify([row.campaignId, row.providerMode, row.executionProvenance, row.engine]);
    if (experiment !== undefined && current !== experiment) throw new Error("mixed comparison experiments");
    experiment = current;
    if (!subjects.includes(row.subjectId) || row.split !== split || row.repeat > (["A0", "A1", "A2"].includes(row.arm) ? 0 : 2)) throw new Error("foreign comparison cell");
    if (byKey.has(key)) throw new Error("duplicate comparison cell; choose one campaign");
    byKey.set(key, { row, complete: observation.complete });
  }
  const missing: string[] = [];
  for (const subject of subjects) for (const arm of ARM_IDS) for (let repeat = 0; repeat < (["A0", "A1", "A2"].includes(arm) ? 1 : 3); repeat++) {
    const key = `${subject}/${arm}/${repeat}`, o = byKey.get(key);
    if (!o || !o.complete || o.row.scoreRaw === null || o.row.overfit.twinIncomplete > 0) missing.push(key);
  }
  const complete = missing.length === 0;
  const aggregates = ARM_IDS.map((arm) => {
    const rows = [...byKey.values()].filter((o) => o.row.arm === arm).map((o) => o.row);
    const repeats = Array.from({ length: ["A0", "A1", "A2"].includes(arm) ? 1 : 3 }, (_, repeat) =>
      complete ? mean(subjects.map((id) => byKey.get(`${id}/${arm}/${repeat}`)!.row.scoreRaw!)) : null);
    const sorted = repeats.filter((v): v is number => v !== null).sort((a, b) => a - b);
    return { arm, repeats, min: complete ? sorted[0]! : null, median: complete ? sorted[Math.floor(sorted.length / 2)]! : null,
      max: complete ? sorted[sorted.length - 1]! : null,
      pooled: rows.reduce((n, r) => ({ killed: n.killed + r.counts.killed, timeout: n.timeout + r.counts.timeout,
        survived: n.survived + r.counts.survived, noCoverage: n.noCoverage + r.counts.noCoverage }), { killed: 0, timeout: 0, survived: 0, noCoverage: 0 }) };
  });
  const differences = complete ? subjects.map((id) => mean([0, 1, 2].map((repeat) => byKey.get(`${id}/A5/${repeat}`)!.row.scoreRaw!)) -
    mean([0, 1, 2].map((repeat) => byKey.get(`${id}/A4/${repeat}`)!.row.scoreRaw!))) : [];
  const interval = complete ? pairedBootstrap(differences, manifest.seed) : { mean: null, low: null, high: null };
  const a5 = aggregates.find((a) => a.arm === "A5")!, a4 = aggregates.find((a) => a.arm === "A4")!;
  const overfitOk = [...byKey.values()].filter((o) => o.row.arm === "A5").every((o) => o.row.overfit.rate !== null && o.row.overfit.rate <= .1);
  return { status: complete ? "complete" : INCOMPLETE, requiredSubjects: subjects, missing, seed: manifest.seed, aggregates,
    bootstrap: { samples: 10000, seed: manifest.seed, estimand: "equal-weight subject mean of mean-repeats(A5 raw) minus mean-repeats(A4 raw)", ...interval },
    hypothesis: complete ? a5.min! > a4.max! && overfitOk ? "supported (exploratory proposal)" : "not supported (exploratory proposal)" : INCOMPLETE };
}
