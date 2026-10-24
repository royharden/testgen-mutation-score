/** Trusted container entrypoint. Source only in Dirty Mode. Image installs this under /opt/testgen.
 * Vitest's programmatic API and state shape are activation assumptions, not measured evidence.
 * The host alone validates the final result schema; raw diagnostics never leave this runner as records.
 */
import { readFile, writeFile, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

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
  if (request.target.kind === "a1-capture") {
    // Trusted capture code only. The imported subject executes exclusively inside this sandbox.
    const ts = await import("typescript");
    const compiled = ts.default.transpileModule(request.sourceText, { compilerOptions: {
      target: ts.default.ScriptTarget.ES2022, module: ts.default.ModuleKind.ES2022,
    }, reportDiagnostics: true });
    if (compiled.diagnostics?.some((d) => d.category === ts.default.DiagnosticCategory.Error)) throw new Error("capture-compile");
    const moduleFile = path.join(work, "a1-source.mjs");
    await writeFile(moduleFile, compiled.outputText, "utf8");
    const subject = await import(pathToFileURL(moduleFile).href);
    const encode = (value) => {
      const active = new Set();
      const visit = (item, depth) => {
        if (depth > 8) throw new Error("capture-depth");
        if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
        if (typeof item === "number" && Number.isFinite(item) && !Object.is(item, -0)) return String(item);
        if (typeof item !== "object" || active.has(item)) throw new Error("capture-value");
        const proto = Object.getPrototypeOf(item);
        if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) throw new Error("capture-prototype");
        if (Reflect.ownKeys(item).some((key) => typeof key !== "string")) throw new Error("capture-symbol");
        active.add(item);
        let encoded;
        if (Array.isArray(item)) {
          if (item.length > 32 || Object.keys(item).length !== item.length) throw new Error("capture-array");
          const children = [];
          if (Reflect.ownKeys(item).length !== item.length + 1) throw new Error("capture-array-keys");
          for (let index = 0; index < item.length; index++) {
            const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
            if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new Error("capture-array-accessor");
            children.push(visit(descriptor.value, depth + 1));
          }
          encoded = `[${children.join(",")}]`;
        } else {
          if (Object.keys(item).length > 32) throw new Error("capture-object");
          const children = [];
          for (const key of Reflect.ownKeys(item)) {
            const d = Object.getOwnPropertyDescriptor(item, key);
            if (!d || !Object.hasOwn(d, "value") || !d.enumerable) throw new Error("capture-accessor");
            children.push(`${JSON.stringify(key)}:${visit(d.value, depth + 1)}`);
          }
          encoded = `{${children.join(",")}}`;
        }
        active.delete(item);
        return encoded;
      };
      // Encode data descriptors manually: a captured object's toJSON is never invoked.
      const encoded = visit(value, 0);
      if (Buffer.byteLength(encoded, "utf8") > 16384) throw new Error("capture-size");
      return encoded;
    };
    const observations = [];
    if (!Array.isArray(request.probes) || request.probes.length > 64) throw new Error("capture-probes");
    for (const probe of request.probes) {
      const base = { probeId: probe.id, valueJson: null, errorName: null, message: null };
      try {
        if (!Object.hasOwn(subject, probe.exportName) || typeof subject[probe.exportName] !== "function") throw new Error("capture-export");
        const args = JSON.parse(probe.argsJson);
        if (!Array.isArray(args)) throw new Error("capture-arguments");
        encode(args);
        let returned;
        try { returned = Reflect.apply(subject[probe.exportName], undefined, args); }
        catch (error) {
          if (!(error instanceof Error) || error.message.length > 1000 || error.name.length > 200) {
            observations.push({ ...base, outcome: "unsupported", message: "non-Error or oversized throw" }); continue;
          }
          observations.push({ ...base, outcome: "throw", errorName: error.name, message: error.message }); continue;
        }
        observations.push({ ...base, outcome: "return", valueJson: encode(returned) });
      } catch { observations.push({ ...base, outcome: "unsupported", message: "unsupported capture value or export" }); }
    }
    result = { kind: "a1-capture", observations, unitSha256s: [], outcome: "passed", durationMs: Date.now() - started,
      shuffleSeed: null, tests: [], outputTruncated: false };
  } else {
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
  }
} catch {
  // Fail closed. A module compile error, reporter failure, storage exhaustion, or API mismatch cannot kill.
  result = { ...request.target, unitSha256s: request.units.map((u) => u.unitSha256), outcome: "error",
    durationMs: Date.now() - started, shuffleSeed: request.shuffleSeed ?? null, tests: [], outputTruncated: false,
    ...(request.target.kind === "coverage" ? { coveredLines: [] } : {}),
    ...(request.target.kind === "a1-capture" ? { observations: (request.probes ?? []).map((p) => ({ probeId: p.id,
      outcome: "unsupported", valueJson: null, errorName: null, message: "capture runner failed" })) } : {}),
    ...("mutantKey" in request.target || request.target.kind === "planted" ? { mutantStatus: "RuntimeError", killCause: null } : {}) };
} finally {
  await context?.close();
}
originalWrite(`${JSON.stringify(result)}\n`);
// startVitest may set exitCode for a failed candidate; that failure is represented in the JSON instead.
process.exitCode = 0;
