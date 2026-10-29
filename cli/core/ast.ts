/** Candidate hygiene and conservative assertion dataflow. This is an admission rule, not a sandbox. */
import ts from "typescript";
import { CANONICAL_SUBJECT_SPECIFIER } from "./schemas.js";
import type { SourceRange } from "./schemas.js";
import { parseCandidate } from "./grammar.js";

export interface StaticRejection {
  code: "syntax" | "forbidden-import" | "no-assertion";
  subReason: string | null;
  detail: string;
}
const forbidden = new Set(["process", "globalThis", "eval", "Function", "fs", "child_process", "net", "http", "worker_threads"]);
const viMethods = new Set(["mock", "doMock", "stubGlobal", "spyOn"]);
const modifiers = new Set(["only", "skip", "todo", "concurrent"]);
const matcherNames = new Set([
  "toBe", "toEqual", "toStrictEqual", "toBeCloseTo", "toBeDefined", "toBeUndefined", "toBeNull", "toBeNaN",
  "toBeTruthy", "toBeFalsy", "toBeGreaterThan", "toBeGreaterThanOrEqual", "toBeLessThan", "toBeLessThanOrEqual",
  "toContain", "toContainEqual", "toHaveLength", "toHaveProperty", "toMatch", "toMatchObject", "toBeInstanceOf",
  "toThrow", "toThrowError", "toSatisfy", "toHaveReturned", "toHaveReturnedWith", "toHaveReturnedTimes",
]);
type Origin = "expect" | "subject" | "vitest" | "vi" | "other";
interface Binding { origin: Origin; value?: ts.Node; members?: string[]; mutable: boolean }
interface Scope { parent?: Scope; bindings: Map<string, Binding> }

function unwrap(node: ts.Node): ts.Node {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return unwrap(node.expression);
  return node;
}
function property(node: ts.Node): { base: ts.Expression; name: string | null } | null {
  if (ts.isPropertyAccessExpression(node)) return { base: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    return { base: node.expression, name: arg && (ts.isStringLiteralLike(arg) || ts.isNumericLiteral(arg)) ? arg.text : null };
  }
  return null;
}
function lookup(scope: Scope, name: string): Binding | undefined {
  return scope.bindings.get(name) ?? (scope.parent && lookup(scope.parent, name));
}
/** Small lexical resolver: hoisted/block bindings shadow imports even before their declaration. */
function resolver(sf: ts.SourceFile): { scopes: Map<ts.Node, Scope>; origin: (node: ts.Node) => Origin } {
  const scopes = new Map<ts.Node, Scope>();
  const root: Scope = { bindings: new Map() };
  function declare(scope: Scope, name: ts.BindingName, value?: ts.Node, members: string[] = []): void {
    if (ts.isIdentifier(name)) { scope.bindings.set(name.text, { origin: "other", value, members, mutable: false }); return; }
    for (const el of name.elements) if (!ts.isOmittedExpression(el)) {
      const key = el.propertyName ?? el.name;
      const member = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : "?";
      declare(scope, el.name, value, [...members, member]);
    }
  }
  function walk(node: ts.Node, inherited: Scope): void {
    let scope = inherited;
    if (node !== sf && (ts.isBlock(node) || ts.isFunctionLike(node) || ts.isCatchClause(node) || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node))) scope = { parent: inherited, bindings: new Map() };
    scopes.set(node, scope);
    if (ts.isFunctionLike(node)) {
      for (const p of node.parameters) declare(scope, p.name);
      if ((ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) && node.name) declare(scope, node.name, node);
    }
    if (ts.isCatchClause(node) && node.variableDeclaration) declare(scope, node.variableDeclaration.name);
    if (ts.isVariableDeclaration(node)) {
      let target = scope;
      // var belongs to the nearest function/source scope, not its containing block.
      if (ts.isVariableDeclarationList(node.parent) && !(node.parent.flags & ts.NodeFlags.BlockScoped)) {
        let parent: ts.Node | undefined = node.parent;
        while (parent && !ts.isFunctionLike(parent) && !ts.isSourceFile(parent)) parent = parent.parent;
        if (parent) target = scopes.get(parent) ?? scope;
      }
      declare(target, node.name, node.initializer);
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) declare(inherited, node.name, node);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) root.bindings.set(clause.name.text, { origin: mod === CANONICAL_SUBJECT_SPECIFIER && !clause.isTypeOnly ? "subject" : "other", mutable: false });
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) root.bindings.set(bindings.name.text, { origin: mod === "vitest" ? "vitest" : mod === CANONICAL_SUBJECT_SPECIFIER ? "subject" : "other", mutable: false });
      if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) {
        const exported = (el.propertyName ?? el.name).text;
        const origin: Origin = clause?.isTypeOnly || el.isTypeOnly ? "other" : mod === CANONICAL_SUBJECT_SPECIFIER ? "subject" : mod === "vitest" && exported === "expect" ? "expect" : mod === "vitest" && exported === "vi" ? "vi" : "other";
        root.bindings.set(el.name.text, { origin, mutable: false });
      }
    }
    ts.forEachChild(node, (child) => walk(child, scope));
  }
  walk(sf, root);
  // A write makes initializer-based assertion evidence unsafe; do not follow that binding.
  function writes(node: ts.Node): void {
    let left: ts.Node | undefined;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) left = node.left;
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) left = node.operand;
    if (left) {
      const mark = (n: ts.Node): void => { if (ts.isIdentifier(n)) { const binding = lookup(scopes.get(n) ?? root, n.text); if (binding) binding.mutable = true; } ts.forEachChild(n, mark); };
      mark(left);
    }
    ts.forEachChild(node, writes);
  }
  writes(sf);
  function origin(node: ts.Node, seen = new Set<Binding>()): Origin {
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      const binding = lookup(scopes.get(node) ?? root, node.text);
      if (!binding || seen.has(binding) || binding.mutable) return "other";
      if (binding.origin !== "other") return binding.origin;
      if (binding.value) {
        seen.add(binding);
        let base = origin(binding.value, seen);
        for (const member of binding.members ?? []) base = base === "vitest" && member === "vi" ? "vi" : base === "vitest" && member === "expect" ? "expect" : base === "subject" ? "subject" : "other";
        return base;
      }
    }
    const p = property(node);
    if (p) {
      const base = origin(p.base, seen);
      if (base === "vitest" && p.name === "expect") return "expect";
      if (base === "vitest" && p.name === "vi") return "vi";
      if (base === "subject") return "subject";
    }
    return "other";
  }
  return { scopes, origin };
}

