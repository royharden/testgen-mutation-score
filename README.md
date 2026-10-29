# testgen-mutation-score

A local TypeScript experiment in test generation: A5 keeps a generated test only when it kills a previously
surviving **feedback** mutant. A separate scorer evaluates the frozen suite on disjoint scoring mutants and
planted traps. The static viewer lets a reviewer inspect the evidence and export approval decisions.

## Current status

**Source construction only — runtime unverified. Nothing has been installed, compiled, type-checked, linted,
tested, built or run.** No Dockerfile, Docker image or package lockfile has been written. The manifest and replay
hashes are pending; no frozen mutant inventory, executed campaign or measured result exists. Dependency versions
in `package.json` are proposals. Authored tests have never been executed.

The bundled `sample-workbench` viewer record is **fictional recorded-fixture data**, with MOCK and SAMPLE
labels. Its subject `sample-clamp` is invented, with no frozen experiment identity. Its counts and dispositions
demonstrate the interface; they are not experimental observations.
[`results/results.md`](results/results.md) remains **not yet measured**. All measurements, including costs,
mutation scores, coverage and twin failures, are not yet measured.

Start activation only after Dirty Mode is closed. Follow [`docs/ACTIVATION.md`](docs/ACTIVATION.md) in order and
record actual receipts in [`docs/DEFERRED-VALIDATION.md`](docs/DEFERRED-VALIDATION.md). Static inspection does not
establish runtime readiness, sandbox security, provider compatibility or Bolt import readiness.

## What is constructed

| Area | Source and purpose |
|---|---|
| Subjects | `fixtures/subjects/`, `gold/manifest.json`, `docs/TRAPS.md`: 24 authored subjects, 12 dev and 12 held-out, with hand suites, twins, traps and canaries |
| Gate | `cli/core/grammar.ts`, `ast.ts`, `gate.ts`, `staging.ts`: strict one-test units, hygiene checks, pristine reruns, feedback admission and immutable staging |
| Execution | `cli/engines/`, `cli/sandbox/`: in-house/Stryker inventory adapters, exact-patch execution and bounded Docker wrapper source |
| Generation | `cli/arms/`, `cli/providers/`, `cli/ledger/`: A0–A6, replay/Anthropic/OpenAI-compatible adapters, explicit retry accounting and budget reservations |
| Evaluation | `cli/core/score.ts`, `cli/evalkit/`: post-freeze scores, twin outcomes, campaign comparisons, public analysis projection and report generation |
| Review | `src/`, `public/`: static React viewer, schema-validated samples and local approval log; `cli/rulings/`, `cli/apply/` validate and apply exported decisions |

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) identifies canonical modules and artifact paths.
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) records study, security and evidence limitations.

| Arm | Policy |
|---|---|
| A0 | Empty suite |
| A1 | Restricted no-model characterisation, seeded bounded probes, per-unit pass-twice admission |
| A2 | Authored hand-suite proxy |
| A3 | Ungated model, one call |
| A4 | Coverage-gated model, up to three rounds |
| A5 | New-feedback-kill gate, up to three rounds |
| A6 | Hand suite plus A5 top-up, up to three rounds |

## Commands after activation

Run at the repository root. These commands are documented from source and **have not been run**. Replace
`<run-id>`, `<campaign-id>`, `<model-id>` and `<image>@sha256:<64-hex>` with actual frozen identities.

| Command | Intended behavior |
|---|---|
| `npm run cli -- run` | Read-only plan, no execution or provider; prints all subjects, selection, inventory counts or `not inventoried`, call and price bounds |
| `npm run cli -- run --split heldout --provider anthropic --model <model-id>` | Read-only held-out cost plan; unknown prices remain unknown |
| `npm run cli -- mutants --execute --split all --engine inhouse` | Initial all-subject fixture hash freeze and immutable inventories |
| `npm run spike:stryker -- --subject clamp-range` | Activation spike, using trusted hand tests on the host; record checks below |
| `npm run replay:check -- --write-hashes` | Initial replay activation: executes real mock controller journey, checks designed dispositions, backs up fixtures and writes hashes |
| `npm run replay:check` | Re-executes the strict full-hash replay journey; pending hashes refuse |
| `npm run cli -- run --execute --provider mock --split dev --subjects clamp-range,stable-sort,validated-number --image <image>@sha256:<64-hex>` | Sandbox replay demo; no model API calls |
| `npm run eval -- <run-id> --provider mock --split dev` | Artifact-only mock evaluation under `results/mock/dev/` |
| `npm run cli -- run --live --provider anthropic --split dev --subjects clamp-range --arms A3 --repeats 1 --image <image>@sha256:<64-hex>` | One-call dev provider smoke, subject to known prices, keys, model and budget |
| `npm run cli -- run --live --provider anthropic --split heldout --heldout-confirm --campaign-id <campaign-id> --repeats 3 --image <image>@sha256:<64-hex>` | Frozen held-out campaign; no tuning after observation |
| `npm run cli -- run --live --provider anthropic --split heldout --heldout-confirm --resume <campaign-id> --repeats 3 --image <image>@sha256:<64-hex>` | Resume with identical configuration, model, prices, fixtures, replay and inventories |
| `npm run eval -- <run-id> --provider anthropic --split heldout` | Measured held-out reports; requires actual matching local artifacts |
| `npm run cli -- apply --rulings rulings.jsonl` | Dry-run approval plan; extra ruling files may follow positionally in log order |
| `npm run cli -- apply --rulings rulings.jsonl --write` | Revalidates and writes new files only to `approved/<subjectId>/<hash-prefix>.test.ts` |
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | Deferred compiler, lint, test and viewer build checks |
| `npm run dev`, `npm run preview` | Local viewer servers; reserve a host port before starting either |

