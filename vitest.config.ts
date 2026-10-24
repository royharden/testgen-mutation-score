import { defineConfig } from "vitest/config";

// Repository unit/contract tests only. Subject hand suites (fixtures/subjects/*/hand.test.ts), staged
// candidate units and approved/ tests are NEVER run by this config: generated or subject test code only
// ever executes through cli/sandbox/sandboxrun.ts (PLAN §2.6).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["fixtures/**", "approved/**", "results/**", "node_modules/**", "dist/**"],
    environment: "node",
    // Tests must pass offline with no keys (DEFERRED-VALIDATION: unit/contract tests).
    passWithNoTests: false,
  },
});
