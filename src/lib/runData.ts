import { PublicAnalysisSchema, RunIdSchema, RunIndexSchema, RunRecordSchema } from "../../cli/core/schemas.js";
import type { PublicAnalysis, RunRecord } from "../../cli/core/schemas.js";

export interface RunBundle { run: RunRecord; analysis: PublicAnalysis | null; analysisError: string | null }
const identity = (c: { subjectId: string; arm: string; repeat: number }) => `${c.subjectId}/${c.arm}/${c.repeat}`;
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function unique(values: readonly string[], label: string): void {
  requireThat(new Set(values).size === values.length, `Duplicate ${label}`);
}
async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Validate identities as well as shapes before any data reaches a route. No candidate code executes. */
export async function validateRun(raw: unknown, requestedId: string): Promise<RunRecord> {
  const run = RunRecordSchema.parse(raw);
  requireThat(run.runId === requestedId, "Run file identity differs from its URL");
  unique(run.subjects.map((s) => s.id), "subject");
  unique(run.arms, "arm");
  unique(run.candidates.map((c) => c.candidateId), "candidate");
  unique(run.units.map((u) => u.unitSha256), "unit");
  unique(run.cells.map(identity), "cell");
  unique(run.missingCells.map(identity), "missing cell");
  const subjects = new Map(run.subjects.map((s) => [s.id, s]));
  const units = new Map(run.units.map((u) => [u.unitSha256, u]));
  const candidates = new Map(run.candidates.map((c) => [c.candidateId, c]));
  const validCell = (c: { subjectId: string; arm: string }) => subjects.has(c.subjectId) && run.arms.includes(c.arm as RunRecord["arms"][number]);
  for (const subject of run.subjects) requireThat(subject.split === run.split, "Subject split differs from run");
  for (const candidate of run.candidates) requireThat(validCell(candidate), "Candidate references an unknown subject or arm");
  for (const unit of run.units) {
    requireThat(subjects.has(unit.subjectId), "Unit references an unknown subject");
    requireThat(new TextEncoder().encode(unit.text).length === unit.byteLength, "Unit byte length mismatch");
    requireThat(await hash(unit.text) === unit.unitSha256, "Unit content hash mismatch");
    const candidate = candidates.get(unit.candidateId);
    // Frozen A1/hand-suite units also appear in RunRecord, without model candidates.
    if (candidate) requireThat(candidate.subjectId === unit.subjectId && candidate.fileSha256 === unit.parentFileSha256,
      "Unit parent identity mismatch");
  }
  for (const cell of [...run.cells, ...run.missingCells]) requireThat(validCell(cell), "Cell references an unknown subject or arm");
  for (const cell of run.cells) for (const key of cell.keptUnits)
    requireThat(units.get(key)?.subjectId === cell.subjectId, "Kept unit is absent or belongs to another subject");
  for (const decision of run.gateDecisions) {
    const candidate = candidates.get(decision.candidateId);
    requireThat(candidate && identity(candidate) === identity(decision) && candidate.round === decision.round,
      "Gate decision candidate identity mismatch");
    if (decision.unitSha256 !== null) {
      const unit = units.get(decision.unitSha256);
      // RunRecord deduplicates exact unit bytes across candidates. The stored unit's parent/index
      // can belong to a later duplicate proposal; gate events retain their original candidate identity.
      requireThat(unit && unit.subjectId === decision.subjectId && unit.testName === decision.testName,
        "Gate decision unit identity mismatch");
    }
  }
  for (const error of run.runErrors) {
    requireThat(error.subjectId === null || subjects.has(error.subjectId), "Run error subject identity mismatch");
    requireThat(error.arm === null || run.arms.includes(error.arm), "Run error arm identity mismatch");
    for (const key of error.rolledBack) requireThat(units.has(key), "Rollback unit is absent");
  }
  return run;
}

export function validateAnalysis(raw: unknown, run: RunRecord): PublicAnalysis {
  const analysis = PublicAnalysisSchema.parse(raw);
  for (const key of ["runId", "campaignId", "split", "providerMode", "executionProvenance", "sandboxQualified", "manifestEdition", "seed"] as const)
    requireThat(analysis[key] === run[key], `Analysis ${key} differs from run`);
  const subjects = new Map(run.subjects.map((s) => [s.id, s]));
  const units = new Map(run.units.map((u) => [u.unitSha256, u]));
  const cells = new Map([...run.cells, ...run.missingCells].map((c) => [identity(c), c]));
  for (const inventory of analysis.inventories) {
    requireThat(subjects.get(inventory.subjectId)?.srcSha256 === inventory.srcSha256, "Inventory source hash differs from run");
    requireThat(run.engine === inventory.engine, "Inventory engine differs from run");
    unique(inventory.mutants.map((m) => m.key), "mutant");
    unique(inventory.planted.map((t) => t.trapId), "trap");
  }
  requireThat(analysis.cells.length === cells.size, "Analysis cell coverage differs from run");
  for (const cell of analysis.cells) {
    const original = cells.get(identity(cell));
    requireThat(original, "Analysis cell is absent from run");
    if (cell.row) requireThat(cell.row.engine === run.engine, "Analysis row engine differs from run");
    for (const key of [...cell.twinFailures, ...cell.matrix.flatMap((m) => m.unitSha256s)])
      requireThat(units.get(key)?.subjectId === cell.subjectId, "Analysis unit is absent or belongs to another subject");
    const inventory = analysis.inventories.find((i) => i.subjectId === cell.subjectId);
    for (const decision of run.gateDecisions.filter((g) => inventory && identity(g) === identity(cell)))
      if (decision.decision === "accepted") for (const key of decision.newKills)
        requireThat(inventory?.mutants.some((m) => m.key === key && m.partition === "feedback"), "Accepted kill is outside feedback inventory");
  }
  return analysis;
}

async function request(url: string, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal, cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  return response;
}
export async function loadIndex(signal?: AbortSignal): Promise<string[]> {
  const parsed = RunIndexSchema.parse(await (await request("/runs/index.json", signal)).json());
  unique(parsed.runs, "catalog run");
  return parsed.runs;
}
export async function loadRun(id: string, signal?: AbortSignal): Promise<RunBundle> {
  RunIdSchema.parse(id);
  const run = await validateRun(await (await request(`/runs/${id}.json`, signal)).json(), id);
  let analysis: PublicAnalysis | null = null, analysisError: string | null = null;
  try {
    const response = await fetch(`/analysis/${id}.json`, { signal, cache: "no-store", credentials: "omit" });
    if (response.status !== 404) {
      if (!response.ok) throw new Error(`Analysis request failed (HTTP ${response.status})`);
      analysis = validateAnalysis(await response.json(), run);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    analysisError = error instanceof Error ? error.message : "Analysis could not be validated";
  }
  return { run, analysis, analysisError };
}
