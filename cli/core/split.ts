/**
 * Partitioning (PLAN §2.3, [C §2.6], D10). Pure and deterministic: no I/O, no clock, no Math.random.
 *
 * 1. Mutant split (every experiment): mutants are grouped by LOCATION (enclosing statement, fallback
 *    file + start line) so a near-identical neighbour of a scoring mutant can never sit in the feedback set.
 *    Identical patches are deduplicated first; groups overlapping a planted trap are reserved to scoring;
 *    every other group goes to feedback or scoring by a seeded hash of its group key. An empty partition
 *    is a typed refusal (preflight, exit 2), never a zero score.
 * 2. Subject split (future editions only, D10): edition 1 uses a designed, stratified assignment recorded
 *    in gold/manifest.json; these seeded functions exist so a later edition can switch to `seeded-hash`.
 */
import { compareSourcePositions, normalizeRelPath } from "./schemas.js";
import type { Partition, SourcePosition, SourceRange, TrapKind } from "./schemas.js";
import { seededHash32, seededUnit, toSeed } from "./prng.js";

// ---------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------

/**
 * One generated mutant as seen by the split (a subset of MutantRecord plus the AST statement range).
 * `relFile` and TrapLocation.file follow the SUBJECT-RELATIVE convention (schemas.ts isSubjectRelFile);
 * both are passed through normalizeRelPath before they are compared or used in a group key.
 */
export interface SplitMutantInput {
  key: string;
  relFile: string;
  range: SourceRange;
  mutator: string;
  replacement: string;
  /** Enclosing statement range (computed by the AST layer); absent ⇒ group by (relFile, start line). */
  statementRange?: SourceRange;
}

/** A planted trap's location. Canaries are ignored: they are excluded from partitions entirely. */
export interface TrapLocation {
  id: string;
  trap: TrapKind;
  file: string;
  range: SourceRange;
}

export interface MutantSplitOptions {
  seed: number;
  /** Probability-like share of non-reserved groups sent to feedback. Default 0.5. */
  feedbackFraction?: number;
}

export interface LocationGroup {
  groupKey: string;
  relFile: string;
  /** Union of the statement/line extent and every member mutant range. */
  extent: SourceRange;
  mutantKeys: string[];
  partition: Partition;
  /** Trap ids whose range overlaps this group (non-empty ⇒ reserved to scoring). */
  reservedBy: string[];
}

export interface DuplicatePatch {
  kept: string;
  dropped: string;
}

export interface SplitSizes {
  inventory: number;
  deduplicated: number;
  groups: number;
  reservedGroups: number;
  feedback: number;
  scoring: number;
}

export interface MutantSplit {
  ok: true;
  seed: number;
  feedbackFraction: number;
  /** Feedback mutant keys, sorted. */
  feedback: string[];
  /** Scoring mutant keys (generated mutants only; planted traps join the scoring set via patchrun), sorted. */
  scoring: string[];
  groups: LocationGroup[];
  reservedGroups: string[];
  duplicates: DuplicatePatch[];
  /** key → groupKey for every kept mutant (written into MutantRecord.groupKey). */
  groupOf: Record<string, string>;
  sizes: SplitSizes;
}

export type MutantSplitRefusalReason =
  | "empty-inventory"
  | "invalid-path"
  | "trap-file-unmatched"
  | "empty-feedback"
  | "empty-scoring";

export interface SplitRefusal {
  ok: false;
  kind: "split-refusal";
  reason: MutantSplitRefusalReason;
  message: string;
  sizes: SplitSizes;
  /** invalid-path: the offending paths; trap-file-unmatched: the ids of the traps whose file matched nothing. */
  offenders?: string[];
}

export type MutantSplitResult = MutantSplit | SplitRefusal;

