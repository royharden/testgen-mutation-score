/**
 * Stryker activation spike (D9). WRITTEN IN DIRTY MODE, NEVER RUN. Run it once at activation, after
 * `npm install`, the sandbox probes and the first inventory, and record its result in README.md
 * ("Stryker spike" slot) and docs/DEFERRED-VALIDATION.md.
 *
 *   npm run spike:stryker -- --subject clamp-range
 *
 * It answers the questions the gate design depends on (PLAN §2.2, [C §2.5] "Kill matrix computation"):
 *
 *   CHECK 1 (key containment): when Stryker is given only the FEEDBACK location ranges via `mutate`
 *     (`src.ts:L:C-L:C`), is every produced mutant key in the frozen feedback key set? Range selectors
 *     select by location, not by mutant, so a scoring group nested inside a feedback statement could leak
 *     in. If this fails, the generation adapter must keep aborting on foreign keys (exit 3) and the default
 *     engine path becomes `patchrun` with exact feedback patches.
 *   CHECK 2 (attribution): with `coverageAnalysis: "perTest"` and `disableBail: true`, does a single
 *     batched run attribute kills (`killedBy`) to exactly the same unit per mutant key as one isolated run
 *     per unit? Units are chosen so that some killers overlap and some are disjoint. Only if this holds
 *     may the batched optimisation replace the default one-pass-per-unit computation.
 *   CHECK 3 (position base): are `runMutationTest()` locations 0-based or 1-based? Keys use 1-based
 *     positions (mutation-testing-report-schema); the adapter's conversion is fixed from this answer.
 *
 * Trust: this script runs Stryker on the HOST against the subject's frozen hand suite only — never on a
 * model candidate (those always go through cli/sandbox/sandboxrun.ts).
 *
 * Exit codes: 0 all checks pass; 2 refused (bad flags, hand suite outside the strict grammar);
 * 3 a check failed (record the failure; the documented fallback applies).
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Stryker } from "@stryker-mutator/core";
import { EXIT_CODES } from "../cli/core/exitCodes.js";
import { parseCandidate } from "../cli/core/grammar.js";
import { mutantKey, normalizeRelFile, sha256Hex } from "../cli/core/mutantKey.js";
import type { SourceRange } from "../cli/core/schemas.js";
import { splitMutants } from "../cli/core/split.js";
import type { SplitMutantInput } from "../cli/core/split.js";

type StrykerOptions = NonNullable<ConstructorParameters<typeof Stryker>[0]>;
type StrykerMutantResult = Awaited<ReturnType<Stryker["runMutationTest"]>>[number];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPIKE_SEED = 20261024;

interface SpikeArgs {
  subject: string;
  /** Position base of runMutationTest() locations; CHECK 3 reports which assumption matched. */
  assumeZeroBased: boolean;
}

function parseArgs(argv: readonly string[]): SpikeArgs | null {
  let subject = "clamp-range";
  let assumeZeroBased = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--subject") {
      const v = argv[++i];
      if (v === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) return null;
      subject = v;
    } else if (a === "--one-based") {
      assumeZeroBased = false;
    } else {
      return null;
    }
  }
  return { subject, assumeZeroBased };
}

/** Convert a Stryker API location to the 1-based range used by mutant keys. */
function toKeyRange(loc: StrykerMutantResult["location"], zeroBased: boolean): SourceRange {
  const d = zeroBased ? 1 : 0;
  return {
    start: { line: loc.start.line + d, column: loc.start.column + d },
    end: { line: loc.end.line + d, column: loc.end.column + d },
  };
}

function rangeSelector(file: string, r: SourceRange): string {
  // Stryker's mutate range syntax: "file:startLine:startCol-endLine:endCol" (1-based lines/columns).
  return `${file}:${r.start.line}:${r.start.column}-${r.end.line}:${r.end.column}`;
}

