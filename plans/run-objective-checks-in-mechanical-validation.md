---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Run each Plan's Objective-Failing Checks as durable Front Matter state: red against the pre-change tree before execution, green during Mechanical Validation."
affectedPaths:
    - "src/tools/plan-written.js"
    - "src/plan-store.js"
    - "src/shared/workflow/objective-checks.ts"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-legacy.ts"
    - "src/shared/workflow/workflow.js"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/document-formats/planner-plan-format.md"
    - "CONTEXT.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-01T00:32:24-04:00"
status: "draft"
---

# Run Objective-Failing Checks in Mechanical Validation

## Context

Planner already authors a falsifiable check per Plan (`planner.md`, "The Verification Plan must be able to fail"), and
recent Plans comply — `plans/expand-golden-tui-workflow-coverage.md` carries a real "Objective-failing checks" block.
But nothing in the pipeline runs them:

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

Make each Plan's Objective-Failing Checks executable, RunWield-owned state that gates delivery:

1. Planner submits them through `plan_written`; RunWield persists them in Plan Front Matter.
2. RunWield **baselines** them against the unmodified tree before execution begins. A check that is already green there
   is not measuring the objective, and the Plan goes back to Planner.
3. Mechanical Validation runs them after CI passes. A red check routes into the existing repair loop.

Baselining is what makes this uncheatable rather than decorative. A check must transition red → green across the
implementation, and both ends are observed by RunWield, not reported by the agent that did the work.

## Approach

Objective-Failing Checks live in Plan Front Matter (`objectiveChecks`), which is RunWield-owned under the plan ownership
split — the Plan body keeps describing them in prose for the human reviewer, but the executable copy is written by
`plan_written` through a tool call, never by an agent editing the file.

One uniform contract per check: **exit 0 means the objective was met.** No per-check expectation grammar, no output
matching. `! grep -rq oldSymbol src/`, `test "$(wc -l < f.ts)" -lt 400`, and `deno test path/to.test.ts` all fit it
already.

A new `src/shared/workflow/objective-checks.ts` owns running a check set against a working directory and classifying
each result. It is used by two call sites (pre-execution baseline, Mechanical Validation) so the semantics cannot drift
between them.

The classification that matters is three-valued, not pass/fail:

- **met** — exit 0.
- **unmet** — non-zero exit from a command that ran.
- **broken** — the command could not run at all (spawn failure, missing interpreter, timeout). A broken check is a Plan
  defect, not an implementation failure, and must never feed the Engineer repair loop; it goes to the user.

## Files to Modify

- `src/plan-store.js` — `objectiveChecks` in the Plan Front Matter type, schema, and normalization; baseline results
  recorded alongside them.
- `src/tools/plan-written.js` — accept and validate the `objectiveChecks` parameter; reject a submission that carries
  none.
- `src/shared/workflow/objective-checks.ts` — new module owning check execution and result classification.
- `src/shared/workflow/workflow.js` — baseline the check set against the pre-change tree in `executePlan` before the
  Engineer turn starts.
- `src/shared/workflow/validation.ts` / `validation-legacy.ts` — run the check set after CI in Mechanical Validation and
  fold `unmet` results into the existing repair loop.
- `src/agent-definitions/planner.md` and `document-formats/planner-plan-format.md` — already updated to describe the
  contract; reconcile wording with the shipped parameter shape.
- `CONTEXT.md` — Objective-Failing Check as canonical project language.

## Reuse Opportunities

- `src/shared/workflow/validation-legacy.ts` — `runLocalCI` for the command-execution and output-capture pattern;
  `runCompletionGatedRepair` for the repair loop that `unmet` results feed into.
- `src/shared/workflow/plan-lifecycle.js` — `recordPlanEvent` and the existing event vocabulary for the new baseline and
  check-failure transitions.
- `src/tools/plan-written.js` — the existing front-matter policy-rejection path (`policy.error`) is the model for
  rejecting a check-less or non-discriminating submission back to Planner.
- `src/shared/workflow/metrics.js` — `recordWorkflowMetric` for baseline and validation check outcomes.

## Implementation Steps

- [ ] `src/shared/workflow/objective-checks.ts` exports `runObjectiveChecks({ checks, cwd, signal, timeoutMs })`
      returning one result per check with status `"met" | "unmet" | "broken"`, captured stdout/stderr, exit code, and
      duration. A command that cannot be spawned or exceeds its timeout classifies as `"broken"`, never `"unmet"`.
- [ ] `src/shared/workflow/objective-checks.ts` exports `summarizeObjectiveChecks(results)` producing the counts and the
      human-readable failure block reused by both the baseline rejection message and the Mechanical Validation report.
