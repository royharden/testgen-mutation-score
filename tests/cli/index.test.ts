import { expect, it } from "vitest";
import { parseArgs, runCli } from "../../cli/index.js";
import { fileURLToPath } from "node:url";

it("rejects incompatible execution and campaign flags before construction", () => {
  for (const flags of [
    ["run", "--execute", "--live"], ["run", "--execute", "--provider", "anthropic"],
    ["run", "--live", "--provider", "mock"], ["run", "--live", "--provider", "anthropic", "--sandbox", "none"],
    ["run", "--sandbox", "none"], ["run", "--split", "all"], ["run", "--execute", "--split", "heldout"],
    ["run", "--resume", "campaign"], ["run", "--write"], ["run", "--write-hashes"], ["run", "--repeats", "0"],
    ["run", "--unknown"], ["run", "--provider", "mock", "--provider", "mock"],
  ]) expect(() => parseArgs(flags)).toThrow();
  expect(parseArgs([])).toMatchObject({ command: "run", mode: "dry-run", provider: "mock", repeats: 3 });
  expect(parseArgs(["mutants", "--execute"])).toMatchObject({ command: "mutants", split: "all" });
  expect(parseArgs(["apply", "first.jsonl", "--rulings", "second.jsonl", "third.jsonl"]).rulings)
    .toEqual(["first.jsonl", "second.jsonl", "third.jsonl"]);
});

it("M6 dispatch has a concrete apply default and retains explicit handler overrides", async () => {
  const out: string[] = [];
  expect(await runCli(["apply"], { stdout: (line) => out.push(line), stderr: (line) => out.push(line) })).toBe(2);
  expect(out.join("\n")).toContain("requires --rulings");
  expect(await runCli(["apply", "rulings.jsonl", "--write"], { root: "C:/review-root", extensions: {
    apply: async (context) => { expect(context.args.write).toBe(true); expect(context.args.positional).toEqual(["rulings.jsonl"]); expect(context.repoRoot).toBe("C:/review-root"); return 0; },
  } })).toBe(0);
  expect(await runCli(["eval"], { extensions: { eval: async (context) => {
    expect(context.args.command).toBe("eval"); return 0;
  } } })).toBe(0);
});

it("default dry run reads all 24 subjects without constructing a provider or executor", async () => {
  const lines: string[] = [];
  // Runtime construction would fail here: replay hashes, manifest hashes and image are pending.
  const code = await runCli([], { root: fileURLToPath(new URL("../../", import.meta.url)), stdout: (line) => lines.push(line), stderr: (line) => lines.push(line) });
  expect(code).toBe(0); expect(lines.filter((line) => /\[(dev|heldout)\]/.test(line))).toHaveLength(24);
  expect(lines.join("\n")).toContain("360 planned model calls");
  expect(lines.join("\n")).toMatch(/not inventoried|feedback \/ .* scoring/);
});
