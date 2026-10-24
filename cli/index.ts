/** CLI entrypoint. Importing this file executes no command, provider, sandbox or subject. */
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ARM_IDS, ArmIdSchema, EngineSchema, ProviderModeSchema, SlugSchema, RunIdSchema } from "./core/schemas.js";
import type { ArmId, Split, ProviderMode, Engine } from "./core/schemas.js";
import { readManifest, readInventory, subjectEntries, inventoryCommand } from "./core/inventory.js";
import { PreflightRefusal } from "./core/preflight.js";
import { runExperiment } from "./arms/runner.js";
import { createProvider, budgetedProvider } from "./providers/index.js";
import { CallLedger, estimateWorstCase, loadPrices } from "./ledger/callledger.js";
import { createSandboxRunner, hostProcessEnv } from "./sandbox/sandboxrun.js";

export type CliCommand = "run" | "mutants" | "eval" | "apply" | "replay:check";
export interface ParsedArgs {
  command: CliCommand; mode: "dry-run" | "execute" | "live"; provider: ProviderMode; sandbox: "docker" | "none";
  split: Split | "all"; subjects?: string[]; arms: ArmId[]; repeats: number; engine: Engine; maxOutputTokens: number;
  retries: number; model?: string; campaignId?: string; resume?: string; heldoutConfirm: boolean; write: boolean;
  strykerReports?: string; image?: string; positional: string[];
  writeHashes: boolean;
}
export interface CliContext { repoRoot: string; args: ParsedArgs; stdout: (line: string) => void; stderr: (line: string) => void }
/** M6 registers these real implementations without introducing nonexistent imports into M5. */
export interface CliExtensionHandlers { eval?: (context: CliContext) => Promise<number>; apply?: (context: CliContext) => Promise<number> }
const valueFlags = new Set(["provider", "sandbox", "split", "subjects", "arms", "repeats", "engine", "max-output-tokens", "retries", "model", "campaign-id", "resume", "stryker-reports", "image"]);
const booleanFlags = new Set(["execute", "live", "dry-run", "heldout-confirm", "write", "write-hashes"]);
function parseArgsUnchecked(argv: readonly string[]): ParsedArgs {
  const commands: CliCommand[] = ["run", "mutants", "eval", "apply", "replay:check"];
  const first = argv[0], command: CliCommand = first && !first.startsWith("--") ? first as CliCommand : "run";
  if (!commands.includes(command)) throw new PreflightRefusal(`unknown command: ${command}`);
  const tokens = first === command ? argv.slice(1) : argv;
  const values = new Map<string, string>(), flags = new Set<string>(), positional: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) { positional.push(token); continue; }
    const flag = token.slice(2);
    if (!valueFlags.has(flag) && !booleanFlags.has(flag)) throw new PreflightRefusal(`unknown flag: --${flag}`);
    if (values.has(flag) || flags.has(flag)) throw new PreflightRefusal(`duplicate flag: --${flag}`);
    if (booleanFlags.has(flag)) flags.add(flag);
    else {
      const value = tokens[++index];
      if (!value || value.startsWith("--")) throw new PreflightRefusal(`missing value for --${flag}`);
      values.set(flag, value);
    }
  }
  const modes = ["execute", "live", "dry-run"].filter((mode) => flags.has(mode));
  if (modes.length > 1) throw new PreflightRefusal("--execute, --live and --dry-run are mutually exclusive");
  const mode = (modes[0] ?? "dry-run") as ParsedArgs["mode"];
  const provider = ProviderModeSchema.parse(values.get("provider") ?? "mock");
  const sandbox = values.get("sandbox") ?? "docker";
  if (sandbox !== "docker" && sandbox !== "none") throw new PreflightRefusal("--sandbox must be docker or none");
  const split = values.get("split") ?? (command === "mutants" ? "all" : "dev");
  if (split !== "all" && split !== "dev" && split !== "heldout") throw new PreflightRefusal("invalid --split");
  if (split === "all" && command !== "mutants") throw new PreflightRefusal("--split all is only valid for mutants");
  if (mode === "execute" && provider !== "mock") throw new PreflightRefusal("--execute requires --provider mock");
  if (mode === "live" && (provider === "mock" || sandbox !== "docker")) throw new PreflightRefusal("--live requires a real provider and Docker");
  if (sandbox === "none" && (mode !== "execute" || provider !== "mock")) throw new PreflightRefusal("--sandbox none requires explicit --execute mock mode");
  if (mode === "live" && command !== "run") throw new PreflightRefusal("--live is only valid for run");
  if ((flags.has("heldout-confirm") || values.has("resume") || values.has("campaign-id")) && (command !== "run" || split !== "heldout" || mode === "dry-run"))
    throw new PreflightRefusal("campaign flags require held-out run execution");
  if (flags.has("write") && command !== "apply") throw new PreflightRefusal("--write is only valid for apply");
  if (flags.has("write-hashes") && command !== "replay:check") throw new PreflightRefusal("--write-hashes is only valid for replay:check");
  if (command !== "apply" && command !== "eval" && positional.length) throw new PreflightRefusal("unexpected positional arguments");
  const integer = (name: string, fallback: number, max: number, min = 1) => {
    const text = values.get(name), number = text === undefined ? fallback : Number(text);
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new PreflightRefusal(`invalid --${name}`);
    return number;
  };
  const subjects = values.get("subjects")?.split(",").map((id) => SlugSchema.parse(id));
  const arms = values.get("arms")?.split(",").map((arm) => ArmIdSchema.parse(arm)) ?? [...ARM_IDS];
  if (new Set(arms).size !== arms.length || (subjects !== undefined && new Set(subjects).size !== subjects.length)) throw new PreflightRefusal("subjects/arms must be unique");
  const result: ParsedArgs = { command, mode, provider, sandbox, split, arms, repeats: integer("repeats", 3, 3),
    engine: EngineSchema.parse(values.get("engine") ?? "inhouse"), maxOutputTokens: integer("max-output-tokens", 2048, 8192),
    retries: integer("retries", 0, 3, 0), heldoutConfirm: flags.has("heldout-confirm"), write: flags.has("write"), writeHashes: flags.has("write-hashes"), positional };
  if (subjects) result.subjects = subjects;
  for (const [flag, key] of [["model", "model"], ["campaign-id", "campaignId"], ["resume", "resume"], ["stryker-reports", "strykerReports"], ["image", "image"]] as const) {
    const value = values.get(flag); if (value) result[key] = value;
  }
  if (result.campaignId) RunIdSchema.parse(result.campaignId);
  if (result.resume) RunIdSchema.parse(result.resume);
  if (result.resume && result.campaignId && result.resume !== result.campaignId) throw new PreflightRefusal("resume and campaign id differ");
  if (command === "run" && split === "heldout" && mode !== "dry-run" && !result.heldoutConfirm) throw new PreflightRefusal("held-out run requires --heldout-confirm");
  return result;
}
export function parseArgs(argv: readonly string[]): ParsedArgs {
  try { return parseArgsUnchecked(argv); }
  catch (error) { if (error instanceof PreflightRefusal) throw error; throw new PreflightRefusal("invalid flag value or identifier"); }
}

