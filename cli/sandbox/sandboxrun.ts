/** Host-side process wrapper. No execution occurs until run() is explicitly invoked after activation. */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ExecutionResultSchema, TestUnitSchema } from "../core/schemas.js";
import type { ExecutionResult } from "../core/schemas.js";
import { EngineExecutionError, validateRunResult } from "../engines/engine.js";
import type { IsolatedRunner, IsolatedRunRequest } from "../engines/engine.js";
import { sha256Hex } from "../core/mutantKey.js";

export interface SandboxOptions {
  mode: "execute" | "live";
  provider: "mock" | "anthropic" | "openai_compatible";
  sandbox: "docker" | "none";
  /** Availability must be established by the CLI preflight, never optimistically assumed. */
  dockerAvailable: boolean;
  /** Pinned local image digest, built only after Dirty Mode closes. */
  image: string;
  timeoutMs?: number;
  outputCapBytes?: number;
  dockerBinary?: string;
  /** Explicit mock-only local opt-out. It remains unqualified and is never selected implicitly. */
  localRunnerFile?: string;
  warn?: (message: string) => void;
}

export interface SandboxCommand { command: string; argv: string[]; env: NodeJS.ProcessEnv; qualified: boolean; warning: string | null }
export interface SandboxRunner extends IsolatedRunner { readonly qualified: boolean; readonly warning: string | null }
const LOCAL_WARNING = "WARNING: --sandbox none executes mock candidates on the host; this run is sandbox-unqualified.";

export function assertSandboxMode(options: SandboxOptions): void {
  if (options.mode === "execute" && options.provider !== "mock")
    throw new EngineExecutionError("sandbox-crash", "--execute requires --provider mock");
  if (options.mode === "live" && (options.provider === "mock" || options.sandbox !== "docker" || !options.dockerAvailable))
    throw new EngineExecutionError("sandbox-crash", "--live requires a real provider and available Docker sandbox");
  if (options.sandbox === "docker" && !options.dockerAvailable)
    throw new EngineExecutionError("sandbox-crash", "Docker is unavailable; execution refused");
  if (options.sandbox === "none" && (options.mode !== "execute" || options.provider !== "mock" || options.localRunnerFile === undefined))
    throw new EngineExecutionError("sandbox-crash", "--sandbox none requires explicit mock execution and a trusted local runner");
  if (!Number.isInteger(options.timeoutMs ?? 30000) || (options.timeoutMs ?? 30000) < 1 || (options.timeoutMs ?? 30000) > 300000)
    throw new EngineExecutionError("sandbox-crash", "invalid sandbox timeout");
  if (!Number.isInteger(options.outputCapBytes ?? 1048576) || (options.outputCapBytes ?? 1048576) < 1 || (options.outputCapBytes ?? 1048576) > 1048576)
    throw new EngineExecutionError("sandbox-crash", "invalid sandbox output cap");
}

/** Only transport/runtime essentials reach the Docker CLI. No model credentials, proxies, NODE_OPTIONS, or user env. */
export function hostProcessEnv(input: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
    const value = input[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function safeMount(host: string, destination: string): string {
  const absolute = path.resolve(host);
  if (/[\r\n,]/.test(absolute) || /docker\.sock|docker_engine/i.test(absolute))
    throw new EngineExecutionError("sandbox-crash", "unsafe sandbox mount path");
  return `type=bind,source=${absolute},destination=${destination},readonly`;
}

export function buildSandboxCommand(options: SandboxOptions, paths: { subjectDir: string; inputDir: string; workDir: string }, name: string): SandboxCommand {
  assertSandboxMode(options);
  if (!/^testgen-[a-z0-9-]+$/.test(name)) throw new EngineExecutionError("sandbox-crash", "invalid container name");
  const env = hostProcessEnv();
  if (options.sandbox === "none") return {
    command: process.execPath,
    argv: [path.resolve(options.localRunnerFile ?? ""), path.resolve(paths.inputDir, "request.json"), path.resolve(paths.workDir)],
    env, qualified: false, warning: LOCAL_WARNING,
  };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*@sha256:[0-9a-f]{64}$/.test(options.image))
    throw new EngineExecutionError("sandbox-crash", "sandbox image must be pinned by sha256 digest");
  return {
    command: options.dockerBinary ?? "docker",
    argv: ["run", "--rm", "--pull", "never", "--name", name, "--network", "none", "--user", "10001:10001", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m,mode=1777",
      "--tmpfs", "/work:rw,nosuid,size=128m,mode=1777", "--memory", "1g", "--memory-swap", "1g", "--cpus", "1", "--pids-limit", "128",
      "--mount", safeMount(paths.subjectDir, "/subject"), "--mount", safeMount(paths.inputDir, "/in"), "--workdir", "/work",
      "--entrypoint", "node", options.image, "/opt/testgen/cli/sandbox/runner.mjs", "/in/request.json", "/work"],
    env, qualified: true, warning: null,
  };
}

export function timeoutResult(request: IsolatedRunRequest, durationMs: number, outputTruncated: boolean): ExecutionResult {
  const base = { ...request.target, unitSha256s: request.units.map((u) => u.unitSha256), outcome: "timeout", durationMs,
    shuffleSeed: request.shuffleSeed ?? null, tests: [], outputTruncated,
    ...(request.target.kind === "coverage" ? { coveredLines: [], executableLines: [] } : {}) };
  if (request.target.kind === "a1-capture") return ExecutionResultSchema.parse({ ...base,
    observations: (request.probes ?? []).map((p) => ({ probeId: p.id, outcome: "unsupported", valueJson: null, errorName: null, message: "capture timed out" })) });
  return ExecutionResultSchema.parse("mutantKey" in request.target || request.target.kind === "planted"
    ? { ...base, mutantStatus: "Timeout", killCause: null } : base);
}

/** Bounded cleanup; a failed removal makes the run unusable instead of silently leaving code running. */
async function removeContainer(options: SandboxOptions, name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(options.dockerBinary ?? "docker", ["rm", "--force", name], { env: hostProcessEnv(), shell: false, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); reject(new EngineExecutionError("sandbox-crash", "container cleanup timed out")); }, 5000);
    child.once("error", () => { clearTimeout(timer); reject(new EngineExecutionError("sandbox-crash", "container cleanup failed")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new EngineExecutionError("sandbox-crash", "container cleanup was not confirmed"));
    });
  });
}

