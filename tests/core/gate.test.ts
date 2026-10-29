import { describe, expect, it } from "vitest";
import { gateRound, emptyGateState } from "../../cli/core/gate.js";
import type { GateDependencies, GateRoundInput } from "../../cli/core/gate.js";
import type { FeedbackRequest } from "../../cli/engines/engine.js";
import type { LoopExecutionResult, TestUnit } from "../../cli/core/schemas.js";

const K1 = "1".repeat(64), K2 = "2".repeat(64), FOREIGN = "f".repeat(64);
const header = 'import {test,expect} from "vitest";\nimport {clamp} from "./src";\n';
const candidate = (names = ["first"]): string => header + names.map((name) => `test("${name}",()=>{expect(clamp(3,0,2)).toBe(2);});`).join("\n");
const pristineHashes = { source: "a".repeat(64), hand: "b".repeat(64), twin: "c".repeat(64) };
function execution(request: FeedbackRequest, outcome: "passed" | "failed" | "timeout" | "error" = "passed"): LoopExecutionResult {
  const units = request.kind === "feedback" ? [request.unit] : request.units;
  const base = { outcome, durationMs: 1, unitSha256s: units.map((u) => u.unitSha256), shuffleSeed: request.kind === "pristine-union" ? request.shuffleSeed : null,
    tests: units.map((u) => ({ name: u.testName, unitSha256: u.unitSha256, status: outcome === "passed" ? "passed" as const : "failed" as const, cause: outcome === "failed" ? "assertion" as const : outcome === "timeout" ? "timeout" as const : outcome === "error" ? "runner-crash" as const : null })), outputTruncated: false };
  switch (request.kind) {
    case "pristine": return { kind: "pristine", attempt: request.attempt, ...base };
    case "pristine-union": return { kind: "pristine-union", ...base };
    case "coverage": return { kind: "coverage", coveredLines: [1, 2], ...base };
    case "feedback": return { kind: "feedback-mutant", mutantKey: K1, mutantStatus: outcome === "timeout" ? "Timeout" : outcome === "failed" ? "Killed" : "Survived", killCause: outcome === "failed" ? "assertion" : null, ...base };
  }
}
function feedback(request: FeedbackRequest, statuses: readonly ("Killed" | "Timeout" | "Survived")[]): LoopExecutionResult[] {
  return statuses.map((status, i) => {
    const out = execution(request, status === "Killed" ? "failed" : status === "Timeout" ? "timeout" : "passed");
    if (out.kind !== "feedback-mutant") throw new Error("test-target");
    return { ...out, mutantKey: i === 0 ? K1 : K2, mutantStatus: status, killCause: status === "Killed" ? "assertion" : null };
  });
}
function harness(respond: (request: FeedbackRequest) => LoopExecutionResult[] = (r) => r.kind === "feedback" ? feedback(r, ["Killed", "Survived"]) : [execution(r)]) {
  const calls: FeedbackRequest[] = [], staged: TestUnit[][] = [];
  const input: GateRoundInput = { subjectId: "clamp-range", arm: "A5", repeat: 0, round: 1, slot: 1, candidateId: "r1-c1", testFile: candidate(), shuffleSeed: 17, feedbackKeys: [K1, K2], state: emptyGateState() };
  const deps: GateDependencies = { executor: { execute: async (r) => { calls.push(r); return respond(r); } }, staging: { commit: async (units) => { staged.push([...units]); return units.map((u) => ({unitSha256: u.unitSha256, stagedAs: `staged/clamp-range/${u.unitSha256}.test.ts`})); } }, snapshotProtected: async () => ({...pristineHashes}), now: () => "2026-10-24T00:00:00Z" };
  return {input, deps, calls, staged};
}
function codes(result: Awaited<ReturnType<typeof gateRound>>): string[] { return result.gateDecisions.flatMap((d) => d.decision === "rejected" ? [d.code] : []); }
describe("seven gate codes and precedence", () => {
  it("syntax rejects the whole file before any executor call", async () => {
    const h = harness(); h.input.testFile = `${header}test("broken",()=>{`;
    const out = await gateRound(h.input,h.deps);
    expect(codes(out)).toEqual(["syntax"]); expect(out.gateDecisions[0]?.unitSha256).toBeNull(); expect(h.calls).toEqual([]);
  });
  it("forbidden imports precede no assertion", async () => {
    const h = harness(); h.input.testFile = 'import fs from "node:fs";import {test} from "vitest";test("case",()=>{});';
    expect(codes(await gateRound(h.input,h.deps))).toEqual(["forbidden-import"]); expect(h.calls).toEqual([]);
  });
  it("no assertion rejects literal-only expects", async () => {
    const h = harness(); h.input.testFile = `${header}test("literal",()=>expect(true).toBe(true));`;
    expect(codes(await gateRound(h.input,h.deps))).toEqual(["no-assertion"]); expect(h.calls).toEqual([]);
  });
  it("fails-pristine stops before a second process", async () => {
    const h = harness((r) => [execution(r,"failed")]);
    expect(codes(await gateRound(h.input,h.deps))).toEqual(["fails-pristine"]); expect(h.calls).toHaveLength(1);
  });
  it("flaky is deterministic with injected fresh pass then fail", async () => {
    const h = harness((r) => [execution(r,r.kind === "pristine" && r.attempt === 2 ? "failed" : "passed")]);
    expect(codes(await gateRound(h.input,h.deps))).toEqual(["flaky"]);
    expect(h.calls.map((r)=>r.kind === "pristine" ? r.attempt : r.kind)).toEqual([1,2]);
  });
  it.each([1,2] as const)("pristine timeout attempt %s precedes failure/flaky", async (attempt) => {
    const h = harness((r) => [execution(r,r.kind === "pristine" && r.attempt === attempt ? "timeout" : "passed")]);
    expect(codes(await gateRound(h.input,h.deps))).toEqual(["timeout"]);
  });
  it("timeout-only feedback never admits or updates a kill set", async () => {
    const h = harness((r) => r.kind === "feedback" ? feedback(r,["Timeout","Survived"]) : [execution(r)]);
    const out = await gateRound(h.input,h.deps); expect(codes(out)).toEqual(["timeout"]); expect(out.state.killedFeedbackKeys).toEqual([]); expect(h.staged).toEqual([]);
  });
  it("no-new-kill leaves the state unchanged", async () => {
    const h = harness((r) => r.kind === "feedback" ? feedback(r,["Survived","Survived"]) : [execution(r)]);
    const out = await gateRound(h.input,h.deps); expect(codes(out)).toEqual(["no-new-kill"]); expect(out.state).toEqual(emptyGateState());
  });
});
describe("round acceptance and rollback", () => {
  it("greedily computes cumulative new kills in file order before one shuffled union and commit", async () => {
    const h = harness((r) => r.kind === "feedback" ? feedback(r,r.unit.testName === "third" ? ["Killed","Killed"] : ["Killed","Survived"]) : [execution(r)]);
    h.input.testFile = candidate(["first","second","third"]);
    const out = await gateRound(h.input,h.deps);
    expect(out.gateDecisions.map((d)=>d.decision)).toEqual(["accepted","rejected","accepted"]);
    expect(out.gateDecisions.flatMap((d)=>d.decision === "accepted" ? [d.newKills] : [])).toEqual([[K1],[K2]]);
    expect(out.state.killedFeedbackKeys).toEqual([K1,K2]); expect(out.state.keptUnits).toHaveLength(2);
    expect(h.calls.filter((r)=>r.kind === "pristine-union")).toEqual([{kind:"pristine-union",units:out.state.keptUnits,shuffleSeed:17}]);
    expect(h.staged).toEqual([out.state.keptUnits]);
  });
  it("accepts thrown-code kills but rejects invalid Killed attribution", async () => {
    const h = harness((r) => r.kind === "feedback" ? feedback(r,["Killed","Survived"]).map((v)=>v.kind === "feedback-mutant" && v.mutantStatus === "Killed" ? {...v,killCause:"thrown" as const,tests:v.tests.map((t)=>({...t,cause:"thrown" as const}))} : v) : [execution(r)]);
    expect((await gateRound(h.input,h.deps)).state.killedFeedbackKeys).toEqual([K1]);
    const bad = harness((r) => r.kind === "feedback" ? feedback(r,["Killed","Survived"]).map((v)=>({...v,killCause:null})) : [execution(r)]);
    expect((await gateRound(bad.input,bad.deps)).runErrors[0]?.kind).toBe("report-parse");
  });
  it.each(["failed","timeout"] as const)("union %s rolls back every new unit and never publishes", async (outcome) => {
    const h = harness((r) => r.kind === "feedback" ? feedback(r,["Killed","Survived"]) : [execution(r,r.kind === "pristine-union" ? outcome : "passed")]);
    const out = await gateRound(h.input,h.deps);
    expect(out.state).toEqual(emptyGateState()); expect(h.staged).toEqual([]); expect(out.gateDecisions).toEqual([]);
    expect(out.runErrors[0]).toMatchObject({type:"run-error",kind:"union-pristine-failure",fatal:false,rolledBack:[out.units[0]?.unitSha256]}); expect(out.exitCode).toBe(5);
  });
  it("a new round subtracts earlier kept kills", async () => {
    const h = harness(); const first = await gateRound(h.input,h.deps);
    const next = {...h.input,state:first.state,round:2,candidateId:"r2-c1",testFile:candidate(["next"])};
    const second = await gateRound(next,h.deps); expect(codes(second)).toEqual(["no-new-kill"]); expect(second.state).toEqual(first.state);
  });
  it("exposes pass-twice and coverage admission for M5 without executing feedback mutants", async () => {
    const plain = harness(); plain.input.arm = "A3";
    const pass = await gateRound(plain.input,plain.deps); expect(pass.state.keptUnits).toHaveLength(1); expect(plain.calls.some((r)=>r.kind === "feedback")).toBe(false);
    const cov = harness(); cov.input.arm = "A4"; cov.input.state = {...emptyGateState(),coveredLines:[1]};
    const out = await gateRound(cov.input,cov.deps); expect(out.state.coveredLines).toEqual([1,2]); expect(out.gateDecisions[0]).toMatchObject({decision:"accepted",newKills:[],coveredLinesGained:1});
    const noGain = await gateRound({...cov.input,state:{...emptyGateState(),coveredLines:[1,2]}},cov.deps); expect(codes(noGain)).toEqual(["no-new-kill"]);
  });
});
describe("run errors remain separate and fail closed", () => {
  it("foreign feedback keys abort without leaking the foreign value into loop artifacts", async () => {
    const h = harness((r) => r.kind === "feedback" ? feedback(r,["Killed","Survived"]).map((v)=>v.kind === "feedback-mutant" ? {...v,mutantKey:FOREIGN} : v) : [execution(r)]);
    const out = await gateRound(h.input,h.deps); expect(out.exitCode).toBe(3); expect(out.runErrors[0]?.kind).toBe("feedback-key-violation"); expect(JSON.stringify(out)).not.toContain(FOREIGN); expect(h.staged).toEqual([]);
  });
  it.each(["missing","duplicate","skipped","compile","crash","scoring"])("rejects %s execution contract failures", async (mode) => {
    const h = harness((r) => {
      if (mode === "crash") throw new Error("raw secret transport detail");
      if (mode === "scoring") return [{...execution(r),kind:"twin"} as unknown as LoopExecutionResult];
      if (mode === "skipped") return [{...execution(r),tests:[]}];
      if (mode === "compile") return [{...execution(r,"error"),tests:[{name:"first",unitSha256:r.kind === "feedback" ? r.unit.unitSha256 : r.units[0]?.unitSha256 ?? null,status:"failed",cause:"compile-error"}]}];
      if (r.kind === "feedback") { const records=feedback(r,["Killed","Survived"]); const first=records[0]; if(!first) throw new Error("test-fixture"); return mode === "missing" ? records.slice(0,1) : [first,first]; }
      return [execution(r)];
    });
    const out=await gateRound(h.input,h.deps); expect(out.runErrors).toHaveLength(1); expect(out.gateDecisions).toEqual([]); expect(out.state).toEqual(emptyGateState()); expect(JSON.stringify(out)).not.toContain("raw secret"); expect(h.staged).toEqual([]);
  });
  it("the add-only guard runs even after a runner exception and takes precedence", async () => {
    const h=harness(()=>{throw new Error("runner failed");}); let reads=0;
    h.deps.snapshotProtected=async()=>({...pristineHashes,source:reads++ === 0 ? pristineHashes.source : "d".repeat(64)});
    const out=await gateRound(h.input,h.deps); expect(out.runErrors[0]?.kind).toBe("add-only-guard"); expect(out.exitCode).toBe(3); expect(h.staged).toEqual([]);
  });
  it("cannot weaken A5/A6 admission with a caller policy override", async () => {
    const h=harness(); h.input.policy="pristine"; expect((await gateRound(h.input,h.deps)).runErrors[0]?.kind).toBe("schema-violation"); expect(h.calls).toEqual([]);
  });
});
