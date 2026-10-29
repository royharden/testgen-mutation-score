import { RulingSchema } from "../../cli/core/schemas.js";
import type { Ruling } from "../../cli/core/schemas.js";

export type RulingScope = "real" | "sample";
export const rulingStorageKey = (scope: RulingScope) => scope === "sample" ? "testgen.rulings.sample.v1" : "testgen.rulings.v1";
export interface RulingStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function parseRulings(text: string): Ruling[] {
  const records: Ruling[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try { raw = JSON.parse(line) as unknown; } catch { throw new Error(`Line ${index + 1}: malformed JSON`); }
    const parsed = RulingSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Line ${index + 1}: invalid ruling (${parsed.error.issues.map((issue) => issue.path.join(".") || "record").join(", ")})`);
    records.push(parsed.data);
  }
  return records;
}
export const rulingKey = (r: Pick<Ruling, "subjectId" | "subjectSha256" | "testSha256">) =>
  JSON.stringify([r.subjectId, r.subjectSha256, r.testSha256]);
/** Last in append order wins; timestamps and run ids do not override revocation. */
export function latestRulings(records: readonly Ruling[]): Map<string, Ruling> {
  const last = new Map<string, Ruling>();
  for (const record of records) last.set(rulingKey(record), record);
  return last;
}
export const rulingsJsonl = (records: readonly Ruling[]) => records.map((r) => JSON.stringify(RulingSchema.parse(r))).join("\n") + (records.length ? "\n" : "");
export function readRulings(storage: RulingStorage, scope: RulingScope = "real"): Ruling[] {
  return parseRulings(storage.getItem(rulingStorageKey(scope)) ?? "");
}
/** Re-read storage before appending. Validate the whole import before a single durable mutation. */
export function appendRulings(storage: RulingStorage, incoming: readonly Ruling[], scope: RulingScope = "real"): Ruling[] {
  const validated = incoming.map((r) => RulingSchema.parse(r));
  const next = [...readRulings(storage, scope), ...validated];
  storage.setItem(rulingStorageKey(scope), rulingsJsonl(next));
  return next;
}