async function runStryker(workDir: string, options: StrykerOptions): Promise<StrykerMutantResult[]> {
  const previous = process.cwd();
  process.chdir(workDir); // Stryker resolves its sandbox from the working directory.
  try {
    return await new Stryker({
      testRunner: "vitest",
      plugins: ["@stryker-mutator/vitest-runner"],
      reporters: [],
      concurrency: 1,
      cleanTempDir: true,
      ...options,
    }).runMutationTest();
  } finally {
    process.chdir(previous);
  }
}

/** Stryker result → split input with its location key. Paths are made relative to the spike work dir. */
function toSplitInput(m: StrykerMutantResult, workDir: string, srcSha256: string, zeroBased: boolean): SplitMutantInput {
  const relFile = normalizeRelFile(path.relative(workDir, path.resolve(workDir, m.fileName)).split(path.sep).join("/"));
  const range = toKeyRange(m.location, zeroBased);
  const replacement = m.replacement ?? "";
  return {
    key: mutantKey({ relFile, srcSha256, range, mutator: m.mutatorName, replacement }),
    relFile,
    range,
    mutator: m.mutatorName,
    replacement,
  };
}

/** Line-group extents end at a sentinel column; clamp to the real line length for Stryker's selector. */
function clampToSource(r: SourceRange, lines: readonly string[]): SourceRange {
  const endLen = (lines[r.end.line - 1]?.length ?? 0) + 1;
  return { start: r.start, end: { line: r.end.line, column: Math.min(r.end.column, endLen) } };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error("usage: stryker-spike [--subject <slug>] [--one-based]");
    return EXIT_CODES.REFUSED;
  }
  const subjectDir = path.join(REPO_ROOT, "fixtures", "subjects", args.subject);
  const src = await readFile(path.join(subjectDir, "src.ts"), "utf8");
  const hand = await readFile(path.join(subjectDir, "hand.test.ts"), "utf8");
  const srcSha256 = sha256Hex(src);

  const parsed = parseCandidate(hand);
  if (!parsed.ok) {
    console.error(`hand suite of ${args.subject} is outside the strict grammar (${parsed.detail}); pick another subject`);
    return EXIT_CODES.REFUSED;
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "testgen-spike-"));
  try {
    await writeFile(path.join(workDir, "src.ts"), src);
    await writeFile(path.join(workDir, "package.json"), JSON.stringify({ type: "module", private: true }));
    // One file per unit, next to src.ts so the canonical `./src` specifier resolves unchanged and batched
    // and isolated runs see byte-identical unit text.
    const unitFiles: string[] = [];
    for (const u of parsed.units) {
      const rel = `u${u.index}.test.ts`;
      await writeFile(path.join(workDir, rel), u.text);
      unitFiles.push(rel);
    }
    const writeVitestConfig = async (name: string, include: string[]) =>
      writeFile(
        path.join(workDir, name),
        `export default { test: { include: ${JSON.stringify(include)}, environment: "node" } };\n`,
      );
    await writeVitestConfig("vitest.all.config.mjs", unitFiles);

    // Inventory (all mutants) → split → feedback ranges.
    const all = await runStryker(workDir, { mutate: ["src.ts"], vitest: { configFile: "vitest.all.config.mjs" } } as StrykerOptions);
    const keyOf = (m: StrykerMutantResult): string => toSplitInput(m, workDir, srcSha256, args.assumeZeroBased).key;
    const inputs: SplitMutantInput[] = all.map((m) => toSplitInput(m, workDir, srcSha256, args.assumeZeroBased));
    // No AST statement ranges here, so groups fall back to (file, line); the spike tests the selector, not ast.ts.
    const split = splitMutants(inputs, [], { seed: SPIKE_SEED });
    if (!split.ok) {
      console.error(`split refused: ${split.reason}`);
      return EXIT_CODES.REFUSED;
    }
    const lines = src.split(/\r?\n/);
    const feedbackKeys = new Set(split.feedback);
    const feedbackRanges = split.groups
      .filter((g) => g.partition === "feedback")
      .map((g) => clampToSource(g.extent, lines));

    // CHECK 3: mutated nodes start at a token, so under the right base every start position lands on a
    // non-whitespace character. Score both bases; the assumed one must be perfect and should beat the other.
    const startsOnToken = (r: SourceRange): boolean => {
      const ch = lines[r.start.line - 1]?.[r.start.column - 1];
      return ch !== undefined && ch.trim() !== "";
    };
    const fraction = (zeroBased: boolean): number =>
      all.length === 0 ? 0 : all.filter((m) => startsOnToken(toKeyRange(m.location, zeroBased))).length / all.length;
    const assumedFraction = fraction(args.assumeZeroBased);
    const alternativeFraction = fraction(!args.assumeZeroBased);

    // CHECK 1: range-targeted run produces only feedback keys.
    const targeted = await runStryker(workDir, {
      mutate: feedbackRanges.map((r) => rangeSelector("src.ts", r)),
      vitest: { configFile: "vitest.all.config.mjs" },
    } as StrykerOptions);
    const targetedKeys = targeted.map((m) => keyOf(m));
    const foreign = targetedKeys.filter((k) => !feedbackKeys.has(k));

    // CHECK 2: batched perTest + disableBail attribution vs isolated per-unit runs.
    const batched = await runStryker(workDir, {
      mutate: feedbackRanges.map((r) => rangeSelector("src.ts", r)),
      coverageAnalysis: "perTest",
      disableBail: true,
      vitest: { configFile: "vitest.all.config.mjs" },
    } as StrykerOptions);
    const batchedKills = new Map<string, Set<string>>();
    for (const m of batched) {
      if (m.status !== "Killed") continue;
      const k = keyOf(m);
      // Assumption verified here: killedBy test ids contain the unit file name.
      const killers = (m.killedBy ?? []).map((id) => unitFiles.find((f) => id.includes(path.basename(f))) ?? `?${id}`);
      batchedKills.set(k, new Set(killers));
    }
    const isolatedKills = new Map<string, Set<string>>();
    for (const [i, unit] of unitFiles.entries()) {
      const cfg = `vitest.u${i}.config.mjs`;
      await writeVitestConfig(cfg, [unit]);
      const res = await runStryker(workDir, {
        mutate: feedbackRanges.map((r) => rangeSelector("src.ts", r)),
        coverageAnalysis: "off",
        vitest: { configFile: cfg },
      } as StrykerOptions);
      for (const m of res) {
        if (m.status !== "Killed") continue;
        const k = keyOf(m);
        const set = isolatedKills.get(k) ?? new Set<string>();
        set.add(unit);
        isolatedKills.set(k, set);
      }
    }
    const attributionDiffs: { key: string; batched: string[]; isolated: string[] }[] = [];
    for (const k of new Set([...batchedKills.keys(), ...isolatedKills.keys()])) {
      const b = [...(batchedKills.get(k) ?? [])].sort();
      const iso = [...(isolatedKills.get(k) ?? [])].sort();
      if (b.join(",") !== iso.join(",")) attributionDiffs.push({ key: k, batched: b, isolated: iso });
    }

    const report = {
      subject: args.subject,
      srcSha256,
      assumedZeroBased: args.assumeZeroBased,
      check1KeyContainment: { pass: foreign.length === 0, produced: targetedKeys.length, foreign },
      check2Attribution: { pass: attributionDiffs.length === 0, units: unitFiles.length, diffs: attributionDiffs },
      check3PositionBase: {
        pass: assumedFraction === 1 && assumedFraction > alternativeFraction,
        assumedFraction,
        alternativeFraction,
      },
      sizes: split.sizes,
    };
    const outDir = path.join(REPO_ROOT, "results", "spike");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, `stryker-spike-${args.subject}.json`), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    const pass = report.check1KeyContainment.pass && report.check2Attribution.pass && report.check3PositionBase.pass;
    return pass ? EXIT_CODES.OK : EXIT_CODES.FATAL;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(EXIT_CODES.FATAL);
  },
);
