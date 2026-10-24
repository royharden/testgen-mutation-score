# Architecture

Source construction only; all runtime behavior described here is intended and unverified. No dependencies,
compiler, lint, tests, build, provider, sandbox or campaign have run. See [ACTIVATION.md](ACTIVATION.md).

## One package, explicit browser boundary

The repository root is one npm package: `cli/index.ts` is the Node CLI and `src/main.tsx` is the static Vite/React
viewer. `cli/core/schemas.ts` is the canonical persisted/public contract module, importing only `zod`.
The viewer may import only that pure Node-free module from `cli/`; it must not import engines, providers,
ledger, arms, sandbox or `mutantKey.ts` (which uses `node:crypto`). Browser data is schema-validated on load.

There is no database, edge function, auth service, queue or remote worker. JSON/JSONL artifacts are local
persistence. Only sanitized projections and fictional samples belong in `public/`. Bolt hosts the static viewer;
local execution remains separate.

## Producer → consumer paths

| Producer | Canonical artifact / interface | Consumer |
|---|---|---|
| Authored fixtures + `core/inventory.ts` | `gold/manifest.json`; four per-subject file hashes and freeze date | Preflight, run controller, campaign lock, scorer and apply |
| `engines/inhouse.ts` or ingested Stryker reports | `results/mutants/<subject-id>.json`; `MutantInventorySchema` | Feedback executor and separate post-freeze scorer |
| `core/grammar.ts` + `core/ast.ts` | Exact UTF-8 import-plus-one-test units, strict grammar and hygiene checks | `core/gate.ts` and immutable staging |
| `providers/` + `core/prompt.ts` | Full-hash replay or validated model output; feedback-only prompt inputs | `arms/runner.ts` |
| `ledger/callledger.ts` | `results/<split>-<campaign-id-or-dev>.ledger.jsonl`; durable per-attempt reservation/terminal events | Budgeted provider and identity-matched evaluator accounting |
| `core/gate.ts` + `core/staging.ts` | `staged/<subject-id>/<round-hash>/<unit-hash>.test.ts` | Frozen suite records and approval/apply |
| `arms/runner.ts` | `<mode-root>/frozen/<run-id>/<subject>-<arm>-<repeat>.json` | Post-freeze scoring; immutable suite/subject/inventory references |
| `arms/runner.ts` | `<mode-root>/loops/…`, `/cells/…`, `/scoring/…`, `/runs/<run-id>.json` | Artifact-only evaluation and local apply |
| `evalkit/command.ts` | `public/analysis/<run-id>.json`; `PublicAnalysisSchema` | Static subject map/results/approvals alongside public RunRecord |
| Run publisher | `public/runs/index.json` and `public/runs/<run-id>.json`; `RunIndexSchema`/`RunRecordSchema` | Viewer loader; analysis companion may be absent |
| Viewer approval log | Browser localStorage and whole-log JSONL; `RulingSchema` | `rulings/rulings.ts` → `apply/apply.ts` |

`<mode-root>` is `results/mock` for replay and `results/measured` for live execution. The frozen, loop, terminal
cell and scoring companions use the same run/cell names. Resume may retain a cell's original run identity;
the campaign journal resolves that lineage. A public record alone is not a private execution/apply receipt.

## Generation and scoring boundary

`core/split.ts` deduplicates exact patches, groups locations by enclosing statement (line fallback), reserves
trap-overlapping groups to scoring, and seeded-splits remaining groups. Empty partitions refuse preflight.
Subject assignment is independently designed-stratified in edition 1; see [LIMITATIONS.md](LIMITATIONS.md).

`core/preflight.ts` checks the hand suite, disposable canary and nonempty partitions before model calls.
`engines/engine.ts` exposes a feedback-only executor to the generation loop. Prompts exclude scoring mutants,
traps and twins; A3–A5 also exclude the hand suite. A6 includes its kept hand baseline. Foreign feedback keys
abort the protocol. Gate admission counts attributable `Killed` outcomes, never timeout, compile error or crash.

A round uses pristine reruns, unit admission, then shuffled union pristine validation. Failed union validation
rolls back the round as a RunError. Source, hand and twin hashes enforce add-only behavior. Exact accepted unit
bytes are published by immutable round directory and a durable suite freeze precedes any scoring execution.
Only the post-freeze bridge in `arms/runner.ts` requests scoring mutants, planted traps and per-unit twins.
Scoring records remain separate from generation RunRecord and prompt inputs.

## Provenance, accounting and reporting

Records carry `providerMode` and `executionProvenance` (`recorded-fixture`, `replay-executed`, `measured`).
The public `sample-workbench` has fictional recorded data; it has no measured receipts. Public analysis is a
sanitized projection, including explicitly labelled mock data, not a substitute for local artifact validation.

`core/campaign.ts` locks held-out configuration, model, prices, fixture/replay trees, manifest and inventories
and journals cell starts/terminals. Resume never repeats observed generation. A durable frozen loop can repair
scoring; an ambiguous interrupted cell before freeze refuses automatic resend. This is an accidental-rerun
and spending guard, not tamper-proof storage or restored held-out blindness.

The ledger reserves worst-case cost before each explicit transport attempt. Default retries are zero; unknown
prices block calls. Evaluation derives USD only from valid identity-matched lifecycles, including failed-billable
attempts, rather than reconstructing from token counts. Unknown usage may retain a conservative charge;
missing/ambiguous accounting is n/a. No invoice-accurate billing or measured cost has been established.

`core/score.ts` checks fixture/inventory/unit/receipt lineage before computing metrics. `evalkit/compare.ts`
requires every manifest cell for campaign inference; an incomplete campaign has no inferred mean/range/interval
or hypothesis. `scripts/eval.ts` delegates to the same CLI evaluator. Mock reports go to
`results/mock/<split>/`, measured dev reports to `results/dev/`, and measured held-out reports to `results/`.
Held-out evaluation replaces only the generated region of `docs/LIMITATIONS.md`; authored disclosures are
preserved exactly and malformed markers refuse the update.

## Review boundary

The viewer renders code as text and never executes tests or calls model providers. LocalStorage rulings are
append-only by application convention, not authenticated audit records. Last ruling in imported log order
wins for `(subjectId, subjectSha256, testSha256)`; rejection revokes and changed source invalidates approval.
`src/lib/review.ts` derives reviewable units from cell-scoped decisions, rollbacks and final kept units.
Recorded fixtures use the separate `testgen.rulings.sample.v1` namespace and SAMPLE-labelled export; actual
and replay-executed runs use `testgen.rulings.v1`. Both logs validate and retain complete append order.
Apply revalidates local run/frozen/stage identities, derives `approved/<subjectId>/<hash-prefix>.test.ts`,
and defaults to dry run. New-file writes refuse overwrites, collisions and detected symlinks/junctions.
Portable path checks do not eliminate hostile concurrent ancestor swaps; see [LIMITATIONS.md](LIMITATIONS.md).
