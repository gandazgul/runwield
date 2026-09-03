---
planId: "d90a8cb8-cdfd-4192-ba1e-d2aa1f9ac3af"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Run all independent pre-test CI gates concurrently, then run the isolated test suite after they pass"
affectedPaths:
    - "deno.json"
    - "scripts/run-ci.ts"
    - "scripts/run-ci.test.ts"
    - "docs/contributing.md"
objectiveChecks:
    - id: "OC1"
      command: "grep -qF '\"ci\": \"deno run -A scripts/run-ci.ts\"' deno.json && deno eval 'const m=await import(\"./scripts/run-ci.ts\");const d=Promise.withResolvers();const calls=[];const run=m.runCi(async n=>{calls.push(n);if(n===m.PRE_TEST_TASKS[0])await d.promise;return {name:n,code:0};});await new Promise(r=>setTimeout(r,0));if(calls.join(\",\")!==m.PRE_TEST_TASKS.join(\",\"))throw Error(\"pre-test wave is not concurrent\");d.resolve();const result=await run;if(calls.at(-1)!==\"test\"||result.exitCode!==0)throw Error(\"test did not follow the barrier\");'"
      rationale: "This directly proves that the CI task uses the new runner, every declared pre-test task starts without waiting for a blocked sibling, and test starts only after the barrier."
    - id: "OC2"
      command: "deno eval 'const m=await import(\"./scripts/run-ci.ts\");const calls=[];const result=await m.runCi(async n=>{calls.push(n);return {name:n,code:n===\"lint\"?7:n===\"seams:check\"?8:0};});const got=result.failures.map(f=>`${f.name}:${f.code}`).join(\",\");if(calls.includes(\"test\")||result.exitCode===0||got!==\"lint:7,seams:check:8\")throw Error(\"pre-test failures were not collected\");'"
      rationale: "This can pass only when multiple pre-test failures are retained in task order, produce a failed CI result, and prevent the test task from starting."
objectiveCheckWaivers:
    []
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-20T19:58:32-04:00"
status: "validated"
origin: "internal"
implementedAt: "2026-08-21T00:59:45.422Z"
validatedAt: "2026-08-22T23:56:24.809Z"
userVerifiedAt: null
executionReport: "- Implemented `scripts/run-ci.ts` with exported `PRE_TEST_TASKS`, concurrent pre-test scheduling, all-failure collection, test barrier, Deno task subprocess executor, inherited child output, and named timing lines.\n- Updated `deno.json` so `ci` runs `deno run -A scripts/run-ci.ts`; existing check and test task definitions remain in place.\n- Added `scripts/run-ci.test.ts` coverage for all-at-once pre-test starts, the test barrier, all pre-test failure collection, process-start failure handling, and test exit-code propagation. Test count delta: +5 tests, 0 removed.\n- Updated `docs/contributing.md` to describe the concurrent pre-test wave, test barrier, and continued use of `scripts/run-tests.js`.\n- Verification passed: `deno run -A scripts/run-tests.js scripts/run-ci.test.ts`; `deno fmt --check deno.json scripts/run-ci.ts scripts/run-ci.test.ts docs/contributing.md`; `deno task check`; `deno task language-policy:check`; `deno task seams:check`; `deno task doc-links:check`; final `deno task ci`.\n- Note: the first `deno task ci` run failed in `src/ui/tui/golden-scenarios/load-plan-epic-workflow.test.ts`; that file passed when rerun directly, and the final full `deno task ci` passed."
workRecord:
    status: "generated"
    recordId: "0fbfd7d6-dd6d-44bb-b06d-61803dd2fb06"
    path: "docs/work-records/2026-08-22-parallel-ci-pre-test-gates.md"
    lastAttemptAt: "2026-08-22T23:56:24.879Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "50b379c933a3e4d9486164dccaf85a4e135d50d7"
    targetBranch: "main"
    targetHeadBeforeMerge: "fa305427c8ef095ca4499a6f6d467889f8e7be30"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 0
updatedAt: "2026-08-23T15:45:48.517Z"
archivedAt: "2026-08-23T15:45:48.517Z"
archivedFromStatus: "validated"
archivedFromPath: "docs/plans/parallelize-independent-ci-stages.md"
---

# Parallelize Independent CI Stages

## Context

`deno task ci` currently joins eight independent pre-test tasks and the test task with shell `&&` operators. This runs
every task in sequence. Warm local measurements put the pre-test tasks at about 9 seconds in total and the test task at
about 326 seconds. The independent gates can share one approximately 5-second critical path without changing the test
runner or its isolation rules.

The user chose maximum pre-test concurrency: all eight pre-test gates start together. Tests must remain behind a barrier
so they consume resources only after every pre-test gate passes.

## Objective

Replace the sequential CI task chain with a small typed runner that starts all eight pre-test tasks concurrently, waits
for all of them, reports all pre-test failures, and runs `test` only after a fully successful pre-test wave.

## Approach

Keep each existing Deno task as the owner of its check. `scripts/run-ci.ts` only owns scheduling, status reporting, and
exit behavior:

```text
submodules:check ───────┐
snip:check ─────────────┤
check ──────────────────┤
workspace:check ────────┤
lint ───────────────────┼─ all passed ─→ test ─→ CI result
language-policy:check ──┤
seams:check ────────────┤
doc-links:check ────────┘
             any failed ───────────────→ report all failures; skip test
```

Export the ordered pre-test task list and a `runCi` scheduling function. Compose the real subprocess executor only in
the script entry point. The executor uses `Deno.execPath()` with `task -q <task-name>`, inherits command output, and
prints short named start/completion lines with elapsed time. A subprocess start error becomes a failed task result; it
must not reject the whole `Promise.all` early or hide sibling outcomes.

`runCi(executeTask)` receives the subprocess executor as the genuine external-process boundary and returns a typed
result with `exitCode` and an ordered `failures` task-result list. Tests use a controlled executor to prove scheduling
and failure behavior without running the repository's full gates recursively.

The set-aside option was two sequential pre-test waves. It would reduce peak load but would retain avoidable ordering;
the measured task costs and the user's preference support one wave.

## Files to Modify

- `deno.json` — replace the sequential `ci` shell chain with the typed CI runner command.
- `scripts/run-ci.ts` — define the fixed CI schedule, concurrent pre-test barrier, subprocess execution, reporting, and
  exit-code behavior.
- `scripts/run-ci.test.ts` — add focused scheduling and failure-path regression tests.
- `docs/contributing.md` — document that the eight pre-test gates run concurrently and tests start only after they all
  pass.

## Reuse Opportunities

- `deno.json` — retain all existing named task definitions; the runner invokes them instead of duplicating their
  commands.
- `scripts/run-tests.js` — keep the established sandboxed, per-file test runner unchanged behind `deno task test`.
- `scripts/run-prototype.js` — follow the existing script pattern of composing a `Deno.Command` subprocess boundary in
  the executable entry point while keeping scheduling logic directly testable.

## Implementation Steps

- [ ] `scripts/run-ci.ts` exports `PRE_TEST_TASKS` as the ordered set `submodules:check`, `snip:check`, `check`,
      `workspace:check`, `lint`, `language-policy:check`, `seams:check`, and `doc-links:check`; `runCi` starts every
      item before waiting for the wave to settle and never starts `test` while a pre-test task remains unsettled.
- [ ] A successful pre-test wave starts exactly one `test` task, and the overall result preserves a non-zero test exit
      code.
- [ ] A pre-test wave with one or more command failures or process-start errors waits for all started siblings, reports
      every failed task by name and exit code, returns a non-zero result, and does not start `test`.
- [ ] The real executor runs each entry through the existing Deno task interface with `Deno.execPath()` and
      `task -q <name>`, keeps child output visible, and emits concise named start/completion timing lines so concurrent
      output remains attributable.
- [ ] `deno.json` defines `ci` as `deno run -A scripts/run-ci.ts`; no existing check or test task is removed or
      duplicated in the runner.
- [ ] `scripts/run-ci.test.ts` proves all-at-once pre-test start, the test barrier, all-failure collection,
      process-start failure handling, and test exit-code propagation with a controlled subprocess executor.
- [ ] `docs/contributing.md` describes the concurrent pre-test wave, the test barrier, and continued use of the safe
      `scripts/run-tests.js` path.

## Approval Confirmation

No Work Records are superseded. The earlier parallel-test work remains authoritative for test-process isolation; this
Plan changes only the scheduling before the existing test task starts.

## Verification Plan

- Automated focused check: `deno run -A scripts/run-tests.js scripts/run-ci.test.ts`.
- Automated task/config checks:
  `deno fmt --check deno.json scripts/run-ci.ts scripts/run-ci.test.ts docs/contributing.md` and `deno task check`.
- Automated policy checks: `deno task language-policy:check`, `deno task seams:check`, and `deno task doc-links:check`.
- End-to-end success: run `deno task ci`; observe all eight named pre-test start messages before the first wave
  completes, then observe `test` start only after all eight pass.
- Expected failure behavior is covered in focused tests rather than by damaging a real repository gate: multiple
  pre-test failures are all returned, test is absent, and a failed test exit code becomes the CI exit code.
- Existing test behavior that must remain protected: `deno task test` still invokes `write-version.js` and
  `scripts/run-tests.js`, each test file remains process-isolated with sandboxed `HOME` and `MNEMOTECA_DB_PATH`, and no
  direct `deno test` invocation is introduced. No existing behavior is expected to stop except sequential pre-test
  execution and first-failure short-circuiting inside that wave.

## Edge Cases & Considerations

- Deno tasks can share the module cache concurrently. Deno owns cache coordination; the runner must not create a second
  cache or sandbox policy.
- `check` can update the ignored generated `src/shared/version.js`. It is the only pre-test writer, and `test` remains
  after the barrier, so there is no concurrent version writer.
- Concurrent task output can interleave. Named start/completion lines and a final ordered failure summary keep the
  source of each result clear without buffering potentially large command output.
- A failed pre-test command must not cancel its siblings. Waiting for the full wave gives contributors all available
  gate diagnostics in one run.
- The all-at-once choice raises peak CPU and memory use compared with two waves. The tasks are short in the supplied
  warm measurements; a future measured resource problem can introduce a concurrency limit without changing individual
  task contracts.
