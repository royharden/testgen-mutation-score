/** Append-only durable reservations. Reopening a ledger never forgets unsettled paid attempts. */
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { LedgerEntrySchema, ProviderModeSchema, IsoDateSchema } from "../core/schemas.js";
import type { LedgerEntry, ModelArmId, ProviderMode, Split } from "../core/schemas.js";
import type { ProviderContext, TokenUsage } from "../providers/index.js";

export const PricesSchema = z.strictObject({ schemaVersion: z.literal(1), asOf: IsoDateSchema, note: z.string(), models: z.array(z.strictObject({ provider: ProviderModeSchema.exclude(["mock"]), model: z.string().min(1), inputUsdPerMillion: z.number().finite().nonnegative().nullable(), outputUsdPerMillion: z.number().finite().nonnegative().nullable() })) });
export type Prices = z.infer<typeof PricesSchema>;
export async function loadPrices(file: string): Promise<Prices> { return PricesSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
function priceRow(prices: Prices, provider: ProviderMode, model: string) {
  const rows = prices.models.filter((r) => r.provider === provider && r.model === model);
  return rows.length === 1 ? rows[0] : undefined;
}
export function estimateWorstCase(prices: Prices, provider: ProviderMode, model: string, inputTokens: number, outputTokens: number, attempts = 1): number | null {
  if (provider === "mock") return 0;
  const row = priceRow(prices, provider, model);
  if (!row || row.inputUsdPerMillion === null || row.outputUsdPerMillion === null) return null;
  if (![inputTokens, outputTokens, attempts].every((n) => Number.isSafeInteger(n) && n >= 0) || attempts < 1) throw new Error("invalid token or attempt bound");
  return ((inputTokens * row.inputUsdPerMillion + outputTokens * row.outputUsdPerMillion) / 1_000_000) * attempts;
}
export class BudgetExceeded extends Error { readonly exitCode = 5; }
export type CallContext = ProviderContext;
export interface ReserveInput { callId: string; provider: ProviderMode; model: string; budgetScope: Split; context: CallContext; inputTokenUpperBound: number; maxOutputTokens: number; attempts: number }
export interface Reservation { input: ReserveInput; perAttemptUsd: number }

function identity(entry: LedgerEntry): string {
  return JSON.stringify([entry.runId, entry.subjectId, entry.arm, entry.repeat, entry.round, entry.provider, entry.model, entry.budgetScope, entry.priceTableDate]);
}
/** Validate the lifecycle globally before attributing any event to a cell. A terminal cannot move a call. */
function validateLifecycle(entries: readonly LedgerEntry[]): void {
  const identities = new Map<string, string>(), reserved = new Map<string, LedgerEntry>(), closed = new Set<string>(), blocked = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.callId}/${entry.attempt}`, callIdentity = identity(entry), priorIdentity = identities.get(entry.callId);
    if (priorIdentity !== undefined && priorIdentity !== callIdentity) throw new Error("ledger call provenance changed across events or retries");
    identities.set(entry.callId, callIdentity);
    if (entry.event === "blocked") {
      if (blocked.has(entry.callId) || [...reserved.values()].some((r) => r.callId === entry.callId)) throw new Error("blocked call also has a reservation or duplicate block");
      blocked.add(entry.callId); continue;
    }
    if (blocked.has(entry.callId)) throw new Error("blocked call cannot later send under the same callId");
    if (entry.event === "reserved") {
      if (reserved.has(key)) throw new Error("duplicate ledger reservation");
      reserved.set(key, entry); continue;
    }
    const original = reserved.get(key);
    if (!original || closed.has(key)) throw new Error("ledger terminal without one open reservation");
    if (original.reservedUsd !== entry.reservedUsd) throw new Error("terminal reservation bound changed");
    if (entry.event === "released" && entry.actualUsd !== 0) throw new Error("unused retry release must charge zero");
    closed.add(key);
  }
}
export interface LedgerCellIdentity { runId: string; subjectId: string; arm: ModelArmId; repeat: number }
export interface LedgerCellTotals { inputTokens: number | null; outputTokens: number | null; usd: number | null; reason: string | null }
/** Ledger only. Reservations and their terminal events are one attempt, never two charges. */
export function summarizeLedgerCell(entries: readonly LedgerEntry[], cell: LedgerCellIdentity): LedgerCellTotals {
  const unavailable = (reason: string): LedgerCellTotals => ({ inputTokens: null, outputTokens: null, usd: null, reason });
  let parsed: LedgerEntry[];
  try { parsed = entries.map((entry) => LedgerEntrySchema.parse(entry)); validateLifecycle(parsed); }
  catch { return unavailable("invalid ledger lifecycle or missing exact run/cell provenance; cached cell USD is not evidence"); }
  const selected = parsed.filter((e) => e.runId === cell.runId && e.subjectId === cell.subjectId && e.arm === cell.arm && e.repeat === cell.repeat);
  if (!selected.length) return unavailable("no ledger events for the exact run/subject/arm/repeat");
  const attempts = new Map<string, LedgerEntry>();
  for (const entry of selected) if (entry.event !== "blocked") attempts.set(`${entry.callId}/${entry.attempt}`, entry);
  let inputTokens = 0, outputTokens = 0, usd = 0, unknownInput = false, unknownOutput = false, outstanding = false;
  for (const entry of attempts.values()) {
    if (entry.event === "reserved") { outstanding = true; continue; }
    if (entry.event === "released") continue;
    if (entry.event !== "settled" && entry.event !== "failed-billable") continue;
    usd += entry.actualUsd ?? 0;
    if (entry.inputTokens === null) unknownInput = true; else inputTokens += entry.inputTokens;
    if (entry.outputTokens === null) unknownOutput = true; else outputTokens += entry.outputTokens;
  }
  return { inputTokens: outstanding || unknownInput ? null : inputTokens, outputTokens: outstanding || unknownOutput ? null : outputTokens,
    usd: outstanding ? null : usd, reason: outstanding ? "unresolved reserved attempt; actual per-cell cost is unavailable" : unknownInput || unknownOutput ? "usage unavailable for a billed attempt; USD includes the ledger's conservative reserved-bound charge, not a verified invoice" : null };
}
export class CallLedger {
  private entries: LedgerEntry[] = [];
  private initialized = false;
  private busy = false;
  constructor(private readonly options: { path: string; budgetUsd: number; prices: Prices; now?: () => string }) {
    if (!Number.isFinite(options.budgetUsd) || options.budgetUsd <= 0) throw new Error("budget must be positive finite USD");
    PricesSchema.parse(options.prices);
  }
  async init(): Promise<void> {
    let content: string;
    try { content = await readFile(this.options.path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; content = ""; }
    if (content && !content.endsWith("\n")) throw new Error("ledger has a truncated trailing line; manual recovery required");
    const parsed = content.split("\n").filter(Boolean).map((line, i) => { try { return LedgerEntrySchema.parse(JSON.parse(line)); } catch { throw new Error(`invalid ledger line ${i + 1}`); } });
    validateLifecycle(parsed);
    this.entries = parsed; this.initialized = true;
  }
  get chargedOrReservedUsd(): number {
    const outstanding = new Map<string, number>(); let paid = 0;
    for (const e of this.entries) { const key = `${e.callId}/${e.attempt}`; if (e.event === "reserved") outstanding.set(key, e.reservedUsd ?? 0); if (e.event === "settled" || e.event === "failed-billable") { outstanding.delete(key); paid += e.actualUsd ?? 0; } if (e.event === "released") outstanding.delete(key); }
    return paid + [...outstanding.values()].reduce((a, b) => a + b, 0);
  }
  /** Serial caller snapshots these totals around each cell. Unknown usage is never represented as free. */
  get totals(): { inputTokens: number; outputTokens: number; usd: number; unknownUsageCalls: number } {
    const charged = this.entries.filter((entry) => entry.event === "settled" || entry.event === "failed-billable");
    return { inputTokens: charged.reduce((n, e) => n + (e.inputTokens ?? 0), 0), outputTokens: charged.reduce((n, e) => n + (e.outputTokens ?? 0), 0), usd: this.chargedOrReservedUsd, unknownUsageCalls: charged.filter((e) => e.inputTokens === null || e.outputTokens === null).length };
  }
  private async append(records: LedgerEntry[]): Promise<void> {
    if (!this.initialized) throw new Error("ledger.init() required before use");
    validateLifecycle([...this.entries, ...records.map((record) => LedgerEntrySchema.parse(record))]);
    await mkdir(path.dirname(this.options.path), { recursive: true });
    const file = await open(this.options.path, "a");
    try { await file.writeFile(records.map((r) => JSON.stringify(LedgerEntrySchema.parse(r)) + "\n").join("")); await file.sync(); } finally { await file.close(); }
    this.entries.push(...records);
  }
  private base(input: ReserveInput, attempt: number): Omit<LedgerEntry, "event"> {
    return { schemaVersion: 1, callId: input.callId, runId: input.context.runId, repeat: input.context.repeat, at: (this.options.now ?? (() => new Date().toISOString()))(), provider: input.provider, model: input.model, priceTableDate: this.options.prices.asOf, budgetScope: input.budgetScope, subjectId: input.context.subjectId, arm: input.context.arm, round: input.context.round, attempt, reservedUsd: null, actualUsd: null, inputTokens: null, outputTokens: null, reason: null };
  }
  async reserve(input: ReserveInput): Promise<Reservation> {
    if (!this.initialized || this.busy) throw new Error("ledger requires initialization and serial calls");
    this.busy = true;
    try {
      if (this.entries.some((e) => e.callId === input.callId)) throw new Error("callId already recorded; never resend an ambiguous paid call");
      // Keep the single-attempt bound identical to settlement's formula (avoid divide-rounding drift).
      const perAttempt = estimateWorstCase(this.options.prices, input.provider, input.model, input.inputTokenUpperBound, input.maxOutputTokens);
      if (!Number.isSafeInteger(input.attempts) || input.attempts < 1 || input.attempts > 4) throw new Error("attempt count must be 1–4");
      const total = perAttempt === null ? null : perAttempt * input.attempts;
      if (perAttempt === null || total === null || this.chargedOrReservedUsd + total > this.options.budgetUsd) {
        await this.append([{ ...this.base(input, 0), event: "blocked", priceTableDate: total === null ? null : this.options.prices.asOf, reason: total === null ? "unknown model price; live call blocked" : "insufficient remaining worst-case budget" }]);
        throw new BudgetExceeded(total === null ? "unknown model price" : "budget cap would be exceeded");
      }
      const perAttemptUsd = perAttempt;
      await this.append(Array.from({ length: input.attempts }, (_, attempt) => ({ ...this.base(input, attempt), event: "reserved" as const, reservedUsd: perAttemptUsd })));
      return { input, perAttemptUsd };
    } finally { this.busy = false; }
  }
  async settle(reservation: Reservation, attempt: number, usage: TokenUsage | null, outcome: "success" | "failed"): Promise<void> {
    const prior = this.entries.filter((e) => e.callId === reservation.input.callId && e.attempt === attempt);
    if (prior.length !== 1 || prior[0]?.event !== "reserved") throw new Error("attempt is absent or already settled");
    const actual = usage ? estimateWorstCase(this.options.prices, reservation.input.provider, reservation.input.model, usage.inputTokens, usage.outputTokens) : reservation.perAttemptUsd;
    if (actual === null) throw new Error("reserved price disappeared");
    await this.append([{ ...this.base(reservation.input, attempt), event: outcome === "success" ? "settled" : "failed-billable", reservedUsd: reservation.perAttemptUsd, actualUsd: actual, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, reason: usage ? null : "usage unavailable; charged conservative reserved bound (including possibly billable failure)" }]);
    // Record observed excess honestly, then stop; a provider token-bound violation cannot authorize more sends.
    if (actual > reservation.perAttemptUsd || this.chargedOrReservedUsd > this.options.budgetUsd) throw new BudgetExceeded("provider usage exceeded reserved bound; no further paid calls permitted");
  }
  async releaseUnused(reservation: Reservation, fromAttempt: number): Promise<void> {
    const records: LedgerEntry[] = [];
    for (let attempt = fromAttempt; attempt < reservation.input.attempts; attempt++) {
      const prior = this.entries.filter((e) => e.callId === reservation.input.callId && e.attempt === attempt);
      if (prior.length !== 1 || prior[0]?.event !== "reserved") throw new Error("cannot release an already closed attempt");
      records.push({ ...this.base(reservation.input, attempt), event: "released", reservedUsd: reservation.perAttemptUsd, actualUsd: 0, reason: "explicit retry was not sent" });
    }
    if (records.length) await this.append(records);
  }
}
