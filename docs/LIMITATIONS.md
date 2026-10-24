# Limitations

<!-- STATIC-LIMITATIONS:START -->
## Authored static disclosures

**Not yet measured.** This document is a construction template. Nothing has been installed, compiled,
type-checked, linted, tested, built or run. No subject, candidate, model request, sandbox probe, inventory,
replay journey, campaign or evaluator has executed. No Dockerfile, image or lockfile has been written.
Source inspection and authored tests do not prove working behavior.

### Study design and scope

- **Small n:** 12 held-out TypeScript subjects support a bounded exploratory comparison. A seeded 10,000-draw
  paired subject bootstrap, if the campaign completes, describes this sample; it does not establish generality,
  correctness or causality. A negative result is valid. Any required missing/error cell suppresses campaign
  inference rather than silently selecting complete cases.
- **Policy confound:** A5 versus A4 changes both admission and feedback. It compares whole policies and cannot
  isolate the causal effect of a new-kill gate. No additional ablation or second model is included.
- **Hand proxy:** A2 uses authored hand suites, not independent human ground truth. Subjects, twins, traps and
  replay cases are designed fixtures; they do not represent arbitrary repositories or async/UI/integration tests.
- **D10 split deviation:** edition 1 uses a **designed, stratified, trap-matched subject assignment** instead of
  the specification's seeded-hash dev/held-out split. The seed controls mutant splitting and bootstrap. Paired
  trap placement is a design intention, not evidence of equal difficulty. Owner acceptance or a new edition is
  required before held-out use; seeded subject-split functions remain available for a later edition.
- **D11 staging deviation:** accepted units are separate immutable content-hashed files published by round,
  rather than appended to one generated file. Approval and apply depend on the recorded exact bytes.
- **A1 restriction:** characterisation handles supported synchronous signatures with number/string/boolean,
  bounded arrays and plain objects, a seeded boundary grid and bounded Cartesian budget. Unsupported signatures
  or captured values are listed, not silently treated as successes. JSON-compatible observations are not a
  general semantic oracle, and finite probes do not prove behavior.
- **Held-out discipline:** source, hand suites and twins freeze before the first inventory; later changes need
  a new documented edition. The campaign lock/journal guards accidental reruns, not deliberate editing,
  tamper-proof history or recovery of blindness once held-out outcomes have been observed.

### Gate and metric interpretation

Passing twice in fresh processes cannot establish absence of flakiness. The probabilistic replay case may
happen to pass both runs; deterministic flaky-gate coverage uses injected results. Shuffle applies to the
combined kept-suite pristine check. Strict synchronous one-test units exclude many legitimate test styles.

AST/import/allowlist restrictions are **hygiene checks, not a security boundary**. Sandbox flags are source
intent only until isolation and cleanup probes pass. D8 explicitly defers writing/building the Dockerfile.
`--sandbox none` executes mock candidates on the host and marks the run unqualified. The Stryker spike uses
trusted authored hand tests on the host; model candidates require the sandbox. No hostile-code containment
claim is established.

The acceptance gate requires an attributable assertion failure or tested-code throw against a new feedback
mutant. A timeout, compile failure or runner crash cannot earn admission. Raw post-freeze mutation score
includes Timeout in its numerator; the killed-only view exposes that sensitivity. Compile exclusions are
reported separately. Scoring combines generated scoring mutants and scored planted traps, with traps also
shown separately; the disposable canary is not scored. No mutation score proves test correctness.

The equivalent-adjusted view removes **only authored planted labels** from numerator and denominator.
Unlabelled generated-mutant equivalence remains unknown. Generated descriptions `uncovered` (NoCoverage),
`timeout` (observed status), and `model-missed` (covered survivor) are mechanical heuristics, not proven causes
or newly inferred equivalent labels. Labels do not change the raw score.

Twin assertion/throw failures show a behavior difference from the authored contract-compatible twin, not proof
that a test is wrong. Timeout, crash, compile failure or missing twin evidence is incomplete, not an overfit
failure. Overfit is measured per admitted unit; A6 reports combined-suite and generated top-up outcomes
separately. Source/twin contract fidelity and all trap witnesses still require execution validation.

Actual executable-line coverage must come from the instrumented runner report, including A0's zero counters.
Missing denominators stay n/a. Source-line guesses and fictional viewer coverage are not measurements.

### Spending, persistence and review

No hidden transport retries are implemented. Default explicit retries are zero; configured retries each require
a fresh ledger reservation before sending. Unknown prices block live calls. Proposed caps are $1 dev / $5
held-out, not accepted spending authority or measured cost. A 360-call planned held-out bound excludes explicit
retries and does not imply affordability. Reservation bounds, concurrency/durability and provider usage remain
unverified. Unknown billable usage retains a conservative USD charge and incomplete token totals; evaluator
cost requires valid identity-matched ledger lifecycles. This is not an invoice guarantee.

An ambiguous crash after a campaign cell starts but before a complete frozen loop exists **fails closed**;
resume must not automatically resend a potentially paid request. Reconcile ledger and artifacts explicitly.
Completed/error/budget-blocked observed cells are not regenerated; a durable frozen loop permits scoring-only
recovery. Interrupted filesystem writes and real process races remain activation work.

Approval logs are localStorage plus imported/exported JSONL, with no accounts, signatures, shared storage or
server-enforced identity. They can be edited or lost. Public sample approvals demonstrate the workflow only;
their storage namespace and SAMPLE-labelled download are separate from actual/replay-executed ruling logs.
Apply requires matching private local run, stage and frozen receipts. Apply's preflight/immediate-write path
checks and exclusive new-file creation do not eliminate a hostile concurrent ancestor swap between check and
operation (**TOCTOU**). OS-level directory handles or a stronger sandbox are needed before claiming atomic
adversarial path protection. Windows/OneDrive junction behavior remains unverified.

The public viewer projection intentionally supports mock and recorded samples with explicit provenance.
`sample-workbench` counts, kills, scores, traces and twin outcomes are **fictional recorded fixtures**, not
experimental results. A schema-valid public record does not establish local execution, approval authority,
privacy review, sandbox qualification or a complete measured campaign. Rendering, export/import and build are
also unverified. No secrets or private execution paths belong in public files.

### Generated findings contract

This static block is authored product truth. `cli/evalkit/limitationsMd.ts` generates only the evidence sections
below, and measured held-out `eval` replaces only the marked generated region, preserving this block's bytes.
Missing, duplicate or unordered markers refuse replacement. Mock evaluation writes its separate limitations
to `results/mock/<split>/LIMITATIONS.md`; measured dev output goes to `results/dev/LIMITATIONS.md`.
Those standalone generated files do not replace these authored disclosures. Until actual evaluation, the
following region contains no invented rows, failed-test hashes, scores or observed root causes.
<!-- STATIC-LIMITATIONS:END -->

<!-- GENERATED-LIMITATIONS:START -->
## Generated findings — pending evaluation

**Not yet measured.** No A5 survivor diagnosis, per-unit twin failure, unresolved trap, cost or campaign result
has been observed. After activation, matching-provider/split evaluation generates these sections from validated
post-freeze artifacts. Incomplete evidence remains incomplete; it is never replaced by fictional sample data.
<!-- GENERATED-LIMITATIONS:END -->
