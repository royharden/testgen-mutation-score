# Replay corpus

These are designed dev fixtures, not observations. The index references each canonical candidate exactly once. The M4 slice remains `clamp-range/A5/r1-c1.json`; there is no copied replacement. Thirty slot-1 calls cover the actual controller's three subjects, A3 once and A4–A6 for three rounds each. Candidate files share the 1–8-test grammar, including A6's six- or seven-test hand-suite duplicate cases.

Runtime lookup requires the complete prompt SHA-256 and the exact subject/arm/round/slot context. `pending` never matches at runtime. No live-provider fallback exists. At activation, after subject freeze, real inventories and the sandbox are ready, run:

```sh
npm run replay:check -- --write-hashes
npm run replay:check
```

The first command obtains prompts from the actual controller/gate/sandbox journey. It checks the designed gate dispositions and the quirk unit's post-freeze twin failure before backing up every original fixture and binding hashes once. It then repeats the journey through the ordinary strict runtime provider. Later runs verify the same hashes and refuse drift. Backups are immutable under `results/mock/replay-activation-backups/`; a partly written activation requires deliberate recovery from those backups, never a permissive runtime lookup.

All twelve kinds are represented. Most bad cases are concentrated on clamp-range; stable-sort supplies no-new-kill and timeout-only cases. Repeated kept units are explicitly labelled no-new-kill or duplicate-kill. A6's hand-suite responses are A6-only and already part of its initial kept state. The probabilistic Math.random candidate is marked `probabilistic: true` and is last in its cell; the checker does not pretend its particular pass/fail sequence is deterministic. Injected gate reducer tests provide deterministic flaky coverage.

The quirk assertion alone cannot authorize admission: its source statement is reserved for scoring. The same unit also asserts an independent clampAll contract behavior intended to kill a feedback mutant. The checker requires both actual gate admission and an attributable post-freeze twin failure. The timeout-only witness targets non-progressing descending insertion and asserts length rather than ordering. Its actual feedback partition may also contain other effects. Neither case is guaranteed against an engine inventory that has never run. Activation must reconcile these designed DEV witnesses against the real frozen engine inventory before the experiment is finally frozen, preserving each bad-kind intent. A mismatch blocks hash binding with a location; never relabel a measured result, borrow a scoring trap, or invent feedback to make the fixture pass.
