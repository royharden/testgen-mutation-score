/** Anthropic Messages request shape; no SDK/automatic retry and no environment reads. */
import { z } from "zod";
import { parseModelOutput, ProviderError, readBoundedJson, tokenUsage } from "./index.js";
import type { FetchLike, ModelProvider } from "./index.js";
const Envelope = z.object({ type: z.literal("message"), stop_reason: z.string().nullable(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })), usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }) });
export function createAnthropicProvider(options: { apiKey: string; fetchImpl?: FetchLike }): ModelProvider {
  return { mode: "anthropic", async generate(request) {
    let response: Response;
    try { response = await (options.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": options.apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: request.model, max_tokens: request.maxOutputTokens, temperature: 0, messages: [{ role: "user", content: request.prompt.text }] }), signal: AbortSignal.timeout(120_000) }); }
    catch { throw new ProviderError("provider-http", "provider transport failed (details redacted)"); }
    const parsed = Envelope.safeParse(await readBoundedJson(response));
    if (!parsed.success) throw new ProviderError("provider-schema", "invalid Messages response envelope");
    const body = parsed.data; const usage = tokenUsage(body.usage.input_tokens, body.usage.output_tokens);
    if (!usage || body.content.length !== 1 || body.content[0]?.type !== "text" || body.content[0].text === undefined) throw new ProviderError("provider-schema", "expected one text content block and valid usage", usage);
    if (body.stop_reason !== "end_turn" && body.stop_reason !== "max_tokens") throw new ProviderError("provider-schema", "unexpected Messages stop reason", usage);
    return { output: parseModelOutput(body.content[0].text, body.stop_reason === "max_tokens", usage), usage };
  } };
}
