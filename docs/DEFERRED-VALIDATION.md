# Deferred validation

Every check that Dirty Mode construction skipped, why, and exactly how to run it at activation. Nothing listed
here has been executed. Rows are appended per milestone; a row is closed only with a dated outcome/receipt in the
**Outcome** column — never inferred. Order of execution follows `docs/ACTIVATION.md`.

Legend — **Added**: milestone that introduced the row. **Outcome**: `pending` until run.

## Toolchain and static checks

| ID | What | Why deferred | Exact command / steps to validate | Added | Outcome |
|---|---|---|---|---|---|
| DV-01 | Proposed package versions in `package.json` are mutually compatible (Node 20+, TypeScript 5.x JS compiler API, vitest 4 + coverage-v8, Stryker 9 core/vitest-runner/typescript-checker, zod 4, vite 7 + plugin-react 5, ESLint 9 + typescript-eslint 8 + globals, React 19, tsx) | No registry access or install in Dirty Mode; versions are "current as of authoring knowledge" | `npm view <pkg> version peerDependencies` for each; confirm Stryker vitest-runner supports the vitest major; adjust ranges; pin | M1 | pending |
| DV-02 | Lockfile exists and installs reproducibly | A lockfile cannot exist without an install (D6); never fabricated | `npm install`; commit `package-lock.json`; fresh clone → `npm ci` succeeds | M1 | pending |
| DV-03 | All TypeScript type-checks (viewer project and CLI/scripts/tests project) | No `tsc` runs in Dirty Mode | `npx tsc --noEmit -p tsconfig.json` and `npx tsc --noEmit -p tsconfig.cli.json` → zero errors | M1 | pending |
| DV-04 | Lint is clean and the D1/determinism rules fire | No ESLint runs in Dirty Mode | `npm run lint` → zero errors; then temporarily add `import "node:fs"` to `cli/core/schemas.ts` and `Math.random()` to `cli/core/split.ts` and confirm both are reported; revert | M1 | pending |
| DV-05 | Unit/contract tests pass offline with no keys | Tests are authored only (PLAN §2.9) | Unset all keys, disable network; `npx vitest run` → all `tests/**` pass; no test reads `fixtures/subjects/*/hand.test.ts` as a test file | M1 | pending |
| DV-06 | Local Node version | Authoring machine reports a newer Node than the spec floor | Run the full gauntlet (DV-03..05) on Node 20 LTS and on the newest installed Node | M1 | pending |

## M1 core contracts (assumptions made while writing without a compiler)

| ID | What | Why deferred | Exact command / steps to validate | Added | Outcome |
|---|---|---|---|---|---|
| DV-07 | zod 4 API assumptions in `cli/core/schemas.ts`: `z.strictObject`, `z.record(enum, …)` is exhaustive over enum keys, `.refine(fn, { message, path })`, `z.discriminatedUnion` over strict members followed by `.refine/.superRefine`, `.options` on enums, `ctx.addIssue({ code: "custom", … })` | Written against zod 4 docs from memory | DV-03 + `npx vitest run tests/core/schemas.test.ts`; if the installed zod differs, adapt the schema code, not the contract | M1 | pending |
| DV-08 | Schema purity (D1): `schemas.ts` bundles into the viewer with only `zod` | Bundle never built | Test `tests/core/schemas.test.ts` "D1 purity"; at M7 `npm run build` and confirm no `node:` import in the bundle graph | M1 | pending |
| DV-09 | TypeScript compiler API in `cli/core/grammar.ts`: `ts.transpileModule(..., { reportDiagnostics: true })` returns syntactic diagnostics only (file-attached), `moduleDetection: Force` avoids script-file diagnostics, `getStart(sf)` excludes leading comments | API behaviour recalled, not executed | `npx vitest run tests/core/grammar.test.ts`; especially the parse-error, no-imports and leading-comment cases | M1 | pending |
| DV-10 | Byte-faithful unit slicing: slices at node boundaries re-encode to the original UTF-8 bytes (CRLF, non-ASCII preserved) | Never executed | grammar tests "byte-faithful unit slicing"; additionally hash a unit's UTF-8 bytes and compare with the same byte range of the original file read as a Buffer | M1 | pending |
| DV-11 | Mutant key stability across OSes (POSIX `relFile`, lowercase hex, no ordinal) | Never executed; Windows path handling untested | `npx vitest run tests/core/mutantKey.test.ts` on Windows and in the Linux container; keys for the same inventory must be identical | M1 | pending |
| DV-12 | Seeded split determinism across platforms (32-bit integer arithmetic only) | No golden vectors could be computed without running code | After DV-05, record `mulberry32(20261024)` first three outputs and `seededHash32(20261024, "src.ts#line@1")` as golden constants in `tests/core/split.test.ts`; re-run on Windows and Linux | M1 | pending |
| DV-13 | Statement-level location groups | `split.ts` takes the enclosing statement range as input; the AST layer that computes it (`cli/core/ast.ts`) is written in M4. Until then callers fall back to (file, start line) | M4 tests for `ast.ts` statement ranges; inventory run (DV-21) reports group counts per subject | M1 | pending |
| DV-14 | ESLint flat config: `defineConfig` from `eslint/config` (ESLint ≥ 9.22) and `no-restricted-imports` negated patterns allow exactly `cli/core/schemas` from `src/` | Config never loaded | DV-04; at M7 add a probe import of `../cli/core/split.js` in a `src/` file and confirm it is reported | M1 | pending |
| DV-15 | Viewer entry `src/main.tsx` referenced by `index.html` does not exist yet | Viewer is milestone M7 | M7 acceptance; `npm run build` succeeds | M1 | pending |
| DV-16 | Stryker programmatic API shapes used by `scripts/stryker-spike.ts` (`new Stryker(opts).runMutationTest()`, `MutantResult.location/mutatorName/replacement/killedBy/status`, `vitest.configFile` option, `mutate` range selector syntax) | Script written, never run (D9) | `npm run spike:stryker -- --subject clamp-range` after DV-21; fix the script against the installed API if it does not compile | M1 | pending |

