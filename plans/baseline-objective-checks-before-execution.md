---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Run each Plan's Objective-Failing Checks against the unmodified tree before execution starts and require every one to fail, so a check that cannot discriminate the objective is rejected back to Planner."
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/plan-store.js"
    - "src/shared/workflow/objective-checks.ts"
    - "src/agent-definitions/planner.md"
dependencies:
    - "run-objective-checks-in-mechanical-validation"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-01T01:39:35-04:00"
status: "draft"
---

# Baseline Objective-Failing Checks Before Execution

## Context

[`run-objective-checks-in-mechanical-validation`](run-objective-checks-in-mechanical-validation.md) makes Mechanical
Validation execute each Plan's Objective-Failing Checks and fail when one is unmet. That closes the hole where nobody
ran the checks, but it leaves one open: **a check that was already green before any work started still passes.**

`! grep -rq "renderLegacy" src/` proves nothing if `renderLegacy` never existed. `test -f src/parser/tokens.ts` proves
nothing if the file was already there. Both are green at validation time and neither measures the objective. A Plan
built entirely from checks like that is indistinguishable, to the pipeline, from one whose checks genuinely
discriminate.

Planner is already told to hold each check to this standard (`planner.md`, "The Verification Plan must be able to
fail"), but nothing verifies the claim, and it is the kind of claim that is easy to believe about your own work.

## Objective

Before execution starts, RunWield runs the Plan's checks against the unmodified tree and requires **every one to fail**.
A check that is already green cannot discriminate the objective, so the Plan returns to Planner instead of executing.

Combined with the dependency Plan, each check must transition red → green across the implementation, and both endpoints
are observed by RunWield rather than reported by the agent that did the work. That is what makes the check uncheatable
rather than decorative: there is no phrasing that satisfies both endpoints without doing the work.

## Approach

`executePlan` runs the check set in the resolved execution cwd before the Engineer turn starts, and persists the results
to Front Matter as `objectiveChecksBaseline` alongside the `head` they were measured against.

Three outcomes, and they route differently because they mean different things:

- **All unmet** — the checks discriminate. Execution proceeds.
- **Any met** — the Plan returns to Planner with the offending check IDs. This is a Plan defect, and the message should
  say the check is already satisfied rather than implying the Plan is wrong overall, because the honest cause is often
  that the user partially implemented the work by hand.
- **Any broken** — surfaced to the user as a Plan defect. A command that cannot run tells us nothing about the
  objective, and silently treating it as red would let a typo'd check pass the baseline and then fail validation.

The baseline is bound to a commit. A resumed or re-reviewed Plan whose recorded `head` no longer matches the execution
tree is re-baselined, because a check that was red against an old commit proves nothing about the current one.

No new module: `runObjectiveChecks` and `summarizeObjectiveChecks` already exist from the dependency Plan, and that Plan
deliberately keeps `objective-checks.ts` free of validation imports so the execution path can call it.

## Files to Modify

- `src/shared/workflow/workflow.js` — baseline in `executePlan` before the Engineer turn; route the three outcomes.
- `src/plan-store.js` — `objectiveChecksBaseline` as `{ recordedAt, head, results }` in Plan Front Matter.
- `src/shared/workflow/objective-checks.ts` — a baseline-specific classifier over existing results, if the routing logic
  does not fit naturally at the call site.
- `src/agent-definitions/planner.md` — state that RunWield verifies redness before execution, so Planner knows an
  already-green check comes back.

## Reuse Opportunities

- `src/shared/workflow/objective-checks.ts` — `runObjectiveChecks` and `summarizeObjectiveChecks` from the dependency
  Plan; the rejection message reuses that summary format so baseline and validation failures read the same.
- `src/shared/workflow/workflow.js` — the existing plan-load-failure recovery path in `executePlan` is the model for
  returning a Plan to Planner without starting execution.
- `src/shared/workflow/plan-lifecycle.js` — `recordPlanEvent` for the baseline outcome transition.
- `src/shared/git-snapshot.js` — resolving the `head` the baseline is bound to.

## Implementation Steps

- [ ] `src/plan-store.js` accepts, validates, normalizes, and round-trips `objectiveChecksBaseline` as
      `{ recordedAt, head, results }`. Plans without the field load unchanged.
- [ ] `executePlan` runs the Plan's checks against the unmodified execution tree before the Engineer turn starts and
      persists the results as `objectiveChecksBaseline` with the measured `head`.
- [ ] A baseline where every check is `"unmet"` proceeds to execution unchanged from today's behavior.
- [ ] A baseline where any check is `"met"` returns the Plan to Planner with the offending check IDs and the reason that
      an already-green check cannot discriminate the objective. Execution does not start and no worktree is created.
- [ ] A baseline where any check is `"broken"` surfaces the command, exit status, and captured output to the user as a
      Plan defect and does not silently proceed or route to Engineer repair.
- [ ] A Plan whose recorded `objectiveChecksBaseline.head` differs from the current execution tree is re-baselined
      rather than trusted, so a resumed or rebased Plan cannot execute on stale evidence.
- [ ] A legacy Plan with no `objectiveChecks` skips baselining and executes as it does today.
- [ ] `planner.md` states that RunWield runs the checks against the unmodified tree before execution and that an
      already-green check is returned, replacing the current self-check wording.
- [ ] `src/shared/workflow/objective-checks.test.ts` and the `executePlan` suite cover all-unmet, any-met, any-broken,
      stale-head re-baseline, and the legacy skip.

## Verification Plan

- Automated: `deno task ci`.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts src/shared/workflow/workflow.test.js src/plan-store.test.js`
- Automated: `deno task test:golden-tui` — a Golden scenario approves a Plan whose only check is already green and
  asserts it returns to Planner with no worktree created.
- Manual: submit a Plan whose only check is `true` and confirm Planner receives the rejection rather than execution
  starting.
- Manual: approve a normal Plan and confirm the baseline adds no user-visible delay beyond the check commands
  themselves.
- Existing behavior to preserve: execution of legacy Plans with no `objectiveChecks`, worktree creation and the
  Readiness Gate for Plans that pass the baseline, and every Mechanical Validation behavior from the dependency Plan.
- Behavior expected to stop existing: a Plan executing on checks that were already satisfied before any work began.

### Objective-Failing Checks

- `OC1` — `grep -q "objectiveChecksBaseline" src/shared/workflow/workflow.js` — the baseline runs on the execution path,
  not just in a helper nothing calls.
- `OC2` — `grep -q "objectiveChecksBaseline" src/plan-store.js` — the result is durable Front Matter, so a resumed Plan
  can tell whether it was baselined and against what.
- `OC3` — `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts` — the any-met
  rejection and stale-head re-baseline are exercised.

## Edge Cases & Considerations

- **The rejection must not read as an accusation.** A green check at baseline often means the user hand-implemented part
  of the work. Say which check is already satisfied and let Planner narrow it, rather than implying the Plan is wrong.
- Baselining runs model-authored shell commands before any Engineer work, on the user's machine, under the same
  authority as CI. Enforce the same per-check timeout the dependency Plan sets.
- The baseline runs in the resolved execution cwd. For a worktree-based execution this must happen before or against the
  same baseline commit the worktree is cut from, or the two endpoints are not comparable.
- A `deno test`-shaped check is slower at baseline than a grep, and now runs twice per Plan. Acceptable, but if baseline
  latency becomes visible the fix is fewer or cheaper checks, not skipping the baseline.
- Non-Git in-place execution has no `head`. Record the baseline without one and re-baseline on every execution attempt,
  rather than trusting a baseline that cannot be invalidated.
- A Plan returned to Planner for a green check must not lose its approval history or leave a half-created worktree
  registry entry.