/** Capture buffers never grow past the cap. Oversized output is a RunError, never a partial valid result. */
async function capture(command: SandboxCommand, request: IsolatedRunRequest, options: SandboxOptions, name: string): Promise<ExecutionResult> {
  const started = Date.now();
  const cap = options.outputCapBytes ?? 1048576;
  let child: ChildProcess;
  let cleanup: Promise<void> | undefined;
  const stop = () => {
    child.kill("SIGKILL");
    if (options.sandbox === "docker") cleanup ??= removeContainer(options, name);
  };
  const result = await new Promise<ExecutionResult>((resolve, reject) => {
    child = spawn(command.command, command.argv, { env: command.env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0), stderrBytes = 0, overflow = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs ?? 30000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length + chunk.length > cap) { overflow = true; stop(); }
      else stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > cap) { overflow = true; stop(); }
    });
    child.once("error", () => { clearTimeout(timer); reject(new EngineExecutionError("sandbox-crash", "sandbox process could not start")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (overflow) { reject(new EngineExecutionError("sandbox-crash", "sandbox output exceeded bounded cap")); return; }
      if (timedOut) { resolve(timeoutResult(request, Date.now() - started, false)); return; }
      if (code !== 0) { reject(new EngineExecutionError("sandbox-crash", "sandbox process exited without a valid result")); return; }
      let decoded: unknown;
      try { decoded = JSON.parse(stdout.toString("utf8")); }
      catch { reject(new EngineExecutionError("report-parse", "sandbox stdout must be exactly one JSON document")); return; }
      try { resolve(validateRunResult(decoded, request)); }
      catch (error) { reject(error); }
    });
  }).finally(async () => { if (cleanup !== undefined) await cleanup; });
  return validateRunResult(result, request);
}

export function createSandboxRunner(options: SandboxOptions): SandboxRunner {
  assertSandboxMode(options);
  return { qualified: options.sandbox === "docker", warning: options.sandbox === "none" ? LOCAL_WARNING : null, async run(request) {
    for (const unit of request.units) {
      TestUnitSchema.parse(unit);
      if (sha256Hex(unit.text) !== unit.unitSha256) throw new EngineExecutionError("add-only-guard", "unit bytes differ from their immutable hash");
    }
    if (new Set(request.units.map((u) => u.unitSha256)).size !== request.units.length)
      throw new EngineExecutionError("report-parse", "duplicate unit in execution request");
    const root = await mkdtemp(path.join(tmpdir(), "testgen-sandbox-"));
    try {
      // All names are trusted constants; request text never supplies host paths or command arguments.
      const subjectDir = path.join(root, "subject"), inputDir = path.join(root, "input"), workDir = path.join(root, "work");
      await Promise.all([mkdir(subjectDir), mkdir(inputDir), mkdir(workDir)]);
      await writeFile(path.join(subjectDir, "src.ts"), request.sourceText, "utf8");
      await writeFile(path.join(inputDir, "request.json"), JSON.stringify(request), "utf8");
      const paths = { subjectDir: await realpath(subjectDir), inputDir: await realpath(inputDir), workDir: await realpath(workDir) };
      const name = `testgen-${randomUUID()}`;
      const command = buildSandboxCommand(options, paths, name);
      if (command.warning !== null) (options.warn ?? console.error)(command.warning);
      return await capture(command, request, options, name);
    } finally {
      // Only the exact mkdtemp directory created above is removed, never a caller-computed path.
      await rm(root, { recursive: true, force: true });
    }
  } };
}
