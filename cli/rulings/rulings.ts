/** Pure ordered JSONL parsing and tuple resolution. No filesystem or Node dependencies. */
import { RulingSchema } from "../core/schemas.js";
import type { Ruling } from "../core/schemas.js";

export interface RulingLog { name: string; text: string }
export interface LocatedRuling { ruling: Ruling; file: string; line: number }
export class RulingLogError extends Error {
  constructor(readonly file: string, readonly line: number, detail: string) {
    super(`${file}:${line}: ${detail}`); this.name = "RulingLogError";
  }
}
/** Files and lines retain caller order. Blank lines are ignored but still count toward line numbers. */
export function parseRulingLogs(logs: readonly RulingLog[]): LocatedRuling[] {
  const records: LocatedRuling[] = [];
  for (const log of logs) {
    const lines = log.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const text = lines[index]!;
      if (!text.trim()) continue;
      let raw: unknown;
      try { raw = JSON.parse(text) as unknown; }
      catch { throw new RulingLogError(log.name, index + 1, "malformed ruling JSON"); }
      const parsed = RulingSchema.safeParse(raw);
      if (!parsed.success) throw new RulingLogError(log.name, index + 1,
        `invalid ruling (${parsed.error.issues.map((issue) => issue.path.join(".") || "record").join(", ")})`);
      records.push({ ruling: parsed.data, file: log.name, line: index + 1 });
    }
  }
  return records;
}
/** runId is provenance, not part of the revocation key. Timestamp order is intentionally irrelevant. */
export function rulingKey(ruling: Pick<Ruling, "subjectId" | "subjectSha256" | "testSha256">): string {
  return JSON.stringify([ruling.subjectId, ruling.subjectSha256, ruling.testSha256]);
}
export function resolveRulings(records: readonly LocatedRuling[]): LocatedRuling[] {
  const last = new Map<string, LocatedRuling>();
  for (const record of records) {
    const key = rulingKey(record.ruling);
    last.delete(key); last.set(key, record);
  }
  return [...last.values()];
}
