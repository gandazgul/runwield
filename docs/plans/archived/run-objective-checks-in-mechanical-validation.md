---
planId: "6628077e-29f5-4f9c-b993-7d9e13dc7cbf"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Persist each Plan's Objective-Failing Checks as Front Matter through plan_written and run them in Workflow Validation's Mechanical Validation phase, so the one check designed to fail is actually executed."
affectedPaths:
    - "src/shared/workflow/objective-checks.ts"
    - "src/shared/workflow/objective-checks.test.ts"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/tools/plan-written.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-loop-core.test.js"
    - "src/shared/workflow/validation-loop-repair.test.js"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/document-formats/planner-plan-format.md"
    - "docs/domain-language.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-01T01:39:35-04:00"
status: "verified"
origin: "internal"
implementedAt: "2026-08-01T18:51:26.646Z"
verifiedAt: "2026-08-01T20:56:47.371Z"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "bc9715b9-5a63-410b-b690-fc596e9a6ca9"
    path: "docs/work-records/2026-08-01-objective-checks-now-run-in-mechanical-validation.md"
    lastAttemptAt: "2026-08-02T15:21:28.249Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "7e7d3a99cce691df4c8b935cff6097f10b6d3d0b"
    targetBranch: "main"
    targetHeadBeforeMerge: "586b5a3a4700fbe188bb5c5239dbdf419db59c0c"
validationCiAttempts: 0
validationSemanticRounds: 1
updatedAt: "2026-08-09T05:03:37.680Z"
archivedAt: "2026-08-09T05:03:37.680Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/run-objective-checks-in-mechanical-validation.md"
---

# Run Objective-Failing Checks in Mechanical Validation

## Context

Planner already authors a falsifiable check per Plan (`planner.md`, "The Verification Plan must be able to fail"), and
recent Plans comply — `plans/expand-golden-tui-workflow-coverage.md` carries a real objective-failing check block. But
nothing in the pipeline runs them:

- Engineer is told to "Complete all Implementation Steps and the Verification Plan" (`workflow-prompts.js:190`) and
  self-reports the result in prose.
- The Semantic Reviewer is explicitly forbidden from auditing it: _"Do not audit whether the Engineer performed the
  Plan's verification procedures. Mechanical validation owns tests, linters, builds, and verification procedures."_
  (`workflow-prompts/reviewer-prompt.md:13-14`).
- Workflow Validation's Mechanical Validation phase starts in `runMechanicalValidationPhase` (`validation.ts`) and uses
  `runLocalCI` from `validation-local-ci.ts` — the project's generic CI command, which has never read the Plan and
  passes on an empty change.

So the one check designed to fail is the only check no independent stage executes. The rename-plus-`export {}` split
failure passed every gate for exactly this reason.

## Objective

A Plan's Objective-Failing Checks become durable RunWield-owned state that Workflow Validation executes during its
Mechanical Validation phase: submitted through `plan_written`, persisted in Front Matter, run after CI passes, and
failing the phase when unmet.

This Plan makes the checks _run_. The archived baseline objective-check Plan proved they were red before this work.

## Approach

Objective-Failing Checks live in Plan Front Matter (`objectiveChecks`), which is RunWield-owned under the plan ownership
split — the Plan body keeps describing them in prose for the human reviewer, but the executable copy is written by
`plan_written` through a tool call, never by an agent editing the file.

One uniform contract per check: **exit 0 means the objective was met.** No per-check expectation grammar, no output
matching. `! grep -rq oldSymbol src/`, `test "$(wc -l < f.ts)" -lt 400`, and `deno test path/to.test.ts` all fit it.

A new `src/shared/workflow/objective-checks.ts` owns running a check set against a working directory and classifying
each result. It is written as a standalone module with no validation dependencies, because the baseline Plan will call
it from `executePlan` — putting it inside the validation modules would force that Plan to import validation into the
execution path.

The classification is three-valued, not pass/fail:

- **met** — exit 0.
- **unmet** — non-zero exit from a command that ran.
- **broken** — the command could not run at all (spawn failure, missing interpreter, timeout). A broken check is a Plan
  defect, not an implementation failure, and must never consume Engineer repair attempts.

## Files to Modify

- `src/shared/workflow/objective-checks.ts` — new TypeScript module for shell execution, timeout handling, output
  capture, result classification, and summary formatting.
- `src/shared/workflow/objective-checks.test.ts` — new tests for met/unmet/broken classification, timeout behavior,
  output capture, summary formatting, and validation-import independence.
- `src/plan-front-matter.js` — add `objectiveChecks` to the known ordered Front Matter keys so formatting and merge
  overrides keep it in a stable location.
