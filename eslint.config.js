// ESLint flat config (ESLint 9 + typescript-eslint 8). Not yet run (DEFERRED-VALIDATION: lint).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig(
  {
    // Subject fixtures and hand suites are content, not repository code; candidate/approved tests are
    // generated artifacts. None of them are linted as part of the product.
    ignores: ["dist/**", "node_modules/**", "fixtures/**", "approved/**", "results/**", "public/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["cli/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "*.config.ts", "*.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // D1: the viewer may import only cli/core/schemas.ts from cli/, and never a node: builtin.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/cli/**", "!**/cli/core/schemas", "!**/cli/core/schemas.js", "!**/cli/core/schemas.ts"],
              message: "D1: the viewer may import only cli/core/schemas.ts from cli/.",
            },
            { group: ["node:*"], message: "D1: no Node builtins in the browser bundle." },
          ],
        },
      ],
      // Candidate code is rendered as escaped text only (PLAN M7).
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Render code as escaped text; never inject HTML.",
        },
        { selector: "CallExpression[callee.name='eval']", message: "No eval in the viewer." },
      ],
    },
  },
  {
    // D1 purity: schemas.ts imports only zod.
    files: ["cli/core/schemas.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*", "./*", "../*", "!zod"],
              message: "D1: cli/core/schemas.ts may import only 'zod' (it is bundled into the viewer).",
            },
          ],
        },
      ],
    },
  },
  {
    // Determinism: core logic uses the seeded PRNG in cli/core/prng.ts, never Math.random.
    files: ["cli/core/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded PRNG in cli/core/prng.ts." },
      ],
    },
  },
);
