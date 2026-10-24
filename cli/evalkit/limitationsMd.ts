import type { PublicAnalysis } from "../core/schemas.js";
import { PreflightRefusal } from "../core/preflight.js";

/** Replace only the explicitly generated region; retain authored disclosures byte-for-byte. */
export function mergeLimitations(existing: string, generated: string): string {
  const markers = ["<!-- STATIC-LIMITATIONS:START -->", "<!-- STATIC-LIMITATIONS:END -->",
    "<!-- GENERATED-LIMITATIONS:START -->", "<!-- GENERATED-LIMITATIONS:END -->"];
  const positions = markers.map((marker) => existing.indexOf(marker));
  if (positions.some((position, index) => position < 0 || existing.indexOf(markers[index]!, position + 1) !== -1) ||
    positions.some((position, index) => index > 0 && position <= positions[index - 1]!)) {
    throw new PreflightRefusal("docs/LIMITATIONS.md needs one ordered STATIC-LIMITATIONS and GENERATED-LIMITATIONS marker pair; restore the authored template before evaluation (existing text was not replaced)");
  }
  const start = positions[2]! + markers[2]!.length;
  return existing.slice(0, start) + "\n\n" + generated.trimEnd() + "\n\n" + existing.slice(positions[3]!);
}
/** Labels are mechanical observations, never inferred equivalence or proven root causes. */
export function limitationsMd(analyses: readonly PublicAnalysis[]): string {
  const lines = ["# Evaluation limitations", "", analyses.some((a) => a.providerMode === "mock") ? "> MOCK / REPLAY — not measured." : "> Generated from post-freeze measured artifacts.", "",
    "A5 versus A4 compares whole policies: acceptance gate plus feedback. It does not isolate the gate. Twelve held-out subjects provide a small exploratory sample, and bootstrap intervals do not establish generality. Designed-stratified subject assignment deviates from a seeded subject split. Accepted tests are staged as separate immutable files.", "",
    "Passing twice cannot establish absence of flakiness. Twin assertion failures measure behavior differences, not proof that a test is wrong. Twin timeouts, compile failures, crashes and missing results are incomplete measurements. A6 reports top-up and combined-suite twin outcomes separately. Hand suites are an agent-authored proxy, not human ground truth.", "",
    "Mechanical labels below are heuristics: uncovered uses recorded NoCoverage status only; timeout is the observed execution status; model-missed means survived with coverage. Equivalent is used only for authored planted labels. Unlabelled equivalence remains unknown. No label changes the unadjusted score.", "",
    "## A5 scoring outcomes that remain unresolved", ""];
  for (const analysis of analyses) for (const cell of analysis.cells.filter((c) => c.arm === "A5")) {
    const inv = analysis.inventories.find((i) => i.subjectId === cell.subjectId);
    for (const m of cell.matrix.filter((m) => m.kind !== "feedback" && m.status !== "Killed")) {
      const equivalent = m.kind === "planted" && inv?.planted.find((t) => t.trapId === m.trapId)?.label === "equivalent";
      const label = equivalent ? "equivalent (planted author label)" : m.status === "NoCoverage" ? "uncovered" : m.status === "Timeout" ? "timeout" : m.status === "Survived" ? "model-missed" : "incomplete execution";
      lines.push(`- ${cell.subjectId}/A5/${cell.repeat}: ${m.mutantKey ?? m.trapId} — ${m.status}; ${label}.`);
    }
  }
  lines.push("", "## Per-unit twin failures and unresolved traps", "");
  for (const analysis of analyses) for (const c of analysis.cells) {
    for (const hash of c.twinFailures) lines.push(`- ${c.subjectId}/${c.arm}/${c.repeat}: unit ${hash} failed its twin by assertion or tested-code throw.`);
    for (const trap of c.row?.planted ?? []) if (trap.status !== "Killed") lines.push(`- ${c.subjectId}/${c.arm}/${c.repeat}: trap ${trap.trapId} (${trap.label}) remains ${trap.status}.`);
    if (c.state === "incomplete") lines.push(`- ${c.subjectId}/${c.arm}/${c.repeat}: incomplete; campaign inference unavailable.`);
  }
  lines.push("", `Sandbox qualification: ${analyses.every((a) => a.sandboxQualified) ? "all selected runs qualified" : "one or more selected runs disqualified"}.`,
    "Coverage percentages remain n/a when artifacts do not provide an executable-line denominator. Cost is derived only from identity-matched ledger events, never token-price reconstruction. Missing or ambiguous ledger attribution leaves costs n/a. Runtime, Docker isolation and replay dispositions still require activation validation.", "");
  return lines.join("\n");
}
