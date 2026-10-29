// M3 acceptance: static validation of every subject folder present
// under fixtures/subjects/ and of gold/manifest.json. Reads files only; never runs a hand suite or a subject.
//
// Split-aware design:
//   - dev rules run now: all 12 dev folders exist and validate, dev covers all nine traps, replay subjects are
//     dev, one dev src.ts carries the injection fixture;
//   - all held-out folders are validated, and their trap sets must equal their partners';
//   - all 12 held-out folders must exist from M3 onward;
//   - cross-split placement (>= 2 subjects, >= 1 per split) is checked over all 24 actual trap sets;
//     the projection helper is also checked, and must have no missing partners to project.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INJECTION_MARKER,
  REPLAY_SUBJECT_IDS,
  SUBJECT_FILES,
  SUBJECTS_PER_SPLIT,
  countLines,
  countOccurrences,
  exportedApi,
  moduleSyntax,
  opensWithContract,
  placementEntries,
  textAtRange,
  validateDevCoverage,
  validateHand,
  validateManifest,
  validatePartners,
  validatePlacement,
  validateSrc,
  validateSubject,
  validateTraps,
  validateTwin,
} from "../../cli/core/fixtureValidate.js";
import type { SubjectFileName, SubjectValidation } from "../../cli/core/fixtureValidate.js";
import type { NamedTrap, SubjectManifest } from "../../cli/core/schemas.js";

const SUBJECTS_DIR = new URL("../../fixtures/subjects/", import.meta.url);
const MANIFEST_URL = new URL("../../gold/manifest.json", import.meta.url);

function loadSubject(id: string): SubjectValidation {
  const dir = new URL(`${id}/`, SUBJECTS_DIR);
  const entries = readdirSync(dir);
  const contents: Partial<Record<SubjectFileName, string>> = {};
  for (const f of SUBJECT_FILES) if (entries.includes(f)) contents[f] = readFileSync(new URL(f, dir), "utf8");
  return validateSubject({ id, entries, contents });
}

