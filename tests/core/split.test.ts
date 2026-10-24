// M1 acceptance 4: location grouping (statement / line), trap reservation, patch dedupe, empty-partition
// refusal, seeded determinism without Math.random; plus the seeded subject split kept for later editions (D10).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mulberry32, seededHash32, seededUnit } from "../../cli/core/prng.js";
import type { SourceRange } from "../../cli/core/schemas.js";
import {
  SplitRefusalError,
  assertMutantSplit,
  dedupePatches,
  locationGroupKey,
  rangesOverlap,
  seededPairedSubjectSplit,
  seededSubjectSplit,
  splitMutants,
} from "../../cli/core/split.js";
import type { MutantSplit, SplitMutantInput, TrapLocation } from "../../cli/core/split.js";

function range(l1: number, c1: number, l2: number, c2: number): SourceRange {
  return { start: { line: l1, column: c1 }, end: { line: l2, column: c2 } };
}

let counter = 0;
function mutant(line: number, col: number, overrides: Partial<SplitMutantInput> = {}): SplitMutantInput {
  counter += 1;
  return {
    key: counter.toString(16).padStart(64, "0"),
    relFile: "src.ts",
    range: range(line, col, line, col + 3),
    mutator: "ArithmeticOperator",
    replacement: `r${counter}`,
    ...overrides,
  };
}

/** One mutant on each of `n` distinct lines starting at `firstLine`: n location groups. */
function linesFrom(firstLine: number, n: number): SplitMutantInput[] {
  return Array.from({ length: n }, (_, i) => mutant(firstLine + i, 5));
}

/** One mutant on each of lines 1..n. */
function manyLines(n: number): SplitMutantInput[] {
  return linesFrom(1, n);
}

function ok(result: ReturnType<typeof splitMutants>): MutantSplit {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result;
}

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

