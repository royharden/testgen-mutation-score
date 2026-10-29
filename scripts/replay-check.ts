/** Activation only: execute the real controller journey, bind pending hashes once, then verify it again. */
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMockProvider, createReplayBindingProvider, loadReplay, replaySlot } from "../cli/providers/mock.js";
import { runReplayCheckJourney } from "../cli/arms/runner.js";
import { ReplayFixtureSchema, ReplayIndexSchema, REPLAY_KINDS } from "../cli/core/schemas.js";
import type { RunRecord, ScoringRecord } from "../cli/core/schemas.js";
import type { LoadedReplay } from "../cli/providers/mock.js";

function assertJourney(records: RunRecord[], replay: LoadedReplay, scoring: readonly ScoringRecord[]): void {
  if (!records.length || records.some((r) => r.providerMode !== "mock" || r.executionProvenance !== "replay-executed" || r.status !== "complete")) throw new Error("actual replay controller journey did not complete; no hashes authorized");
  const kinds = new Set([...replay.fixtures.values()].map((f) => f.kind));
  if (REPLAY_KINDS.some((kind) => !kinds.has(kind))) throw new Error("replay fixture kind coverage is incomplete");
  for (const fixture of replay.fixtures.values()) {
    const recordsForArm = records.filter((r) => r.arms.includes(fixture.arm));
    const candidates = recordsForArm.flatMap((r) => r.candidates).filter((c) => c.subjectId === fixture.subjectId && c.arm === fixture.arm && c.round === fixture.round && c.slot === fixture.slot);
    if (candidates.length !== 1) throw new Error(`actual controller did not visit exactly once: ${replaySlot(fixture)}`);
    // Expectations describe intended cases, never fabricated observations. Flaky fixture is explicitly probabilistic.
    if (fixture.probabilistic) continue;
    const candidate = candidates[0];
    const decisions = recordsForArm.flatMap((r) => r.gateDecisions).filter((d) => d.candidateId === candidate?.candidateId);
    for (const expected of fixture.expected) {
      if (!decisions.some((d) => d.testName === expected.testName && d.decision === expected.decision && (d.decision === "accepted" ? expected.code === null : d.code === expected.code && (expected.subReason === null || d.subReason === expected.subReason)))) throw new Error(`designed disposition not observed at ${replaySlot(fixture)}; inspect frozen feedback inventory before activation`);
    }
    if (fixture.expectTwinFailure) {
      const admitted = decisions.filter((d) => d.decision === "accepted").flatMap((d) => d.unitSha256 === null ? [] : [d.unitSha256]);
      const score = scoring.filter((s) => recordsForArm.some((r) => r.runId === s.runId) && s.subjectId === fixture.subjectId && s.arm === fixture.arm && s.repeat === 0);
      if (!score.some((s) => s.results.some((r) => r.kind === "twin" && r.outcome === "failed" && r.unitSha256s.some((hash) => admitted.includes(hash)) && r.tests.some((t) => t.status === "failed" && (t.cause === "assertion" || t.cause === "thrown"))))) throw new Error(`quirk fixture lacks an attributable post-freeze twin failure at ${replaySlot(fixture)}`);
    }
  }
}
async function backupOnce(root: string, relative: string): Promise<void> {
  const target = path.join(root, "results/mock/replay-activation-backups", relative);
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, "wx");
  try { await handle.writeFile(await readFile(path.join(root, relative))); await handle.sync(); } finally { await handle.close(); }
}
export async function checkReplay(root: string, writeHashes: boolean): Promise<void> {
  const replay = await loadReplay(root);
  const pending = replay.index.fixtures.filter((e) => e.promptSha256 === "pending");
  if (pending.length) {
    if (!writeHashes) throw new Error("pending replay hashes: after sandbox/inventory activation, run npm run replay:check -- --write-hashes");
    if (pending.length !== replay.index.fixtures.length) throw new Error("partly activated replay corpus; recover from immutable activation backups rather than mixing contexts");
    const binding = createReplayBindingProvider(replay);
    const scoring: ScoringRecord[] = [];
    const records = await runReplayCheckJourney({ root, provider: binding.provider, onScoring: (records) => { scoring.push(...records); } });
    assertJourney(records, replay, scoring);
    if (binding.observed.size !== replay.index.fixtures.length) throw new Error("actual controller did not supply every indexed prompt");
    // Back up all inherited bytes before touching any canonical fixture. Never overwrite backups.
    for (const entry of replay.index.fixtures) await backupOnce(root, entry.path);
    await backupOnce(root, "fixtures/replay/index.json");
    for (const entry of replay.index.fixtures) {
      const fixture = replay.fixtures.get(replaySlot(entry)); const hash = binding.observed.get(replaySlot(entry));
      if (!fixture || !hash) throw new Error("incomplete activation binding");
      const activated = ReplayFixtureSchema.parse({ ...fixture, promptSha256: hash });
      await writeFile(path.join(root, entry.path), JSON.stringify(activated, null, 2) + "\n");
      entry.promptSha256 = hash;
    }
    await writeFile(path.join(root, "fixtures/replay/index.json"), JSON.stringify(ReplayIndexSchema.parse(replay.index), null, 2) + "\n");
  }
  // This is the ordinary runtime provider: no pending bypass and no slot-only fallback.
  const activated = await loadReplay(root);
  const provider = await createMockProvider({ root });
  const scoring: ScoringRecord[] = [];
  assertJourney(await runReplayCheckJourney({ root, provider, onScoring: (records) => { scoring.push(...records); } }), activated, scoring);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--write-hashes")) { console.error("usage: replay:check [--write-hashes]"); process.exitCode = 4; }
  else try { await checkReplay(process.cwd(), args.includes("--write-hashes")); console.log("Replay hashes and actual controller journey verified; mock data remains replay-executed."); }
  catch (error) { console.error(error instanceof Error ? error.message : "replay check failed"); process.exitCode = 4; }
}