- `src/plan-store.js` — `objectiveChecks` in the Plan Front Matter typedef, parsing, normalization, and round-trip
  formatting.
- `src/plan-store.test.js` — cover valid check normalization, invalid field dropping/rejection behavior, and legacy Plan
  compatibility.
- `src/tools/plan-written.js` — accept and validate the `objectiveChecks` parameter, write it to Front Matter before
  review, and reject a check-less PLANNED_CHANGE submission.
- `src/tools/__tests__/plan-written.test.js` — cover tool parameter validation, Front Matter persistence before review,
  PLANNED_CHANGE rejection with no checks, and PROJECT Epic exemption.
- `src/shared/workflow/validation.ts` — run the Plan check set after CI and fold `unmet` results into the existing Plan
  Workflow Validation repair loop.
- `src/shared/workflow/validation-loop-core.test.js`, `validation-loop-repair.test.js` — cover passing checks, unmet
  checks dispatching repair under the existing attempt ceiling, broken checks stopping without repair, and legacy Plans
  with no `objectiveChecks`.
- `src/agent-definitions/planner.md`, `document-formats/planner-plan-format.md` — reconcile Planner instructions and
  Plan format wording with the shipped `plan_written` parameter and Front Matter field.
- `docs/domain-language.md` — define Objective-Failing Check and clarify that executable Plan work runs these checks
  inside Workflow Validation's Mechanical Validation phase.

## Reuse Opportunities

- `src/shared/workflow/validation-local-ci.ts` and `src/shared/workflow/process-output.ts` — subprocess spawning and
  bounded output-capture patterns; prefer the shared `process-output.ts` helpers in the new module rather than copying
  validation-local code again.
- `src/shared/workflow/validation.ts` — `runMechanicalValidationPhase`, `dispatchCiRepair`, `getCiFailureReason`, and
  the durable `validationCiAttempts` counter are the model for how unmet checks consume repair attempts.
- `src/tools/plan-written.js` — the existing Front Matter policy-rejection path (`policy.error`) is the model for
  rejecting a check-less submission back to Planner before review/readiness.
- `src/plan-store.js` — `updatePlanFrontMatter` / Front Matter merge helpers are the route for tool-owned metadata
  updates; do not hand-edit YAML text in `plan_written`.
- `src/shared/workflow/plan-lifecycle.js` — `recordPlanEvent` and the existing validation event vocabulary.
- `src/shared/workflow/metrics.js` — `recordWorkflowMetric` for check outcomes.

## Implementation Steps

- [ ] `src/shared/workflow/objective-checks.ts` exports `runObjectiveChecks({ checks, cwd, signal, timeoutMs })`
      returning one result per check with status `"met" | "unmet" | "broken"`, captured stdout/stderr, exit code,
      duration, command, and check ID. A command that cannot be spawned or exceeds its timeout classifies as `"broken"`,
      never `"unmet"`. The module imports nothing from `validation.ts`, `validation-local-ci.ts`, or
      `validation-helpers.ts`.
- [ ] `src/shared/workflow/objective-checks.ts` executes commands through the platform shell (`sh -c` / `cmd /c`) in the
      supplied `cwd`, uses a default per-check timeout constant, honors an abort `signal`, and captures bounded output
      through `src/shared/workflow/process-output.ts`.
- [ ] `src/shared/workflow/objective-checks.ts` exports `summarizeObjectiveChecks(results)` producing counts plus a
      human-readable block that names every non-met check by ID, command, status, exit code, timeout/spawn reason, and
      captured output tail, so validation output and the later baseline rejection share one format.
- [ ] `src/plan-front-matter.js` includes `objectiveChecks` in `PLAN_FRONT_MATTER_KEYS` immediately after
      `affectedPaths`, keeping it with the Plan's reviewable requirement metadata rather than lifecycle/recovery fields.
- [ ] `src/plan-store.js` accepts, validates, normalizes, and round-trips `objectiveChecks` in Plan Front Matter as an
      array of `{ id, command, rationale }`. `id` and `command` are required non-empty strings, `rationale` is an
      optional non-empty string, IDs are unique within a Plan, and invalid entries fail closed for newly written
      metadata while Plans without the field load unchanged.
- [ ] `plan_written` accepts an `objectiveChecks` parameter with the same `{ id, command, rationale }` shape and writes
      the normalized list to Front Matter using `updatePlanFrontMatter` before opening the review UI, so the reviewed
      Plan includes the executable copy RunWield will later run.
