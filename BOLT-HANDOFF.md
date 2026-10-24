# Bolt infrastructure handoff: testgen-mutation-score

<!-- SKELETON (M1). Finished in milestone M7. No secrets. Nothing here has been executed. -->

## Target and readiness

- Repository / branch / prepared revision: local inner repo only (no remote yet); revision recorded at M7
- App root: repository root (single npm package)
- Database: **none** (JSON/JSONL files are the persistence; no `supabase/` folder)
- Target: not applicable (no backend resources)
- Existing baseline / applied migrations: not applicable
- Hosting: Bolt hosting for the **static viewer only**; the CLI and Docker sandbox run locally and are never hosted
- Publication: prepare only
- Bolt action: **inspect and prepare only**
- Status: specification only / implementation incomplete (Dirty Mode construction, runtime unverified);
  infrastructure: none required
- Owner prerequisites: GitHub access for import; model API keys stay on the local machine (CLI), never in Bolt

## Build and connection

| Item | Exact command or configuration name |
|---|---|
| Runtime / package manager | Node 20+ / npm; **no lockfile yet** (created at activation) |
| Frozen install / dev | `npm ci` (after activation commits the lockfile) / `npm run dev` |
| Build / output | `npm run build` → `dist/` (viewer entry `src/main.tsx` written in M7) |
| Type/lint/tests | `npm run typecheck`, `npm run lint`, `npm test` — never run so far |
| Client file / public env names | none — the viewer needs no env and there are no `VITE_*` names |
| Missing config behavior | viewer shows an empty state when `public/runs/index.json` lists no runs (M7) |

## Database

Not required. Run records are immutable files written by the local CLI; approvals are a per-reviewer
append-only log kept in browser localStorage and exported as JSONL.

## Functions

Not required. The viewer never executes candidate code and calls no backend.

## Server secrets to enter through settings

None for Bolt. Local CLI env names (values never committed): `ANTHROPIC_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`,
`OPENAI_COMPATIBLE_API_KEY`, `TESTGEN_MODEL`, `TESTGEN_BUDGET_USD`, `TESTGEN_DEV_BUDGET_USD`.

## Auth, storage, and external steps

- Auth, buckets, Realtime, scheduled jobs: not required.
- Docker sandbox: local only. **Spec deviation:** the Dockerfile is not written during construction (Dirty Mode
  forbids dockerizing); its recipe is in `docs/ACTIVATION.md` (D8).
- Other spec deviations to be listed here at M7: D10 designed-stratified subject split, D11 per-unit staging.

## Acceptance checks and receipts

| Check | Expected result | Outcome / receipt |
|---|---|---|
| Import/install/build | `npm ci && npm run build` at repo root | pending (never run) |
| Viewer empty state | renders with no runs | pending |
| Viewer sample runs | SAMPLE / MOCK banners keyed off provenance | pending |

## One prompt after GitHub import

### Inspect and prepare only

> Read BOLT-HANDOFF.md and inspect the imported source at the intended branch/revision. This app has no
> database and no functions: only the static viewer is Bolt-hosted; the CLI and Docker sandbox are local.
> Report concrete build gaps and owner blockers. Preserve the app design. Do not create cloud resources,
> enter secrets, or publish. Do not describe unexecuted checks as complete.
