/** Restricted, seeded, budgeted characterisation. No subject module is imported on the host. */
import ts from "typescript";
import { mulberry32 } from "../prng.js";
import type { A1Probe, A1Observation } from "../schemas.js";
import { validateRunResult } from "../../engines/engine.js";
import type { IsolatedRunner } from "../../engines/engine.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface CharacterisationPlan { probes: A1Probe[]; unsupported: string[] }
export function planCharacterisation(source: string, seed: number, budget = 32): CharacterisationPlan {
  if (!Number.isInteger(budget) || budget < 1 || budget > 64) throw new Error("A1 budget must be 1..64");
  const file = ts.createSourceFile("src.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const aliases = new Map(file.statements.filter(ts.isTypeAliasDeclaration).map((n) => [n.name.text, n.type]));
  const interfaces = new Map(file.statements.filter(ts.isInterfaceDeclaration).map((n) => [n.name.text, n]));
  const random = mulberry32(seed);
  const values = (type: ts.TypeNode | undefined, depth = 0, seen = new Set<string>()): Json[] | null => {
    if (!type || depth > 4) return null;
    if (type.kind === ts.SyntaxKind.NumberKeyword) return [-1, 0, 1, 2, 10, Math.floor(random() * 21) - 10];
    if (type.kind === ts.SyntaxKind.StringKeyword) return ["", "a", " ", "0", "é", "a,b"];
    if (type.kind === ts.SyntaxKind.BooleanKeyword) return [false, true];
    if (ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.ReadonlyKeyword) return values(type.type, depth + 1, seen);
    if (ts.isParenthesizedTypeNode(type)) return values(type.type, depth + 1, seen);
    if (ts.isArrayTypeNode(type) || (ts.isTypeReferenceNode(type) && ["Array", "ReadonlyArray"].includes(type.typeName.getText(file)))) {
      const child = values(ts.isArrayTypeNode(type) ? type.elementType : type.typeArguments?.[0], depth + 1, seen);
      return child ? [[], [child[0]!], [child[0]!, child[1] ?? child[0]!]] : null;
    }
    let members: ts.NodeArray<ts.TypeElement> | undefined;
    if (ts.isTypeLiteralNode(type)) members = type.members;
    else if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && !type.typeArguments?.length) {
      const name = type.typeName.text;
      if (seen.has(name)) return null;
      const next = new Set(seen).add(name), alias = aliases.get(name), iface = interfaces.get(name);
      if (alias) return values(alias, depth + 1, next);
      if (iface && !iface.typeParameters?.length && !iface.heritageClauses?.length) members = iface.members;
    }
    if (!members || members.length > 6) return null;
    const first: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
    const last: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.name || !(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) return null;
      const grid = values(member.type, depth + 1, seen);
      if (!grid) return null;
      const key = member.name.text;
      // A null-prototype data map preserves even __proto__ as an ordinary JSON key.
      first[key] = grid[0]!; last[key] = grid[grid.length - 1]!;
    }
    return [first, last];
  };
  const probes: A1Probe[] = [], unsupported: string[] = [];
  for (const node of file.statements) {
    const exported = ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (!ts.isFunctionDeclaration(node) || !node.name || !node.body || node.typeParameters?.length || node.asteriskToken ||
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword || m.kind === ts.SyntaxKind.DefaultKeyword)) {
      if (ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) unsupported.push(`${node.getText(file).slice(0, 80)}: unsupported export signature`);
      continue;
    }
    const grids = node.parameters.map((parameter) => parameter.dotDotDotToken || !ts.isIdentifier(parameter.name) ? null : values(parameter.type));
    if (grids.some((grid) => grid === null)) { unsupported.push(`${node.name.text}: unsupported parameter type`); continue; }
    // Lexicographic Cartesian walk, seeded boundary values, globally bounded across exports.
    const walk = (index: number, args: Json[]): void => {
      if (probes.length >= budget) return;
      if (index === grids.length) { probes.push({ id: `p${probes.length}`, exportName: node.name!.text, argsJson: JSON.stringify(args) }); return; }
      for (const item of grids[index] ?? []) { walk(index + 1, [...args, item]); if (probes.length >= budget) break; }
    };
    walk(0, []);
  }
  return { probes, unsupported };
}

/** Returns one-test candidate files: the normal gate performs pass-twice and union admission. */
export async function characterise(source: string, seed: number, run: IsolatedRunner, budget = 32): Promise<{
  testFiles: string[]; unsupported: string[]; observations: A1Observation[];
}> {
  const plan = planCharacterisation(source, seed, budget);
  if (plan.probes.length === 0) return { testFiles: [], unsupported: plan.unsupported, observations: [] };
  const request = { sourceText: source, units: [], target: { kind: "a1-capture" as const }, probes: plan.probes };
  const captured = validateRunResult(await run.run(request), request);
  if (captured.kind !== "a1-capture" || captured.outcome !== "passed") throw new Error("A1 capture did not complete");
  const unsupported = [...plan.unsupported], testFiles: string[] = [];
  for (const observation of captured.observations) {
    const probe = plan.probes.find((p) => p.id === observation.probeId)!;
    const call = `${probe.exportName}(...JSON.parse(${JSON.stringify(probe.argsJson)}))`;
    let assertion: string;
    if (observation.outcome === "return" && observation.valueJson !== null) {
      // Round-trip JSON text is always quoted. Captured quotes/newlines cannot become code.
      assertion = `expect(${call}).toEqual(JSON.parse(${JSON.stringify(observation.valueJson)}));`;
    } else if (observation.outcome === "throw" && observation.message !== null) {
      assertion = `expect(() => ${call}).toThrow(new Error(${JSON.stringify(observation.message)}));`;
    } else { unsupported.push(`${probe.exportName}/${probe.id}: unsupported captured value`); continue; }
    testFiles.push(`import { test, expect } from "vitest";\nimport { ${probe.exportName} } from "./src";\ntest(${JSON.stringify(`A1 ${probe.exportName} ${probe.id}`)}, () => { ${assertion} });\n`);
  }
  return { testFiles, unsupported, observations: captured.observations };
}
