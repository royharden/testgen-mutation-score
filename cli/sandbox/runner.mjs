/** Trusted container entrypoint. Source only in Dirty Mode. Image installs this under /opt/testgen.
 * Vitest's programmatic API and state shape are activation assumptions, not measured evidence.
 * The host alone validates the final result schema; raw diagnostics never leave this runner as records.
 */
import { readFile, writeFile, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const originalWrite = process.stdout.write.bind(process.stdout);
// Console/reporter output is confined to capped stderr; stdout carries one JSON document only.
process.stdout.write = (...args) => process.stderr.write(...args);
const requestPath = process.argv[2];
const work = process.argv[3];
if (!requestPath || !work || !path.isAbsolute(requestPath) || !path.isAbsolute(work)) process.exit(2);
const started = Date.now();
const request = JSON.parse(await readFile(requestPath, "utf8"));
await mkdir(work, { recursive: true });
await writeFile(path.join(work, "src.ts"), request.sourceText, "utf8");
await writeFile(path.join(work, "package.json"), '{"type":"module","private":true}\n');
// Resolve Vitest and test imports from the image's installed package root, never from model input.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await symlink(path.join(packageRoot, "node_modules"), path.join(work, "node_modules"), "junction");
const files = [];
const hashOfFile = new Map();
for (const unit of request.units) {
  if (!/^[0-9a-f]{64}$/.test(unit.unitSha256)) process.exit(2);
  const file = path.join(work, `u-${unit.unitSha256}.test.ts`);
  files.push(file);
  hashOfFile.set(file, unit.unitSha256);
  await writeFile(file, unit.text, "utf8");
}
let result;
let context;
try {
  const { startVitest } = await import("vitest/node");
  context = await startVitest("test", files, {
    root: work, config: false, watch: false, run: true, globals: false, environment: "node",
    include: files.map((file) => path.basename(file)), passWithNoTests: files.length === 0,
    reporters: [{ onUserConsoleLog() { return false; } }], maxWorkers: 1, fileParallelism: false,
    testTimeout: 25000, hookTimeout: 25000, bail: 0,
    ...(request.shuffleSeed === undefined ? {} : { sequence: { shuffle: true, seed: request.shuffleSeed } }),
    coverage: { enabled: request.target.kind === "coverage", provider: "v8", reporter: ["json"],
      reportsDirectory: path.join(work, "coverage"), include: ["src.ts"] },
  });
  if (!context) throw new Error("runner-unavailable");
  const tests = [];
  const collect = (task, file) => {
    if (Array.isArray(task.tasks)) for (const child of task.tasks) collect(child, file);
    else if (task.type === "test") {
      const errors = task.result?.errors ?? [];
      const cause = errors.length === 0 ? null : errors.every((error) => error.name === "AssertionError") ? "assertion"
        : errors.some((error) => String(error.stack ?? error.stackStr ?? "").includes(`${work}/src.ts`)) ? "thrown" : "runner-crash";
      tests.push({ name: task.name, unitSha256: hashOfFile.get(path.resolve(file.filepath)) ?? null,
        status: task.result?.state === "pass" ? "passed" : task.result?.state === "fail" ? "failed" : "skipped", cause });
    }
  };
  const reported = context.state.getFiles();
  for (const file of reported) collect(file, file);
  const unhandled = context.state.getUnhandledErrors();
  const moduleError = reported.some((file) => (file.result?.errors?.length ?? 0) > 0);
  const crashed = unhandled.length > 0 || moduleError || tests.some((t) => t.cause === "runner-crash");
  const failed = tests.filter((t) => t.status === "failed");
  const outcome = crashed ? "error" : failed.length > 0 ? "failed" : tests.some((t) => t.status !== "passed") ? "error" : "passed";
  result = { ...request.target, unitSha256s: request.units.map((u) => u.unitSha256), outcome,
    durationMs: Date.now() - started, shuffleSeed: request.shuffleSeed ?? null, tests, outputTruncated: false };
  if ("mutantKey" in request.target || request.target.kind === "planted") {
    result.mutantStatus = outcome === "error" ? "RuntimeError" : outcome === "failed" ? "Killed" : "Survived";
    result.killCause = outcome === "failed" ? failed.some((t) => t.cause === "assertion") ? "assertion" : "thrown" : null;
  }
  if (request.target.kind === "coverage") {
    const coverage = JSON.parse(await readFile(path.join(work, "coverage/coverage-final.json"), "utf8"));
    const subject = Object.entries(coverage).find(([file]) => path.resolve(file) === path.join(work, "src.ts"))?.[1];
    if (!subject) throw new Error("coverage-missing");
    const lines = new Set();
    for (const [id, count] of Object.entries(subject.s ?? {})) if (Number(count) > 0) {
      const location = subject.statementMap[id];
      for (let line = location.start.line; line <= location.end.line; line++) lines.add(line);
    }
    result.coveredLines = [...lines].sort((a, b) => a - b);
  }
} catch {
  // Fail closed. A module compile error, reporter failure, storage exhaustion, or API mismatch cannot kill.
  result = { ...request.target, unitSha256s: request.units.map((u) => u.unitSha256), outcome: "error",
    durationMs: Date.now() - started, shuffleSeed: request.shuffleSeed ?? null, tests: [], outputTruncated: false,
    ...(request.target.kind === "coverage" ? { coveredLines: [] } : {}),
    ...("mutantKey" in request.target || request.target.kind === "planted" ? { mutantStatus: "RuntimeError", killCause: null } : {}) };
} finally {
  await context?.close();
}
originalWrite(`${JSON.stringify(result)}\n`);
// startVitest may set exitCode for a failed candidate; that failure is represented in the JSON instead.
process.exitCode = 0;
