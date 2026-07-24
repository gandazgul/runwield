---
kind: "work_record"
recordId: "45cfc5af-1a2b-4032-8115-2f88f0a733df"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-24T19:37:29.115Z"
provenance:
    sourcePlans:
        - "d59f7222-2743-4569-9f20-7ac3cfee9986"
---

# Parallel test runs enabled with shared-state isolation

## Summary

Enabled native Deno module-level parallelism for general and Workspace test tasks, moved bundled resource lookup to
source paths during non-standalone runs, preserved standalone extraction through a release smoke probe, and documented
`DENO_JOBS` concurrency controls. Verification covered targeted affected tests, Workspace tests, capped serial/parallel
runs, and multiple shuffle seeds.

## Deviations from Plan

Verification uncovered and fixed additional parallel/shuffle flakes beyond the planned files, including install script
cwd/input handling, plan-server runtime fixture paths, Workspace subprocess stderr filtering, and selected HOME/cwd
races. Default `deno task test` still showed intermittent parallel failures in unrelated shared-state tests.

## Deferred Work

Release check, full CI, and the performance median benchmark were not completed after the default parallel test failure.
Remaining intermittent failures appear tied to HOME/cwd shared-state races in `src/cmd/init/init-state_test.js`,
`src/shared/session/__tests__/session-tools-policy.test.js`, and `src/shared/session/root-session.test.js`.

## Future Planning Notes

Parallelizing the suite exposed hidden process-global state coupling; future test optimization work should budget time
for HOME/cwd/env locking or fixture isolation outside the initially suspected files.

## Execution Report

- Implemented parallel-test-run changes: `deno task test`/`workspace:test` use `--parallel`; source runs read bundled
  agent defs/skills from `src/`; standalone extraction smoke script added to release check; docs updated with
  `DENO_JOBS` guidance.
- Refactored planned shared-state hazards: session catalog/tool-policy tests no longer mutate repository `.wld`; ACP CLI
  smoke no longer runs `scripts/write-version.js` inside a worker; standalone probe verifies extracted agent
  definitions/skills.
- Added/used process-global locking and fixed several additional parallel/shuffle flakes discovered during verification
  (install script cwd/input, plan-server runtime fixture paths, workspace subprocess stderr filtering, selected HOME/cwd
  tests).
- Passing verification: targeted affected tests passed; `deno task workspace:test` passed after
  `deno task workspace:build`; `DENO_JOBS=1 deno task test` passed with 1646 tests; `DENO_JOBS=2 deno task test` passed
  with 1646 tests; shuffle seeds 101, 202, 303, and 404 passed after fixes.
- Failing verification remains: default `deno task test` still fails intermittently under parallelism; latest failures
  were `src/cmd/init/init-state_test.js`, `src/shared/session/__tests__/session-tools-policy.test.js`, and
  `src/shared/session/root-session.test.js`, consistent with remaining HOME/cwd shared-state races outside the original
  planned files.
- Not completed because default tests still fail: release check, full CI, and performance median benchmark were not run
  to completion after the default test failure.
- Repository-state check: `git diff -- .wld src/shared/version.js` is empty; only implementation/test/doc changes remain
  modified.