`--execute` permits only `--provider mock`; `--live` requires a real provider and Docker. The real provider ids
are `anthropic` and `openai_compatible`. No hidden transport retries occur; `--retries 0` is the default
(maximum 3 explicit retries, each reserved separately). `--sandbox none` is an explicit mock-only host execution
opt-out and disqualifies the run. It is not the demo default.

Set local CLI values in the **shell environment**; source does not automatically load `.env`.
`.env.example` supplies names only: `ANTHROPIC_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`,
`OPENAI_COMPATIBLE_API_KEY`, `TESTGEN_MODEL`, `TESTGEN_BUDGET_USD`, `TESTGEN_DEV_BUDGET_USD`.
The replay checker also requires `TESTGEN_SANDBOX_IMAGE` set to the pinned digest because it has no image flag.
The viewer needs no environment values or credentials. Never put model keys in `VITE_*` settings.

The budget proposal is **$1 dev / $5 held-out**, pending owner acceptance and price/model reconciliation.
Null/unknown prices in `cli/ledger/prices.json` block live calls. A full held-out campaign plans at most 360
model calls before explicit retries (A3: 36; A4/A5/A6: 108 each); this is not a promise those calls fit the cap.
Reservations bound spending; exhausted budgets produce partial records rather than silent retries or filled-in results.

## Viewer and approvals

The viewer reads `/runs/index.json`, `/runs/<run-id>.json` and the optional `/analysis/<run-id>.json` companion.
Hash routes are `#/runs`, `#/runs/<run-id>/subjects/<subject-id>`, `#/runs/<run-id>/trace`,
`#/runs/<run-id>/results` and `#/runs/<run-id>/approvals`. The subject view distinguishes feedback, scoring
and planted outcomes; trace shows gate reasons; results retains missing/incomplete evidence.
An empty catalog has an explicit empty state. Rendering and all journeys remain unverified.

Approvals append to browser localStorage and can be imported/exported as whole JSONL logs. Last ruling by log
order wins for the subject/source/test hash tuple; reject revokes approval and changed source invalidates it.
A recorded-fixture sample uses the separate `testgen.rulings.sample.v1` storage namespace and
`testgen-SAMPLE-rulings.jsonl` download; actual/replay-executed runs use `testgen.rulings.v1`.
A5/A6 are the default approval filter. Browser storage is local and unauthenticated, not a shared approval service.
Download/export logs for transfer or backup. Applying requires the matching private local run, immutable stage
and frozen artifacts; a public sample decision alone cannot create an approved test.

## Results and Stryker spike

**Not yet measured.** The intended table reports raw `(Killed+Timeout)/(Killed+Timeout+Survived+NoCoverage)`,
killed-only sensitivity, adjustment for labelled planted equivalents only, separate compile exclusions, traps,
per-unit twin differences, tokens, ledger USD and score gain per dollar. Incomplete required cells suppress
campaign inference. A5 versus A4 compares whole policies; 12 held-out subjects are exploratory.

Spike receipt slot (pending): date; resolved Node/Vitest/Stryker versions; dev subjects; CHECK 1 feedback-key
containment; CHECK 2 batched versus isolated attribution; CHECK 3 position base; chosen generated-mutant engine
and exact-patch/isolated execution path. No batched attribution optimization is established.

## Bolt and license

[`BOLT-HANDOFF.md`](BOLT-HANDOFF.md) is an **inspection/preparation** handoff. Only the static viewer is intended
for Bolt hosting. Database: none. Functions: not required. No GitHub remote exists; pushing, importing and
publication have not been authorized or performed. MIT — see [`LICENSE`](LICENSE).
