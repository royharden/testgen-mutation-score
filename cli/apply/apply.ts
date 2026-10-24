/** Apply local approvals only after full-log and immutable-artifact validation. Never executes tests. */
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { CliContext } from "../index.js";
import { CellArtifactSchema, FrozenCellSuiteSchema, suiteHash } from "../arms/runner.js";
import { PreflightRefusal } from "../core/preflight.js";
import { sha256Bytes } from "../core/staging.js";
import { JournalSchema } from "../core/campaign.js";
import { RunIdSchema, RunRecordSchema, Sha256HexSchema, SlugSchema, isSafeRelPath } from "../core/schemas.js";
import type { Ruling, RunRecord, TestUnit } from "../core/schemas.js";
import { parseRulingLogs, resolveRulings, RulingLogError } from "../rulings/rulings.js";
import type { LocatedRuling } from "../rulings/rulings.js";

export interface ApplyFile { relative: string; text: string; subjectId: string; sourceSha256: string; testSha256: string; stagedAs: string }
export interface ApplyPlan { files: ApplyFile[]; invalidated: LocatedRuling[]; revoked: LocatedRuling[] }
const verifiedPlans = new WeakMap<ApplyPlan, string>();
const missing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";
const samePath = (a: string, b: string): boolean => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
function refusal(message: string): never { throw new PreflightRefusal(message); }
function relativeFile(root: string, relative: string): string {
  if (!isSafeRelPath(relative) || relative.includes(":")) refusal("unsafe relative artifact path");
  const resolved = path.resolve(root, ...relative.split("/")), fromRoot = path.relative(path.resolve(root), resolved);
  if (!fromRoot || fromRoot.startsWith(`..${path.sep}`) || fromRoot === ".." || path.isAbsolute(fromRoot)) refusal("artifact path escapes repository");
  return resolved;
}
/** lstat catches symlinks/junctions; realpath also catches redirected ancestors. Missing suffixes are allowed only for output. */
async function checkPath(root: string, relative: string, allowMissing = false): Promise<void> {
  const absolute = relative ? relativeFile(root, relative) : path.resolve(root);
  const parts = absolute.slice(path.parse(absolute).root.length).split(path.sep).filter(Boolean);
  let current = path.parse(absolute).root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !samePath(await realpath(current), current)) refusal("symlink, junction or redirected ancestor refused");
      if (index < parts.length - 1 && !stat.isDirectory()) refusal("artifact ancestor is not a directory");
    } catch (error) { if (allowMissing && missing(error)) return; throw error; }
  }
}
async function readLocal(root: string, relative: string): Promise<Buffer> {
  await checkPath(root, relative);
  const absolute = relativeFile(root, relative), before = await lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink()) refusal("artifact is not a regular file");
  const handle = await open(absolute, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) refusal("artifact changed while opening");
    const bytes = await handle.readFile();
    await checkPath(root, relative);
    const after = await lstat(absolute);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) refusal("artifact changed while reading");
    return bytes;
  } finally { await handle.close(); }
}
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
async function readJson(root: string, relative: string): Promise<unknown> {
  try { return JSON.parse((await readLocal(root, relative)).toString("utf8")) as unknown; }
  catch (error) { if (error instanceof PreflightRefusal) throw error; return refusal(`missing or invalid local artifact: ${relative}`); }
}
async function loadRun(root: string, runId: string): Promise<{ run: RunRecord; modeRoot: string }> {
  RunIdSchema.parse(runId);
  const found: { run: RunRecord; modeRoot: string }[] = [];
  for (const modeRoot of ["results/mock", "results/measured"]) {
    const relative = `${modeRoot}/runs/${runId}.json`;
    try {
      const bytes = await readLocal(root, relative), run = RunRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (run.runId !== runId || (run.providerMode === "mock") !== (modeRoot === "results/mock")) refusal("run identity or mode differs from its local artifact");
      found.push({ run, modeRoot });
    } catch (error) { if (!missing(error)) { if (error instanceof PreflightRefusal) throw error; refusal(`invalid local run: ${runId}`); } }
  }
  if (found.length !== 1) refusal(found.length ? `ambiguous local run: ${runId}` : `unknown local run: ${runId}`);
  return found[0]!;
}
// A resumed campaign may publish a new run containing cells frozen by an earlier run. The journal,
// rather than a directory scan or caller-supplied path, supplies that lineage. Paths are still derived here.
async function retainedCellRun(root: string, run: RunRecord, modeRoot: string, decision: { subjectId: string; arm: string; repeat: number }): Promise<{ runId: string; suiteSha256: string | null }> {
  if (!run.campaignId) return { runId: run.runId, suiteSha256: null };
  const raw = (await readLocal(root, `results/${run.campaignId}.journal.jsonl`)).toString("utf8");
  if (!raw.endsWith("\n")) refusal("campaign journal has a truncated final line");
  const entries = raw.split(/\r?\n/).filter((line) => line.trim()).map((line) => JournalSchema.parse(JSON.parse(line)));
  const found = entries.filter((entry) => entry.event !== "started" && entry.subjectId === decision.subjectId && entry.arm === decision.arm && entry.repeat === decision.repeat);
  if (found.length !== 1) refusal("campaign cell has missing or ambiguous lineage");
  const entry = found[0]!, expected = `${modeRoot}/cells/${entry.runId}/${entry.subjectId}-${entry.arm}-${entry.repeat}.json`;
  if (entry.artifact !== expected || entry.suiteSha256 === null) refusal("campaign cell path or suite identity differs");
  return { runId: entry.runId, suiteSha256: entry.suiteSha256 };
}
async function acceptedUnit(root: string, ruling: Ruling, local: { run: RunRecord; modeRoot: string }): Promise<{ unit: TestUnit; stagedAs: string }> {
  const { run, modeRoot } = local;
  if (!run.subjects.some((subject) => subject.id === ruling.subjectId && subject.srcSha256 === ruling.subjectSha256)) refusal("ruling source identity does not belong to its run");
  const decisions = run.gateDecisions.filter((decision) => decision.decision === "accepted" && decision.subjectId === ruling.subjectId && decision.unitSha256 === ruling.testSha256);
  if (!decisions.length) refusal("unknown or unaccepted test reference");
  let verified: { unit: TestUnit; stagedAs: string } | undefined;
  for (const decision of decisions) {
    if (decision.decision !== "accepted") continue;
    const cell = run.cells.find((value) => value.subjectId === decision.subjectId && value.arm === decision.arm && value.repeat === decision.repeat);
    if (!cell || !cell.keptUnits.includes(ruling.testSha256)) refusal("accepted test is absent from the retained cell");
    const origin = await retainedCellRun(root, run, modeRoot, decision), name = `${decision.subjectId}-${decision.arm}-${decision.repeat}.json`;
    const artifact = CellArtifactSchema.parse(await readJson(root, `${modeRoot}/cells/${origin.runId}/${name}`));
    const frozen = FrozenCellSuiteSchema.parse(await readJson(root, `${modeRoot}/frozen/${origin.runId}/${name}`));
    if (!sameJson(artifact.cell, cell) || !sameJson(artifact.frozen, frozen) || frozen.runId !== origin.runId ||
        (origin.suiteSha256 !== null && origin.suiteSha256 !== frozen.frozenSuiteSha256) ||
        frozen.subjectId !== decision.subjectId || frozen.arm !== decision.arm || frozen.repeat !== decision.repeat ||
        frozen.subjectSha256 !== ruling.subjectSha256 || suiteHash(frozen.units) !== frozen.frozenSuiteSha256 ||
        !sameJson([...cell.keptUnits].sort(), frozen.units.map((unit) => unit.unitSha256).sort()) ||
        !artifact.gateDecisions.some((value) => sameJson(value, decision))) refusal("accepted decision, cell and frozen suite disagree");
    const units = artifact.units.filter((unit) => unit.unitSha256 === ruling.testSha256 && unit.candidateId === decision.candidateId);
    if (units.length !== 1) refusal("accepted candidate/unit identity is ambiguous or absent");
    const unit = units[0]!;
    const candidate = artifact.candidates.find((value) => value.candidateId === decision.candidateId && value.subjectId === ruling.subjectId &&
      value.arm === decision.arm && value.repeat === decision.repeat && value.round === decision.round && value.fileSha256 === unit.parentFileSha256);
    // RunRecord.units is deduplicated globally by hash; the cell/frozen unit owns subject/candidate identity.
    if (!candidate || !run.candidates.some((value) => sameJson(value, candidate)) || !run.units.some((value) => value.unitSha256 === unit.unitSha256 && value.text === unit.text) ||
        !frozen.units.some((value) => sameJson(value, unit)) || unit.subjectId !== ruling.subjectId || unit.index !== decision.unitIndex ||
        unit.testName !== decision.testName || sha256Bytes(unit.text) !== ruling.testSha256 || Buffer.byteLength(unit.text, "utf8") !== unit.byteLength)
      refusal("accepted candidate identity or immutable unit bytes differ");
    const stagePattern = new RegExp(`^staged/${ruling.subjectId}/[0-9a-f]{64}/${ruling.testSha256}\\.test\\.ts$`);
    if (!stagePattern.test(decision.stagedAs)) refusal("accepted staged path is not canonical");
    const bytes = await readLocal(root, decision.stagedAs);
    if (sha256Bytes(bytes) !== ruling.testSha256 || !bytes.equals(Buffer.from(unit.text, "utf8"))) refusal("immutable staged bytes differ from accepted unit");
    if (verified && verified.unit.text !== unit.text) refusal("test hash has inconsistent accepted unit bytes");
    verified = { unit, stagedAs: decision.stagedAs };
  }
  if (!verified) refusal("unknown accepted test reference");
  return verified;
}
async function checkDestination(root: string, relative: string): Promise<void> {
  await checkPath(root, relative, true);
  try { await lstat(relativeFile(root, relative)); refusal(`destination already exists: ${relative}`); }
  catch (error) { if (!missing(error)) throw error; }
}
/** All logs, including superseded/rejected records, are resolved against local run provenance before writes. */
export async function planApply(root: string, logs: readonly { name: string; text: string }[]): Promise<ApplyPlan> {
  const records = parseRulingLogs(logs); // Parse the entire batch before even considering output directories.
  const runs = new Map<string, Awaited<ReturnType<typeof loadRun>>>(), accepted = new Map<LocatedRuling, Awaited<ReturnType<typeof acceptedUnit>>>();
  for (const record of records) {
    try {
      let local = runs.get(record.ruling.runId);
      if (!local) { local = await loadRun(root, record.ruling.runId); runs.set(record.ruling.runId, local); }
      accepted.set(record, await acceptedUnit(root, record.ruling, local));
    } catch (error) { refusal(`${record.file}:${record.line}: ${error instanceof PreflightRefusal ? error.message : "invalid accepted-test provenance"}`); }
  }
  const plan: ApplyPlan = { files: [], invalidated: [], revoked: [] }, destinations = new Map<string, string>();
  for (const record of resolveRulings(records)) {
    const ruling = record.ruling, source = await readLocal(root, `fixtures/subjects/${ruling.subjectId}/src.ts`);
    if (sha256Bytes(source) !== ruling.subjectSha256) { plan.invalidated.push(record); continue; }
    if (ruling.decision === "reject") { plan.revoked.push(record); continue; }
    const relative = `approved/${ruling.subjectId}/${ruling.testSha256.slice(0, 12)}.test.ts`, previous = destinations.get(relative);
    if (previous && previous !== ruling.testSha256) refusal(`test hash prefix collision: ${relative}`);
    if (previous) continue;
    destinations.set(relative, ruling.testSha256);
    await checkDestination(root, relative);
    const verified = accepted.get(record)!;
    plan.files.push({ relative, text: verified.unit.text, subjectId: ruling.subjectId, sourceSha256: ruling.subjectSha256,
      testSha256: ruling.testSha256, stagedAs: verified.stagedAs });
  }
  verifiedPlans.set(plan, sha256Bytes(JSON.stringify([path.resolve(root), plan.files])));
  return plan;
}
/** Informational unified diff; output file bytes always remain exactly the accepted unit bytes. */
export function applyPatchText(file: ApplyFile): string {
  const lines = file.text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [`diff --git a/${file.relative} b/${file.relative}`, "new file mode 100644", "--- /dev/null", `+++ b/${file.relative}`,
    `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`), ...(file.text.endsWith("\n") ? [] : ["\\ No newline at end of file"])].join("\n");
}
async function revalidate(root: string, files: readonly ApplyFile[]): Promise<void> {
  for (const file of files) {
    if (sha256Bytes(await readLocal(root, `fixtures/subjects/${file.subjectId}/src.ts`)) !== file.sourceSha256 ||
        sha256Bytes(await readLocal(root, file.stagedAs)) !== file.testSha256 || sha256Bytes(file.text) !== file.testSha256)
      refusal("source or staged bytes changed after approval planning");
    await checkDestination(root, file.relative);
  }
}
/** Exclusive file creation prevents overwrites. Ancestors are rechecked before each open; an OS directory-fd
 * sandbox would be needed to eliminate all concurrent hostile ancestor swaps on every supported platform. */
