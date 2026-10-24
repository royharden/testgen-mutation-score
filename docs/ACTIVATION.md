# Activation

**Source construction only — runtime unverified.** Nothing has been installed, compiled, type-checked,
linted, tested, built or run. Activation starts only after Dirty Mode is closed. Each failed step stops the
sequence until resolved; record dated observed outcomes in [DEFERRED-VALIDATION.md](DEFERRED-VALIDATION.md).
Commands below are deferred instructions, not receipts. Run from the product repository root.

## Ordered activation sequence

1. **Reconcile and pin versions.** Check proposed `package.json` versions and peer requirements against actual
   registry documentation: Node 20+ floor versus supported Vite/Vitest runtime; TypeScript 5.x compiler API;
   Vitest/coverage-v8 matching versions; Stryker core/runner/checker compatibility; zod 4; Vite/plugin-react;
   React/types; ESLint/typescript-eslint/globals; tsx and fast-check. Resolve concrete incompatibilities.
2. **Install and lock.** `npm install`; commit the actual `package-lock.json`; confirm `npm ci` from a clean
   checkout. No lockfile or integrity data has been fabricated during construction.
3. **Compile/lint.** `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p tsconfig.cli.json`, `npm run lint`.
4. **Offline tests.** `npx vitest run`, with no network or provider keys. Authored injected tests do not prove
   Docker isolation or actual engine APIs. Run all focused ledger/sandbox/eval/apply/viewer regressions too.
5. **Write/build Dockerfile.** Follow the prose recipe below; `docker build -t testgen-sandbox:<pinned-tag> .`.
   Establish a locally available digest reference accepted by the wrapper: `<image>@sha256:<64-hex>`.
   A local tag or image id alone does not satisfy the parser; verify the digest resolves locally without pulling.
6. **Sandbox probes.** Validate the exact generated argv, uid, read-only mounts, network denial, limits, no key
   exposure, bounded output, timeout and container removal, including Windows mounts and runner API/coverage.
   Set `TESTGEN_SANDBOX_IMAGE` in the shell to the verified digest. No automatic `.env` loader is implemented.
7. **Prepare fixture freeze.** Execute fixture validators and hand/twin/trap/canary probes. Inspect the complete
   `gold/manifest.json` edition and designed-stratified rationale. Make an immutable activation backup. All four
   hashes (`src`, `hand`, `twin`, `traps`) and `freezeDate` are still `pending` in construction; do not guess them.
8. **Freeze/hash and inventory all subjects.** `npm run cli -- mutants --execute --split all --engine inhouse`
   performs the initial all-subject pending→frozen transition and writes `results/mutants/<subject-id>.json`.
   Check each file identity, nonempty partitions, statement grouping, trap reservations and compile exclusions.
   This command implements step 7's hash computation; no separate hash CLI exists. Subsequent byte changes
   refuse the edition. Existing inventories are immutable, and engine changes require a documented new edition.
9. **Stryker spike and engine decision.** `npm run spike:stryker -- --subject clamp-range`, then a second dev
   subject (for example `stable-sort`); record versions, key containment, attribution and position-base results
   in README. This trusted-hand-suite spike runs on the host. If choosing Stryker inventories, prepare actual
   reports per subject and use `npm run cli -- mutants --execute --split all --engine stryker --stryker-reports <report-directory>`
   in the documented new edition; do not mix engines or overwrite step 8's inventories. Exact-patch isolated
   feedback execution remains the conservative path; batched attribution requires demonstrated equality.
10. **Bind and verify replay.** With the sandbox digest environment set, run
    `npm run replay:check -- --write-hashes`, then `npm run replay:check`. The first command executes actual
    controller prompts/dispositions before backing up and filling hashes. Pending/partly activated contexts,
    unreachable slots, wrong dispositions or missing attributed twin evidence refuse activation. Reconcile
    dev fixture expectations before experiment freeze, preserving intent; never substitute scoring keys.
11. **Mock demonstration.** `npm run cli -- run --execute --provider mock --split dev --subjects clamp-range,stable-sort,validated-number --image <image>@sha256:<64-hex>`.
    Inspect forbidden-import rejection, accepted new feedback kill, duplicate/no-new-kill and quirk-pinning
    post-freeze twin outcome. `npm run eval -- <mock-run-id> --provider mock --split dev`; verify reports remain
    under `results/mock/dev/`, public projections retain provenance and measured placeholder remains untouched.
12. **Tiny-cap live provider smoke.** Verify current official prices, pin dated non-null price/model rows and
    model id, set keys and a cents-level `TESTGEN_DEV_BUDGET_USD` in the shell. For each provider actually to be
    supported, run one A3 call: `npm run cli -- run --live --provider anthropic --split dev --subjects clamp-range --arms A3 --repeats 1 --image <image>@sha256:<64-hex>`;
    use `--provider openai_compatible` with its base URL/key for that adapter. Validate ledger reservations,
    usage/error settlement and no hidden retries. Unknown prices or missing credentials/model/budget must refuse.
