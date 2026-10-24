/** Strict full-prompt-hash lookup, with a second independent slot-context check. */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { ModelOutputSchema, ReplayFixtureSchema, ReplayIndexSchema } from "../core/schemas.js";
import type { ReplayFixture, ReplayIndex } from "../core/schemas.js";
import { ProviderError } from "./index.js";
import type { ModelProvider, ProviderContext, ProviderRequest } from "./index.js";

export function replaySlot(context: ProviderContext): string { return `${context.subjectId}/${context.arm}/r${context.round}-c${context.slot}`; }
export interface LoadedReplay { index: ReplayIndex; fixtures: Map<string, ReplayFixture> }
export async function loadReplay(root: string): Promise<LoadedReplay> {
  try {
  const index = ReplayIndexSchema.parse(JSON.parse(await readFile(path.join(root, "fixtures/replay/index.json"), "utf8")));
  const replayRoot = await realpath(path.join(root, "fixtures/replay")); const fixtures = new Map<string, ReplayFixture>();
  for (const entry of index.fixtures) {
    const file = await realpath(path.resolve(root, entry.path));
    const relative = path.relative(replayRoot, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ProviderError("schema-violation", "replay path escapes fixture root", null, false);
    const fixture = ReplayFixtureSchema.parse(JSON.parse(await readFile(file, "utf8")));
    const slot = replaySlot(entry);
    if (slot !== replaySlot(fixture) || entry.promptSha256 !== fixture.promptSha256) throw new ProviderError("schema-violation", "replay index and canonical fixture disagree", null, false);
    ModelOutputSchema.parse(fixture.response);
    fixtures.set(slot, fixture);
  }
  return { index, fixtures };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("schema-violation", "replay corpus cannot be loaded or violates its schema", null, false);
  }
}
function verifiedPrompt(request: ProviderRequest): string {
  const hash = createHash("sha256").update(request.prompt.text).digest("hex");
  if (hash !== request.prompt.sha256) throw new ProviderError("schema-violation", "supplied prompt hash does not match complete prompt bytes", null, false);
  return hash;
}
export async function createMockProvider(options: { root: string }): Promise<ModelProvider> {
  const replay = await loadReplay(options.root);
  return { mode: "mock", async generate(request) {
    const hash = verifiedPrompt(request);
    const matches = replay.index.fixtures.filter((entry) => entry.promptSha256 !== "pending" && entry.promptSha256 === hash);
    const indexed = matches.find((entry) => replaySlot(entry) === replaySlot(request.context));
    if (!indexed) throw new ProviderError("replay-miss", "no activated fixture for full prompt hash and exact slot", null, false);
    const fixture = replay.fixtures.get(replaySlot(indexed));
    if (!fixture || fixture.promptSha256 !== hash) throw new ProviderError("replay-miss", "canonical fixture hash mismatch", null, false);
    return { output: ModelOutputSchema.parse(fixture.response), usage: { inputTokens: 0, outputTokens: 0 } };
  } };
}
/**
 * Activation-only binding. Never used by createProvider or runtime fallback. The checker supplies the
 * actual controller journey; captures are not synthetic prompts or fabricated execution evidence.
 */
export function createReplayBindingProvider(replay: LoadedReplay): { provider: ModelProvider; observed: Map<string, string> } {
  const observed = new Map<string, string>();
  return { observed, provider: { mode: "mock", async generate(request) {
    const hash = verifiedPrompt(request); const slot = replaySlot(request.context); const fixture = replay.fixtures.get(slot);
    if (!fixture) throw new ProviderError("replay-miss", `no canonical fixture for activation slot ${slot}`, null, false);
    if (fixture.promptSha256 !== "pending" && fixture.promptSha256 !== hash) throw new ProviderError("replay-miss", `activated prompt drift at ${slot}`, null, false);
    const prior = observed.get(slot);
    if (prior && prior !== hash) throw new ProviderError("replay-miss", `non-deterministic controller prompt at ${slot}`, null, false);
    observed.set(slot, hash);
    return { output: ModelOutputSchema.parse(fixture.response), usage: { inputTokens: 0, outputTokens: 0 } };
  } } };
}
