import { expect, it } from "vitest";
import { parseRulingLogs, resolveRulings, RulingLogError } from "../../cli/rulings/rulings.js";
import type { Ruling } from "../../cli/core/schemas.js";

const base: Ruling = { schemaVersion: 1, kind: "test-accept", runId: "run-one", subjectId: "clamp-range",
  subjectSha256: "1".repeat(64), testSha256: "a".repeat(64), decision: "approve", who: "local reviewer",
  when: "2026-10-24T00:00:00Z", why: "Reviewed exact bytes" };
const log = (name: string, rulings: Ruling[]) => ({ name, text: rulings.map((ruling) => JSON.stringify(ruling)).join("\n") });

it("keeps source v1 approval separate from source v2 rejection across two merged logs", () => {
  const records = parseRulingLogs([log("v1.jsonl", [base]), log("v2.jsonl", [{ ...base, subjectSha256: "2".repeat(64), decision: "reject" }])]);
  expect(resolveRulings(records).map((record) => [record.ruling.subjectSha256, record.ruling.decision]))
    .toEqual([["1".repeat(64), "approve"], ["2".repeat(64), "reject"]]);
});
it("revokes the same tuple by log order across runs, even with an earlier timestamp", () => {
  const rejected = { ...base, runId: "run-two", decision: "reject" as const, when: "2026-10-23T00:00:00Z" };
  const resolved = resolveRulings(parseRulingLogs([log("first", [base]), log("second", [rejected])]));
  expect(resolved).toHaveLength(1); expect(resolved[0]).toMatchObject({ file: "second", line: 1, ruling: rejected });
});
it("reports the actual file and line for JSON and schema errors after valid and blank lines", () => {
  for (const bad of ["{truncated", JSON.stringify({ ...base, subjectId: "../escape" }), JSON.stringify({ ...base, destination: "outside" })]) {
    expect(() => parseRulingLogs([{ name: "bad.jsonl", text: `${JSON.stringify(base)}\n\n${bad}\n` }]))
      .toThrow("bad.jsonl:3:");
  }
  expect(() => parseRulingLogs([{ name: "broken", text: "no" }])).toThrow(RulingLogError);
});