/** Read-only planning: no provider, ledger, executor, enumeration, or runtime probe is constructed. */
export async function dryRun(context: CliContext): Promise<number> {
  const manifest = await readManifest(context.repoRoot), args = context.args;
  const selected = subjectEntries(manifest, args.split).filter((entry) => !args.subjects || args.subjects.includes(entry.id));
  if (!selected.length || args.subjects?.some((id) => !selected.some((entry) => entry.id === id))) throw new PreflightRefusal("unknown subject for selected split");
  context.stdout("DRY RUN — no inventory, provider call, subject or sandbox execution");
  for (const entry of subjectEntries(manifest, "all")) {
    const inventory = await readInventory(context.repoRoot, entry.id);
    context.stdout(`${entry.id} [${entry.split}]${selected.some((s) => s.id === entry.id) ? " selected" : ""}: ${inventory ? `${inventory.partition.feedback.length} feedback / ${inventory.partition.scoring.length} scoring` : "not inventoried"}`);
  }
  const counts = { A0: 0, A1: 0, A2: 0, A3: selected.length * args.repeats, A4: selected.length * args.repeats * 3,
    A5: selected.length * args.repeats * 3, A6: selected.length * args.repeats * 3 };
  for (const arm of args.arms) context.stdout(`${arm}: at most ${counts[arm]} model calls`);
  context.stdout("Full held-out campaign (12 subjects × 3 repeats): 360 planned model calls (A3 36; A4/A5/A6 108 each), before explicit transport retries.");
  const prices = await loadPrices(path.join(context.repoRoot, "cli/ledger/prices.json"));
  const model = args.model ?? process.env.TESTGEN_MODEL ?? "unconfigured";
  // This conservative byte bound includes three worst-case 8-unit files and quoted feedback diffs.
  let maximumInputBound = 0;
  for (const entry of selected) {
    const source = await readFile(path.join(context.repoRoot, "fixtures/subjects", entry.id, "src.ts"), "utf8");
    const inventory = await readInventory(context.repoRoot, entry.id);
    const maxReplacement = Math.max(0, ...(inventory?.mutants.map((m) => Buffer.byteLength(m.replacement, "utf8")) ?? []));
    maximumInputBound = Math.max(maximumInputBound, Buffer.byteLength(source, "utf8") * 20 + 3 * 8 * 32768 * 4 + maxReplacement * 40 + 100000);
  }
  const calls = args.arms.reduce((sum, arm) => sum + counts[arm], 0);
  const bound = estimateWorstCase(prices, args.provider, model, maximumInputBound, args.maxOutputTokens, args.retries + 1);
  context.stdout(`Worst-case requested-provider cost: ${bound === null ? "unknown price" : `USD ${(bound * calls).toFixed(6)} upper bound`}; pinned model ${model}; live prices must be known before execution.`);
  return 0;
}

