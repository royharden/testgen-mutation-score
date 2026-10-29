import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BudgetExceeded, CallLedger, summarizeLedgerCell } from "../../cli/ledger/callledger.js";
import type { Prices, ReserveInput } from "../../cli/ledger/callledger.js";
import { LedgerEntrySchema } from "../../cli/core/schemas.js";
import { buildPrompt } from "../../cli/core/prompt.js";
import { budgetedProvider, ProviderError } from "../../cli/providers/index.js";
import type { ModelProvider, ProviderRequest } from "../../cli/providers/index.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const prices: Prices = { schemaVersion: 1, asOf: "2026-10-24", note: "TEST ONLY", models: [{ provider: "anthropic", model: "test", inputUsdPerMillion: 1, outputUsdPerMillion: 2 }] };
const input: ReserveInput = { callId: "test-call", provider: "anthropic", model: "test", budgetScope: "dev", context: { runId: "ledger-test", subjectId: "clamp-range", arm: "A5", repeat: 0, round: 1, slot: 1 }, inputTokenUpperBound: 100, maxOutputTokens: 100, attempts: 2 };
async function ledger(budgetUsd = 1, table = prices) { const root = await mkdtemp(path.join(tmpdir(), "callledger-")); roots.push(root); const file = path.join(root, "calls.jsonl"); const value = new CallLedger({ path: file, budgetUsd, prices: table, now: () => "2026-10-24T00:00:00Z" }); await value.init(); return { value, file }; }
it("unknown prices and insufficient worst-case retry budget block before any send", async () => {
  const unknown = await ledger(1, { ...prices, models: [{ provider: "anthropic", model: "test", inputUsdPerMillion: null, outputUsdPerMillion: 2 }] });
  await expect(unknown.value.reserve(input)).rejects.toBeInstanceOf(BudgetExceeded);
  const low = await ledger(0.0005); await expect(low.value.reserve(input)).rejects.toBeInstanceOf(BudgetExceeded);
  expect(await readFile(low.file, "utf8")).not.toContain('"event":"reserved"');
});
it("persists all attempt bounds first, settles actual usage, retains ambiguous failures on reopen", async () => {
  const { value, file } = await ledger(); const reservation = await value.reserve(input);
  expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(2);
  await value.settle(reservation, 0, { inputTokens: 10, outputTokens: 20 }, "failed");
  expect(value.totals.usd).toBeCloseTo(0.00035);
  const reopened = new CallLedger({ path: file, budgetUsd: 1, prices }); await reopened.init();
  expect(reopened.chargedOrReservedUsd).toBeCloseTo(0.00035);
  await expect(reopened.reserve(input)).rejects.toThrow(/already recorded/);
  await reopened.settle(reservation, 1, null, "failed");
  expect(reopened.totals.unknownUsageCalls).toBe(1); expect(reopened.totals.usd).toBeCloseTo(0.00035);
  expect(await readFile(file, "utf8")).toContain('"event":"failed-billable"');
});
it("retry wrapper sends only after durable reservations, and never retries malformed output", async () => {
  const { value, file } = await ledger(); let sends = 0;
  const transport: ModelProvider = { mode: "anthropic", generate: async () => { sends++; const lines = (await readFile(file, "utf8")).trim().split("\n"); expect(lines.filter((line) => line.includes('"event":"reserved"'))).toHaveLength(2); throw new ProviderError("provider-schema", "bad", { inputTokens: 1, outputTokens: 2 }); } };
  const provider = budgetedProvider(transport, value, { budgetScope: "dev", retries: 1, callId: () => "wrapped-call" });
  const request: ProviderRequest = { prompt: buildPrompt({ subjectId: "clamp-range", source: "source", keptTests: [], arm: "A3", round: 1, maxOutputTokens: 100 }), context: { ...input.context, arm: "A3" }, model: "test", maxOutputTokens: 100 };
  await expect(provider.generate(request)).rejects.toMatchObject({ kind: "provider-schema" });
  expect(sends).toBe(1); expect(value.totals.usd).toBeCloseTo(0.000005);
  expect(await readFile(file, "utf8")).toContain('"event":"released"');
});

