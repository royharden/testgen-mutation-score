/** Exact one-patch execution fallback, shared with planted traps; no fuzzy search or host test execution. */
import type { ExecutionResult, TestUnit, Trap } from "../core/schemas.js";
import { EngineExecutionError, executeExactPatch } from "./engine.js";
import type { IsolatedRunner } from "./engine.js";
export { applyExactPatch, executeExactPatch, sourceOffset, sourceSlice } from "./engine.js";

/** Trusted preflight/scorer helper. Canary never enters a generated inventory or partition. */
export function executePlanted(runner: IsolatedRunner, sourceText: string, units: readonly TestUnit[], trap: Trap): Promise<ExecutionResult> {
  if (trap.file !== "src.ts") throw new EngineExecutionError("report-parse", "planted patch is not subject-relative");
  return executeExactPatch(runner, { sourceText, range: trap.range, original: trap.original, replacement: trap.replacement,
    units, target: { kind: "planted", trapId: trap.id } });
}