13. **Dev runs only.** Decide the proposed $1 dev cap and perform bounded dev comparisons with equal A4–A6
    round policy. Freeze any dev-derived policy changes before held-out work. No automatic budget increase.
14. **Final experiment freeze.** Review model, prices, prompts/replay, CLI configuration, engine, full fixture
    manifest/inventory identities and explicit retry policy; accept D10 or create a new edition. Confirm D8/D11
    disclosures. First inventory already froze subjects before dev execution; any later subject/hand/twin change
    requires a new edition, new inventories and replay reconciliation, never in-place tuning against mutants.
15. **Held-out campaign.** Decide the proposed $5 cap and run exactly the frozen campaign, for example
    `npm run cli -- run --live --provider anthropic --split heldout --heldout-confirm --campaign-id <campaign-id> --repeats 3 --image <image>@sha256:<64-hex>`.
    Three repeats form one campaign, with A0–A2 once per subject. The lock covers configuration/model, prices,
    fixtures, replay, manifest and inventories. Resume using the identical invocation with `--resume <campaign-id>`
    instead of `--campaign-id`; never change budgets/flags or resend an ambiguous started cell. A prefreeze crash
    requires visible ledger/artifact reconciliation; frozen loops permit scoring-only recovery.
16. **Artifact-only evaluation.** `npm run eval -- <run-id> --provider anthropic --split heldout` (substitute the
    actual provider). Multiple run ids can select retained campaign/resume records; incompatible campaigns
    refuse. Outputs include `results/results.md`, `results/results.jsonl`, `results/comparison.json`, the generated
    region of `docs/LIMITATIONS.md`, and sanitized analysis. Verify static disclosures survive repeated evaluation,
    malformed markers refuse, incomplete campaign inference stays unavailable and costs derive from ledger lineage.
17. **Viewer with actual projections.** Inspect `public/runs/` and `public/analysis/` for private data first.
    `npm run build`; reserve/check a host port before `npm run dev` or `npm run preview`. Validate empty/error
    states, MOCK/SAMPLE labels, subject map, trace, results, approval export/import/revocation and changed-source
    invalidation. Exercise apply dry run and new-file writes only in a disposable tree; keep TOCTOU disclosure.
18. **Bolt inspection/preparation.** Owner pins the reviewed revision and authorizes GitHub creation/push/import
    separately; no remote currently exists. Follow [BOLT-HANDOFF.md](../BOLT-HANDOFF.md) for static-viewer-only
    inspection. Database none, functions not required, local CLI/Docker outside hosting. No publication implied.

## Dockerfile recipe — prose only (D8)

No Dockerfile or image is written during construction. At step 5, write the real Dockerfile after compatibility
checks, then build and probe it before any untrusted candidate execution:

- Use a reconciled official Node slim base (20 or later), pinned by digest. Build-time network may fetch pinned
  dependencies via committed `package-lock.json` and `npm ci`; runtime network must be disabled.
- Install the package and `node_modules` under `/opt/testgen`, with trusted
  `/opt/testgen/cli/sandbox/runner.mjs`. Include the validated Vitest, coverage, TypeScript and selected engine
  dependencies/configuration. Never copy `.env`, credentials, local results or model transport diagnostics.
- Provide uid/gid `10001:10001` and allow the runner to work with `--read-only` plus `/tmp` and `/work` tmpfs.
  The host overrides entrypoint to `node /opt/testgen/cli/sandbox/runner.mjs /in/request.json /work`.
- `/subject` and `/in` are host bind mounts with `readonly`; `/work` receives trusted request source and
  byte-verified candidate units. Runner resolves packages from `/opt/testgen/node_modules`.
- Match `cli/sandbox/sandboxrun.ts` exactly: `--rm --pull never`, named container, `--network none`,
  `--user 10001:10001 --read-only --cap-drop ALL --security-opt no-new-privileges`, bounded tmpfs `/tmp` (64 MB)
  and `/work` (128 MB), `--memory 1g --memory-swap 1g --cpus 1 --pids-limit 128`. No Docker socket or secret env.
- Host default wall limit is 30 seconds; stdout/stderr are each capped at 1 MiB. Overflow, malformed result,
  crash or unconfirmed cleanup must be an error, never a kill. Confirm forced removal after timeout and on
  Windows Docker Desktop. Runner emits one schema-validated JSON document, not raw transport diagnostics.

## Deferred decisions and receipts

Owner decisions remain: close Dirty Mode; accept designed subject assignment or request a new seeded edition;
select/pin compatible packages, model/provider, engine and verified prices; accept dev/held-out budgets; approve
later GitHub/import/publication scope if desired. Jev triage is outside this build and requires a separate
paid-work decision. None of these decisions is implied by source access or a prepared handoff prompt.

Append actual dated receipts to the existing deferred ledger; preserve prior pending rows and history.
