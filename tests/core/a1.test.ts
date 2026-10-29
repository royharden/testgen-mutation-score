import { expect, it } from "vitest";
import { characterise, planCharacterisation } from "../../cli/core/a1/characterise.js";
import { parseCandidate } from "../../cli/core/grammar.js";
import { inspectUnit } from "../../cli/core/ast.js";
import { validateRunResult } from "../../cli/engines/engine.js";

it("plans only restricted signatures with a seeded bounded Cartesian grid", () => {
  const source = `export function boundary(value:number, label:string, enabled:boolean):number{return value;}
export function lists(values:readonly number[]):number{return values.length;}
export function object(value:{count:number;name:string}):number{return value.count;}
export function callback(fn:()=>number):number{return fn();}
export async function promise(value:number):Promise<number>{return value;}`;
  const plan = planCharacterisation(source, 19, 8);
  expect(plan.probes).toHaveLength(8); expect(plan).toEqual(planCharacterisation(source, 19, 8));
  expect(plan.unsupported.join("\n")).toContain("callback"); expect(plan.unsupported.join("\n")).toContain("promise");
  const objects = planCharacterisation('export function data(input:{"__proto__":string;flag:boolean}):boolean{return input.flag;}', 1, 3);
  expect(JSON.parse(objects.probes[0]!.argsJson)[0]).toHaveProperty("__proto__", "");
});

it("observations are quoted data and unsupported values are listed instead of guessed", async () => {
  const source = "export function value(input:string):string{return input;}";
  let captured = false;
  const result = await characterise(source, 1, { async run(request) {
    captured = request.target.kind === "a1-capture";
    return { kind: "a1-capture", unitSha256s: [], outcome: "passed", durationMs: 1, shuffleSeed: null, tests: [], outputTruncated: false,
      observations: (request.probes ?? []).map((probe, index) => ({ probeId: probe.id, outcome: index === 0 ? "return" as const : "unsupported" as const,
        valueJson: index === 0 ? JSON.stringify('"; process.exit(); //') : null, errorName: null, message: index === 0 ? null : "undefined unsupported" })) };
  } }, 2);
  expect(captured).toBe(true); expect(result.testFiles).toHaveLength(1); expect(result.unsupported).toHaveLength(1);
  const parsed = parseCandidate(result.testFiles[0]!); expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(inspectUnit(parsed.units[0]!.text)).toBeNull();
});

it("capture attribution rejects missing or foreign observations", () => {
  const request = { sourceText: "", units: [], target: { kind: "a1-capture" as const }, probes: [{ id: "p0", exportName: "f", argsJson: "[]" }] };
  const base = { kind: "a1-capture", unitSha256s: [], outcome: "passed", durationMs: 0, shuffleSeed: null, tests: [], outputTruncated: false };
  expect(() => validateRunResult({ ...base, observations: [] }, request)).toThrow();
  expect(() => validateRunResult({ ...base, observations: [{ probeId: "other", outcome: "return", valueJson: "0", errorName: null, message: null }] }, request)).toThrow();
});
