/** Immutable, byte-verified round publication and add-only protection of source/hand/twin. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { TestUnitSchema, SlugSchema, isSafeRelPath } from "./schemas.js";
import type { TestUnit } from "./schemas.js";

export function sha256Bytes(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export interface StagedUnit { unitSha256: string; stagedAs: string }
/** commit must publish all of a round atomically, or publish none. No candidate is published before union passes. */
export interface StagingStore { commit(units: readonly TestUnit[]): Promise<readonly StagedUnit[]> }
export interface ProtectedHashes { source: string; hand: string; twin: string }
export type ProtectedSnapshot = () => Promise<ProtectedHashes>;
export class StagingError extends Error {
  constructor(readonly kind: "add-only-guard" | "storage-exhausted" | "schema-violation", message: string) { super(message); this.name = "StagingError"; }
}
export function assertProtectedUnchanged(before: ProtectedHashes, after: ProtectedHashes): void {
  if (before.source !== after.source || before.hand !== after.hand || before.twin !== after.twin) throw new StagingError("add-only-guard", "protected subject, hand suite or twin bytes changed during the round");
}
/** Missing files, replacements with directories/symlinks and unreadable files also fail closed. */
export function protectedFilesSnapshot(files: { source: string; hand: string; twin: string }): ProtectedSnapshot {
  return async () => {
    const one = async (file: string): Promise<string> => {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new StagingError("add-only-guard", "protected input is not a regular file");
      return sha256Bytes(await readFile(file));
    };
    try {
      const [source, hand, twin] = await Promise.all([one(files.source), one(files.hand), one(files.twin)]);
      return { source, hand, twin };
    } catch { throw new StagingError("add-only-guard", "protected inputs could not be verified"); }
  };
}
async function realDirectory(directory: string): Promise<void> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new StagingError("storage-exhausted", "staging ancestor is not a regular directory");
}

/**
 * Each round is written to a private directory then renamed to its content-addressed final directory.
 * rename is the publication boundary; no partially written committed round exists. Failed unpublished
 * directories are retained for inspection (never used as accepted input). Existing content is verified,
 * never overwritten. The staging root and repository root must be on the same local filesystem.
 */
export class FileStagingStore implements StagingStore {
  constructor(private readonly repoRoot: string, private readonly subjectId: string) { SlugSchema.parse(subjectId); }
  async commit(units: readonly TestUnit[]): Promise<readonly StagedUnit[]> {
    if (units.length === 0) return [];
    const seen = new Set<string>();
    for (const unit of units) {
      TestUnitSchema.parse(unit);
      if (unit.subjectId !== this.subjectId || sha256Bytes(unit.text) !== unit.unitSha256 || Buffer.byteLength(unit.text, "utf8") !== unit.byteLength || seen.has(unit.unitSha256)) throw new StagingError("schema-violation", "staging units are inconsistent with their immutable bytes");
      seen.add(unit.unitSha256);
    }
    const roundHash = sha256Bytes(units.map((u) => u.unitSha256).join("\n"));
    const base = `staged/${this.subjectId}`;
    const relative = `${base}/${roundHash}`;
    if (!isSafeRelPath(relative)) throw new StagingError("schema-violation", "unsafe staging path");
    const root = path.resolve(this.repoRoot);
    await realDirectory(root);
    const staging = path.join(root, "staged");
    await mkdir(staging, { recursive: true });
    await realDirectory(staging);
    const subject = path.join(root, base);
    await mkdir(subject, { recursive: true });
    await realDirectory(subject);
    const destination = path.join(root, relative);
    const records = units.map((unit) => ({ unitSha256: unit.unitSha256, stagedAs: `${relative}/${unit.unitSha256}.test.ts` }));
    const verifyExisting = async (): Promise<void> => {
      await realDirectory(destination);
      for (const unit of units) {
        const file = path.join(destination, `${unit.unitSha256}.test.ts`);
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || !(await readFile(file)).equals(Buffer.from(unit.text, "utf8"))) throw new StagingError("storage-exhausted", "immutable staging collision");
      }
    };
    try { await lstat(destination); await verifyExisting(); return records; }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    const pending = path.join(subject, `.pending-${randomUUID()}`);
    await mkdir(pending);
    try {
      for (const unit of units) await writeFile(path.join(pending, `${unit.unitSha256}.test.ts`), Buffer.from(unit.text, "utf8"), { flag: "wx" });
      // Verify again after all writes; only the exact UTF-8 bytes are admitted.
      for (const unit of units) if (sha256Bytes(await readFile(path.join(pending, `${unit.unitSha256}.test.ts`))) !== unit.unitSha256) throw new Error("staged-byte-mismatch");
      await rename(pending, destination);
      return records;
    } catch { throw new StagingError("storage-exhausted", "round staging failed before publication; no admissions committed"); }
  }
}
