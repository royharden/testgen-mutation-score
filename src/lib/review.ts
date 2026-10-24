import type { GateDecision, RunRecord, TestUnit } from "../../cli/core/schemas.js";

export interface ReviewItem { decision: Extract<GateDecision, { decision: "accepted" }>; unit: TestUnit; subjectHash: string }
const cellKey = (c: { subjectId: string; arm: string; repeat: number }) => `${c.subjectId}/${c.arm}/${c.repeat}`;
/** A content hash can recur across arms, repeats and rounds. Rollback belongs to its admission event. */
export function isRolledBack(run: RunRecord, decision: GateDecision): boolean {
  return decision.unitSha256 !== null && run.runErrors.some((error) =>
    error.subjectId === decision.subjectId && error.arm === decision.arm && error.repeat === decision.repeat &&
    error.round === decision.round && error.rolledBack.includes(decision.unitSha256 ?? ""));
}
export function reviewItems(run: RunRecord): ReviewItem[] {
  const items = new Map<string, ReviewItem>();
  for (const decision of run.gateDecisions) {
    if (decision.decision !== "accepted" || decision.unitSha256 === null || isRolledBack(run, decision)) continue;
    const unit = run.units.find((u) => u.unitSha256 === decision.unitSha256);
    const subjectHash = run.subjects.find((s) => s.id === decision.subjectId)?.srcSha256;
    if (!unit || !subjectHash || subjectHash === "pending" || !run.cells.some((c) => cellKey(c) === cellKey(decision) && c.keptUnits.includes(unit.unitSha256))) continue;
    items.set(`${cellKey(decision)}/${unit.unitSha256}`, { decision, unit, subjectHash });
  }
  return [...items.values()];
}
