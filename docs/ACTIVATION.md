# Activation

Everything in this repository was written in Dirty Mode: static construction only, nothing installed, built or
run. Activation starts only after Roy closes Dirty Mode. Do the steps in order; each one records its outcome in
`docs/DEFERRED-VALIDATION.md` (and README where noted). A failed step stops the sequence until it is fixed.

## Sequence (PLAN §6)

1. **Reconcile versions.** Check every proposed version in `package.json` against the registry and against each
   other: Node 20+, `typescript` (the compiler API used by `cli/core/grammar.ts` must be the JavaScript
   compiler, 5.x line), `vitest` + `@vitest/coverage-v8` (same version), `@stryker-mutator/core` +
   `@stryker-mutator/vitest-runner` + `@stryker-mutator/typescript-checker` (same version, and a runner release
   that supports the chosen vitest major), `zod` (4.x API is assumed by `cli/core/schemas.ts`), `vite` +
   `@vitejs/plugin-react`, `eslint` + `@eslint/js` + `typescript-eslint` + `globals`, `react`/`react-dom` +
   `@types/*`, `tsx`, `fast-check`. Adjust ranges, then pin.
2. **`npm install`**, then **commit `package-lock.json`**. Confirm `npm ci` works from a clean checkout.
3. **Static checks:** `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p tsconfig.cli.json`, `npm run lint`.
4. **Offline tests:** `npx vitest run` with no network and no keys in the environment.
5. **Write and build the Dockerfile** (recipe below), then `docker build -t testgen-sandbox:<pinned-tag> .`.
6. **Sandbox probes** (see DEFERRED-VALIDATION "sandboxrun").
7. **Compute subject hashes** into `gold/manifest.json` (replace `"pending"`).
8. **Inventory:** `npm run cli -- mutants --execute --split all` → `results/mutants/<id>.json` (frozen).
9. **Stryker spike:** `npm run spike:stryker -- --subject clamp-range` (and one more dev subject); record the
   result and the chosen engine path in README "Stryker spike".
10. **`npm run replay:check`** — computes the replay prompt hashes once, then verifies them on every later run.
11. **Mock end-to-end demo** (README journey) with `--provider mock`.
12. **Tiny-cap provider smoke:** one call per real provider under a cents-level cap; pin prices in
    `cli/ledger/prices.json` and the model in `TESTGEN_MODEL`.
13. **Dev live runs;** fix the round cap on dev only, equally across A4–A6.
14. **Freeze** manifest, model and prices (D13: any later subject/hand/twin change is a new edition).
15. **Held-out campaign** (`--split heldout --heldout-confirm`, three repeats as one campaign).
16. **`npm run eval`**, then generate `docs/LIMITATIONS.md` sections.
17. **Viewer from real run JSON** (`public/runs/`), `npm run build`, preview.
18. **Bolt inspect-and-prepare import** (owner action) using the prompt in `BOLT-HANDOFF.md`.

## Dockerfile recipe (prose only — D8: no Dockerfile is written during construction)

Write `Dockerfile` at the repository root at activation step 5:

- **Base:** an official Node slim image of the reconciled Node major (20 or later), pinned by digest.
- **Build stage (network allowed):** copy `package.json` and `package-lock.json`, run `npm ci`, copy only what the
  in-container runner needs (vitest, Stryker and their plugins, the trusted runner/reporter config and the
  entrypoint). Never copy `.env`, keys or `results/`.
- **Runtime user:** create an unprivileged user and switch to it (`USER`); the image must run with
  `--user <uid>` without needing root.
- **Filesystem:** the image expects to run with `--read-only`; writable storage is only the bounded tmpfs mounts
  `/tmp` and `/work`. The entrypoint copies `/subject` (subject files, read-only) and `/in` (candidate units and
  trusted config, read-only) into `/work`, runs vitest or Stryker there, and prints **one** bounded JSON result
  document to stdout. Storage exhaustion is reported as an error result, never as a kill.
- **No network at runtime:** the host always runs the container with `--network none`.
- **Environment:** the image sets no secrets; the host passes an empty environment (explicit allowlist only).
- **Intended host argv** (built by `cli/sandbox/sandboxrun.ts`, milestone M4):
  `docker run --rm --network none --user <uid> --read-only --tmpfs /tmp:size=64m --tmpfs /work:size=128m
  --memory 1g --cpus 1 --pids-limit 128 -v <subjectDir>:/subject:ro -v <inputDir>:/in:ro -w /work
  <pinned image> <cmd>`, with a host wall-clock timeout that removes the container, a ~1 MB stdout/stderr cap,
  no Docker socket mount and no `-e` for any key name. Windows hosts pass absolute paths via `path.resolve`.

## Stryker spike notes

`scripts/stryker-spike.ts` checks (1) that range-targeted runs produce only frozen feedback keys, (2) whether a
batched `coverageAnalysis: "perTest"` + `disableBail: true` run attributes kills identically to isolated per-unit
runs, and (3) the position base of Stryker API locations. Until it passes, the generation path uses one
Stryker pass per surviving unit (or `patchrun` with exact feedback patches) and aborts on any foreign key.
