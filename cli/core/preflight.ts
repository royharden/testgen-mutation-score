import { parseCandidate } from "./grammar.js";
import { sha256Hex } from "./mutantKey.js";
import { TestUnitSchema } from "./schemas.js";
import type { MutantInventory, TestUnit, Trap } from "./schemas.js";
import type { FeedbackExecutor, IsolatedRunner } from "../engines/engine.js";
import { executePlanted } from "../engines/patchrun.js";

export class PreflightRefusal extends Error { readonly exitCode = 2; }
export function unitsFromFile(subjectId: string, file: string, candidateId: string): TestUnit[] {
  const parsed = parseCandidate(file);
  if (!parsed.ok) throw new PreflightRefusal("frozen hand suite violates the candidate grammar");
  return parsed.units.map((unit) => TestUnitSchema.parse({ index: unit.index, testName: unit.testName,
    importsRange: unit.importsRange, testRange: unit.testRange, text: unit.text, unitSha256: sha256Hex(unit.text),
    parentFileSha256: sha256Hex(file), subjectId, candidateId, byteLength: Buffer.byteLength(unit.text, "utf8") }));
}
export async function preflight(input: {
  source: string; hand: string; inventory: MutantInventory; canary: Trap; feedback: FeedbackExecutor; run: IsolatedRunner;
}): Promise<TestUnit[]> {
  if (!input.inventory.partition.feedback.length || !input.inventory.partition.scoring.length)
    throw new PreflightRefusal("empty feedback or scoring partition");
  if (sha256Hex(input.source) !== input.inventory.srcSha256) throw new PreflightRefusal("inventory source freeze differs");
  const handUnits = unitsFromFile(input.inventory.subjectId, input.hand, `hand:${input.inventory.subjectId}`);
  for (const attempt of [1, 2] as const) {
    const outcomes = await input.feedback.execute({ kind: "pristine", units: handUnits, attempt });
    if (outcomes.length !== 1 || outcomes[0]?.outcome !== "passed") throw new PreflightRefusal(`hand suite fails pristine attempt ${attempt}`);
  }
  const canary = await executePlanted(input.run, input.source, handUnits, input.canary);
  if (canary.kind !== "planted" || canary.mutantStatus !== "Killed" || !["assertion", "thrown"].includes(canary.killCause ?? ""))
    throw new PreflightRefusal("hand suite does not kill the disposable canary");
  return handUnits;
}