export async function writeApplyPlan(root: string, plan: ApplyPlan): Promise<void> {
  if (verifiedPlans.get(plan) !== sha256Bytes(JSON.stringify([path.resolve(root), plan.files]))) refusal("apply plan was not verified or was modified after verification");
  // Revalidate the WHOLE verified batch before the first mkdir/open.
  for (const file of plan.files) {
    SlugSchema.parse(file.subjectId); Sha256HexSchema.parse(file.testSha256); Sha256HexSchema.parse(file.sourceSha256);
    if (file.relative !== `approved/${file.subjectId}/${file.testSha256.slice(0, 12)}.test.ts` ||
        !new RegExp(`^staged/${file.subjectId}/[0-9a-f]{64}/${file.testSha256}\\.test\\.ts$`).test(file.stagedAs)) refusal("apply plan contains a noncanonical path");
  }
  if (new Set(plan.files.map((file) => file.relative)).size !== plan.files.length) refusal("apply plan contains colliding destinations");
  await revalidate(root, plan.files);
  for (const file of plan.files) {
    for (const directory of ["approved", `approved/${file.subjectId}`]) {
      await checkPath(root, directory, true);
      try { await mkdir(relativeFile(root, directory)); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
      await checkPath(root, directory);
      if (!(await lstat(relativeFile(root, directory))).isDirectory()) refusal("approved ancestor is not a directory");
    }
    await revalidate(root, [file]);
    const handle = await open(relativeFile(root, file.relative), "wx", 0o600);
    try { await handle.writeFile(Buffer.from(file.text, "utf8")); await handle.sync(); }
    finally { await handle.close(); }
  }
}
export async function applyCommand(context: CliContext): Promise<number> {
  const names = context.args.rulings ?? context.args.positional;
  if (!names.length) refusal("apply requires --rulings <file.jsonl> [more files] (or positional ruling files)");
  try {
    const logs = [];
    for (const name of names) {
      let text: string;
      try { text = await readFile(path.resolve(context.repoRoot, name), "utf8"); }
      catch { refusal(`cannot read ruling input: ${name}`); }
      logs.push({ name, text });
    }
    const plan = await planApply(context.repoRoot, logs);
    for (const record of plan.invalidated) context.stdout(`INVALIDATED ${record.ruling.subjectId}/${record.ruling.testSha256}: source hash changed`);
    for (const record of plan.revoked) context.stdout(`REVOKED ${record.ruling.subjectId}/${record.ruling.testSha256}`);
    for (const file of plan.files) context.stdout(applyPatchText(file));
    if (context.args.write) { await writeApplyPlan(context.repoRoot, plan); context.stdout(`WROTE ${plan.files.length} new approved file(s)`); }
    else context.stdout(`DRY RUN — ${plan.files.length} new approved file(s); pass --write to create them`);
    return 0;
  } catch (error) {
    if (error instanceof RulingLogError) refusal(error.message);
    if (error instanceof PreflightRefusal) throw error;
    refusal("apply failed while verifying or exclusively creating local files; inspect existing outputs before retrying");
  }
}