- [ ] A PLANNED_CHANGE submission with zero valid checks is rejected before review/readiness with the reason and the
      Plan format reference, and no Plan Lifecycle event is recorded. PROJECT Epics accept and require none.
- [ ] `plan_written` enforces bounded metadata: at most 12 checks, `id` at most 64 characters, `command` at most 1000
      characters, and `rationale` at most 500 characters.
- [ ] Workflow Validation's Mechanical Validation phase loads `objectiveChecks` from the canonical Plan metadata after
      CI passes and before `mechanical_validation_passed` is recorded. Each status line names the check currently
      running and the final summary lists every check ID with its status.
- [ ] An `"unmet"` check fails the phase and dispatches the Plan's execution Agent for repair with the check ID,
      command, rationale, and captured output, under the same `validationCiAttempts` / `AUTOMATIC_ROUNDS` ceiling as CI
      failure.
- [ ] A `"broken"` check records/stages a validation failure reason when possible, surfaces the command, exit status or
      spawn/timeout reason, and captured output to the user as a Plan defect, and does not dispatch Engineer or consume
      a repair attempt.
- [ ] QUICK_FIX no-plan Mechanical Validation and PROJECT Epics run no Objective-Failing Checks; an already-approved or
      external legacy Plan without `objectiveChecks` validates exactly as it does today.
- [ ] `docs/domain-language.md` defines Objective-Failing Check and its exit-0 contract in the same change, and
      clarifies the distinction between no-plan QUICK_FIX Mechanical Validation and the Mechanical Validation phase
      inside Workflow Validation.

## Verification Plan

- Automated: `deno task ci`.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts src/tools/__tests__/plan-written.test.js src/plan-store.test.js src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-repair.test.js`
- Automated: `deno task test:golden-tui` — a Golden scenario drives a Plan whose check goes green after implementation,
  and a second whose check stays red and reaches the repair loop.
- Manual: submit a Plan with no checks and confirm Planner receives the rejection rather than the Plan reaching review.
- Manual: submit a Plan whose check is `not-a-real-command` and confirm the user sees a Plan defect, not an Engineer
  repair round.
- Existing behavior to preserve: CI-only Mechanical Validation for QUICK_FIX, the current repair attempt ceiling and its
  messaging, Semantic Review's scope, and validation of legacy Plans that predate `objectiveChecks`.
- Behavior expected to stop existing: a PLANNED_CHANGE reaching `validated_ci` without any Plan-derived check running.

### Objective-Failing Checks

- `OC1` — `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts` — the module and
  its three-valued classification exist and are exercised.
- `OC2` — `grep -q "runObjectiveChecks" src/shared/workflow/validation.ts` — Workflow Validation's Mechanical Validation
  phase calls the checks rather than remaining CI-only.
- `OC3` —
  `grep -q "objectiveChecks" src/tools/plan-written.js && grep -q "objectiveChecks" src/plan-store.js && grep -q "objectiveChecks" src/plan-front-matter.js`
  — the parameter is accepted, persisted, and formatted as known Front Matter, not merely documented in the prompts.
- `OC4` —
  `deno eval -A 'const s=await Deno.readTextFile("src/shared/workflow/objective-checks.ts"); Deno.exit(/from\s+["\x27][^"\x27]*validation|import\s*\(\s*["\x27][^"\x27]*validation/.test(s) ? 1 : 0)'`
  — the module stays free of validation imports, so the baseline Plan can call it from the execution path.

## Edge Cases & Considerations

- **Checks run untrusted shell commands authored by a model.** They execute with the same authority as `runLocalCI` on
  the user's machine. Keep them subject to the same permission and sandbox posture as CI; do not add a broader-privilege
  path. Enforce a per-check timeout so a hanging command cannot wedge validation.
- Until the baseline Plan lands, a check that was already green before the work still passes here. That is a known and
  accepted gap for this Plan, not something to paper over with a heuristic.
- A check that re-runs one test file is slower than a grep, but Mechanical Validation already runs the full suite via
  CI, so the marginal cost is small. Do not special-case by command shape.
- `validation.ts` is a large lifecycle module; keep the new command runner isolated and typed rather than growing a
  second validation driver or adding broad dependency seams. Do not add `__deps` for RunWield-owned objective check
  machinery; test it with real temp directories and real shell commands.
- Check output can be large. Truncate captured output for the repair prompt the same way other validation output is
  truncated, keeping the failing command and exit status intact.
- Updating the canonical Plan format changes how future Planner calls `plan_written`, but existing draft Plans may still
  only have a body section until they are resubmitted. Treat the tool parameter and persisted Front Matter as authority;
  the body section remains reviewable explanation.
