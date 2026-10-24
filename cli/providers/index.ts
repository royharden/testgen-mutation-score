/** Host-only providers. Construction does not read environment variables or send requests. */
import { CANDIDATE_MAX_BYTES, ModelOutputSchema } from "../core/schemas.js";
import type { ModelArmId, ModelOutput, ProviderMode, RunErrorKind, Split } from "../core/schemas.js";
import type { BuiltPrompt } from "../core/prompt.js";
import type { CallLedger } from "../ledger/callledger.js";
import { createMockProvider } from "./mock.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAICompatibleProvider } from "./openaiCompatible.js";

export interface ProviderContext { subjectId: string; arm: ModelArmId; round: number; slot: number }
export interface TokenUsage { inputTokens: number; outputTokens: number }
export interface ProviderRequest { prompt: BuiltPrompt; context: ProviderContext; model: string; maxOutputTokens: number }
export interface ProviderResult { output: ModelOutput; usage: TokenUsage | null }
export interface ModelProvider { readonly mode: ProviderMode; generate(request: ProviderRequest): Promise<ProviderResult> }
export type FetchLike = typeof fetch;
export class ProviderError extends Error {
  constructor(readonly kind: RunErrorKind, message: string, readonly usage: TokenUsage | null = null, readonly billableUnknown = true) { super(message); }
  get exitCode(): 4 | 5 { return this.kind === "replay-miss" || this.kind === "schema-violation" ? 4 : 5; }
}
export function parseModelOutput(text: string, truncated: boolean, usage: TokenUsage | null): ModelOutput {
  if (truncated) throw new ProviderError("provider-truncated", "provider stopped at its output limit", usage);
  // JSON escaping overhead is bounded separately from the decoded test-file cap.
  if (Buffer.byteLength(text, "utf8") > CANDIDATE_MAX_BYTES * 8) throw new ProviderError("provider-oversize", "provider output exceeds response cap", usage);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ProviderError("provider-schema", "provider output is not one JSON object", usage); }
  if (typeof raw === "object" && raw !== null && "testFile" in raw && typeof raw.testFile === "string" && Buffer.byteLength(raw.testFile, "utf8") > CANDIDATE_MAX_BYTES) throw new ProviderError("provider-oversize", "testFile exceeds byte cap", usage);
  const parsed = ModelOutputSchema.safeParse(raw);
  if (!parsed.success) throw new ProviderError("provider-schema", "provider output violates {testFile} schema", usage);
  return parsed.data;
}
export async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new ProviderError("provider-http", `provider HTTP ${response.status}`);
  if (!response.body) throw new ProviderError("provider-schema", "provider response has no body");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > CANDIDATE_MAX_BYTES * 16) { await reader.cancel(); throw new ProviderError("provider-oversize", "provider transport response exceeds byte cap"); } chunks.push(part.value); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new ProviderError("provider-schema", "provider transport is not JSON"); }
  } finally { reader.releaseLock(); }
}
export function tokenUsage(input: unknown, output: unknown): TokenUsage | null {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0 && typeof output === "number" && Number.isSafeInteger(output) && output >= 0 ? { inputTokens: input, outputTokens: output } : null;
}
export interface ProviderOptions { mode: ProviderMode; root: string; apiKey?: string; baseUrl?: string; fetchImpl?: FetchLike }
export async function createProvider(options: ProviderOptions): Promise<ModelProvider> {
  if (options.mode === "mock") return createMockProvider({ root: options.root });
  if (!options.apiKey) throw new ProviderError("schema-violation", "live provider requires an explicitly supplied key", null, false);
  return options.mode === "anthropic" ? createAnthropicProvider({ apiKey: options.apiKey, fetchImpl: options.fetchImpl }) : createOpenAICompatibleProvider({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetchImpl: options.fetchImpl });
}
/** Explicit serial retries only. All possible attempts are durably reserved before the first send. */
export function budgetedProvider(provider: ModelProvider, ledger: CallLedger, options: { budgetScope: Split; retries: number; callId: () => string }): ModelProvider {
  if (provider.mode === "mock") return provider;
  if (!Number.isSafeInteger(options.retries) || options.retries < 0 || options.retries > 3) throw new Error("explicit retries must be 0–3");
  let sending = false;
  return { mode: provider.mode, async generate(request) {
    if (sending) throw new Error("paid provider calls must be serial");
    sending = true;
    try {
    const reservation = await ledger.reserve({ callId: options.callId(), provider: provider.mode, model: request.model, budgetScope: options.budgetScope, context: request.context, inputTokenUpperBound: request.prompt.inputTokenUpperBound, maxOutputTokens: request.maxOutputTokens, attempts: options.retries + 1 });
    for (let attempt = 0; attempt <= options.retries; attempt++) {
      let result: ProviderResult;
      try {
        result = await provider.generate(request);
      } catch (error) {
        // Settlement/storage errors must not cause a second paid send.
        if (!(error instanceof ProviderError)) { await ledger.settle(reservation, attempt, null, "failed"); await ledger.releaseUnused(reservation, attempt + 1); throw error; }
        await ledger.settle(reservation, attempt, error.usage, "failed");
        if (attempt === options.retries || error.kind !== "provider-http") { await ledger.releaseUnused(reservation, attempt + 1); throw error; }
        continue;
      }
      await ledger.settle(reservation, attempt, result.usage, "success");
      await ledger.releaseUnused(reservation, attempt + 1);
      return result;
    }
    throw new Error("unreachable explicit retry state");
    } finally { sending = false; }
  } };
}
export { createMockProvider };
