/** Pure argv/mode tests. No child process, Docker, Vitest programmatic runner or candidate is executed. */
import { describe, expect, it } from "vitest";
import { assertSandboxMode, buildSandboxCommand, createSandboxRunner, hostProcessEnv, timeoutResult } from "../../cli/sandbox/sandboxrun.js";
import type { SandboxOptions } from "../../cli/sandbox/sandboxrun.js";

const options: SandboxOptions = { mode: "execute", provider: "mock", sandbox: "docker", dockerAvailable: true,
  image: `testgen-local@sha256:${"a".repeat(64)}` };
const paths = { subjectDir: "C:/testgen subject", inputDir: "C:/testgen inputs", workDir: "C:/testgen work" };
describe("sandbox source protocol", () => {
  it("builds an unprivileged network-free read-only bounded Docker command", () => {
    const cmd = buildSandboxCommand(options, paths, "testgen-sample");
    expect(cmd.argv).toEqual(expect.arrayContaining(["--network", "none", "--user", "10001:10001", "--read-only", "--memory", "1g", "--cpus", "1", "--pids-limit", "128"]));
    expect(cmd.argv.filter((arg) => arg.includes("destination=")).every((arg) => arg.endsWith(",readonly"))).toBe(true);
    expect(cmd.argv).toContain("/tmp:rw,noexec,nosuid,size=64m,mode=1777");
    expect(cmd.argv).toContain("/work:rw,nosuid,size=128m,mode=1777");
    expect(cmd.argv).toContain("/opt/testgen/cli/sandbox/runner.mjs");
    expect(cmd.argv).not.toContain("-e"); expect(cmd.argv).not.toContain("--env-file");
    expect(cmd.argv.join(" ")).not.toMatch(/docker\.sock|docker_engine|API_KEY/);
    expect(cmd.qualified).toBe(true);
  });
  it("forwards no credentials or transport injection variables", () => {
    expect(hostProcessEnv({ PATH: "runtime-path", ANTHROPIC_API_KEY: "not-forwarded", OPENAI_COMPATIBLE_API_KEY: "not-forwarded", NODE_OPTIONS: "not-forwarded", DOCKER_HOST: "not-forwarded", HTTP_PROXY: "not-forwarded" }))
      .toEqual({ PATH: "runtime-path" });
  });
  it("refuses live without Docker and all implicit local fallback", () => {
    expect(() => assertSandboxMode({ ...options, mode: "live", provider: "anthropic", dockerAvailable: false })).toThrow();
    expect(() => assertSandboxMode({ ...options, mode: "live", provider: "anthropic", sandbox: "none" })).toThrow();
    expect(() => assertSandboxMode({ ...options, provider: "anthropic" })).toThrow();
    expect(() => assertSandboxMode({ ...options, sandbox: "none" })).toThrow();
    expect(() => buildSandboxCommand({ ...options, image: "latest" }, paths, "testgen-sample")).toThrow();
  });
  it("marks explicit local mock execution as warned and disqualified", () => {
    const local: SandboxOptions = { ...options, sandbox: "none", dockerAvailable: false, localRunnerFile: "C:/trusted/runner.mjs" };
    expect(buildSandboxCommand(local, paths, "testgen-sample")).toMatchObject({ qualified: false, warning: expect.stringContaining("sandbox-unqualified") });
    expect(createSandboxRunner(local).qualified).toBe(false);
  });
  it("refuses socket mounts and mount option injection", () => {
    expect(() => buildSandboxCommand(options, { ...paths, inputDir: "C:/docker.sock" }, "testgen-sample")).toThrow();
    expect(() => buildSandboxCommand(options, { ...paths, inputDir: "C:/input,volume-opt=evil" }, "testgen-sample")).toThrow();
  });
  it("keeps coverage host timeouts schema-valid and never represents a timeout as a kill", () => {
    expect(timeoutResult({ sourceText: "", units: [], target: { kind: "coverage" } }, 30, false))
      .toMatchObject({ kind: "coverage", outcome: "timeout", coveredLines: [] });
    expect(timeoutResult({ sourceText: "", units: [], target: { kind: "feedback-mutant", mutantKey: "a".repeat(64) } }, 30, false))
      .toMatchObject({ outcome: "timeout", mutantStatus: "Timeout", killCause: null });
  });
});
