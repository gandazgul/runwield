---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Persist each Plan's Objective-Failing Checks as Front Matter through plan_written and run them in Mechanical Validation, so the one check designed to fail is actually executed."
affectedPaths:
    - "src/shared/workflow/objective-checks.ts"
    - "src/tools/plan-written.js"
    - "src/plan-store.js"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-legacy.ts"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/document-formats/planner-plan-format.md"
    - "CONTEXT.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-01T01:39:35-04:00"
status: "validated_reviewer"
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
- Mechanical Validation runs `runLocalCI` (`validation-legacy.ts:1416`) — the project's generic CI command, which has
  never read the Plan and passes on an empty change.

So the one check designed to fail is the only check no independent stage executes. The rename-plus-`export {}` split
failure passed every gate for exactly this reason.

## Objective

A Plan's Objective-Failing Checks become durable RunWield-owned state that Mechanical Validation executes: submitted
through `plan_written`, persisted in Front Matter, run after CI passes, and failing the phase when unmet.

This Plan makes the checks _run_. Proving they were red before the work is
[`baseline-objective-checks-before-execution`](baseline-objective-checks-before-execution.md), which depends on this
one.

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

- `src/shared/workflow/objective-checks.ts` — new: check execution and result classification.
- `src/plan-store.js` — `objectiveChecks` in the Plan Front Matter type, schema, and normalization.
- `src/tools/plan-written.js` — accept and validate the `objectiveChecks` parameter; reject a check-less PLANNED_CHANGE.
- `src/shared/workflow/validation.ts` / `validation-legacy.ts` — run the check set after CI and fold `unmet` results
  into the existing repair loop.
- `src/agent-definitions/planner.md`, `document-formats/planner-plan-format.md` — reconcile wording with the shipped
  parameter shape.
- `CONTEXT.md` — Objective-Failing Check as canonical project language.

## Reuse Opportunities

- `src/shared/workflow/validation-legacy.ts` — `runLocalCI` for the command-execution and output-capture pattern;
  `runCompletionGatedRepair` for the repair loop that `unmet` results feed into.
- `src/tools/plan-written.js` — the existing front-matter policy-rejection path (`policy.error`) is the model for
  rejecting a check-less submission back to Planner.
- `src/shared/workflow/plan-lifecycle.js` — `recordPlanEvent` and the existing event vocabulary.
- `src/shared/workflow/metrics.js` — `recordWorkflowMetric` for check outcomes.

## Implementation Steps

- [ ] `src/shared/workflow/objective-checks.ts` exports `runObjectiveChecks({ checks, cwd, signal, timeoutMs })`
      returning one result per check with status `"met" | "unmet" | "broken"`, captured stdout/stderr, exit code, and
      duration. A command that cannot be spawned or exceeds its timeout classifies as `"broken"`, never `"unmet"`. The
      module imports nothing from `validation.ts` or `validation-legacy.ts`.
- [ ] `src/shared/workflow/objective-checks.ts` exports `summarizeObjectiveChecks(results)` producing counts and the
      human-readable failure block, so validation output and the later baseline rejection share one format.
- [ ] `src/plan-store.js` accepts, validates, normalizes, and round-trips `objectiveChecks` in Plan Front Matter as an
      array of `{ id, command, rationale }`. Plans without the field load unchanged, so existing Plans in `plans/` and
      `plans/archived/` still parse.
- [ ] `plan_written` accepts an `objectiveChecks` parameter and writes it to Front Matter. A PLANNED_CHANGE submission
      with zero checks is rejected with the reason and the format reference, and no lifecycle transition is recorded.
      PROJECT Epics accept and require none.
- [ ] `plan_written` caps check count and per-command length so a Plan header cannot grow unbounded.
- [ ] Mechanical Validation runs the Plan's checks after `runLocalCI` passes and before Semantic Review, reporting each
      check ID with its status in the progress surface.
- [ ] An `"unmet"` check fails the phase and feeds the existing completion-gated repair loop with the check ID, command,
      and captured output, under the same attempt ceiling as CI failure.
- [ ] A `"broken"` check stops the phase and surfaces the command, exit status, and captured output to the user as a
      Plan defect rather than consuming repair attempts.
- [ ] QUICK_FIX validation and PROJECT Epics run no checks; a legacy Plan without `objectiveChecks` validates exactly as
      it does today.
- [ ] `CONTEXT.md` defines Objective-Failing Check and its exit-0 contract in the same change.

## Verification Plan

- Automated: `deno task ci`.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts src/tools/__tests__/plan-written.test.js src/plan-store.test.js`
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
- `OC2` — `grep -rq "runObjectiveChecks" src/shared/workflow/validation.ts src/shared/workflow/validation-legacy.ts` —
  Mechanical Validation calls the checks rather than remaining CI-only.
- `OC3` — `grep -q "objectiveChecks" src/tools/plan-written.js && grep -q "objectiveChecks" src/plan-store.js` — the
  parameter is accepted and persisted, not merely documented in the prompts.
- `OC4` — `! grep -q "validation" src/shared/workflow/objective-checks.ts` — the module stays free of validation
  imports, so the baseline Plan can call it from the execution path.

## Edge Cases & Considerations

- **Checks run untrusted shell commands authored by a model.** They execute with the same authority as `runLocalCI` on
  the user's machine. Keep them subject to the same permission and sandbox posture as CI; do not add a broader-privilege
  path. Enforce a per-check timeout so a hanging command cannot wedge validation.
- Until the baseline Plan lands, a check that was already green before the work still passes here. That is a known and
  accepted gap for this Plan, not something to paper over with a heuristic.
- A check that re-runs one test file is slower than a grep, but Mechanical Validation already runs the full suite via
  CI, so the marginal cost is small. Do not special-case by command shape.
- `validation-legacy.ts` does not type-check cleanly in isolation today. Do not widen its looseness into the new module,
  which is typed properly per the house style.
- Check output can be large. Truncate captured output for the repair prompt the same way other validation output is
  truncated, keeping the failing command and exit status intact.