export class SplitRefusalError extends Error {
  override name = "SplitRefusalError";
  readonly refusal: SplitRefusal | SubjectSplitRefusal;
  constructor(refusal: SplitRefusal | SubjectSplitRefusal) {
    super(refusal.message);
    this.refusal = refusal;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------------------------------------

/** A column larger than any real line, used to make a whole-line extent. */
const LINE_END_COLUMN = Number.MAX_SAFE_INTEGER;

function rangeText(r: SourceRange): string {
  return `${r.start.line}:${r.start.column}-${r.end.line}:${r.end.column}`;
}

function minPos(a: SourcePosition, b: SourcePosition): SourcePosition {
  return compareSourcePositions(a, b) <= 0 ? a : b;
}

function maxPos(a: SourcePosition, b: SourcePosition): SourcePosition {
  return compareSourcePositions(a, b) >= 0 ? a : b;
}

function unionRange(a: SourceRange, b: SourceRange): SourceRange {
  return { start: minPos(a.start, b.start), end: maxPos(a.end, b.end) };
}

/**
 * Inclusive overlap. Engines differ on whether `end` is exclusive, so touching ranges count as
 * overlapping: reserving one group too many to scoring is the safe direction.
 */
export function rangesOverlap(a: SourceRange, b: SourceRange): boolean {
  return compareSourcePositions(a.start, b.end) <= 0 && compareSourcePositions(b.start, a.end) <= 0;
}

/** Location group key: enclosing statement if known, else (file, start line). */
export function locationGroupKey(m: Pick<SplitMutantInput, "relFile" | "range" | "statementRange">): string {
  return m.statementRange !== undefined
    ? `${m.relFile}#stmt@${rangeText(m.statementRange)}`
    : `${m.relFile}#line@${m.range.start.line}`;
}

function baseExtent(m: SplitMutantInput): SourceRange {
  if (m.statementRange !== undefined) return m.statementRange;
  const line = m.range.start.line;
  return { start: { line, column: 1 }, end: { line, column: LINE_END_COLUMN } };
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------
// Mutant split
// ---------------------------------------------------------------------------------------------------------

/**
 * Remove identical patches: same file, same range and same replacement text are the same program even
 * when two mutators produced them. The smallest key is kept so the result is independent of input order.
 */
export function dedupePatches(mutants: readonly SplitMutantInput[]): {
  kept: SplitMutantInput[];
  duplicates: DuplicatePatch[];
} {
  const sorted = [...mutants].sort((a, b) => byString(a.key, b.key));
  const firstByPatch = new Map<string, string>();
  const kept: SplitMutantInput[] = [];
  const duplicates: DuplicatePatch[] = [];
  for (const m of sorted) {
    const patchId = `${m.relFile}\u0000${rangeText(m.range)}\u0000${m.replacement}`;
    const prior = firstByPatch.get(patchId);
    if (prior !== undefined) {
      duplicates.push({ kept: prior, dropped: m.key });
      continue;
    }
    firstByPatch.set(patchId, m.key);
    kept.push(m);
  }
  return { kept, duplicates };
}

/** Location-grouped, trap-reserved, deduplicated, seeded feedback/scoring split of one subject's mutants. */
export function splitMutants(
  mutants: readonly SplitMutantInput[],
  traps: readonly TrapLocation[],
  options: MutantSplitOptions,
): MutantSplitResult {
  const seed = toSeed(options.seed);
  const feedbackFraction = options.feedbackFraction ?? 0.5;
  if (!(feedbackFraction >= 0 && feedbackFraction <= 1))
    throw new RangeError(`feedbackFraction must be in [0, 1], got ${feedbackFraction}`);

  // Normalise both sides of every file comparison (subject-relative convention, schemas.ts). Canaries are
  // disposable and never part of a partition, so they reserve nothing and are not checked here.
  const invalidPaths: string[] = [];
  const normalised: SplitMutantInput[] = mutants.map((m) => {
    const relFile = normalizeRelPath(m.relFile);
    if (relFile === null) {
      invalidPaths.push(m.relFile);
      return m;
    }
    return relFile === m.relFile ? m : { ...m, relFile };
  });
  const scoredTraps: TrapLocation[] = [];
  for (const t of traps) {
    if (t.trap === "canary") continue;
    const file = normalizeRelPath(t.file);
    if (file === null) {
      invalidPaths.push(t.file);
      continue;
    }
    scoredTraps.push(file === t.file ? t : { ...t, file });
  }

  const { kept, duplicates } = dedupePatches(normalised);

  // Build location groups.
  const groupsByKey = new Map<string, { relFile: string; extent: SourceRange; mutantKeys: string[] }>();
  const groupOf: Record<string, string> = {};
  for (const m of kept) {
    const gk = locationGroupKey(m);
    groupOf[m.key] = gk;
    const existing = groupsByKey.get(gk);
    if (existing === undefined) {
      groupsByKey.set(gk, { relFile: m.relFile, extent: unionRange(baseExtent(m), m.range), mutantKeys: [m.key] });
    } else {
      existing.extent = unionRange(existing.extent, m.range);
      existing.mutantKeys.push(m.key);
    }
  }

  const groups: LocationGroup[] = [...groupsByKey.entries()]
    .sort(([a], [b]) => byString(a, b))
    .map(([groupKey, g]) => {
      const reservedBy = scoredTraps
        .filter((t) => t.file === g.relFile && rangesOverlap(t.range, g.extent))
        .map((t) => t.id)
        .sort(byString);
      const partition: Partition =
        reservedBy.length > 0 ? "scoring" : seededUnit(seed, groupKey) < feedbackFraction ? "feedback" : "scoring";
      return { groupKey, relFile: g.relFile, extent: g.extent, mutantKeys: [...g.mutantKeys].sort(byString), partition, reservedBy };
    });

  const feedback = groups.filter((g) => g.partition === "feedback").flatMap((g) => g.mutantKeys).sort(byString);
  const scoring = groups.filter((g) => g.partition === "scoring").flatMap((g) => g.mutantKeys).sort(byString);
  const reservedGroups = groups.filter((g) => g.reservedBy.length > 0).map((g) => g.groupKey);

  const sizes: SplitSizes = {
    inventory: mutants.length,
    deduplicated: kept.length,
    groups: groups.length,
    reservedGroups: reservedGroups.length,
    feedback: feedback.length,
    scoring: scoring.length,
  };

  const refuse = (reason: MutantSplitRefusalReason, message: string, offenders?: string[]): SplitRefusal => ({
    ok: false,
    kind: "split-refusal",
    reason,
    message,
    sizes,
    ...(offenders === undefined ? {} : { offenders }),
  });
  if (kept.length === 0) return refuse("empty-inventory", "no generated mutants to split");
  if (invalidPaths.length > 0)
    return refuse("invalid-path", "a mutant relFile or trap file is not a safe relative path", [...invalidPaths].sort(byString));
  // A scored trap whose file matches no inventoried file would silently reserve nothing (e.g. a repo-relative
  // trap path against subject-relative mutants), letting its neighbours into the feedback set.
  const inventoryFiles = new Set(normalised.map((m) => m.relFile));
  const unmatched = scoredTraps.filter((t) => !inventoryFiles.has(t.file)).map((t) => t.id).sort(byString);
  if (unmatched.length > 0)
    return refuse("trap-file-unmatched", "a scored trap's file matches no mutant relFile in the inventory", unmatched);
  if (feedback.length === 0) return refuse("empty-feedback", "feedback partition is empty; the gate would have no signal");
  if (scoring.length === 0) return refuse("empty-scoring", "scoring partition is empty; nothing could be scored");

  return { ok: true, seed, feedbackFraction, feedback, scoring, groups, reservedGroups, duplicates, groupOf, sizes };
}

/** Throwing variant for callers that treat a refusal as a preflight abort. */
export function assertMutantSplit(result: MutantSplitResult): MutantSplit {
  if (!result.ok) throw new SplitRefusalError(result);
  return result;
}

// ---------------------------------------------------------------------------------------------------------
// Subject split (seeded; future editions only — D10)
// ---------------------------------------------------------------------------------------------------------

export interface SubjectSplit {
  ok: true;
  method: "seeded-hash";
  seed: number;
  dev: string[];
  heldout: string[];
  /** Present for the paired variant: each held-out subject's trap-matched dev partner. */
  partners?: { heldout: string; dev: string }[];
}

export interface SubjectSplitRefusal {
  ok: false;
  kind: "split-refusal";
  reason: "empty-dev" | "empty-heldout" | "duplicate-subject" | "invalid-pair";
  message: string;
}

export type SubjectSplitResult = SubjectSplit | SubjectSplitRefusal;

function subjectRefusal(reason: SubjectSplitRefusal["reason"], message: string): SubjectSplitRefusal {
  return { ok: false, kind: "split-refusal", reason, message };
}

/**
 * Rank subjects by a seeded hash of their id (ties broken by id) and send the first `heldoutCount` to
 * held-out. Independent of input order.
 */
export function seededSubjectSplit(ids: readonly string[], options: { seed: number; heldoutCount: number }): SubjectSplitResult {
  const seed = toSeed(options.seed);
  if (new Set(ids).size !== ids.length) return subjectRefusal("duplicate-subject", "subject ids must be unique");
  if (!Number.isInteger(options.heldoutCount) || options.heldoutCount <= 0)
    return subjectRefusal("empty-heldout", "held-out partition would be empty");
  if (options.heldoutCount >= ids.length) return subjectRefusal("empty-dev", "dev partition would be empty");
  const ranked = [...ids].sort((a, b) => seededHash32(seed, a) - seededHash32(seed, b) || byString(a, b));
  const heldout = ranked.slice(0, options.heldoutCount).sort(byString);
  const dev = ranked.slice(options.heldoutCount).sort(byString);
  return { ok: true, method: "seeded-hash", seed, dev, heldout };
}

/**
 * Stratified seeded split over trap-matched pairs: exactly one member of each pair goes to held-out,
 * chosen by a seeded hash of the (order-normalised) pair. Keeps D10's balance guarantee under a seed.
 */
export function seededPairedSubjectSplit(
  pairs: readonly (readonly [string, string])[],
  options: { seed: number },
): SubjectSplitResult {
  const seed = toSeed(options.seed);
  if (pairs.length === 0) return subjectRefusal("empty-heldout", "no pairs to split");
  const seen = new Set<string>();
  for (const [a, b] of pairs) {
    if (a === b) return subjectRefusal("invalid-pair", `subject ${a} is paired with itself`);
    for (const id of [a, b]) {
      if (seen.has(id)) return subjectRefusal("duplicate-subject", `subject ${id} appears in two pairs`);
      seen.add(id);
    }
  }
  const dev: string[] = [];
  const heldout: string[] = [];
  const partners: { heldout: string; dev: string }[] = [];
  for (const pair of pairs) {
    const [lo, hi]: [string, string] = byString(pair[0], pair[1]) <= 0 ? [pair[0], pair[1]] : [pair[1], pair[0]];
    const loIsHeldout = (seededHash32(seed, `${lo}|${hi}`) & 1) === 1;
    const h = loIsHeldout ? lo : hi;
    const d = loIsHeldout ? hi : lo;
    heldout.push(h);
    dev.push(d);
    partners.push({ heldout: h, dev: d });
  }
  partners.sort((x, y) => byString(x.heldout, y.heldout));
  return { ok: true, method: "seeded-hash", seed, dev: dev.sort(byString), heldout: heldout.sort(byString), partners };
}