const folderIds = readdirSync(SUBJECTS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const manifestResult = validateManifest(JSON.parse(readFileSync(MANIFEST_URL, "utf8")), folderIds);
const manifest = manifestResult.manifest as SubjectManifest;
const devIds = manifest.dev.map((s) => s.id);
const heldoutIds = manifest.heldout.map((s) => s.id);
const presentHeldout = heldoutIds.filter((id) => folderIds.includes(id));
const results = new Map(folderIds.map((id) => [id, loadSubject(id)]));
const trapsById = new Map<string, readonly NamedTrap[]>();
for (const [id, r] of results) if (r.namedTraps !== null) trapsById.set(id, r.namedTraps);

describe("gold/manifest.json (D10, D13)", () => {
  it("is schema-valid and agrees with the subject folders", () => {
    expect(manifestResult.issues).toEqual([]);
    expect(manifestResult.manifest).not.toBeNull();
  });

  it("declares the designed-stratified split with a rationale, edition 1, a seed and a placeholder freeze date", () => {
    expect(manifest.splitMethod).toBe("designed-stratified");
    expect(manifest.splitRationale).toMatch(/D10/);
    expect(manifest.edition).toBe(1);
    expect(Number.isInteger(manifest.seed)).toBe(true);
    expect(manifest.freezeDate).toBe("pending"); // placeholder until activation, never a real freeze
  });

  it("lists 12 dev and 12 held-out unique ids, each held-out with a distinct dev partner, hashes pending", () => {
    expect(devIds).toHaveLength(SUBJECTS_PER_SPLIT);
    expect(heldoutIds).toHaveLength(SUBJECTS_PER_SPLIT);
    expect(new Set([...devIds, ...heldoutIds]).size).toBe(2 * SUBJECTS_PER_SPLIT);
    expect(new Set(manifest.heldout.map((h) => h.partner)).size).toBe(SUBJECTS_PER_SPLIT);
    for (const s of [...manifest.dev, ...manifest.heldout]) expect(Object.values(s.sha256)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("puts the replay subjects in dev", () => {
    for (const id of REPLAY_SUBJECT_IDS) expect(devIds).toContain(id);
  });
});

describe("dev subjects (M2)", () => {
  it("every dev subject has a folder", () => {
    expect(devIds.filter((id) => !folderIds.includes(id))).toEqual([]);
  });

  it.each(devIds)("%s passes every static rule", (id) => {
    const r = results.get(id);
    expect(r).toBeDefined();
    expect(r?.issues).toEqual([]);
  });

  it("the dev split covers all nine named traps", () => {
    expect(validateDevCoverage(devIds.map((id) => trapsById.get(id) ?? []))).toEqual([]);
  });

  it("exactly one dev subject carries the prompt-injection comment, in src.ts", () => {
    const carriers = devIds.filter((id) => (results.get(id)?.src ?? "").includes(INJECTION_MARKER));
    expect(carriers).toHaveLength(1);
  });
});

describe("held-out subjects (M3) and cross-split rules", () => {
  it("every held-out subject has a folder (all 12 required from M3 onward)", () => {
    expect(presentHeldout).toHaveLength(SUBJECTS_PER_SPLIT);
    expect(heldoutIds.filter((id) => !folderIds.includes(id))).toEqual([]);
  });

  it.each(heldoutIds)("%s passes every static rule", (id) => {
    expect(results.get(id)?.issues).toEqual([]);
  });

  it("each held-out subject plants exactly its dev partner's trap set", () => {
    expect(validatePartners(manifest, trapsById)).toEqual([]);
  });

  it("placement helper uses actual dev and held-out sets with no projections", () => {
    const { entries, projected } = placementEntries(manifest, trapsById);
    expect(entries).toHaveLength(2 * SUBJECTS_PER_SPLIT);
    expect(projected).toEqual(heldoutIds.filter((id) => !presentHeldout.includes(id)));
    expect(validatePlacement(entries)).toEqual([]);
  });

  it("all 24 subjects are authored and placement holds over actual files only", () => {
    const { entries, projected } = placementEntries(manifest, trapsById);
    expect(projected).toEqual([]);
    expect(validatePlacement(entries)).toEqual([]);
    expect(folderIds).toHaveLength(2 * SUBJECTS_PER_SPLIT);
    expect(devIds.filter((id) => heldoutIds.includes(id))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The validators themselves (synthetic inputs): each rule fires on a bad case.
// ---------------------------------------------------------------------------------------------------------

function srcOf(lines: number, header = "/*\n * CONTRACT - demo\n */"): string {
  const body = Array.from({ length: Math.max(0, lines - 4) }, (_, i) => `const v${i} = ${i};`);
  return [header, ...body, "export function f(x: number): number {", "  return x < 10 ? x : 10;", "}"].join("\n") + "\n";
}

const HAND_OK = [
  'import { expect, test } from "vitest";',
  'import { f } from "./src";',
  ...Array.from({ length: 5 }, (_, i) => `test("t${i}", () => {\n  expect(f(${i})).toBe(${i});\n});`),
].join("\n");

describe("validator rules", () => {
  it("counts lines and extracts exclusive-end ranges", () => {
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("")).toBe(0);
    const text = "abc\n  x < y;\n";
    expect(textAtRange(text, { start: { line: 2, column: 3 }, end: { line: 2, column: 8 } })).toBe("x < y");
    expect(textAtRange(text, { start: { line: 1, column: 3 }, end: { line: 2, column: 4 } })).toBe("c\n  x");
    expect(textAtRange(text, { start: { line: 9, column: 1 }, end: { line: 9, column: 2 } })).toBeNull();
    expect(countOccurrences("aaa", "aa")).toBe(2);
  });

  it("src.ts: line count, import-free and CONTRACT header", () => {
    expect(validateSrc("demo", srcOf(40))).toEqual([]);
    expect(validateSrc("demo", srcOf(10)).map((i) => i.rule)).toContain("src-line-count");
    expect(validateSrc("demo", srcOf(130)).map((i) => i.rule)).toContain("src-line-count");
    expect(validateSrc("demo", srcOf(40, "// helpers")).map((i) => i.rule)).toContain("contract-header");
    expect(validateSrc("demo", `${srcOf(40)}import "x";\n`).map((i) => i.rule)).toContain("module-syntax");
    expect(moduleSyntax('const m = await import("fs"); const r = require("x"); const u = import.meta.url;')).toHaveLength(3);
    expect(opensWithContract("\n/* CONTRACT */")).toBe(true);
    expect(validateSrc("demo", srcOf(40).replace("demo", "démo")).map((i) => i.rule)).toContain("non-ascii");
    expect(validateSrc("demo", srcOf(40).replace(/\n/g, "\r\n")).map((i) => i.rule)).toContain("line-endings");
  });

  it("hand.test.ts: grammar, 5..8 tests, allowed imports, no vi or modifiers", () => {
    expect(validateHand("demo", HAND_OK)).toEqual([]);
    expect(validateHand("demo", `${HAND_OK}\nconst shared = 1;`).map((i) => i.rule)).toEqual(["hand-grammar"]);
    const four = HAND_OK.split("\ntest(").slice(0, 5).join("\ntest(");
    expect(validateHand("demo", four).map((i) => i.rule)).toEqual(["hand-test-count"]);
    expect(validateHand("demo", HAND_OK.replace('"./src"', '"./src.js"')).map((i) => i.rule)).toEqual(["hand-imports", "hand-imports"]);
    expect(validateHand("demo", HAND_OK.replace('test("t0"', 'test.skip("t0"')).map((i) => i.rule)).toEqual(["hand-hygiene"]);
    expect(validateHand("demo", HAND_OK.replace("expect(f(0))", "vi.fn(); expect(f(0))")).map((i) => i.rule)).toEqual(["hand-hygiene"]);
  });

  it("twin.ts: same API, TWIN-DIFF comments, quirk comment when needed, not identical", () => {
    const src = "/* CONTRACT */\nexport function f(): number { return 1; }\nexport interface O { a: number }\n";
    const twin = "// TWIN-DIFF: other text\nexport function f(): number { return 1; }\nexport type O = { a: number };\n";
    expect(exportedApi(src)).toEqual(["function:f", "type:O"]);
    expect(validateTwin("demo", src, twin, false)).toEqual([]);
    expect(validateTwin("demo", src, twin, true).map((i) => i.rule)).toEqual(["twin-diff-comment"]);
    expect(validateTwin("demo", src, twin.replace("function f", "function g"), false).map((i) => i.rule)).toEqual(["twin-api"]);
    expect(validateTwin("demo", src, src, false).map((i) => i.rule)).toEqual(["twin-diff-comment", "twin-identical"]);
  });

  it("traps.json: schema, exact range, single occurrence, subject-relative file, no overlap", () => {
    const src = srcOf(40);
    const line = countLines(src) - 1; // "  return x < 10 ? x : 10;"
    const trap = (over: Record<string, unknown> = {}) => ({
      id: "b1",
      trap: "boundary-off-by-one",
      file: "src.ts",
      range: { start: { line, column: 10 }, end: { line, column: 16 } },
      original: "x < 10",
      replacement: "x <= 10",
      label: "killable",
      ...over,
    });
    const canary = trap({ id: "c", trap: "canary", range: { start: { line, column: 19 }, end: { line, column: 20 } }, original: "x", replacement: "0" });
    const file = (traps: unknown[]) => JSON.stringify({ schemaVersion: 1, subjectId: "demo", traps });
    expect(validateTraps("demo", file([trap(), canary]), src).issues.map((i) => i.rule)).toEqual(["trap-original-count"]); // "x" is not unique
    // Columns of "  return x < 10 ? x : 10;": "x < 10" is 10..16 (exclusive end), "? x" is 17..20.
    const shortCanary = trap({ id: "c", trap: "canary", range: { start: { line, column: 17 }, end: { line, column: 19 } }, original: "? x", replacement: "? 0" });
    expect(validateTraps("demo", file([trap(), shortCanary]), src).issues.map((i) => i.rule)).toEqual(["trap-range"]); // 2 columns for 3 chars
    const goodCanary = { ...shortCanary, range: { start: { line, column: 17 }, end: { line, column: 20 } } };
    expect(validateTraps("demo", file([trap(), goodCanary]), src).issues).toEqual([]);
    expect(validateTraps("demo", file([trap({ file: "fixtures/subjects/demo/src.ts" }), goodCanary]), src).issues.map((i) => i.rule)).toEqual(["traps-schema"]);
    expect(validateTraps("demo", file([trap()]), src).issues.map((i) => i.rule)).toEqual(["traps-schema"]); // no canary
    const overlapping = trap({ id: "b2", trap: "float-rounding", range: { start: { line, column: 12 }, end: { line, column: 16 } }, original: "< 10", replacement: "> 10" });
    expect(validateTraps("demo", file([trap(), overlapping, goodCanary]), src).issues.map((i) => i.rule)).toContain("trap-overlap");
    expect(validateTraps("other", file([trap(), goodCanary]), src).issues.map((i) => i.rule)).toEqual(["traps-subject-id"]);
  });

  it("placement: every trap in >= 2 subjects with >= 1 per split", () => {
    const all = (split: "dev" | "heldout", n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${split}-${i}`, split, traps: [] as NamedTrap[] }));
    const entries = [...all("dev", 3), ...all("heldout", 3)];
    const nine: NamedTrap[] = [
      "boundary-off-by-one",
      "equivalent-loop-bound",
      "message-only",
      "exception-type-only",
      "infinite-loop",
      "dead-flag-branch",
      "float-rounding",
      "sort-stability",
      "quirk-trap",
    ];
    for (let i = 0; i < 3; i++) {
      entries[i]!.traps = nine.slice(i * 3, i * 3 + 3);
      entries[i + 3]!.traps = nine.slice(i * 3, i * 3 + 3);
    }
    expect(validatePlacement(entries)).toEqual([]);
    entries[3]!.traps = [];
    expect(validatePlacement(entries).map((i) => i.message)).toEqual([
      "boundary-off-by-one is in 1 subject(s); needs >= 2",
      "boundary-off-by-one has no held-out subject",
      "equivalent-loop-bound is in 1 subject(s); needs >= 2",
      "equivalent-loop-bound has no held-out subject",
      "message-only is in 1 subject(s); needs >= 2",
      "message-only has no held-out subject",
    ]);
  });
});
