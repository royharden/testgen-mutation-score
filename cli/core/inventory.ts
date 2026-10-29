/** Activation-only inventory/freeze IO. Dry-run readers never invoke enumeration or write files. */
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { SubjectManifestSchema, TrapsFileSchema, MutantInventorySchema } from "./schemas.js";
import type { SubjectManifest, MutantInventory, Split, Engine } from "./schemas.js";
import { sha256Hex } from "./mutantKey.js";
import { PreflightRefusal } from "./preflight.js";
import { enumerateInhouse, INHOUSE_VERSION } from "../engines/inhouse.js";
import { buildInventory, applyExactPatch, sourceSlice } from "../engines/engine.js";
import { parseStrykerReport } from "../engines/stryker.js";

export async function readManifest(root: string): Promise<SubjectManifest> {
  return SubjectManifestSchema.parse(JSON.parse(await readFile(path.join(root, "gold/manifest.json"), "utf8")));
}
export function subjectEntries(manifest: SubjectManifest, split: Split | "all") {
  return [...(split !== "heldout" ? manifest.dev.map((entry) => ({ ...entry, split: "dev" as const })) : []),
    ...(split !== "dev" ? manifest.heldout.map((entry) => ({ ...entry, split: "heldout" as const })) : [])];
}
export async function fixtureHashes(root: string, id: string) {
  const base = path.join(root, "fixtures/subjects", id);
  const hashes = await Promise.all(["src.ts", "hand.test.ts", "twin.ts", "traps.json"].map(async (file) => {
    const target = path.join(base, file), stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new PreflightRefusal("fixture is not a regular file");
    return sha256Hex(await readFile(target, "utf8"));
  }));
  return { src: hashes[0]!, hand: hashes[1]!, twin: hashes[2]!, traps: hashes[3]! };
}
export async function assertFixtureFreeze(root: string, manifest: SubjectManifest): Promise<void> {
  if (manifest.freezeDate === "pending") throw new PreflightRefusal("freeze manifest before execution with mutants --execute --split all");
  for (const entry of subjectEntries(manifest, "all")) {
    if (JSON.stringify(entry.sha256) !== JSON.stringify(await fixtureHashes(root, entry.id))) throw new PreflightRefusal(`fixture freeze mismatch: ${entry.id}; a changed fixture needs a new edition`);
  }
}
export async function readInventory(root: string, id: string): Promise<MutantInventory | null> {
  try { return MutantInventorySchema.parse(JSON.parse(await readFile(path.join(root, "results/mutants", `${id}.json`), "utf8"))); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
}
/** No execution: compiler diagnostics exclude compile-invalid patches before partition assignment. */
function compiles(source: string): boolean {
  const options: ts.CompilerOptions = { strict: true, noUncheckedIndexedAccess: true, target: ts.ScriptTarget.ES2022, noEmit: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
  const virtual = path.resolve("testgen-inventory-src.ts");
  host.getSourceFile = (file, language, onError, createNew) => path.resolve(file) === virtual
    ? ts.createSourceFile(file, source, language, true) : original(file, language, onError, createNew);
  return ts.getPreEmitDiagnostics(ts.createProgram([virtual], options, host)).every((d) => d.category !== ts.DiagnosticCategory.Error);
}
export async function inventoryCommand(root: string, options: { split: Split | "all"; engine: Engine; reportDir?: string; now?: () => string }): Promise<MutantInventory[]> {
  const manifest = await readManifest(root), now = options.now ?? (() => new Date().toISOString());
  if (manifest.freezeDate === "pending") {
    if (options.split !== "all") throw new PreflightRefusal("the first inventory must freeze all subjects together (--split all)");
    for (const entry of [...manifest.dev, ...manifest.heldout]) entry.sha256 = await fixtureHashes(root, entry.id);
    manifest.freezeDate = now().slice(0, 10);
    // This is the only initial pending -> frozen transition; subsequent runs refuse byte changes.
    await writeFile(path.join(root, "gold/manifest.json"), `${JSON.stringify(SubjectManifestSchema.parse(manifest), null, 2)}\n`, "utf8");
  }
  await assertFixtureFreeze(root, manifest);
  const output: MutantInventory[] = [];
  for (const entry of subjectEntries(manifest, options.split)) {
    const existing = await readInventory(root, entry.id);
    if (existing) {
      if (existing.srcSha256 !== entry.sha256.src || existing.seed !== manifest.seed || existing.engine !== options.engine)
        throw new PreflightRefusal("existing immutable inventory differs; use a documented new edition");
      output.push(existing); continue;
    }
    const base = path.join(root, "fixtures/subjects", entry.id), source = await readFile(path.join(base, "src.ts"), "utf8");
    const traps = TrapsFileSchema.parse(JSON.parse(await readFile(path.join(base, "traps.json"), "utf8")));
    let compileErrorCount = 0;
    const mutations = options.engine === "inhouse" ? enumerateInhouse(source).filter((mutation) => {
      if (compiles(applyExactPatch(source, mutation.range, sourceSlice(source, mutation.range), mutation.replacement))) return true;
      compileErrorCount++; return false;
    }) : [];
    if (options.engine === "stryker" && !options.reportDir) throw new PreflightRefusal("Stryker inventory requires --stryker-reports with actual activation reports");
    // A supplied report is read as data; no Stryker code or candidate executes on the host.
    const report = options.engine === "stryker" && options.reportDir ? parseStrykerReport(JSON.parse(await readFile(path.join(options.reportDir, `${entry.id}.json`), "utf8")), source) : null;
    const actual = report ? report.mutants.map(({ mutant }) => mutant) : mutations;
    const inventory = buildInventory({ sourceText: source, subjectId: entry.id, engine: options.engine,
      engineVersion: options.engine === "inhouse" ? INHOUSE_VERSION : "activation-report", createdAt: now(), seed: manifest.seed,
      mutations: actual, traps: traps.traps, compileErrorCount: report?.compileErrorCount ?? compileErrorCount });
    await mkdir(path.join(root, "results/mutants"), { recursive: true });
    await writeFile(path.join(root, "results/mutants", `${entry.id}.json`), `${JSON.stringify(inventory, null, 2)}\n`, { flag: "wx" });
    output.push(inventory);
  }
  return output;
}
