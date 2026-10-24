import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt } from "../../cli/core/prompt.js";
import { REPLAY_KINDS } from "../../cli/core/schemas.js";
import { createMockProvider, createReplayBindingProvider, loadReplay } from "../../cli/providers/mock.js";
import type { ProviderRequest } from "../../cli/providers/index.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const request: ProviderRequest = { prompt: buildPrompt({ subjectId: "clamp-range", source: "source", keptTests: [], arm: "A5", survivors: [], round: 1, maxOutputTokens: 100 }), context: { subjectId: "clamp-range", arm: "A5", round: 1, slot: 1 }, model: "mock", maxOutputTokens: 100 };
async function corpus(hash: string) {
  const root = await mkdtemp(path.join(tmpdir(), "mock-replay-")); roots.push(root);
  const relative = "fixtures/replay/clamp-range/A5/r1-c1.json";
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  const canonical = JSON.parse(await readFile(fileURLToPath(new URL("../../fixtures/replay/clamp-range/A5/r1-c1.json", import.meta.url)), "utf8")) as Record<string, unknown>;
  await writeFile(path.join(root, relative), JSON.stringify({ ...canonical, promptSha256: hash }));
  await writeFile(path.join(root, "fixtures/replay/index.json"), JSON.stringify({ schemaVersion: 1, fixtures: [{ ...request.context, path: relative, promptSha256: hash }] }));
  return root;
}
it("runtime never falls back to a slot for pending/drifted full hashes", async () => {
  const pending = await createMockProvider({ root: await corpus("pending") });
  await expect(pending.generate(request)).rejects.toMatchObject({ kind: "replay-miss", exitCode: 4 });
  const activated = await createMockProvider({ root: await corpus(request.prompt.sha256) });
  expect((await activated.generate(request)).output.testFile).toContain("clamps above the upper bound");
  await expect(activated.generate({ ...request, context: { ...request.context, slot: 2 } })).rejects.toMatchObject({ kind: "replay-miss" });
  await expect(activated.generate({ ...request, prompt: { ...request.prompt, text: "different bytes" } })).rejects.toMatchObject({ kind: "schema-violation" });
});
it("explicit activation binding captures supplied actual-controller requests and checks prior hashes", async () => {
  const root = await corpus("pending"); const binding = createReplayBindingProvider(await loadReplay(root));
  await binding.provider.generate(request);
  expect(binding.observed.get("clamp-range/A5/r1-c1")).toBe(request.prompt.sha256);
  const drift = { ...request, prompt: buildPrompt({ subjectId: "clamp-range", source: "changed", keptTests: [], arm: "A5", survivors: [], round: 1, maxOutputTokens: 100 }) };
  await expect(binding.provider.generate(drift)).rejects.toMatchObject({ kind: "replay-miss" });
});
it("canonical replay corpus has thirty reachable slot1 calls, every kind, and one source for the M4 slice", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url)); const replay = await loadReplay(root);
  expect(replay.index.fixtures).toHaveLength(30);
  expect(new Set([...replay.fixtures.values()].map((fixture) => fixture.kind))).toEqual(new Set(REPLAY_KINDS));
  expect(replay.index.fixtures.every((f) => f.slot === 1 && f.round <= (f.arm === "A3" ? 1 : 3))).toBe(true);
  expect(replay.index.fixtures.filter((f) => f.path === "fixtures/replay/clamp-range/A5/r1-c1.json")).toHaveLength(1);
  expect([...replay.fixtures.values()].filter((f) => f.probabilistic).map((f) => f.kind)).toEqual(["flaky-probabilistic"]);
});
