/**
 * Strict candidate grammar and byte-faithful unit slicing (PLAN §2.1, [C §2.4]).
 *
 * A candidate test file is accepted structurally only if its top level contains:
 *   - import declarations (string-literal specifier), all before the first test, and
 *   - 1..MAX_TESTS_PER_FILE expression statements `test(name, fn)` / `it(name, fn)` where `name` is a
 *     string literal, names are unique, and `fn` is a synchronous, non-generator, parameterless function
 *     or arrow function. Exactly two arguments (no options/timeout argument).
 * Anything else — describe, hooks, test.each/it.each, top-level variables/helpers/exports/other
 * statements — is `syntax` / `unsupported-structure`. A file that does not parse is `syntax` / `parse-error`.
 *
 * `test.only / .skip / .todo / .concurrent` are recognised structurally and reported in `modifiers`; the
 * gate maps them to `forbidden-import` with a sub-reason ([C §2.5] step 2), so they are not grammar errors.
 * Import allowlisting and identifier bans are likewise ast.ts's job (M4), not the grammar's.
 *
 * A unit is the exact slice `importsBlock + "\n" + testStatement` of the original text: no printer, no
 * reformatting, no prelude lifting. Offsets are UTF-16 code units into the decoded text; slices taken at
 * node boundaries re-encode to exactly the original bytes. Leading comments of a statement are trivia and
 * are not part of its slice; comments inside the statement are.
 *
 * Pure: depends only on the `typescript` package (no node:* imports, no file system).
 */
import ts from "typescript";
import { MAX_TESTS_PER_FILE } from "./schemas.js";
import type { SyntaxSubReason, TextRange } from "./schemas.js";

export { MAX_TESTS_PER_FILE };

export const TEST_CALLEES = ["test", "it"] as const;
export type TestCallee = (typeof TEST_CALLEES)[number];

/** Modifiers that are structurally a test but forbidden by the gate (mapped to forbidden-import). */
export const FORBIDDEN_TEST_MODIFIERS = ["only", "skip", "todo", "concurrent"] as const;
export type TestModifier = (typeof FORBIDDEN_TEST_MODIFIERS)[number];

export interface Position {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

export interface ImportInfo {
  specifier: string;
  range: TextRange;
}

export interface ParsedTest {
  index: number;
  name: string;
  callee: TestCallee;
  modifiers: TestModifier[];
  /** Whole statement, from its first token (leading trivia excluded) to its end (incl. `;` if present). */
  range: TextRange;
  position: Position;
}

export interface SlicedUnit {
  index: number;
  testName: string;
  modifiers: TestModifier[];
  /** Contiguous block from the first import's first token to the last import's end; null without imports. */
  importsRange: TextRange | null;
  testRange: TextRange;
  /** Exact bytes: text.slice(imports) + "\n" + text.slice(test), or just the test slice without imports. */
  text: string;
}

export interface GrammarAccepted {
  ok: true;
  imports: ImportInfo[];
  tests: ParsedTest[];
  units: SlicedUnit[];
}

export interface GrammarRejected {
  ok: false;
  code: "syntax";
  subReason: SyntaxSubReason;
  detail: string;
  position: Position | null;
}

export type GrammarResult = GrammarAccepted | GrammarRejected;

const FILE_NAME = "candidate.test.ts";

function positionOf(sf: ts.SourceFile, offset: number): Position {
  const lc = sf.getLineAndCharacterOfPosition(offset);
  return { line: lc.line + 1, column: lc.character + 1 };
}

function reject(subReason: SyntaxSubReason, detail: string, position: Position | null): GrammarRejected {
  return { ok: false, code: "syntax", subReason, detail, position };
}

/**
 * Syntactic diagnostics through the public API: transpileModule reports only syntactic and option
 * diagnostics (no type checking, no resolution), which is exactly "does it parse".
 */
function firstParseError(text: string): { message: string; start: number | undefined } | null {
  const out = ts.transpileModule(text, {
    fileName: FILE_NAME,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      // Treat every candidate as a module so an import-free file never trips a script-file diagnostic.
      moduleDetection: ts.ModuleDetectionKind.Force,
    },
  });
  // Syntactic diagnostics are attached to the file; option diagnostics are not and are not parse errors.
  const err = (out.diagnostics ?? []).find((d) => d.category === ts.DiagnosticCategory.Error && d.file !== undefined);
  if (err === undefined) return null;
  return { message: ts.flattenDiagnosticMessageText(err.messageText, "\n"), start: err.start };
}

/** `test` / `it` / `test.only` / `it.skip.concurrent` …; null for anything else (incl. test.each). */
function classifyCallee(expr: ts.Expression): { callee: TestCallee; modifiers: TestModifier[] } | null {
  const modifiers: TestModifier[] = [];
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur)) {
    const name = cur.name.text;
    if (!(FORBIDDEN_TEST_MODIFIERS as readonly string[]).includes(name)) return null;
    modifiers.unshift(name as TestModifier);
    cur = cur.expression;
  }
  if (!ts.isIdentifier(cur)) return null;
  const base = cur.text;
  if (!(TEST_CALLEES as readonly string[]).includes(base)) return null;
  return { callee: base as TestCallee, modifiers };
}