describe("prng", () => {
  it("mulberry32 is deterministic per seed and stays in [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });

  it("seededHash32 depends on seed and text, and is a uint32", () => {
    expect(seededHash32(1, "src.ts#line@3")).toBe(seededHash32(1, "src.ts#line@3"));
    expect(seededHash32(1, "src.ts#line@3")).not.toBe(seededHash32(2, "src.ts#line@3"));
    expect(seededHash32(1, "a")).not.toBe(seededHash32(1, "b"));
    const h = seededHash32(123, "x");
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
    expect(seededUnit(123, "x")).toBeLessThan(1);
  });
});

describe("location grouping", () => {
  it("groups by enclosing statement when the AST supplies one, else by (file, start line)", () => {
    const stmt = range(10, 3, 12, 4);
    expect(locationGroupKey({ relFile: "src.ts", range: range(11, 7, 11, 9), statementRange: stmt })).toBe(
      "src.ts#stmt@10:3-12:4",
    );
    expect(locationGroupKey({ relFile: "src.ts", range: range(11, 7, 11, 9) })).toBe("src.ts#line@11");
  });

  it("keeps every mutant of one statement in the same partition", () => {
    const stmt = range(20, 1, 22, 2);
    const sameStatement = [mutant(20, 5, { statementRange: stmt }), mutant(21, 9, { statementRange: stmt }), mutant(22, 1, { statementRange: stmt })];
    const result = ok(splitMutants([...sameStatement, ...manyLines(19)], [], { seed: 99 }));
    const fb = new Set(result.feedback);
    const sides = sameStatement.map((m) => fb.has(m.key));
    expect(new Set(sides).size).toBe(1);
    expect(result.groups.find((g) => g.groupKey === "src.ts#stmt@20:1-22:2")?.mutantKeys).toHaveLength(3);
  });

  it("keeps every mutant of one line (fallback) in the same partition", () => {
    const line = [mutant(40, 2), mutant(40, 10), mutant(40, 20)];
    const result = ok(splitMutants([...line, ...manyLines(30)], [], { seed: 5 }));
    const fb = new Set(result.feedback);
    expect(new Set(line.map((m) => fb.has(m.key))).size).toBe(1);
  });
});

describe("trap reservation", () => {
  it("reserves every group overlapping a planted trap to scoring, whatever the seed", () => {
    const trapped = mutant(7, 5);
    const traps: TrapLocation[] = [{ id: "b1", trap: "boundary-off-by-one", file: "src.ts", range: range(7, 6, 7, 8) }];
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      // 60 unreserved line groups away from line 7 keep both partitions non-empty for any seed in practice.
      const result = ok(splitMutants([trapped, ...linesFrom(100, 60)], traps, { seed }));
      expect(result.scoring).toContain(trapped.key);
      expect(result.reservedGroups).toContain("src.ts#line@7");
    }
  });

  it("ignores canaries and traps in other files", () => {
    const m = mutant(3, 1);
    // other.ts has an inventoried mutant (so the trap's file is matched) far from the trap's range.
    const elsewhere = mutant(50, 1, { relFile: "other.ts" });
    const traps: TrapLocation[] = [
      { id: "c", trap: "canary", file: "src.ts", range: range(3, 1, 3, 4) },
      { id: "x", trap: "float-rounding", file: "other.ts", range: range(3, 1, 3, 4) },
    ];
    const result = ok(splitMutants([m, elsewhere, ...manyLines(40)], traps, { seed: 3, feedbackFraction: 0.5 }));
    expect(result.reservedGroups).toEqual([]);
  });

  it("normalises engine paths on both sides before matching (subject-relative convention)", () => {
    const fromEngine = mutant(7, 5, { relFile: ".\\src.ts" });
    const traps: TrapLocation[] = [{ id: "b1", trap: "boundary-off-by-one", file: "./src.ts", range: range(7, 6, 7, 8) }];
    const result = ok(splitMutants([fromEngine, ...linesFrom(100, 60)], traps, { seed: 4 }));
    expect(result.reservedGroups).toEqual(["src.ts#line@7"]);
    expect(result.groupOf[fromEngine.key]).toBe("src.ts#line@7");
  });

  it("refuses when a scored trap's file matches no inventoried mutant file (e.g. a repo-relative trap path)", () => {
    const traps: TrapLocation[] = [
      { id: "b1", trap: "boundary-off-by-one", file: "fixtures/subjects/clamp-range/src.ts", range: range(7, 6, 7, 8) },
    ];
    expect(splitMutants(manyLines(40), traps, { seed: 4 })).toMatchObject({
      ok: false,
      kind: "split-refusal",
      reason: "trap-file-unmatched",
      offenders: ["b1"],
    });
  });

  it("does not refuse for an unmatched canary (canaries never take part in the split)", () => {
    const traps: TrapLocation[] = [{ id: "c", trap: "canary", file: "elsewhere.ts", range: range(1, 1, 1, 2) }];
    expect(splitMutants(manyLines(40), traps, { seed: 4 }).ok).toBe(true);
  });

  it("refuses traversal or absolute paths on either side", () => {
    expect(splitMutants([mutant(1, 1, { relFile: "../src.ts" }), ...manyLines(40)], [], { seed: 4 })).toMatchObject({
      ok: false,
      reason: "invalid-path",
    });
    const traps: TrapLocation[] = [{ id: "t", trap: "quirk-trap", file: "C:\\repo\\src.ts", range: range(1, 1, 1, 2) }];
    expect(splitMutants(manyLines(40), traps, { seed: 4 })).toMatchObject({ ok: false, reason: "invalid-path" });
  });

  it("treats touching ranges as overlapping (safe direction)", () => {
    expect(rangesOverlap(range(1, 1, 1, 5), range(1, 5, 1, 9))).toBe(true);
    expect(rangesOverlap(range(1, 1, 1, 4), range(1, 5, 1, 9))).toBe(false);
    expect(rangesOverlap(range(1, 1, 3, 1), range(2, 1, 2, 2))).toBe(true);
  });
});

describe("deduplication", () => {
  it("drops identical patches (same file, range, replacement) even from different mutators", () => {
    const a = mutant(9, 3, { replacement: "a - b", mutator: "ArithmeticOperator" });
    const b = mutant(9, 3, { replacement: "a - b", mutator: "SomethingElse" });
    const c = mutant(9, 3, { replacement: "a * b" });
    const { kept, duplicates } = dedupePatches([b, c, a]);
    expect(kept.map((m) => m.key).sort()).toEqual([a.key, c.key].sort());
    expect(duplicates).toEqual([{ kept: a.key, dropped: b.key }]);
  });

  it("records sizes before and after dedupe", () => {
    const a = mutant(9, 3, { replacement: "same" });
    const b = mutant(9, 3, { replacement: "same" });
    const result = ok(splitMutants([a, b, ...manyLines(30)], [], { seed: 11 }));
    expect(result.sizes.inventory).toBe(32);
    expect(result.sizes.deduplicated).toBe(31);
  });
});