async function readEntries(file: string) { return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((line) => LedgerEntrySchema.parse(JSON.parse(line))); }
it("attributes every paid retry once to its exact run and repeat, independently of cached cell totals", async () => {
  const { value, file } = await ledger();
  const first = await value.reserve(input);
  await value.settle(first, 0, { inputTokens: 3, outputTokens: 4 }, "failed");
  await value.settle(first, 1, { inputTokens: 5, outputTokens: 6 }, "success");
  const second = await value.reserve({ ...input, callId: "next-repeat", attempts: 1, context: { ...input.context, repeat: 1 } });
  await value.settle(second, 0, { inputTokens: 7, outputTokens: 8 }, "success");
  const otherRun = await value.reserve({ ...input, callId: "other-run", attempts: 1, context: { ...input.context, runId: "unrelated-run" } });
  await value.settle(otherRun, 0, { inputTokens: 9, outputTokens: 10 }, "success");
  const entries = await readEntries(file);
  expect(entries.filter((entry) => entry.callId === input.callId).every((entry) => entry.runId === "ledger-test" && entry.repeat === 0)).toBe(true);
  const totals = summarizeLedgerCell(entries, input.context);
  expect(totals.inputTokens).toBe(8); expect(totals.outputTokens).toBe(10); expect(totals.usd).toBeCloseTo(0.000028); expect(totals.reason).toBeNull();
  expect(summarizeLedgerCell(entries, { ...input.context, repeat: 1 }).usd).toBeCloseTo(0.000023);
  expect(summarizeLedgerCell(entries, { ...input.context, runId: "unrelated-run" }).usd).toBeCloseTo(0.000029);
  expect(summarizeLedgerCell(entries, { ...input.context, runId: "missing-run" }).usd).toBeNull();
});
it("unresolved attempts and missing legacy provenance are n/a; unknown usage retains a labelled bound", async () => {
  const { value, file } = await ledger();
  const reservation = await value.reserve({ ...input, attempts: 1 });
  expect(summarizeLedgerCell(await readEntries(file), input.context)).toMatchObject({ usd: null, inputTokens: null, outputTokens: null });
  await value.settle(reservation, 0, null, "failed");
  const entries = await readEntries(file), totals = summarizeLedgerCell(entries, input.context);
  expect(totals.usd).toBeCloseTo(0.0003); expect(totals.inputTokens).toBeNull(); expect(totals.outputTokens).toBeNull(); expect(totals.reason).toContain("conservative reserved-bound charge");
  const legacy = entries.map((entry) => ({ ...entry, runId: undefined })) as unknown as typeof entries;
  expect(summarizeLedgerCell(legacy, input.context)).toMatchObject({ usd: null, inputTokens: null, outputTokens: null });
});
it("a terminal cannot reassign an attempt to another repeat or double-charge a settled call", async () => {
  const { value, file } = await ledger(); const reservation = await value.reserve({ ...input, attempts: 1 });
  const forged = { ...reservation, input: { ...reservation.input, context: { ...reservation.input.context, repeat: 1 } } };
  await expect(value.settle(forged, 0, { inputTokens: 1, outputTokens: 1 }, "success")).rejects.toThrow(/provenance changed/);
  await value.settle(reservation, 0, { inputTokens: 1, outputTokens: 1 }, "success");
  const entries = await readEntries(file), terminal = entries.find((entry) => entry.event === "settled");
  if (!terminal) throw new Error("authored fixture requires one terminal event");
  expect(summarizeLedgerCell([...entries, terminal], input.context).usd).toBeNull();
  const moved = entries.map((entry) => entry.event === "settled" ? { ...entry, repeat: 1 } : entry);
  expect(summarizeLedgerCell(moved, input.context).usd).toBeNull();
});
