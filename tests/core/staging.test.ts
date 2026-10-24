import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileStagingStore, assertProtectedUnchanged, protectedFilesSnapshot, sha256Bytes } from "../../cli/core/staging.js";
import { parseCandidate } from "../../cli/core/grammar.js";
import type { TestUnit } from "../../cli/core/schemas.js";

const roots: string[]=[];
async function temporary(): Promise<string> { const root=await mkdtemp(path.join(tmpdir(),"mutgate-stage-")); roots.push(root); return root; }
afterEach(async()=>{ for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });
function unit(text: string): TestUnit {
  const grammar=parseCandidate(text); if(!grammar.ok || !grammar.units[0]) throw new Error("invalid test fixture");
  const s=grammar.units[0];
  return {unitSha256:sha256Bytes(s.text),candidateId:"fixture",parentFileSha256:sha256Bytes(text),subjectId:"clamp-range",index:s.index,testName:s.testName,importsRange:s.importsRange,testRange:s.testRange,byteLength:Buffer.byteLength(s.text,"utf8"),text:s.text};
}
const sample='import {test,expect} from "vitest";\r\nimport {clamp} from "./src";\r\ntest("café",()=>{expect(clamp(3,0,2)).toBe(2);});';
describe("immutable staging",()=>{
  it("writes exact non-ASCII/CRLF unit bytes with full content-hash names and idempotent receipts",async()=>{
    const root=await temporary(), store=new FileStagingStore(root,"clamp-range"), u=unit(sample);
    const receipts=await store.commit([u]); const receipt=receipts[0]; if(!receipt) throw new Error("missing receipt");
    expect(receipt.stagedAs.endsWith(`/${u.unitSha256}.test.ts`)).toBe(true);
    expect(await readFile(path.join(root,receipt.stagedAs))).toEqual(Buffer.from(u.text,"utf8"));
    expect(await store.commit([u])).toEqual(receipts);
    expect((await readdir(path.join(root,"staged","clamp-range"))).filter((entry)=>!entry.startsWith(".pending-"))).toHaveLength(1);
  });
  it("refuses changed byte length/hash before publishing any directory",async()=>{
    const root=await temporary(), store=new FileStagingStore(root,"clamp-range"), u=unit(sample);
    await expect(store.commit([{...u,text:`${u.text}\n`}])).rejects.toMatchObject({kind:"schema-violation"});
    expect(await readdir(root)).toEqual([]);
  });
  it("never overwrites a content-addressed collision",async()=>{
    const root=await temporary(), store=new FileStagingStore(root,"clamp-range"), u=unit(sample);
    const [receipt]=await store.commit([u]); if(!receipt) throw new Error("missing receipt");
    await writeFile(path.join(root,receipt.stagedAs),"tampered","utf8");
    await expect(store.commit([u])).rejects.toMatchObject({kind:"storage-exhausted"});
    expect(await readFile(path.join(root,receipt.stagedAs),"utf8")).toBe("tampered");
  });
  it("validates every unit before publishing a multi-unit round",async()=>{
    const root=await temporary(), store=new FileStagingStore(root,"clamp-range"), u=unit(sample);
    const second=unit(sample.replace("café","other"));
    await expect(store.commit([u,{...second,unitSha256:"0".repeat(64)}])).rejects.toMatchObject({kind:"schema-violation"});
    expect(await readdir(root)).toEqual([]);
  });
});
describe("add-only protected files",()=>{
  it.each(["source","hand","twin"] as const)("detects any %s byte change",async(key)=>{
    const root=await temporary(); const files={source:path.join(root,"src.ts"),hand:path.join(root,"hand.test.ts"),twin:path.join(root,"twin.ts")};
    await Promise.all(Object.values(files).map((file)=>writeFile(file,"original\r\né","utf8")));
    const snapshot=protectedFilesSnapshot(files), before=await snapshot();
    await writeFile(files[key],"original\né","utf8");
    expect(()=>assertProtectedUnchanged(before,{...before})).not.toThrow();
    const after=await snapshot(); expect(()=>assertProtectedUnchanged(before,after)).toThrow("protected");
  });
  it("fails closed if a protected input disappears",async()=>{
    const root=await temporary(); const missing=path.join(root,"missing.ts");
    await expect(protectedFilesSnapshot({source:missing,hand:missing,twin:missing})()).rejects.toMatchObject({kind:"add-only-guard"});
  });
});