describe("determinism and partitions", () => {
  const inventory = manyLines(120);

  it("is a pure function of (inventory, traps, seed): input order does not matter", () => {
    const r1 = ok(splitMutants(inventory, [], { seed: 20261024 }));
    const r2 = ok(splitMutants(shuffled(inventory, 1), [], { seed: 20261024 }));
    expect(r2.feedback).toEqual(r1.feedback);
    expect(r2.scoring).toEqual(r1.scoring);
    expect(r2.groups).toEqual(r1.groups);
  });

  it("changes with the seed", () => {
    const r1 = ok(splitMutants(inventory, [], { seed: 1 }));
    const r2 = ok(splitMutants(inventory, [], { seed: 2 }));
    expect(r2.feedback).not.toEqual(r1.feedback);
  });

  it("produces disjoint partitions covering every kept mutant", () => {
    const r = ok(splitMutants(inventory, [], { seed: 77 }));
    const fb = new Set(r.feedback);
    expect(r.scoring.filter((k) => fb.has(k))).toEqual([]);
    expect(r.feedback.length + r.scoring.length).toBe(inventory.length);
  });

  it("does not use Math.random", () => {
    for (const file of ["../../cli/core/split.ts", "../../cli/core/prng.ts"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src).not.toMatch(/Math\.random\s*\(/);
    }
  });
});

describe("empty-partition refusal (never a zero score)", () => {
  it("refuses an empty inventory", () => {
    const r = splitMutants([], [], { seed: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty-inventory");
  });

  it("refuses an empty feedback partition", () => {
    const r = splitMutants(manyLines(10), [], { seed: 1, feedbackFraction: 0 });
    expect(r).toMatchObject({ ok: false, kind: "split-refusal", reason: "empty-feedback" });
  });

  it("refuses an empty scoring partition", () => {
    const r = splitMutants(manyLines(10), [], { seed: 1, feedbackFraction: 1 });
    expect(r).toMatchObject({ ok: false, reason: "empty-scoring" });
  });

  it("refuses when trap reservation consumes every group", () => {
    const m = mutant(4, 2);
    const traps: TrapLocation[] = [{ id: "t", trap: "sort-stability", file: "src.ts", range: range(4, 1, 4, 30) }];
    expect(splitMutants([m], traps, { seed: 1 })).toMatchObject({ ok: false, reason: "empty-feedback" });
  });

  it("assertMutantSplit throws a typed error carrying the refusal", () => {
    expect(() => assertMutantSplit(splitMutants([], [], { seed: 1 }))).toThrow(SplitRefusalError);
  });

  it("rejects an out-of-range feedback fraction", () => {
    expect(() => splitMutants(manyLines(3), [], { seed: 1, feedbackFraction: 1.5 })).toThrow(RangeError);
  });
});

describe("seeded subject split (future editions, D10)", () => {
  const ids = Array.from({ length: 24 }, (_, i) => `subject-${String(i).padStart(2, "0")}`);

  it("is deterministic, disjoint and complete", () => {
    const a = seededSubjectSplit(ids, { seed: 9, heldoutCount: 12 });
    const b = seededSubjectSplit(shuffled(ids, 4), { seed: 9, heldoutCount: 12 });
    expect(a).toEqual(b);
    if (!a.ok) throw new Error("unexpected refusal");
    expect(a.heldout).toHaveLength(12);
    expect(new Set([...a.dev, ...a.heldout]).size).toBe(24);
    expect(a.dev.filter((id) => a.heldout.includes(id))).toEqual([]);
  });

  it("refuses empty partitions and duplicate ids", () => {
    expect(seededSubjectSplit(ids, { seed: 9, heldoutCount: 0 })).toMatchObject({ ok: false, reason: "empty-heldout" });
    expect(seededSubjectSplit(ids, { seed: 9, heldoutCount: 24 })).toMatchObject({ ok: false, reason: "empty-dev" });
    expect(seededSubjectSplit(["a", "a", "b"], { seed: 9, heldoutCount: 1 })).toMatchObject({ ok: false, reason: "duplicate-subject" });
  });

  it("paired variant sends exactly one member of each trap-matched pair to held-out", () => {
    const pairs: [string, string][] = Array.from({ length: 12 }, (_, i) => [`dev-${i}`, `alt-${i}`]);
    const r = seededPairedSubjectSplit(pairs, { seed: 3 });
    if (!r.ok) throw new Error("unexpected refusal");
    expect(r.heldout).toHaveLength(12);
    expect(r.dev).toHaveLength(12);
    for (const [a, b] of pairs) expect([r.heldout.includes(a), r.heldout.includes(b)].filter(Boolean)).toHaveLength(1);
    expect(seededPairedSubjectSplit(pairs.map(([a, b]) => [b, a] as [string, string]), { seed: 3 })).toEqual(r);
    expect(seededPairedSubjectSplit([["x", "x"]], { seed: 3 })).toMatchObject({ ok: false, reason: "invalid-pair" });
  });
});
