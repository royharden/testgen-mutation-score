# Bolt handoff: testgen-mutation-score

## Target and readiness

**Source construction only — runtime unverified.** Nothing has been installed, compiled, type-checked,
linted, tested, built or run. No measured result exists. The bundled viewer sample is fictional
`providerMode: mock`, `executionProvenance: recorded-fixture` data, not experimental evidence.

| Item | Selected scope / state |
|---|---|
| App root | Repository root, single npm package; import the product repo, not a containing folder |
| Source baseline | Local `m7-viewer-handoff` construction branch, based on `db8be9b`; final reviewed revision must be pinned by the owner before import |
| GitHub | No remote exists; no push authorized or performed |
| Future Bolt action | **Inspect and prepare only**; import/publication require a later owner action |
| Hosted component | Static Vite/React viewer only |
| Local components | Node CLI, providers, filesystem receipts, evaluator and Docker sandbox |
| Database | **None**; no Supabase client, migrations or database provisioning |
| Functions | **Not required**; no edge functions or server deployment |
| Auth / buckets / Realtime / schedules | Not required |
| Infrastructure status | No backend required; viewer install/build/import readiness unverified |

## Build and configuration inventory

| Item | Source contract / pending action |
|---|---|
| Runtime / package manager | Node 20+ / npm; reconcile proposed package and peer versions first |
| First install | `npm install`, then commit actual `package-lock.json`; no lockfile has been written |
| Reproducible install | `npm ci` only after activation supplies a reviewed lockfile |
| Build / output | `npm run build` → `dist/`; never run |
| Checks | `npm run typecheck`, `npm run lint`, `npm test`; never run |
| Viewer entry | `index.html` → `src/main.tsx`; static hash routes, no backend calls |
| Public data | `public/runs/index.json`, `public/runs/<run-id>.json`, optional `public/analysis/<run-id>.json` |
| Empty configuration | Empty runs catalog renders an empty state; malformed records must be visibly rejected |
| Browser env / secrets | None; no `VITE_*` variables |
| Local CLI config names | `ANTHROPIC_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `TESTGEN_MODEL`, `TESTGEN_BUDGET_USD`, `TESTGEN_DEV_BUDGET_USD` |
| Sandbox selection | Local `--image <image>@sha256:<64-hex>` or `TESTGEN_SANDBOX_IMAGE`; replay checker uses that environment name |
| External prerequisites | Later authorized GitHub import, reconciled Node/npm, local Docker and digest-pinned image; model account/key and known dated price row for paid calls |

Local values belong in the invoking shell environment; `.env` is not automatically loaded. Do not enter local
model credentials in Bolt. Unknown prices block live calls. The proposed $1 dev / $5 held-out caps require
owner acceptance; no paid smoke, invoice reconciliation or cost measurement has occurred.

## Explicit construction deviations

- **D8 — Docker deferred.** No Dockerfile or image was written. The host wrapper and trusted runner are source
  only. Write/build/probe the image after Dirty Mode closes using [`docs/ACTIVATION.md`](docs/ACTIVATION.md).
  Bolt import does not supply Docker or the local CLI runtime.
- **D10 — subject assignment.** Edition 1 uses the manifest's **designed, stratified, trap-matched dev/held-out
  assignment** rather than the specification's seeded-hash subject split. The seed still controls mutant
  splitting and bootstrap; seeded subject-split functions remain for a future edition. Owner acceptance or a
  new edition is required before the held-out campaign.
- **D11 — staging.** Accepted units become separate immutable content-hashed files, published by round after
  the union passes, rather than being appended to a shared generated file. Approval/apply verify exact bytes.

## Acceptance work and receipts

All outcomes below are **pending / never run**. Use [`docs/DEFERRED-VALIDATION.md`](docs/DEFERRED-VALIDATION.md)
for the complete historical ledger and [`docs/ACTIVATION.md`](docs/ACTIVATION.md) for ordered local activation.

| Check | Required later evidence |
|---|---|
| Toolchain and bundle | Reconciled versions, real lockfile, clean install, both TypeScript projects, lint, tests and `npm run build`; no Node-only module in browser graph |
| Viewer journeys | Sample MOCK + SAMPLE banners, fictional-data labels, catalog empty/error states, subject map, candidate trace, incomplete results and approval import/export/revocation |
| Safe display | Source/code shown as escaped text; no execution or raw HTML rendering |
| Privacy | Public run/analysis projections contain no absolute local paths, environment, credentials or provider transport details |
| Measured viewer | Only validated post-freeze projections; mock/sample provenance never promoted to measured; matching provider/split evaluation receipts |
| Local runtime | Docker isolation/cleanup/coverage probes, frozen inventories, Stryker spike, strict replay activation, tiny-cap provider smoke and complete campaign evidence |
| Future import | Owner-pinned reviewed revision and lockfile; observed import/install/build; no backend or publication actions inferred from import |

## Future inspection/preparation prompt

This prompt is prepared text only. It has not been submitted. First obtain an authorized GitHub import of the
reviewed product revision; no remote currently exists. Do not treat this handoff as permission to push or publish.

> Read BOLT-HANDOFF.md, README.md, docs/ARCHITECTURE.md, docs/LIMITATIONS.md and
> docs/DEFERRED-VALIDATION.md in the imported product repo. Verify the intended reviewed branch/revision
> and actual lockfile. This is a static React/Vite viewer with database NONE and functions NOT REQUIRED.
> The CLI, model providers, evaluator, private JSON/JSONL receipts and Docker sandbox remain local.
> Inspect and prepare only: identify concrete import/build gaps and owner prerequisites, preserving the
> viewer design and schema boundary. Do not provision databases, functions, auth, storage or schedules;
> do not enter credentials or publish. Keep fictional recorded fixtures labelled MOCK and SAMPLE and
> all unmeasured results explicitly unmeasured. Report observed checks separately from pending work.
> Make source changes only for a concrete deployment gap under the owner's subsequent direction.
