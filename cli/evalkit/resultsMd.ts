import type { EvalRow, PublicAnalysis } from "../core/schemas.js";
import type { Comparison } from "./compare.js";
export const percent = (v: number | null) => v === null ? "n/a" : `${(v * 100).toFixed(2)}%`;
const number = (v: number | null) => v === null ? "n/a" : v.toFixed(4);
export function resultsMd(rows: readonly EvalRow[], comparison: Comparison, analyses: readonly PublicAnalysis[]): string {
  const mock = analyses.some((a) => a.providerMode === "mock");
  const banner = mock ? "> MOCK / REPLAY — not a measurement.\n" : "> MEASURED — ledger costs and sandbox qualification are listed below.\n";
  const lines = ["# Evaluation results", "", banner, `Split: ${analyses[0]?.split ?? "unknown"}. Campaign: ${analyses[0]?.campaignId ?? analyses[0]?.runId ?? "none"}.`,
    `Sandbox qualified: ${analyses.every((a) => a.sandboxQualified) ? "yes" : "no — disqualified"}.`, "",
    "Raw = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage). Killed-only uses the same denominator. Labelled-equivalent adjustment removes those outcomes from numerator and denominator. Overall scores combine generated scoring mutants and scored planted traps; planted outcomes are also reported separately. Compile errors are separate; inventory compiler exclusions have no partition assignment.", "",
    "| Subject | Arm | Repeat | Raw | Killed only | Without equivalents | Line coverage | Kept | Twin fail / accepted (incomplete) | A6 top-up twin fail / accepted (incomplete) | Input / output tokens | USD | USD / accepted | Gain pp / USD | Compile errors | Run errors |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---:|---:|---:|---:|---:|"];
  for (const r of rows) {
    const top = analyses.flatMap((a) => a.cells).find((c) => c.subjectId === r.subjectId && c.arm === r.arm && c.repeat === r.repeat)?.topUpOverfit;
    lines.push(`| ${r.subjectId} | ${r.arm} | ${r.repeat} | ${percent(r.scoreRaw)} | ${percent(r.scoreKilledOnly)} | ${percent(r.scoreWithoutEquivalents)} | ${percent(r.lineCoverage)} | ${r.keptUnits} | ${r.overfit.failingTwin}/${r.overfit.accepted} (${r.overfit.twinIncomplete}); ${percent(r.overfit.rate)} | ${top ? `${top.failingTwin}/${top.accepted} (${top.twinIncomplete}); ${percent(top.rate)}` : "n/a"} | ${r.inputTokens}/${r.outputTokens} | ${number(r.usd)} | ${number(r.costPerAcceptedTestUsd)} | ${number(r.scoreGainPerDollarPp)} (${r.gainBaseline ?? "n/a"}) | ${r.counts.compileError} | ${r.runErrors} |`);
  }
  lines.push("", `Campaign status: **${comparison.status}**. Required subjects: ${comparison.requiredSubjects.length}.`, "",
    "Equal-weight subject means; min/median/max range over the three campaign aggregates for model arms. Pooled counts are secondary context. Missing cells are never dropped or zero-filled.", "",
    "| Arm | Repeat aggregates | Min | Median | Max | Pooled K / T / S / NC |", "|---|---|---:|---:|---:|---|");
  for (const a of comparison.aggregates) lines.push(`| ${a.arm} | ${a.repeats.map(percent).join(", ")} | ${percent(a.min)} | ${percent(a.median)} | ${percent(a.max)} | ${a.pooled.killed}/${a.pooled.timeout}/${a.pooled.survived}/${a.pooled.noCoverage} |`);
  lines.push("", `Paired A5−A4: ${comparison.bootstrap.estimand}. Seed ${comparison.seed}; 10,000 mulberry32 subject resamples; 95% percentile interval (inverse empirical CDF): ${percent(comparison.bootstrap.low)} to ${percent(comparison.bootstrap.high)}; mean ${percent(comparison.bootstrap.mean)}.`,
    `Hypothesis verdict: ${comparison.hypothesis}. Proposal only; never a pass condition.`, "", "## Missing or incomplete required cells", "",
    ...comparison.missing.map((key) => `- ${key}`), "", "Incomplete cells with retained accounting (unknown scores are not zero):", "",
    ...analyses.flatMap((a) => a.cells.filter((c) => c.row === null).map((c) => `- ${c.subjectId}/${c.arm}/${c.repeat}: score n/a; input/output ${c.accounting.inputTokens}/${c.accounting.outputTokens}; USD ${number(c.accounting.usd)}; run errors ${c.accounting.runErrors}.`)),
    "", "## Cell n/a reasons", "",
    ...rows.filter((r) => r.naReasons.length).map((r) => `- ${r.subjectId}/${r.arm}/${r.repeat}: ${r.naReasons.join("; ")}`), "");
  lines.push("## Rejections and planted outcomes", "",
    ...rows.map((r) => `- ${r.subjectId}/${r.arm}/${r.repeat}: rejections ${Object.entries(r.rejectedByCode).map(([code, count]) => `${code}=${count}`).join(", ")}; planted ${r.planted.map((p) => `${p.trapId} (${p.label})=${p.status}`).join(", ") || "none"}.`), "");
  return lines.join("\n");
}
