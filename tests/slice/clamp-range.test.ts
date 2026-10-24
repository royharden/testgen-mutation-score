/** Construction fixture journey with injected execution evidence. No subject or mutant is executed here. */
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyGateState, gateRound } from "../../cli/core/gate.js";
import { FileStagingStore, protectedFilesSnapshot } from "../../cli/core/staging.js";
import { CandidateSchema, GateDecisionSchema, ReplayFixtureSchema, RunCellSchema, RunErrorSchema, TestUnitSchema } from "../../cli/core/schemas.js";
import type { RunRecord } from "../../cli/core/schemas.js";
import type { FeedbackExecutor } from "../../cli/engines/engine.js";

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});
it("canonical replay → gate → actual immutable staged bytes → sanitized RunRecord fragment",async()=>{
  const fixture=ReplayFixtureSchema.parse(JSON.parse(await readFile(fileURLToPath(new URL("../../fixtures/replay/clamp-range/A5/r1-c1.json",import.meta.url)),"utf8")));
  expect(fixture.promptSha256).toBe("pending");
  const root=await mkdtemp(path.join(tmpdir(),"mutgate-slice-"));roots.push(root);
  const subjectRoot=fileURLToPath(new URL("../../fixtures/subjects/clamp-range/",import.meta.url));
  const key="1".repeat(64);
  const executor:FeedbackExecutor={execute:async(request)=>{
    const units=request.kind === "feedback" ? [request.unit] : request.units;
    const killed=request.kind === "feedback";
    const base={unitSha256s:units.map((u)=>u.unitSha256),outcome:killed ? "failed" as const : "passed" as const,durationMs:1,shuffleSeed:request.kind === "pristine-union" ? request.shuffleSeed : null,tests:units.map((u)=>({name:u.testName,unitSha256:u.unitSha256,status:killed ? "failed" as const : "passed" as const,cause:killed ? "assertion" as const : null})),outputTruncated:false};
    switch(request.kind){
      case "pristine":return [{kind:"pristine",attempt:request.attempt,...base}];
      case "pristine-union":return [{kind:"pristine-union",...base}];
      case "feedback":return [{kind:"feedback-mutant",mutantKey:key,mutantStatus:"Killed",killCause:"assertion",...base}];
      case "coverage":return [{kind:"coverage",coveredLines:[],...base}];
    }
  }};
  const out=await gateRound({subjectId:fixture.subjectId,arm:fixture.arm,repeat:0,round:fixture.round,slot:fixture.slot,candidateId:"clamp-range/A5/r1-c1",testFile:fixture.response.testFile,shuffleSeed:17,feedbackKeys:[key],state:emptyGateState()},
    {executor,staging:new FileStagingStore(root,"clamp-range"),snapshotProtected:protectedFilesSnapshot({source:path.join(subjectRoot,"src.ts"),hand:path.join(subjectRoot,"hand.test.ts"),twin:path.join(subjectRoot,"twin.ts")}),now:()=>"2026-10-24T00:00:00Z"});
  const accepted=out.gateDecisions[0];if(!accepted || accepted.decision !== "accepted") throw new Error("expected constructed acceptance");
  const admitted=out.state.keptUnits[0];if(!admitted) throw new Error("expected staged unit");
  expect(await readFile(path.join(root,accepted.stagedAs))).toEqual(Buffer.from(admitted.text,"utf8"));
  const fragment:Pick<RunRecord,"providerMode"|"executionProvenance"|"candidates"|"units"|"gateDecisions"|"runErrors"|"cells">={providerMode:"mock",executionProvenance:"recorded-fixture",candidates:out.candidates,units:out.units,gateDecisions:out.gateDecisions,runErrors:out.runErrors,cells:[{subjectId:"clamp-range",arm:"A5",repeat:0,state:"complete",reason:null,rounds:1,keptUnits:[admitted.unitSha256],roundWallMs:[1],inputTokens:0,outputTokens:0,usd:null}]};
  fragment.candidates.forEach((v)=>CandidateSchema.parse(v));fragment.units.forEach((v)=>TestUnitSchema.parse(v));fragment.gateDecisions.forEach((v)=>GateDecisionSchema.parse(v));fragment.runErrors.forEach((v)=>RunErrorSchema.parse(v));fragment.cells.forEach((v)=>RunCellSchema.parse(v));
  expect(fragment.executionProvenance).toBe("recorded-fixture");expect(JSON.stringify(fragment)).not.toContain(root);expect(out.runErrors).toEqual([]);expect(accepted.newKills).toEqual([key]);
});