- [ ] `src/plan-store.js` accepts, validates, normalizes, and round-trips `objectiveChecks` in Plan Front Matter as an
      array of `{ id, command, rationale }`, and `objectiveChecksBaseline` as `{ recordedAt, head, results }`. Plans
      without the field load unchanged, so existing Plans in `plans/` and `plans/archived/` still parse.
- [ ] `plan_written` accepts an `objectiveChecks` parameter and writes it to Front Matter. A PLANNED_CHANGE submission
      with zero checks is rejected with the reason and the format reference, and no lifecycle transition is recorded.
      PROJECT Epics accept and require none.
- [ ] `executePlan` runs the Plan's checks against the unmodified execution tree before the Engineer turn starts and
      persists the results as `objectiveChecksBaseline`. Every check must be `"unmet"` to proceed.
- [ ] A baseline where any check is `"met"` returns the Plan to Planner with the offending check IDs and the reason that
      an already-green check cannot discriminate the objective. Execution does not start and no worktree is created.
- [ ] A baseline where any check is `"broken"` surfaces the command, exit status, and captured output to the user as a
      Plan defect and does not silently proceed or route to Engineer repair.
- [ ] Mechanical Validation runs the Plan's checks after `runLocalCI` passes and before Semantic Review, reporting each
      check ID with its status in the progress surface.
- [ ] An `"unmet"` check in Mechanical Validation fails the phase and feeds the existing completion-gated repair loop
      with the check ID, command, and captured output, under the same attempt ceiling as CI failure.
- [ ] A `"broken"` check in Mechanical Validation stops the phase and surfaces the Plan defect to the user rather than
      consuming repair attempts.
- [ ] QUICK_FIX validation and PROJECT Epics run no checks and are unaffected; a legacy Plan without `objectiveChecks`
      executes and validates exactly as it does today.
- [ ] `CONTEXT.md` defines Objective-Failing Check and its red-before/green-after contract in the same change.

## Verification Plan

- Automated: `deno task ci`.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts
  src/tools/__tests__/plan-written.test.js src/shared/workflow/validation-*.test.* src/plan-store.test.js`
- Automated: `deno task test:golden-tui` — a Golden scenario drives a Plan whose check is red at baseline and green
  after implementation, and a second whose check stays red through validation and reaches the repair loop.
- Manual: submit a Plan whose only check is `true` and confirm Planner receives the rejection rather than execution
  starting.
- Manual: submit a Plan whose check is `not-a-real-command` and confirm the user sees a Plan defect, not an Engineer
  repair round.
- Existing behavior to preserve: CI-only Mechanical Validation for QUICK_FIX, the current repair attempt ceiling and its
  messaging, Semantic Review's scope (it still does not audit verification procedures), and execution of legacy Plans
  that predate `objectiveChecks`.
- Behavior expected to stop existing: a PLANNED_CHANGE reaching `validated_ci` without any Plan-derived check running.

### Objective-Failing Checks

- `OC1` — `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts` — the module and
  its three-valued classification exist and are exercised.
- `OC2` — `grep -rq "runObjectiveChecks" src/shared/workflow/validation.ts src/shared/workflow/validation-legacy.ts` —
  Mechanical Validation actually calls the checks rather than remaining CI-only.
- `OC3` — `grep -q "objectiveChecks" src/tools/plan-written.js && grep -q "objectiveChecks" src/plan-store.js` — the
  parameter is accepted and persisted, not merely documented in the prompts.
- `OC4` — `grep -q "objectiveChecksBaseline" src/shared/workflow/workflow.js` — the pre-execution baseline exists, so a
  check cannot be authored green.

## Edge Cases & Considerations

- **Checks run untrusted shell commands authored by a model.** They execute with the same authority as `runLocalCI` on
  the user's machine. Keep them subject to the same permission and sandbox posture as CI; do not add a broader-privilege
  path. Enforce a per-check timeout so a hanging command cannot wedge validation.
- **Baseline runs against the pre-change tree, but a worktree may not exist yet.** Baseline in the execution cwd
  resolved for the Plan, before any Engineer edits; record the `head` alongside results so a stale baseline is
  detectable after a rebase or a resumed Plan.
- **A resumed or re-reviewed Plan may already carry a baseline.** Re-baseline when the recorded `head` no longer matches
  the execution tree; a check that was red against an old commit proves nothing about the current one.
- **A check may be green at baseline for a legitimate reason** — the user partially implemented the work by hand. The
  rejection message should say so and let Planner narrow the check rather than implying the Plan is wrong.
- **`grep`-shaped checks are portable; `deno test`-shaped ones are slower.** Mechanical Validation already runs the full
  suite via CI, so a check that re-runs one test file is cheap. Do not special-case it.
- Front Matter grows with check text. Cap the check count and per-command length in `plan_written` validation rather
  than letting a Plan header become unbounded.
