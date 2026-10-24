/** OpenAI-compatible Chat Completions request shape. Endpoint/key are supplied by host preflight. */
import { z } from "zod";
import { parseModelOutput, ProviderError, readBoundedJson, tokenUsage } from "./index.js";
import type { FetchLike, ModelProvider } from "./index.js";
const Envelope = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }) })).length(1), usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }) });
export function createOpenAICompatibleProvider(options: { apiKey: string; baseUrl?: string; fetchImpl?: FetchLike }): ModelProvider {
  if (!options.baseUrl) throw new ProviderError("schema-violation", "OpenAI-compatible base URL is required", null, false);
  let base: URL;
  try { base = new URL(options.baseUrl); } catch { throw new ProviderError("schema-violation", "invalid provider base URL", null, false); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new ProviderError("schema-violation", "provider base URL must be credential-free HTTPS", null, false);
  const endpoint = `${base.toString().replace(/\/$/, "")}/chat/completions`;
  return { mode: "openai_compatible", async generate(request) {
    let response: Response;
    try { response = await (options.fetchImpl ?? fetch)(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` }, body: JSON.stringify({ model: request.model, max_completion_tokens: request.maxOutputTokens, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: request.prompt.text }] }), signal: AbortSignal.timeout(120_000) }); }
    catch { throw new ProviderError("provider-http", "provider transport failed (details redacted)"); }
    const parsed = Envelope.safeParse(await readBoundedJson(response));
    if (!parsed.success) throw new ProviderError("provider-schema", "invalid Chat Completions response envelope");
    const body = parsed.data; const choice = body.choices[0]; const usage = tokenUsage(body.usage.prompt_tokens, body.usage.completion_tokens);
    if (!usage || !choice || choice.message.content === null || choice.message.refusal || !["stop", "length"].includes(choice.finish_reason ?? "")) throw new ProviderError("provider-schema", "expected completed JSON content and valid usage", usage);
    return { output: parseModelOutput(choice.message.content, choice.finish_reason === "length", usage), usage };
  } };
}
