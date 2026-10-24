# testgen-mutation-score

Test generation where a model-written test is **kept only if it kills a not-yet-killed mutant** of the code
under test, measured on a **disjoint** set of mutants the loop never sees. On held-out TypeScript modules the
kill-gated loop (A5) is compared with an empty suite (A0), a no-model characterisation generator (A1), a
hand-written suite proxy (A2), the same model ungated (A3), the same model with a coverage gate (A4), and hand
suite + A5 top-up (A6). The table reports mutation score (raw, killed-only, without labelled equivalents), planted
trap outcomes, overfit rate against a contract-compatible twin, tokens, USD and score gained per dollar. With 12
held-out subjects this is a bounded exploratory comparison; a negative result is a valid result.

## Status — read this first

**Skeleton. Nothing has been installed, built, type-checked, linted, tested or run.** This repository was
written in Dirty Mode (static construction only). There is no `node_modules`, no lockfile, no Docker image, no
inventory, no run record and no measurement. Every test file was authored but never executed. Package versions in
`package.json` are proposals to be reconciled at activation. See
[`docs/DEFERRED-VALIDATION.md`](docs/DEFERRED-VALIDATION.md) for every skipped check and how to run it, and
[`docs/ACTIVATION.md`](docs/ACTIVATION.md) for the activation sequence.

Status vocabulary: *specification only* → *accepted for Dirty Mode construction — runtime unverified* → MVP
runtime acceptance only after activation.

This README is finished in milestone M7.

## What exists so far (milestone M1 — scaffold and core contracts)

| Path | Purpose |
|---|---|
| `cli/core/schemas.ts` | zod contracts for every persisted record (imports only `zod`; the viewer may import it) |
| `cli/core/mutantKey.ts` | location-keyed mutant identity: sha256 of `relFile\|srcSha256\|range\|mutator\|replacement` (CLI-only, uses `node:crypto`) |
| `cli/core/split.ts` | location-grouped, trap-reserved, deduplicated seeded mutant split; seeded subject split for future editions |
| `cli/core/grammar.ts` | strict candidate grammar and byte-faithful unit slicing (TypeScript compiler API) |
| `cli/core/exitCodes.ts` | exit codes 0/2/3/4/5 and run statuses |
| `cli/core/prng.ts` | mulberry32 and a seeded 32-bit hash |
| `scripts/stryker-spike.ts` | activation spike for Stryker key containment and kill attribution (written, never run) |
| `tests/core/*.test.ts` | authored unit/contract tests (never run) |

## Planned commands (none has been run)

| Command | What it will do |
|---|---|
| `npm run cli -- run` | dry run: subjects, split, inventory counts, planned calls and worst-case cost; executes nothing |
| `npm run cli -- run --execute --provider mock --split dev --subjects clamp-range` | replayed candidates through the sandbox |
| `npm run cli -- mutants --execute --split all` | frozen mutant inventories (activation) |
| `npm run cli -- apply --rulings <file>` | dry-run patch of approved tests; `--write` writes new files only |
| `npm run eval` | results table (`results/mock/` with a MOCK banner for mock runs) |
| `npm run replay:check` | computes/verifies replay prompt hashes (activation) |
| `npm run spike:stryker` | the Stryker spike |
| `npm run dev` / `npm run build` | the static viewer (entry written in M7) |
| `npm test`, `npm run lint`, `npm run typecheck` | offline checks |

## Stryker spike

_Not yet run._ Record here: date, versions, subject, CHECK 1 (key containment), CHECK 2 (batched vs isolated
attribution), CHECK 3 (position base), and the engine path chosen for generation and scoring.

## Budget proposal

Dev cap proposal $1, held-out cap proposal $5 (PLAN C5). Values are set locally via `TESTGEN_DEV_BUDGET_USD` and
`TESTGEN_BUDGET_USD`; `.env.example` holds names only.

## License

MIT — see [`LICENSE`](LICENSE).
