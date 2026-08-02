---
kind: "work_record"
recordId: "34e2c783-7a34-46ae-af64-b2008c0da826"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-02T04:19:57.646Z"
provenance:
    sourcePlans:
        - "c3890fc4-66e3-4c47-99bb-af609e2b4047"
---

# Baseline Objective-Failing Checks Before Execution

## Summary

Implemented durable pre-execution baselining for Objective-Failing Checks so RunWield now verifies checks are red before
Engineer work begins and green during Mechanical Validation. The workflow persists `objectiveChecksBaseline`, rejects
already-met or broken checks back to Planner, re-runs stale baselines when the head or command set changes, and
preserves legacy no-check execution behavior. Verification passed with CI, targeted workflow/plan-store/objective-check
tests, and golden TUI coverage.

## Deviations from Plan

The planned manual interactive verification was not performed; automated workflow and golden coverage exercised the
already-green rejection and normal execution paths instead.

## Future Planning Notes

Objective-Failing Checks now need to discriminate the objective mechanically: Planner should expect already-green checks
to be returned before execution rather than discovered after implementation.

## Execution Report

- Implemented baseline Objective-Failing Check support: normalized/persisted `objectiveChecksBaseline`, baseline
  classification/matching helpers, workflow pre-execution baselining for worktree and non-Git execution, stale-baseline
  re-run logic, and Planner rejection routing for already-met/broken checks.
- Added/updated coverage in `objective-checks.test.ts`, `workflow.test.js`, and `plan-store.test.js`, including the
  required tests `baseline rejects already-met Objective-Failing Checks before Engineer starts` and
  `re-baselines Objective-Failing Checks when head or command set changes`.
- Updated Planner and context docs to describe mechanically observed red-before-execution and green-during-validation
  checks.
- Verification passed: `deno task ci`;
  `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts src/shared/workflow/workflow.test.js src/plan-store.test.js`;
  `deno task test:golden-tui` (first attempt timed out at 180s, rerun with 360s passed).
- Manual verification from the plan was not performed interactively; automated workflow/golden coverage exercises the
  same already-green rejection and normal execution paths.