export async function probeDockerAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["version", "--format", "{{.Server.Version}}"], { env: hostProcessEnv(), shell: false, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 5000);
    child.once("error", () => { clearTimeout(timer); resolve(false); });
    child.once("close", (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

export async function runCli(argv: readonly string[], options: { root?: string; stdout?: (line: string) => void;
  stderr?: (line: string) => void; extensions?: CliExtensionHandlers } = {}): Promise<number> {
  const stdout = options.stdout ?? console.log, stderr = options.stderr ?? console.error;
  try {
    const args = parseArgs(argv), repoRoot = options.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const context = { repoRoot, args, stdout, stderr };
    if (args.command === "apply" || args.command === "eval") {
      const handler = options.extensions?.[args.command];
      if (!handler) throw new PreflightRefusal(`${args.command} implementation belongs to M6; no evaluation or write was performed`);
      return await handler(context);
    }
    if (args.command === "replay:check") {
      const { checkReplay } = await import("../scripts/replay-check.js");
      await checkReplay(repoRoot, args.writeHashes); stdout("Replay prompt hashes and controller journey verified."); return 0;
    }
    if (args.mode === "dry-run") return dryRun(context);
    if (args.command === "mutants") {
      const inventories = await inventoryCommand(repoRoot, { split: args.split, engine: args.engine, ...(args.strykerReports ? { reportDir: args.strykerReports } : {}) });
      for (const inventory of inventories) stdout(`${inventory.subjectId}: frozen ${inventory.partition.feedback.length} feedback / ${inventory.partition.scoring.length} scoring`);
      return 0;
    }
    const prices = await loadPrices(path.join(repoRoot, "cli/ledger/prices.json"));
    const model = args.model ?? process.env.TESTGEN_MODEL ?? (args.provider === "mock" ? "mock-replay" : "");
    let budget = 0, key: string | undefined;
    if (args.mode === "live") {
      key = process.env[args.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_COMPATIBLE_API_KEY"];
      budget = Number(process.env[args.split === "heldout" ? "TESTGEN_BUDGET_USD" : "TESTGEN_DEV_BUDGET_USD"]);
      if (!key || !model || !Number.isFinite(budget) || budget <= 0) throw new PreflightRefusal("live run requires key, pinned TESTGEN_MODEL, and a positive split-specific budget");
      if (estimateWorstCase(prices, args.provider, model, 1, 1) === null) throw new PreflightRefusal("unknown live model price; pin a dated price row before execution");
    }
    const dockerAvailable = args.sandbox === "docker" ? await probeDockerAvailability() : false;
    if (args.sandbox === "docker" && !dockerAvailable) throw new PreflightRefusal("Docker is unavailable");
    const image = args.image ?? process.env.TESTGEN_SANDBOX_IMAGE ?? "";
    if (args.sandbox === "docker" && !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*@sha256:[0-9a-f]{64}$/.test(image)) throw new PreflightRefusal("a pinned sandbox image digest is required (--image or TESTGEN_SANDBOX_IMAGE)");
    const sandbox = createSandboxRunner({ mode: args.mode, provider: args.provider, sandbox: args.sandbox, dockerAvailable, image,
      localRunnerFile: path.join(repoRoot, "cli/sandbox/runner.mjs"), warn: stderr });
    if (sandbox.warning) stderr(sandbox.warning);
    const provider = await createProvider({ mode: args.provider, root: repoRoot, ...(key ? { apiKey: key } : {}),
      ...(process.env.OPENAI_COMPATIBLE_BASE_URL ? { baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL } : {}) });
    const campaignId = args.resume ?? args.campaignId ?? (args.split === "heldout" ? `campaign-${randomUUID()}` : undefined);
    const ledger = args.mode === "live" ? new CallLedger({ path: path.join(repoRoot, "results", `${args.split}-${campaignId ?? "dev"}.ledger.jsonl`), budgetUsd: budget, prices }) : null;
    await ledger?.init();
    const result = await runExperiment({ root: repoRoot, split: args.split as Split, arms: args.arms, repeats: args.repeats,
      ...(args.subjects ? { subjectIds: args.subjects } : {}), ...(campaignId ? { campaignId } : {}), ...(args.resume ? { resume: args.resume } : {}),
      heldoutConfirm: args.heldoutConfirm, model, maxOutputTokens: args.maxOutputTokens, sandbox: args.sandbox,
      provider: ledger ? budgetedProvider(provider, ledger, { budgetScope: args.split as Split, retries: args.retries, callId: () => `call-${randomUUID()}` }) : provider,
      run: sandbox, ...(ledger ? { accounting: () => ledger.totals } : {}),
      frozenConfig: { split: args.split, subjects: args.subjects ?? null, arms: args.arms, repeats: args.repeats, provider: args.provider,
        sandbox: args.sandbox, image, model, maxOutputTokens: args.maxOutputTokens, retries: args.retries, budgetUsd: budget } });
    stdout(`${result.status}: ${result.runId}; ${result.cells.length} retained cells; ${result.missingCells.length} missing; exit ${result.exitCode}`);
    return result.exitCode;
  } catch (error) {
    stderr(error instanceof PreflightRefusal ? error.message : "command failed; raw provider, environment and sandbox diagnostics omitted");
    return error instanceof Error && "exitCode" in error && [2, 3, 4, 5].includes(Number(error.exitCode)) ? Number(error.exitCode) : 4;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runCli(process.argv.slice(2));
