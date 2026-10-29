import { expect, it } from "vitest";
import { buildPrompt } from "../../cli/core/prompt.js";
import { CANDIDATE_MAX_BYTES } from "../../cli/core/schemas.js";
import { parseModelOutput, ProviderError } from "../../cli/providers/index.js";
import type { FetchLike, ProviderRequest } from "../../cli/providers/index.js";
import { createAnthropicProvider } from "../../cli/providers/anthropic.js";
import { createOpenAICompatibleProvider } from "../../cli/providers/openaiCompatible.js";
const request: ProviderRequest = { prompt: buildPrompt({ subjectId: "clamp-range", source: "source", keptTests: [], arm: "A3", round: 1, maxOutputTokens: 100 }), context: { runId: "provider-test", subjectId: "clamp-range", arm: "A3", repeat: 0, round: 1, slot: 1 }, model: "pinned-test-model", maxOutputTokens: 100 };
const usage = { inputTokens: 3, outputTokens: 5 };
it("does not repair markdown/non-JSON/unknown keys and distinguishes cap/truncation", () => {
  for (const text of ["```json\n{}\n```", '{"testFile":"x","extra":1}', "[]"]) expect(() => parseModelOutput(text, false, usage)).toThrow(ProviderError);
  expect(() => parseModelOutput('{"testFile":"x"}', true, usage)).toThrow(/output limit/);
  expect(() => parseModelOutput(JSON.stringify({ testFile: "x".repeat(CANDIDATE_MAX_BYTES + 1) }), false, usage)).toThrow(/byte cap/);
});
it("Messages fetch adapter sends once, parses usage and rejects non-text blocks", async () => {
  let sends = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    sends++; const body = JSON.parse(String(init?.body)) as { messages: { content: string }[]; max_tokens: number };
    expect(body.messages[0]?.content).toBe(request.prompt.text); expect(body.max_tokens).toBe(100);
    return new Response(JSON.stringify({ type: "message", stop_reason: "end_turn", content: [{ type: "text", text: '{"testFile":"test bytes"}' }], usage: { input_tokens: 3, output_tokens: 5 } }));
  };
  const result = await createAnthropicProvider({ apiKey: "TEST_ONLY_NOT_A_CREDENTIAL", fetchImpl }).generate(request);
  expect(result).toEqual({ output: { testFile: "test bytes" }, usage }); expect(sends).toBe(1);
  const errorFetch: FetchLike = async () => { sends++; return new Response("error", { status: 429 }); };
  await expect(createAnthropicProvider({ apiKey: "TEST_ONLY", fetchImpl: errorFetch }).generate(request)).rejects.toMatchObject({ kind: "provider-http" });
  expect(sends).toBe(2);
});
it("compatible endpoint uses a JSON-object request and rejects truncation with known billed usage", async () => {
  const fetchImpl: FetchLike = async (url, init) => {
    expect(String(url)).toBe("https://example.invalid/v1/chat/completions");
    expect(JSON.parse(String(init?.body))).toMatchObject({ max_completion_tokens: 100, response_format: { type: "json_object" } });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"testFile":"partial"}' } }], usage: { prompt_tokens: 3, completion_tokens: 5 } }));
  };
  await expect(createOpenAICompatibleProvider({ apiKey: "TEST_ONLY", baseUrl: "https://example.invalid/v1", fetchImpl }).generate(request)).rejects.toMatchObject({ kind: "provider-truncated", usage });
});
