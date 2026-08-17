---
kind: "work_record"
recordId: "8add6d2e-46f3-40de-a8d1-0408211ffc7d"
status: "approved"
scope: "planned_change"
workKind: "MAINTENANCE"
origin: "internal"
completionMode: "user_verified"
createdAt: "2026-08-16T22:03:20.570Z"
provenance:
    sourcePlans:
        - "b03c8b1e-4936-4f20-ae8c-487c63248702"
---

# Golden TUI validation coverage deepening

## Summary

The first delivery recorded here was user-verified while still partial. Follow-on repair work subsequently replaced that
small inventory-focused checkpoint with a split Golden validation suite containing 66 real composed-TUI scenarios across
11 concern test files. Those scenarios drive `/load-plan`, the Session Runtime, real Git worktrees, validation commands,
Agent turns, user interactions, lifecycle persistence, recovery, and publication. They collectively own 72 declared
validation branch IDs and run four files in parallel.

The follow-on work also repaired production behavior exposed by the Goldens, including lifecycle recovery, validation
checkpoint handling, incomplete Semantic Reviewer turns, omitted-finding nudges, durable Stop behavior, stale merge
repair worktrees, and publication repair recovery. The completed repair was merged through `c15e7b0e` and `7a164b9f`.

Verification after the merge:

- all 11 validation-workflow Golden files passed with zero ignored tests (`129.4s`, four workers);
- `deno task ci` passed on merged `main`: 321 test files passed and 0 failed (`276.3s`, four workers);
- type checking, Workspace diagnostics, lint, language policy, injection-seam checks, documentation links, formatting,
  and the pinned-submodule check passed.

## Deviations from Plan

The earlier statement that this work was mainly inventory and evidence meta-tests is no longer accurate. The current
suite consists of real composed-TUI scenarios. However, the branch inventory still needs a precision audit before it can
support the stronger statement that every user path is independently proven:

- `validation-tree-objective-none` currently owns both `mechanical:objective:none` and `mechanical:objective:all-pass`,
  although its Plan defines no Objective Checks;
- `validation-tree-human-review-ask-skip` owns both `human-review:ask-skip` and `human-review:none`, which may conflate
  distinct entry paths; and
- some branch evidence requirements use category-level transcript fragments and broad event/state checks rather than a
  branch-specific interaction value, next phase, and durable field.

## Deferred Work

Audit the multi-branch scenario owners and split any branch that is not actually traversed by its owner. Tighten each
branch assertion so it proves the exact interaction choice, phase or Agent routing, and relevant durable Plan, registry,
Git, waiver, review, delivery, or worktree state. Keep the existing composed-TUI scenarios as the execution layer; the
remaining work is proof precision, not replacement of a meta-test-only suite.

## Future Planning Notes

Run `deno task check` before isolated Golden commands when generated version artifacts are absent. Keep the validation
suite split by concern and use `scripts/run-tests.js --isolated` so files run in parallel with sandboxed process-global
state. Do not describe the suite as branch-complete until the branch-proof precision audit above is resolved.