## Spec deviations recorded for activation

| ID | What | Why deferred | Exact command / steps to validate | Added | Outcome |
|---|---|---|---|---|---|
| DV-17 | **D10 subject split deviation**: spec says dev/held-out "split by a seeded hash"; edition 1 uses a designed, stratified, trap-matched assignment (`splitMethod: "designed-stratified"`), while `split.ts` keeps `seededSubjectSplit` / `seededPairedSubjectSplit` for later editions | Placement guarantees (≥ 1 trap per split, named dev replay subjects) cannot come from a post-hoc hash, and no hash can be computed in Dirty Mode | Confirm `gold/manifest.json` declares the method and rationale (M2/M3); confirm BOLT-HANDOFF and LIMITATIONS name the deviation (M7); Roy accepts or requests a seeded edition 2 | M1 | pending |
| DV-18 | **D8 Dockerfile deviation**: no Dockerfile/image during construction | Dirty Mode forbids dockerizing | Write it per `docs/ACTIVATION.md`; `docker build`; then DV-20 probes | M1 | pending |
| DV-19 | **D11 staging deviation**: accepted units staged as immutable content-hashed files rather than appended to one generated file | Design decision; behaviour unexecuted | M4 staging tests; mock demo shows byte-identical staged files | M1 | pending |

## Runtime components (from PLAN §7 / [C §6]; owning milestone writes the code)

| ID | What | Why deferred | Exact command / steps to validate | Added | Outcome |
|---|---|---|---|---|---|
| DV-20 | `sandboxrun`: no network, read-only mounts, non-root, memory/pids limits, bounded `/tmp` and `/work` tmpfs, output caps, timeout removes the container, no env keys (incl. Windows Docker Desktop) | Docker not used in Dirty Mode | Probes in the container: outbound network call fails; write to `/subject` fails; fork bomb bounded by pids; `sleep 999` killed and container removed; oversized stdout truncated; `env` shows no key names | M1 | pending |
| DV-21 | Frozen inventories and split | Requires Stryker execution | `npm run cli -- mutants --execute --split all`; every subject has non-empty feedback and scoring partitions or a recorded refusal | M1 | pending |
| DV-22 | Stryker adapter: range-targeted runs produce only feedback keys; batched `perTest` + `disableBail` attribution equals isolated runs | Spike not run (D9) | DV-16; record outcome and chosen engine path in README; on failure use per-unit passes or `patchrun` | M1 | pending |
| DV-23 | Scoring boundary: no scoring outcome reachable from loop-side records during generation | Needs a mock campaign | Inspect every artifact of a mock campaign before suite freeze: no scoring keys or statuses | M1 | pending |
| DV-24 | Campaign journal: resume only unfinished cells under identical hashes | Needs runs | Interrupt a dev campaign; resume; change one hash and confirm refusal | M1 | pending |
| DV-25 | In-house fallback mutator gives compile-valid mutants within runtime limits | Needs execution | Run on two dev subjects | M1 | pending |
| DV-26 | Traps and canaries: `original` text matches; equivalents survive; `infinite-loop` ends as Timeout; hand suite kills the canary | Needs `patchrun` execution | `patchrun` over all traps and canaries of all 24 subjects | M1 | pending |
| DV-27 | Twins pass contract-specified hand tests; quirk twin fails the quirk test | Needs execution | Run each hand suite against its `twin.ts` | M1 | pending |
| DV-28 | Replay fixtures: prompt hashes pending | Prompt hashes need the built prompt at runtime | `npm run replay:check` computes once, then verifies (drift = exit 4) | M1 | pending |
| DV-29 | A1 characterisation grid covers the supported types | Needs execution | Run A1 on dev subjects; inspect units and the unsupported-signature list | M1 | pending |
| DV-30 | A4 per-unit v8 coverage deltas are stable | Needs execution | Run A4 twice on one dev subject; compare | M1 | pending |
| DV-31 | Provider request/response shapes are current | No network in Dirty Mode | One call per provider under a tiny cap | M1 | pending |
| DV-32 | Price table correct and dated | Prices unknown in Dirty Mode (`null` ⇒ blocks live calls) | Check provider pricing at activation; pin before freeze | M1 | pending |
| DV-33 | Budget sufficiency ($1 dev / $5 held-out proposals; 360 planned held-out calls) | Prices unknown | Dry-run estimate; adjust rounds on dev only, equally across A4–A6 | M1 | pending |
| DV-34 | Held-out lock refuses a second campaign | Needs runs | Attempt a second campaign; it must refuse (exit 2) | M1 | pending |
| DV-35 | Viewer builds and renders sample/real runs, empty state, rulings export/import | Viewer is M7; no build in Dirty Mode | `npm run build`, `npm run preview`, DOM tests | M1 | pending |
| DV-36 | Bolt import builds at the repo root | Owner action after GitHub import | Inspect-and-prepare prompt in `BOLT-HANDOFF.md` | M1 | pending |
