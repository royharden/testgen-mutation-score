/** Authored for activation; not executed during Dirty Mode construction. */
import { describe, expect, it } from "vitest";
import { appendRulings, latestRulings, parseRulings, readRulings, rulingKey, rulingsJsonl } from "../../src/lib/rulingsStore.js";
import type { RulingStorage } from "../../src/lib/rulingsStore.js";
import type { Ruling } from "../../cli/core/schemas.js";

const approval: Ruling = { schemaVersion: 1, kind: "test-accept", runId: "sample-one", subjectId: "sample-subject",
  subjectSha256: "a".repeat(64), testSha256: "b".repeat(64), decision: "approve", who: "local reviewer",
  when: "2026-10-24T12:00:00Z", why: "Sample reasoning." };
function memory(): RulingStorage {
  let text: string | null = null;
  return { getItem: () => text, setItem: (_key, value) => { text = value; } };
}
describe("viewer ordered ruling log", () => {
  it("round-trips the whole log and lets a later reject revoke across runs, ignoring timestamp order", () => {
    const reject: Ruling = { ...approval, runId: "sample-two", decision: "reject", when: "2026-10-23T12:00:00Z" };
    const storage = memory();
    appendRulings(storage, [approval]);
    const log = appendRulings(storage, parseRulings(rulingsJsonl([reject])));
    expect(readRulings(storage)).toEqual([approval, reject]);
    expect(latestRulings(log).get(rulingKey(approval))?.decision).toBe("reject");
  });
  it("does not reuse approval after source hash changes", () => {
    const changed = { ...approval, subjectSha256: "c".repeat(64) };
    expect(latestRulings([approval]).has(rulingKey(changed))).toBe(false);
  });
  it("keeps demonstration rulings out of the real apply log", () => {
    const values = new Map<string, string>();
    const storage: RulingStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
    appendRulings(storage, [approval], "sample");
    expect(readRulings(storage, "sample")).toEqual([approval]);
    expect(readRulings(storage, "real")).toEqual([]);
  });
  it("reports malformed import line and leaves the durable log untouched", () => {
    const storage = memory(); appendRulings(storage, [approval]);
    const before = readRulings(storage);
    expect(() => appendRulings(storage, parseRulings(`${rulingsJsonl([approval])}{bad}\n`))).toThrow("Line 2");
    expect(readRulings(storage)).toEqual(before);
  });
  it("rejects unknown fields on every imported ruling before merging", () => {
    expect(() => parseRulings(JSON.stringify({ ...approval, destination: "approved/override.ts" }))).toThrow("Line 1");
  });
  it("surfaces write failures without pretending the append was saved", () => {
    const storage: RulingStorage = { getItem: () => null, setItem: () => { throw new Error("quota unavailable"); } };
    expect(() => appendRulings(storage, [approval])).toThrow("quota unavailable");
    expect(readRulings(storage)).toEqual([]);
  });
  it("does not overwrite malformed pre-existing local data", () => {
    let writes = 0;
    const storage: RulingStorage = { getItem: () => "corrupt", setItem: () => { writes++; } };
    expect(() => appendRulings(storage, [approval])).toThrow("Line 1");
    expect(writes).toBe(0);
  });
});
