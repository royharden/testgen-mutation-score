/** Append-only held-out lock and cell completion journal. No overwrite or implicit new campaign. */
import { readFile, writeFile, mkdir, appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RunIdSchema, Sha256HexSchema, ArmIdSchema, SlugSchema } from "./schemas.js";
import { sha256Hex } from "./mutantKey.js";
import { PreflightRefusal } from "./preflight.js";

const LockSchema = z.strictObject({ schemaVersion: z.literal(1), campaignId: RunIdSchema, createdAt: z.string(),
  hashes: z.record(z.string(), Sha256HexSchema) });
const JournalSchema = z.strictObject({ schemaVersion: z.literal(1), event: z.enum(["started", "complete", "error", "budget-blocked"]),
  subjectId: SlugSchema, arm: ArmIdSchema, repeat: z.number().int().min(0), runId: RunIdSchema,
  artifact: z.string().nullable(), suiteSha256: Sha256HexSchema.nullable(), at: z.string() });
export type JournalEntry = z.infer<typeof JournalSchema>;
export const cellKey = (cell: { subjectId: string; arm: string; repeat: number }) => `${cell.subjectId}/${cell.arm}/${cell.repeat}`;
export async function hashTree(root: string, relative: string): Promise<string> {
  const items: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(path.join(root, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new PreflightRefusal("campaign input contains a symlink");
      if (entry.isDirectory()) await walk(rel);
      else if (entry.isFile()) items.push(`${rel}\0${sha256Hex(await readFile(path.join(root, rel), "utf8"))}`);
    }
  };
  await walk(relative);
  return sha256Hex(items.join("\n"));
}
export async function openCampaign(input: { root: string; campaignId: string; resume?: string; confirm: boolean; config: unknown; now: () => string }) {
  if (!input.confirm) throw new PreflightRefusal("held-out execution requires --heldout-confirm");
  RunIdSchema.parse(input.campaignId);
  const hashes = { config: sha256Hex(JSON.stringify(input.config)), manifest: sha256Hex(await readFile(path.join(input.root, "gold/manifest.json"), "utf8")),
    fixtures: await hashTree(input.root, "fixtures/subjects"), replay: await hashTree(input.root, "fixtures/replay"),
    inventories: await hashTree(input.root, "results/mutants"), prices: sha256Hex(await readFile(path.join(input.root, "cli/ledger/prices.json"), "utf8")) };
  const lockPath = path.join(input.root, "results/heldout.lock");
  await mkdir(path.dirname(lockPath), { recursive: true });
  let exists = false;
  try {
    const lock = LockSchema.parse(JSON.parse(await readFile(lockPath, "utf8"))); exists = true;
    if (input.resume !== lock.campaignId || input.campaignId !== lock.campaignId || JSON.stringify(lock.hashes) !== JSON.stringify(hashes))
      throw new PreflightRefusal("held-out campaign lock differs; resume only its unfinished cells with identical frozen inputs");
  } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (!exists) {
    if (input.resume) throw new PreflightRefusal("cannot resume a campaign without its existing held-out lock");
    await writeFile(lockPath, `${JSON.stringify(LockSchema.parse({ schemaVersion: 1, campaignId: input.campaignId, createdAt: input.now(), hashes }), null, 2)}\n`, { flag: "wx" });
  }
  const journalPath = path.join(input.root, "results", `${input.campaignId}.journal.jsonl`);
  let entries: JournalEntry[] = [];
  try { entries = (await readFile(journalPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JournalSchema.parse(JSON.parse(line))); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (entries.length && !(await readFile(journalPath, "utf8")).endsWith("\n")) throw new PreflightRefusal("campaign journal has a truncated line; recovery required");
  const observed = new Map(entries.filter((entry) => entry.event !== "started").map((entry) => [cellKey(entry), entry]));
  const started = new Map(entries.filter((entry) => entry.event === "started" && !observed.has(cellKey(entry))).map((entry) => [cellKey(entry), entry]));
  return { hashes, observed, started, async append(entry: Omit<JournalEntry, "schemaVersion" | "at">) {
    const parsed = JournalSchema.parse({ schemaVersion: 1, ...entry, at: input.now() });
    if (observed.has(cellKey(parsed))) throw new PreflightRefusal("cannot overwrite an observed campaign cell");
    await appendFile(journalPath, `${JSON.stringify(parsed)}\n`, "utf8");
    if (parsed.event !== "started") observed.set(cellKey(parsed), parsed);
  } };
}
