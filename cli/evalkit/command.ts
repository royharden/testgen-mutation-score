/** Artifact-only post-freeze evaluator. Importing it starts no execution or provider. */
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CliContext } from "../index.js";
import { RunRecordSchema, RunIdSchema, SubjectManifestSchema, MutantInventorySchema, TrapsFileSchema,
  ScoringRecordSchema, PublicAnalysisSchema, LedgerEntrySchema, ModelArmIdSchema } from "../core/schemas.js";
import type { RunRecord, PublicAnalysis, EvalRow, LedgerEntry } from "../core/schemas.js";
import { CellArtifactSchema, FrozenCellSuiteSchema } from "../arms/runner.js";
import { scoreCell, withCost } from "../core/score.js";
import type { ScoredCell } from "../core/score.js";
import { summarizeLedgerCell } from "../ledger/callledger.js";
import { compareCampaign } from "../evalkit/compare.js";
import type { Observation } from "../evalkit/compare.js";
import { resultsMd } from "../evalkit/resultsMd.js";
import { limitationsMd } from "../evalkit/limitationsMd.js";
import { sha256Hex } from "../core/mutantKey.js";

const isMissing = (e: unknown) => e instanceof Error && "code" in e && e.code === "ENOENT";
/** Refuse symlinks at every path component; caller paths are code-derived, never artifact-supplied. */
async function readText(root: string, relative: string): Promise<string> {
  let at = root;
  for (const part of relative.split("/")) {
    if (!part || part === "." || part === ".." || part.includes("\\")) throw new Error("unsafe evaluation path");
    at = path.join(at, part);
    if ((await lstat(at)).isSymbolicLink()) throw new Error("evaluation refuses symlink artifacts");
  }
  return readFile(at, "utf8");
}
const json = async (root: string, relative: string): Promise<unknown> => JSON.parse(await readText(root, relative));
async function writeOutput(root: string, relative: string, value: string): Promise<void> {
  // Walk existing components before creating directories; generated destinations are fixed by code.
  let at = root;
  for (const part of relative.split("/")) {
    at = path.join(at, part);
    try { if ((await lstat(at)).isSymbolicLink()) throw new Error("evaluation refuses symlink outputs"); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
  await mkdir(path.dirname(at), { recursive: true });
  await writeFile(at, value, "utf8");
}
const identity = (c: { subjectId: string; arm: string; repeat: number }) => `${c.subjectId}/${c.arm}/${c.repeat}`;
interface Loaded { run: RunRecord; analysis: PublicAnalysis; observations: Observation[] }

async function loadRun(root: string, modeRoot: string, run: RunRecord, campaignRuns: readonly RunRecord[], manifest: ReturnType<typeof SubjectManifestSchema.parse>): Promise<Loaded> {
  const analysis: PublicAnalysis = { schemaVersion: 1, runId: run.runId, campaignId: run.campaignId, split: run.split,
    providerMode: run.providerMode, executionProvenance: run.executionProvenance, sandboxQualified: run.sandboxQualified,
    manifestEdition: run.manifestEdition, seed: run.seed, inventories: [], cells: [] };
  const observations: Observation[] = [];
  let ledger: LedgerEntry[] = [], ledgerIssue: string | null = null;
  if (run.providerMode !== "mock") {
    try {
      const text = await readText(root, `results/${run.split}-${run.campaignId ?? "dev"}.ledger.jsonl`);
      if (text && !text.endsWith("\n")) throw new Error("truncated ledger");
      ledger = text.split(/\r?\n/).filter((line) => line.length > 0).map((line) => LedgerEntrySchema.parse(JSON.parse(line)));
    } catch { ledgerIssue = "ledger missing, malformed or lacking explicit run/repeat provenance"; }
  }
  for (const cell of run.cells) {
    const publicCell: PublicAnalysis["cells"][number] = { subjectId: cell.subjectId, arm: cell.arm, repeat: cell.repeat,
      state: "incomplete", issues: [], row: null, topUpOverfit: null, matrix: [], twinFailures: [],
      accounting: { inputTokens: cell.inputTokens, outputTokens: cell.outputTokens, usd: null,
        runErrors: run.runErrors.filter((e) => e.subjectId === cell.subjectId && e.arm === cell.arm && e.repeat === cell.repeat).length } };
    try {
      const filename = `${cell.subjectId}-${cell.arm}-${cell.repeat}.json`;
      // Resumed run records retain old cells. Locate their original immutable owner; never infer scoring from the new run id.
      const candidates: { owner: RunRecord; artifact: ReturnType<typeof CellArtifactSchema.parse> }[] = [];
      for (const owner of campaignRuns) {
        try {
          const artifact = CellArtifactSchema.parse(await json(root, `${modeRoot}/cells/${owner.runId}/${filename}`));
          if (JSON.stringify(artifact.cell) === JSON.stringify(cell)) candidates.push({ owner, artifact });
        } catch (error) { if (!isMissing(error)) throw error; }
      }
      if (candidates.length !== 1) throw new Error("cell has missing or ambiguous immutable owner");
      const { owner, artifact } = candidates[0]!;
      const cost = ledgerIssue === null && run.providerMode !== "mock" && ModelArmIdSchema.safeParse(cell.arm).success ? summarizeLedgerCell(ledger, {
        runId: owner.runId, subjectId: cell.subjectId, arm: ModelArmIdSchema.parse(cell.arm), repeat: cell.repeat }) : null;
      publicCell.accounting = { inputTokens: cost?.inputTokens ?? cell.inputTokens, outputTokens: cost?.outputTokens ?? cell.outputTokens,
        usd: cost?.usd ?? null, runErrors: artifact.runErrors.length };
      const frozen = FrozenCellSuiteSchema.parse(await json(root, `${modeRoot}/frozen/${owner.runId}/${filename}`));
      const loop = CellArtifactSchema.parse(await json(root, `${modeRoot}/loops/${owner.runId}/${filename}`));
      const scoring = ScoringRecordSchema.parse(await json(root, `${modeRoot}/scoring/${owner.runId}/${filename}`));
      const inventory = MutantInventorySchema.parse(await json(root, `results/mutants/${cell.subjectId}.json`));
      const traps = TrapsFileSchema.parse(await json(root, `fixtures/subjects/${cell.subjectId}/traps.json`));
      const entry = manifest[run.split].find((s) => s.id === cell.subjectId);
      if (!entry || entry.sha256.src !== inventory.srcSha256 || run.manifestEdition !== manifest.edition || run.seed !== manifest.seed)
        throw new Error("manifest identity mismatch");
      for (const [name, file] of [["src", "src.ts"], ["hand", "hand.test.ts"], ["twin", "twin.ts"], ["traps", "traps.json"]] as const)
        if (sha256Hex(await readText(root, `fixtures/subjects/${cell.subjectId}/${file}`)) !== entry.sha256[name]) throw new Error("fixture freeze mismatch");
      const scored: ScoredCell = scoreCell({ run: owner, artifact, loop, frozen, scoring, inventory, traps });
      let row = scored.row;
      if (row.gainBaseline) {
        row = withCost(row, cost?.usd ?? null, null, scored.topUpOverfit?.accepted);
        row.naReasons = row.naReasons.filter((r) => !r.startsWith("per-cell USD unavailable:"));
        if (!cost || cost.usd === null) row.naReasons.push(ledgerIssue ?? cost?.reason ?? "mock execution has no paid ledger");
        else if (cost.reason) row.naReasons.push(cost.reason);
        if (cost?.inputTokens !== null && cost?.inputTokens !== undefined) row.inputTokens = cost.inputTokens;
        if (cost?.outputTokens !== null && cost?.outputTokens !== undefined) row.outputTokens = cost.outputTokens;
        // Token counters retain reported-only values when usage is incomplete; disclose the missing component.
        if (cost && (cost.inputTokens === null || cost.outputTokens === null)) row.naReasons.push("ledger token usage incomplete; token counters include reported usage only");
      }
      publicCell.row = row; publicCell.topUpOverfit = scored.topUpOverfit;
      publicCell.state = scored.complete ? "complete" : "incomplete";
      if (!scored.complete) publicCell.issues.push("incomplete-measurement");
      publicCell.matrix = [...artifact.loopExecutions.flatMap((r) => r.kind === "feedback-mutant" ? [{ kind: "feedback" as const,
        mutantKey: r.mutantKey, trapId: null, unitSha256s: r.unitSha256s, status: r.mutantStatus }] : []),
      ...scoring.results.flatMap<PublicAnalysis["cells"][number]["matrix"][number]>((r) => r.kind === "scoring-mutant" ? [{ kind: "scoring" as const, mutantKey: r.mutantKey,
        trapId: null, unitSha256s: r.unitSha256s, status: r.mutantStatus }] : r.kind === "planted" ? [{ kind: "planted" as const,
        mutantKey: null, trapId: r.trapId, unitSha256s: r.unitSha256s, status: r.mutantStatus }] : [])];
      publicCell.twinFailures = scoring.results.filter((r) => r.kind === "twin" && r.outcome === "failed" && r.tests.length === 1 &&
        r.tests[0]?.status === "failed" && ["assertion", "thrown"].includes(r.tests[0]?.cause ?? "")).flatMap((r) => r.unitSha256s);
      if (!analysis.inventories.some((i) => i.subjectId === cell.subjectId)) analysis.inventories.push({ subjectId: inventory.subjectId,
        srcSha256: inventory.srcSha256, engine: inventory.engine, compileErrorCount: inventory.compileErrorCount,
        mutants: inventory.mutants.map((m) => ({ key: m.key, range: m.range,
          partition: inventory.partition.feedback.includes(m.key) ? "feedback" : "scoring", source: m.source })),
        planted: traps.traps.flatMap((t) => t.trap === "canary" ? [] : [{ trapId: t.id, trap: t.trap, label: t.label, range: t.range }]) });
      observations.push({ row, complete: scored.complete });
    } catch (error) {
      publicCell.issues.push(isMissing(error) ? "missing-artifact" : "invalid-artifact");
      // No raw filesystem error, arbitrary runner text or local path enters public JSON.
    }
    analysis.cells.push(publicCell);
  }
  for (const missing of run.missingCells) if (!analysis.cells.some((c) => identity(c) === identity(missing))) analysis.cells.push({
    subjectId: missing.subjectId, arm: missing.arm, repeat: missing.repeat, state: "incomplete", issues: ["missing-artifact"],
    row: null, topUpOverfit: null, matrix: [], twinFailures: [], accounting: { inputTokens: 0, outputTokens: 0, usd: null, runErrors: 0 } });
  return { run, analysis: PublicAnalysisSchema.parse(analysis), observations };
}

/** Sanitized public projection for a completed generation attempt, including MOCK-labelled replay.
 * It does not write evaluation reports or measurements and does not execute a scorer.
 */
export async function publishRunAnalysis(root: string, runInput: RunRecord): Promise<PublicAnalysis> {
  const run = RunRecordSchema.parse(runInput), modeRoot = run.providerMode === "mock" ? "results/mock" : "results/measured";
  const manifest = SubjectManifestSchema.parse(await json(root, "gold/manifest.json"));
  const campaignRuns: RunRecord[] = [];
  for (const name of (await readdir(path.join(root, modeRoot, "runs"))).filter((n) => n.endsWith(".json"))) {
    const id = RunIdSchema.parse(name.slice(0, -5)), candidate = RunRecordSchema.parse(await json(root, `${modeRoot}/runs/${id}.json`));
    if (candidate.runId !== id) throw new Error("run identity mismatch");
    if (candidate.runId === run.runId || (run.campaignId !== null && candidate.campaignId === run.campaignId &&
      candidate.providerMode === run.providerMode && candidate.manifestEdition === run.manifestEdition && candidate.seed === run.seed)) campaignRuns.push(candidate);
  }
  const loaded = await loadRun(root, modeRoot, run, campaignRuns, manifest);
  await writeOutput(root, `public/analysis/${run.runId}.json`, JSON.stringify(loaded.analysis, null, 2) + "\n");
  return loaded.analysis;
}

/** eval [runId ...] --split dev|heldout --provider mock|anthropic|openai_compatible.
 * Omitting ids scans that mode/split, and refuses multiple campaigns or incompatible experiment identities.
 */
export async function evalCommand(context: CliContext): Promise<number> {
  const { repoRoot: root, args } = context, modeRoot = args.provider === "mock" ? "results/mock" : "results/measured";
  if (args.split === "all") throw new Error("eval requires a single split");
  const manifest = SubjectManifestSchema.parse(await json(root, "gold/manifest.json"));
  let names: string[];
  try { names = (await readdir(path.join(root, modeRoot, "runs"))).filter((n) => n.endsWith(".json")); }
  catch (error) { if (!isMissing(error)) throw error; context.stdout("not yet measured — no run artifacts"); return 0; }
  const allRuns = await Promise.all(names.sort().map(async (name) => {
    const id = RunIdSchema.parse(name.slice(0, -5));
    const run = RunRecordSchema.parse(await json(root, `${modeRoot}/runs/${id}.json`));
    if (run.runId !== id) throw new Error("run file identity mismatch");
    return run;
  }));
  const ids = args.positional.map((id) => RunIdSchema.parse(id));
  const selected = allRuns.filter((r) => r.split === args.split && r.providerMode === args.provider && (!ids.length || ids.includes(r.runId)));
  if (ids.some((id) => !selected.some((r) => r.runId === id))) throw new Error("requested run absent or provider/split differs");
  if (!selected.length) { context.stdout("not yet measured — no matching run artifacts"); return 0; }
  const first = selected[0]!;
  const experiment = (r: RunRecord) => JSON.stringify([r.campaignId ?? r.runId, r.split, r.providerMode, r.executionProvenance,
    r.manifestEdition, r.seed, r.engine, r.model, r.sandboxQualified]);
  if (selected.some((r) => experiment(r) !== experiment(first))) throw new Error("select one campaign with identical experiment/provenance/qualification");
  if (first.providerMode !== "mock" && first.executionProvenance !== "measured") throw new Error("measured output refuses samples and replay");
  const campaignRuns = allRuns.filter((r) => experiment(r) === experiment(first));
  const loaded = await Promise.all(selected.map((run) => loadRun(root, modeRoot, run, campaignRuns, manifest)));
  const unique = new Map<string, Observation>();
  for (const item of loaded) for (const o of item.observations) {
    const key = identity(o.row), previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(o)) throw new Error("conflicting retained campaign observations");
    unique.set(key, o);
  }
  // Baselines are once per inventory, repeat 0. Cost gain uses raw pp with A6's hand baseline explicitly labelled.
  for (const o of unique.values()) if (o.row.gainBaseline) {
    const baseline = unique.get(`${o.row.subjectId}/${o.row.gainBaseline}/0`);
    const topUp = loaded.flatMap((l) => l.analysis.cells).find((c) => identity(c) === identity(o.row))?.topUpOverfit?.accepted;
    o.row = withCost(o.row, o.row.usd, baseline?.complete ? baseline.row.scoreRaw : null, topUp);
  }
  const observations = [...unique.values()], rows: EvalRow[] = observations.map((o) => o.row);
  // Reconcile the final gain-bearing rows back into each per-run public companion.
  for (const item of loaded) for (const cell of item.analysis.cells) if (cell.row) cell.row = unique.get(identity(cell))!.row;
  const analyses = loaded.map((l) => PublicAnalysisSchema.parse(l.analysis));
  const comparison = compareCampaign(manifest, args.split, observations);
  const markdown = resultsMd(rows, comparison, analyses), limitations = limitationsMd(analyses);
  // Mock evaluation reports are restricted to results/mock; public viewer projections retain MOCK provenance.
  const output = args.provider === "mock" ? `results/mock/${args.split}` : args.split === "dev" ? "results/dev" : "results";
  await writeOutput(root, `${output}/results.md`, markdown);
  await writeOutput(root, `${output}/results.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  await writeOutput(root, `${output}/comparison.json`, JSON.stringify(comparison, null, 2) + "\n");
  await writeOutput(root, args.provider === "mock" ? `${output}/LIMITATIONS.md` : args.split === "dev" ? "results/dev/LIMITATIONS.md" : "docs/LIMITATIONS.md", limitations);
  // D12 projection is the same exception as public MOCK RunRecords: it always retains mock provenance.
  // Evaluation reports remain in results/mock, and the measured results placeholder remains untouched.
  for (const analysis of analyses) await writeOutput(root, `public/analysis/${analysis.runId}.json`, JSON.stringify(analysis, null, 2) + "\n");
  context.stdout(`${args.provider === "mock" ? "MOCK / REPLAY" : "MEASURED"}: ${comparison.status}; ${rows.length} observed cells; output ${output}/results.md`);
  return comparison.status === "complete" ? 0 : 5;
}

