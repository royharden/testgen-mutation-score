/** Deterministic TypeScript-AST fallback inventory. Operators are fixed for the experiment. */
import ts from "typescript";
import { EngineExecutionError, normalizeMutations } from "./engine.js";
import type { RawMutation } from "./engine.js";
import type { MutantRecord, SourceRange } from "../core/schemas.js";

export const INHOUSE_VERSION = "1";
export const INHOUSE_OPERATORS = ["BooleanLiteral", "NumericBoundary", "Equality", "Relational", "Arithmetic", "Logical", "UnaryNegation", "Conditional"] as const;

export function enumerateInhouse(sourceText: string): RawMutation[] {
  const file = ts.createSourceFile("src.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) throw new EngineExecutionError("harness-compile-error", "subject source does not parse");
  const mutations: RawMutation[] = [];
  const rangeAt = (start: number, end: number): SourceRange => {
    const a = file.getLineAndCharacterOfPosition(start), b = file.getLineAndCharacterOfPosition(end);
    return { start: { line: a.line + 1, column: a.character + 1 }, end: { line: b.line + 1, column: b.character + 1 } };
  };
  const add = (node: ts.Node, mutator: string, replacement: string) => {
    if (node.getText(file) !== replacement) mutations.push({ relFile: "src.ts", range: rangeAt(node.getStart(file), node.end), mutator, replacement });
  };
  const replacements: Readonly<Partial<Record<ts.SyntaxKind, readonly [string, string]>>> = {
    [ts.SyntaxKind.EqualsEqualsToken]: ["Equality", "!="], [ts.SyntaxKind.ExclamationEqualsToken]: ["Equality", "=="],
    [ts.SyntaxKind.EqualsEqualsEqualsToken]: ["Equality", "!=="], [ts.SyntaxKind.ExclamationEqualsEqualsToken]: ["Equality", "==="],
    [ts.SyntaxKind.LessThanToken]: ["Relational", "<="], [ts.SyntaxKind.LessThanEqualsToken]: ["Relational", "<"],
    [ts.SyntaxKind.GreaterThanToken]: ["Relational", ">="], [ts.SyntaxKind.GreaterThanEqualsToken]: ["Relational", ">"],
    [ts.SyntaxKind.PlusToken]: ["Arithmetic", "-"], [ts.SyntaxKind.MinusToken]: ["Arithmetic", "+"],
    [ts.SyntaxKind.AsteriskToken]: ["Arithmetic", "/"], [ts.SyntaxKind.SlashToken]: ["Arithmetic", "*"],
    [ts.SyntaxKind.PercentToken]: ["Arithmetic", "*"],
    [ts.SyntaxKind.AmpersandAmpersandToken]: ["Logical", "||"], [ts.SyntaxKind.BarBarToken]: ["Logical", "&&"],
  };
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.TrueKeyword) add(node, "BooleanLiteral", "false");
    else if (node.kind === ts.SyntaxKind.FalseKeyword) add(node, "BooleanLiteral", "true");
    else if (ts.isNumericLiteral(node)) {
      // Parenthesized numbers are valid both as expressions and object property values. Property names
      // and type literals are excluded; compile-validity is still measured at activation, never assumed.
      if (!(ts.isLiteralTypeNode(node.parent) || (ts.isPropertyAssignment(node.parent) && node.parent.name === node))) {
        const value = Number(node.text);
        if (Number.isFinite(value)) for (const n of new Set([0, value + 1, value - 1])) add(node, "NumericBoundary", String(n));
      }
    } else if (ts.isBinaryExpression(node)) {
      const replacement = replacements[node.operatorToken.kind];
      if (replacement !== undefined) add(node.operatorToken, replacement[0], replacement[1]);
    } else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      add(node, "UnaryNegation", `(${node.operand.getText(file)})`);
    } else if (ts.isConditionalExpression(node)) {
      add(node.condition, "Conditional", `!(${node.condition.getText(file)})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return mutations;
}

export function inhouseMutants(sourceText: string): MutantRecord[] {
  return normalizeMutations(sourceText, "inhouse", enumerateInhouse(sourceText));
}
