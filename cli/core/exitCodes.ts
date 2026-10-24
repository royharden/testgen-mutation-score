/**
 * Process exit codes and run statuses (PLAN §2.5, [C §2.9]). Neither 3 nor 5 is success.
 * The enum values themselves live in schemas.ts (single source of truth, also used by the viewer);
 * this module gives them names and helpers for the CLI.
 */
import { EXIT_CODE_VALUES, RUN_STATUSES, STATUS_EXIT_CODES } from "./schemas.js";
import type { ExitCodeValue, RunStatus } from "./schemas.js";

export const EXIT_CODES = {
  /** Complete run, or a dry run. */
  OK: 0,
  /** Refused before any work: bad flags, preflight/canary failure, missing Docker/key/budget, split refusal. */
  REFUSED: 2,
  /** Fatal invalid run or protocol abort: sandbox crash, add-only guard, scoring-boundary violation. Results unusable. */
  FATAL: 3,
  /** Replay miss or schema violation. Never falls back to another candidate or a live call. */
  REPLAY_MISS_OR_SCHEMA: 4,
  /** Incomplete but retained: budget exhausted or cells with run errors (`status: partial-*`). */
  INCOMPLETE: 5,
} as const satisfies Record<string, ExitCodeValue>;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export { EXIT_CODE_VALUES, RUN_STATUSES, STATUS_EXIT_CODES };
export type { RunStatus, ExitCodeValue };

/** Named statuses, for call sites that should not spell string literals. */
export const RUN_STATUS = {
  COMPLETE: "complete",
  PARTIAL_BUDGET: "partial-budget",
  PARTIAL_ERROR: "partial-error",
  REFUSED: "refused",
} as const satisfies Record<string, RunStatus>;

const DESCRIPTIONS: Readonly<Record<ExitCode, string>> = {
  0: "complete (or dry run)",
  2: "refused before work",
  3: "fatal: invalid run or protocol abort; results unusable",
  4: "replay miss or schema violation",
  5: "incomplete but retained (partial-budget or partial-error)",
};

export function describeExitCode(code: ExitCode): string {
  return DESCRIPTIONS[code];
}

export function isSuccess(code: ExitCode): boolean {
  return code === EXIT_CODES.OK;
}

/** Whether a recorded run status may be reported with this exit code (mirrors RunRecordSchema's check). */
export function isExitCodeAllowedForStatus(status: RunStatus, code: ExitCode): boolean {
  return STATUS_EXIT_CODES[status].includes(code);
}

/** Default exit code for a status when no more specific cause applies. */
export function defaultExitCodeForStatus(status: RunStatus): ExitCode {
  switch (status) {
    case "complete":
      return EXIT_CODES.OK;
    case "refused":
      return EXIT_CODES.REFUSED;
    case "partial-budget":
    case "partial-error":
      return EXIT_CODES.INCOMPLETE;
  }
}
