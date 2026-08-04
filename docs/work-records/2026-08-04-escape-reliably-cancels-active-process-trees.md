---
kind: "work_record"
recordId: "852e2fdc-9506-47a5-bbf0-1711f10515c8"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-04T12:24:27.164Z"
provenance:
    sourcePlans:
        - "4425275e-0a18-4a91-ae3e-29473cf77f86"
---

# Escape reliably cancels active process trees

## Summary

Escape cancellation now reaches RunWield-owned foreground process trees for local shell commands, local CI, and
Objective-Failing Checks through a new shared foreground-process primitive. Workflow Validation treats canceled
Objective-Failing Checks as a resumable pause rather than a validation failure or repair trigger. Regression coverage
was added for descendant termination, abort races, timeout behavior, and validation cancellation; Objective-Failing
Checks turned red on baseline and green after implementation, seams checks held, and `deno task ci` passed.

## Deviations from Plan

Manual interactive TUI verification was not run because no interactive terminal was available. One unrelated golden TUI
scenario flaked during the first full CI run, then passed in isolation and on full rerun.

## Deferred Work

User-facing manual TUI checks remain: Escape during `!`/`!!`, QUICK_FIX CI, executable-Plan CI and Objective-Failing
Checks, and an agent bash tool call.

## Future Planning Notes

Shared process-tree ownership avoided adding a dependency seam while making cancellation reusable across shell, CI, and
Objective-Failing Checks. Treating validation cancellation as a resumable pause preserves Plan/workflow authority and
avoids unnecessary repair routing.

## Execution Report

- Implemented all 9 plan steps: new `src/shared/foreground-process.ts` process-tree primitive (detached group +
  negative-pid SIGKILL on Unix, taskkill /F /T on Windows, race-safe abort/timeout binding, pre-abort spawn skip, no DI
  seam); `runLocalShellCommand()`, `runLocalCI()`, and `runObjectiveChecks()` migrated to it; Workflow Validation now
  registers the Objective-Failing Check phase as an active interaction and treats its cancellation as the same resumable
  retry-or-stop pause as canceled CI (no failure staging, no Engineer repair, Plan stays `implemented`);
  `docs/architecture.md` documents SessionRuntime as cancellation authority and the module as subprocess-tree owner.
- Objective-Failing Checks: OC1/OC2 confirmed red on baseline (exit 1, descendant survived) and green after (exit 0);
  OC3 test "Workflow Validation treats canceled Objective-Failing Checks as a resumable pause" added and passing.
- Test delta: +13 new tests (6 foreground-process, 3 objective-checks, 3 validation-local-ci in a new file, 1
  validation-loop-core), 0 deleted; existing direct-sleep cancellation test retained alongside the new descendant
  regression. Targeted suite: 106 passed / 0 failed across all 7 plan-listed test files.
- Mutation-verified: removing `detached` turns the three descendant-kill tests red; restored to green.
- `deno task seams:check` holds (69 seams / 27 modules, no new seam).
- `deno task ci` passes (exit 0, 242 files passed / 0 failed). First run flaked once on golden TUI scenario
  `presentation-runtime-prompts-and-queued-state` — unrelated to changed code (TUI presentation scenario), passed in
  isolation and on full re-run; noting it as a possible pre-existing flake under parallel load.
- Manual TUI verification steps from the plan were not run (no interactive terminal available): Escape during `!`/`!!`,
  during QUICK_FIX CI, during executable-Plan CI + Objective-Failing Checks, and during an agent bash tool call remain
  for the user to exercise.
