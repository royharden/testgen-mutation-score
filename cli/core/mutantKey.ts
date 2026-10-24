/**
 * Location-keyed mutant identity (PLAN §2.3, [C §2.2]).
 *
 *   key = sha256( relFile | srcSha256 | startLine:startCol-endLine:endCol | mutator | replacement )
 *
 * Exactly these five inputs and nothing else: never an engine ordinal / Stryker mutant id, never an
 * absolute path, so keys are stable across engine runs, machines and operating systems.
 *
 * CLI-ONLY: uses node:crypto, so it must never be imported by cli/core/schemas.ts or the viewer (D1).
 */
import { createHash } from "node:crypto";
import { isSubjectRelFile, normalizeRelPath } from "./schemas.js";
import type { MutantKeyInput, SourceRange } from "./schemas.js";

export type { MutantKeyInput };

/** sha256 hex of a UTF-8 string or raw bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** `startLine:startCol-endLine:endCol` (1-based, as in mutation-testing-report-schema). */
export function formatRange(range: SourceRange): string {
  return `${range.start.line}:${range.start.column}-${range.end.line}:${range.end.column}`;
}

/**
 * Normalise an engine-reported file path to relative POSIX form (backslashes → `/`, leading `./` removed).
 * Throws if the result is not a safe relative path. Keys additionally require the result to be
 * SUBJECT-RELATIVE (`src.ts`, see isSubjectRelFile in schemas.ts); engines run with the subject directory
 * as their root, so their paths normalise to that form.
 */
export function normalizeRelFile(file: string): string {
  const p = normalizeRelPath(file);
  if (p === null) throw new MutantKeyError(`not a safe relative path: ${JSON.stringify(file)}`);
  return p;
}

export class MutantKeyError extends Error {
  override name = "MutantKeyError";
}

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n >= 1;
}

/**
 * The exact pre-image hashed by {@link mutantKey}. Exposed for tests and for audit output.
 *
 * Injectivity: `relFile` and `mutator` may not contain `|`, `srcSha256` is fixed-width hex and the range
 * has a fixed shape, so the last field (`replacement`, which may contain anything) is unambiguous.
 */
export function mutantKeyPreimage(input: MutantKeyInput): string {
  const { relFile, srcSha256, range, mutator, replacement } = input;
  if (relFile !== normalizeRelFile(relFile)) throw new MutantKeyError(`relFile must be normalised: ${JSON.stringify(relFile)}`);
  if (!isSubjectRelFile(relFile))
    throw new MutantKeyError(`relFile must be subject-relative (e.g. src.ts): ${JSON.stringify(relFile)}`);
  if (relFile.includes("|")) throw new MutantKeyError("relFile may not contain '|'");
  if (!/^[0-9a-f]{64}$/.test(srcSha256)) throw new MutantKeyError("srcSha256 must be lowercase hex sha256");
  if (mutator.length === 0 || mutator.includes("|")) throw new MutantKeyError("mutator must be non-empty and contain no '|'");
  const { start, end } = range;
  if (![start.line, start.column, end.line, end.column].every(isPositiveInt))
    throw new MutantKeyError("range positions must be 1-based integers");
  if (end.line < start.line || (end.line === start.line && end.column < start.column))
    throw new MutantKeyError("range end precedes start");
  return [relFile, srcSha256, formatRange(range), mutator, replacement].join("|");
}

/** Stable mutant key: lowercase hex sha256 of {@link mutantKeyPreimage}. */
export function mutantKey(input: MutantKeyInput): string {
  return sha256Hex(mutantKeyPreimage(input));
}