function isSyncParameterlessFunction(node: ts.Expression): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return false;
  if (ts.isFunctionExpression(node) && node.asteriskToken !== undefined) return false;
  return node.parameters.length === 0;
}

/** Describe a disallowed top-level statement for the rejection detail. */
function describeStatement(stmt: ts.Statement, sf: ts.SourceFile): string {
  if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
    const callee = stmt.expression.expression.getText(sf);
    return `top-level call ${callee}(...) is not test()/it()`;
  }
  return `top-level ${ts.SyntaxKind[stmt.kind]} is not allowed (only imports and test()/it())`;
}

/** Parse a candidate file and either reject it (`syntax`) or return its tests and byte-faithful units. */
export function parseCandidate(text: string): GrammarResult {
  const parseError = firstParseError(text);
  const sf = ts.createSourceFile(FILE_NAME, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);
  if (parseError !== null) {
    return reject(
      "parse-error",
      parseError.message,
      parseError.start === undefined ? null : positionOf(sf, parseError.start),
    );
  }

  const imports: ImportInfo[] = [];
  const tests: ParsedTest[] = [];
  const names = new Set<string>();

  for (const stmt of sf.statements) {
    const start = stmt.getStart(sf);
    const pos = positionOf(sf, start);

    if (ts.isImportDeclaration(stmt)) {
      if (tests.length > 0) return reject("unsupported-structure", "imports must precede every test", pos);
      if (!ts.isStringLiteral(stmt.moduleSpecifier))
        return reject("unsupported-structure", "import specifier must be a string literal", pos);
      imports.push({ specifier: stmt.moduleSpecifier.text, range: { start, end: stmt.end } });
      continue;
    }

    if (!ts.isExpressionStatement(stmt) || !ts.isCallExpression(stmt.expression))
      return reject("unsupported-structure", describeStatement(stmt, sf), pos);

    const call = stmt.expression;
    const kind = classifyCallee(call.expression);
    if (kind === null) return reject("unsupported-structure", describeStatement(stmt, sf), pos);
    if (call.questionDotToken !== undefined || call.typeArguments !== undefined)
      return reject("unsupported-structure", "test call may not use ?. or type arguments", pos);

    const [nameArg, fnArg, ...extra] = call.arguments;
    if (nameArg === undefined || !(ts.isStringLiteral(nameArg) || ts.isNoSubstitutionTemplateLiteral(nameArg)))
      return reject("unsupported-structure", "test name must be a string literal", pos);
    const name = nameArg.text;
    if (name.length === 0) return reject("unsupported-structure", "test name must be non-empty", pos);

    // `.todo` may legitimately have no body; it is rejected by the gate as forbidden-import/todo anyway.
    const bodyOptional = kind.modifiers.includes("todo");
    if (fnArg === undefined) {
      if (!bodyOptional) return reject("unsupported-structure", `test "${name}" has no function body`, pos);
    } else if (!isSyncParameterlessFunction(fnArg)) {
      return reject(
        "unsupported-structure",
        `test "${name}" body must be a synchronous, parameterless function or arrow function`,
        pos,
      );
    }
    if (extra.length > 0)
      return reject("unsupported-structure", `test "${name}" may not take an options/timeout argument`, pos);

    if (names.has(name)) return reject("unsupported-structure", `duplicate test name "${name}"`, pos);
    names.add(name);

    tests.push({
      index: tests.length,
      name,
      callee: kind.callee,
      modifiers: kind.modifiers,
      range: { start, end: stmt.end },
      position: pos,
    });
    if (tests.length > MAX_TESTS_PER_FILE)
      return reject("unsupported-structure", `more than ${MAX_TESTS_PER_FILE} tests in one file`, pos);
  }

  if (tests.length === 0) return reject("unsupported-structure", "file contains no test()/it() statement", null);

  const firstImport = imports[0];
  const lastImport = imports[imports.length - 1];
  const importsRange: TextRange | null =
    firstImport !== undefined && lastImport !== undefined ? { start: firstImport.range.start, end: lastImport.range.end } : null;

  const units = tests.map((t) => sliceUnit(text, importsRange, t));
  return { ok: true, imports, tests, units };
}

/** Build one unit as an exact slice of the original text. */
export function sliceUnit(text: string, importsRange: TextRange | null, test: ParsedTest): SlicedUnit {
  const testText = text.slice(test.range.start, test.range.end);
  const unitText = importsRange === null ? testText : `${text.slice(importsRange.start, importsRange.end)}\n${testText}`;
  return {
    index: test.index,
    testName: test.name,
    modifiers: test.modifiers,
    importsRange,
    testRange: test.range,
    text: unitText,
  };
}
