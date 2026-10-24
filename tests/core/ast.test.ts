import { describe, expect, it } from "vitest";
import { enclosingStatementRange, inspectUnit } from "../../cli/core/ast.js";

const header = 'import { test, expect, vi } from "vitest";\nimport { clamp } from "./src";\n';
const unit = (body: string, imports = header): string => `${imports}test("case", () => { ${body} });`;
describe("candidate hygiene", () => {
  it.each(["node:fs", "node:child_process", "fs", "http", "./src.ts", "../src", "./twin", "unknown"])("refuses import %s", (mod) => {
    expect(inspectUnit(unit('expect(clamp(3,0,2)).toBe(2);', `import { test, expect } from "vitest"; import * as forbidden from "${mod}"; import {clamp} from "./src";`))?.code).toBe("forbidden-import");
  });
  it.each(["process", "globalThis", "eval", "Function", "fs", "child_process", "net", "http", "worker_threads"])("refuses capability aliases of %s", (name) => {
    expect(inspectUnit(unit(`const alias = ${name}; expect(clamp(3,0,2)).toBe(2);`))?.code).toBe("forbidden-import");
  });
  it.each(['const r = require; r("fs");', 'import("fs");', 'const meta = import.meta;'])("refuses loader escape %s", (body) => {
    expect(inspectUnit(unit(`${body} expect(clamp(3,0,2)).toBe(2);`))?.code).toBe("forbidden-import");
  });
  it.each(["mock", "doMock", "stubGlobal", "spyOn"])("refuses direct, aliased and destructured vi.%s", (method) => {
    for (const body of [`vi.${method}("./src");`, `const v=vi; v["${method}"]("./src");`, `const {${method}: m}=vi; m("./src");`]) {
      expect(inspectUnit(unit(`${body} expect(clamp(3,0,2)).toBe(2);`))?.code).toBe("forbidden-import");
    }
    const imports = 'import * as V from "vitest"; import {test,expect} from "vitest"; import {clamp} from "./src";';
    expect(inspectUnit(unit(`const {vi:v}=V; v.${method}("./src"); expect(clamp(3,0,2)).toBe(2);`, imports))?.code).toBe("forbidden-import");
    expect(inspectUnit(unit(`const {vi:{${method}:m}}=V; m("./src"); expect(clamp(3,0,2)).toBe(2);`, imports))?.code).toBe("forbidden-import");
    expect(inspectUnit(unit('const {vi:{...v}}=V; v.mock("./src");expect(clamp(3,0,2)).toBe(2);', imports))?.code).toBe("forbidden-import");
  });
  it("refuses computed and opaque vi aliases rather than guessing", () => {
    for (const body of ['vi["sp"+"yOn"]();', 'const box={v:vi}; box.v.spyOn();', 'let v; v=vi; v.mock();']) expect(inspectUnit(unit(`${body} expect(clamp(3,0,2)).toBe(2);`))?.code).toBe("forbidden-import");
  });
  it.each(["only", "skip", "todo", "concurrent"])("maps .%s to forbidden-import", (modifier) => {
    expect(inspectUnit(`${header}test.${modifier}("case",()=>expect(clamp(3,0,2)).toBe(2));`)?.subReason).toBe(modifier);
    expect(inspectUnit(unit(`const {${modifier}:alias}=test;expect(clamp(3,0,2)).toBe(2);`))?.subReason).toBe(modifier);
  });
  it.each(['return Promise.resolve(clamp(3,0,2));', 'expect(clamp(3,0,2)).resolves.toBe(2);', 'const later=async()=>clamp(3,0,2);', 'return {then:()=>clamp(3,0,2)}.then();'])("refuses promise/async body %s", (body) => {
    expect(inspectUnit(unit(`${body} expect(clamp(3,0,2)).toBe(2);`))?.code).toBe("syntax");
  });
});
describe("assertion provenance", () => {
  it.each([
    'clamp(3,0,2);', 'expect(true).toBe(true); clamp(3,0,2);',
    'const expect=()=>({toBe:()=>{}}); expect(clamp(3,0,2)).toBe(2);',
    'const clamp=()=>2; expect(clamp()).toBe(2);',
    'let value=clamp(3,0,2); value=2; expect(value).toBe(2);',
    'let f=clamp;f=()=>0;expect(f(3,0,2)).toBe(0);',
    'let e=expect;e=()=>({toBe(){}});e(clamp(3,0,2)).toBe(2);',
    'function unused(){expect(clamp(3,0,2)).toBe(2);}',
    'expect(()=>{function unused(){clamp(3,0,2);}}).toThrow();',
    'const thunk=()=>clamp(3,0,2); expect(thunk).toBeDefined();',
    'expect((clamp(3,0,2),true)).toBe(true);',
    'const helper=()=>{clamp(3,0,2);return true;};expect(helper()).toBe(true);',
    'expect(clamp).toBeDefined();', 'expect(clamp(3,0,2)).inventedMatcher();',
  ])("rejects inert or shadowed assertion %s", (body) => expect(inspectUnit(unit(body))?.code).toBe("no-assertion"));
  it.each([
    'expect(clamp(3,0,2)).toBe(2);',
    'const value=clamp(3,0,2);expect(value).not.toBe(3);',
    'const c=clamp; const x=c(3,0,2);expect(x).toEqual(2);',
    'expect(()=>clamp(3,2,0)).toThrow(RangeError);',
    'const thunk=()=>clamp(3,2,0);expect(thunk).toThrow();',
    'function helper(){return clamp(3,0,2);}expect(helper()).toBe(2);',
  ])("accepts a subject-dependent matcher %s", (body) => expect(inspectUnit(unit(body))).toBeNull());
  it("resolves renamed imports and nested lexical shadows independently", () => {
    const text = 'import {test,expect as check} from "vitest";import {clamp as c} from "./src";test("case",()=>{{const check=()=>0;} const x=c(3,0,2);check(x).toBe(2);});';
    expect(inspectUnit(text)).toBeNull();
  });
});
describe("enclosing statement location", () => {
  it("groups operators in the same return, separately from an adjacent return", () => {
    const source = 'export function f(x:number){\n  if(x>0) return x+1;\n  return x-1;\n}\n';
    const first = enclosingStatementRange(source, {start:{line:2,column:20},end:{line:2,column:21}});
    const same = enclosingStatementRange(source, {start:{line:2,column:21},end:{line:2,column:22}});
    const other = enclosingStatementRange(source, {start:{line:3,column:11},end:{line:3,column:12}});
    expect(first).toEqual(same);
    expect(first).not.toEqual(other);
  });
  it("falls back cleanly for invalid positions", () => {
    expect(enclosingStatementRange("const x=1;", {start:{line:99,column:1},end:{line:99,column:2}})).toBeUndefined();
  });
});