/** Checks a whole one-test byte slice. Grammar is checked first and never rewritten. */
export function inspectUnit(text: string): StaticRejection | null {
  const grammar = parseCandidate(text);
  if (!grammar.ok) return { code: "syntax", subReason: grammar.subReason, detail: grammar.detail };
  const sf = ts.createSourceFile("candidate.test.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const { scopes, origin } = resolver(sf);
  let hygiene: StaticRejection | null = null;
  let asyncBody = false;
  const reject = (subReason: string, detail: string): void => { hygiene ??= { code: "forbidden-import", subReason, detail }; };
  function patternOrigin(pattern: ts.BindingPattern): Origin {
    const parent = pattern.parent;
    if (ts.isVariableDeclaration(parent)) return parent.initializer ? origin(parent.initializer) : "other";
    if (ts.isBindingElement(parent) && (ts.isObjectBindingPattern(parent.parent) || ts.isArrayBindingPattern(parent.parent))) {
      const base = patternOrigin(parent.parent);
      const key = parent.propertyName ?? parent.name;
      const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null;
      return base === "vitest" && name === "vi" ? "vi" : "other";
    }
    return "other";
  }
  function scan(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = node.moduleSpecifier.text;
      if (mod.startsWith("node:")) reject("node-specifier", "node: imports are forbidden");
      else if (!["vitest", "fast-check", CANONICAL_SUBJECT_SPECIFIER].includes(mod)) reject("module", "module is outside the import allowlist");
    }
    if (ts.isIdentifier(node) && forbidden.has(node.text)) reject("identifier", "forbidden capability identifier");
    if (ts.isIdentifier(node) && node.text === "require") reject("require", "require and its aliases are forbidden");
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) reject("dynamic-import", "dynamic imports are forbidden");
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) reject("import-meta", "import.meta is forbidden");
    const p = property(node);
    if (p && p.name !== null && forbidden.has(p.name)) reject("identifier", "forbidden capability property");
    if (p && p.name !== null && modifiers.has(p.name)) reject(p.name, "test execution modifiers and their aliases are forbidden");
    if (p && origin(p.base) === "vi" && (p.name === null || viMethods.has(p.name))) reject(`vi-${p.name ?? "mock"}`, "mocking, spying and global stubbing are forbidden");
    if (ts.isBindingElement(node) && (ts.isObjectBindingPattern(node.parent) || ts.isArrayBindingPattern(node.parent))) {
      const key = node.propertyName ?? node.name;
      const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null;
      if (name !== null && modifiers.has(name)) reject(name, "destructured execution modifiers are forbidden");
      if (patternOrigin(node.parent) === "vi" && (name === null || !!node.dotDotDotToken || viMethods.has(name))) reject(`vi-${name !== null && viMethods.has(name) ? name : "mock"}`, "destructured mocking methods are forbidden");
    }
    // Simple const aliases are resolved; storing/passing vi through arbitrary containers or assignments
    // is refused rather than pretending to prove the eventual call target.
    if ((ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && origin(node) === "vi") {
      const parent = node.parent;
      const safe = ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || (ts.isPropertyAccessExpression(parent) && parent.expression === node) || (ts.isElementAccessExpression(parent) && parent.expression === node) || (ts.isVariableDeclaration(parent) && parent.initializer === node);
      if (!safe) reject("vi-mock", "opaque aliases of vi are unsupported");
    }
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node) || node.kind === ts.SyntaxKind.AsyncKeyword || (ts.isIdentifier(node) && node.text === "Promise") || (p && ["then", "catch", "finally", "resolves", "rejects"].includes(p.name ?? ""))) asyncBody = true;
    ts.forEachChild(node, scan);
  }
  scan(sf);
  // Capability rejection has precedence over body/assertion checks.
  if (hygiene) return hygiene;
  if (asyncBody) return { code: "syntax", subReason: "unsupported-structure", detail: "only synchronous bodies and synchronous assertions are supported" };

  function reaches(node: ts.Node, seen = new Set<ts.Node>(), allowCallback = false): boolean {
    node = unwrap(node);
    if (seen.has(node)) return false;
    seen = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      const binding = lookup(scopes.get(node) ?? { bindings: new Map() }, node.text);
      return !!binding && !binding.mutable && !!binding.value && reaches(binding.value, seen, allowCallback);
    }
    if (ts.isCallExpression(node)) {
      if (origin(node.expression) === "subject") return true;
      // A local helper contributes only its returned value, not an unrelated side effect.
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee)) {
        const binding = lookup(scopes.get(callee) ?? { bindings: new Map() }, callee.text);
        if (binding?.value && !binding.mutable) {
          const value = unwrap(binding.value);
          if (ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isFunctionDeclaration(value)) {
            if (value.body && !ts.isBlock(value.body)) return reaches(value.body, seen);
            let result = false;
            const returns = (n: ts.Node): void => { if (ts.isReturnStatement(n) && n.expression) result ||= reaches(n.expression, seen); else if (!ts.isFunctionLike(n)) ts.forEachChild(n, returns); };
            if (value.body) ts.forEachChild(value.body, returns);
            return result;
          }
        }
      }
      return node.arguments.some((arg) => reaches(arg, seen));
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (!allowCallback) return false;
      // Used only for toThrow subjects: dormant nested functions do not count as executed calls.
      let result = false;
      const body = (n: ts.Node): void => { if (ts.isFunctionLike(n)) return; if (ts.isCallExpression(n) && origin(n.expression) === "subject") result = true; ts.forEachChild(n, body); };
      body(node.body);
      return result;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) return reaches(node.right, seen);
    let result = false;
    ts.forEachChild(node, (child) => { result ||= reaches(child, seen); });
    return result;
  }
  let assertion = false;
  function assertions(node: ts.Node): void {
    if (ts.isFunctionLike(node) && !ts.isCallExpression(node.parent)) return;
    if (ts.isCallExpression(node)) {
      const matcher = property(node.expression);
      if (matcher && matcherNames.has(matcher.name ?? "")) {
        let base: ts.Node = matcher.base;
        const not = property(base);
        if (not?.name === "not") base = not.base;
        base = unwrap(base);
        if (ts.isCallExpression(base) && origin(base.expression) === "expect" && base.arguments.length === 1) {
          const subject = base.arguments[0];
          if (subject && reaches(subject, new Set(), matcher.name === "toThrow" || matcher.name === "toThrowError")) assertion = true;
        }
      }
    }
    ts.forEachChild(node, assertions);
  }
  assertions(sf);
  return assertion ? null : { code: "no-assertion", subReason: null, detail: "no imported expect matcher depends on an imported subject call" };
}

/** Smallest enclosing executable statement. Source locations and returned ranges are 1-based, end-exclusive. */
export function enclosingStatementRange(sourceText: string, range: SourceRange): SourceRange | undefined {
  const sf = ts.createSourceFile("src.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const offset = (p: SourceRange["start"]): number | undefined => {
    const lines = sf.getLineStarts();
    const start = lines[p.line - 1];
    if (start === undefined || p.column < 1) return undefined;
    const out = start + p.column - 1;
    const end = lines[p.line] ?? sourceText.length;
    return out <= end && out <= sourceText.length ? out : undefined;
  };
  const start = offset(range.start), end = offset(range.end);
  if (start === undefined || end === undefined || end < start) return undefined;
  let best: ts.Statement | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart(sf) > start || node.end < end) return;
    if (ts.isStatement(node) && !ts.isBlock(node)) best = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!best) return undefined;
  const a = sf.getLineAndCharacterOfPosition(best.getStart(sf));
  const b = sf.getLineAndCharacterOfPosition(best.end);
  return { start: { line: a.line + 1, column: a.character + 1 }, end: { line: b.line + 1, column: b.character + 1 } };
}
