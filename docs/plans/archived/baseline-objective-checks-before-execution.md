---
planId: "c3890fc4-66e3-4c47-99bb-af609e2b4047"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Run each Plan's Objective-Failing Checks against the unmodified tree before execution starts and require every one to fail, so a check that cannot discriminate the objective is rejected back to Planner."
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/objective-checks.ts"
    - "src/shared/workflow/objective-checks.test.ts"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/agent-definitions/planner.md"
    - "docs/domain-language.md"
objectiveChecks:
    - id: "OC1"
      command: "grep -q \"objectiveChecksBaseline\" src/shared/workflow/workflow.js"
      rationale: "The baseline must run on the execution path, not just in a helper nothing calls."
    - id: "OC2"
      command: "grep -q \"objectiveChecksBaseline\" src/plan-store.js"
      rationale: "The baseline result must be durable Plan Front Matter so resumed Plans can compare the recorded head/check set."
    - id: "OC3"
      command: "grep -q \"baseline rejects already-met Objective-Failing Checks before Engineer starts\" src/shared/workflow/workflow.test.js && deno run -A scripts/run-tests.js -A --no-check --filter \"baseline rejects already-met Objective-Failing Checks before Engineer starts\" src/shared/workflow/workflow.test.js"
      rationale: "This focused behavior test only passes when an already-green baseline is rejected before Engineer ownership or lifecycle start."
    - id: "OC4"
      command: "grep -q \"re-baselines Objective-Failing Checks when head or command set changes\" src/shared/workflow/workflow.test.js && deno run -A scripts/run-tests.js -A --no-check --filter \"re-baselines Objective-Failing Checks when head or command set changes\" src/shared/workflow/workflow.test.js"
      rationale: "This focused behavior test only passes when stale baseline evidence is not trusted after the execution base or check commands change."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-01T01:39:35-04:00"
updatedAt: "2026-08-02T04:20:05.716Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
dependencies:
    - "run-objective-checks-in-mechanical-validation"
implementedAt: "2026-08-02T02:44:05.146Z"
verifiedAt: "2026-08-02T04:19:23.013Z"
userVerifiedAt: null
executionReport: "- Implemented baseline Objective-Failing Check support: normalized/persisted `objectiveChecksBaseline`, baseline classification/matching helpers, workflow pre-execution baselining for worktree and non-Git execution, stale-baseline re-run logic, and Planner rejection routing for already-met/broken checks.\n- Added/updated coverage in `objective-checks.test.ts`, `workflow.test.js`, and `plan-store.test.js`, including the required tests `baseline rejects already-met Objective-Failing Checks before Engineer starts` and `re-baselines Objective-Failing Checks when head or command set changes`.\n- Updated Planner and context docs to describe mechanically observed red-before-execution and green-during-validation checks.\n- Verification passed: `deno task ci`; `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts src/shared/workflow/workflow.test.js src/plan-store.test.js`; `deno task test:golden-tui` (first attempt timed out at 180s, rerun with 360s passed).\n- Manual verification from the plan was not performed interactively; automated workflow/golden coverage exercises the same already-green rejection and normal execution paths."
workRecord:
    status: "generated"
    recordId: "34e2c783-7a34-46ae-af64-b2008c0da826"
    path: "docs/work-records/2026-08-02-baseline-objective-failing-checks-before-execution.md"
    lastAttemptAt: "2026-08-02T04:19:57.646Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-02T04:19:21.572Z"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "3dc86832329a7a3b9de5a8c42c15b13eb91a1072"
    targetBranch: "main"
    targetHeadBeforeMerge: "c95cd744d79e475995d252a862bac60300fcccd0"
validationCiAttempts: 0
validationSemanticRounds: 1
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

`executePlan` / `startActiveExecutionWorkflow` run the check set after readiness and execution-target selection but
before the Engineer turn, `execution_started` Plan Event, or active execution workflow. For Git worktree execution, this
means the checks run in the prepared execution worktree at the same base commit the worktree will execute from; for
non-Git in-place execution, they run in the project root after the explicit in-place consent step and before the
execution-start lifecycle event.

The result is persisted to canonical Plan Front Matter as `objectiveChecksBaseline: { recordedAt, head, results }`. For
Git worktrees, `head` is the execution base commit (`worktree.baseCommit` / registry `baseCommit`) rather than the
mutable target branch name. For non-Git execution there is no durable `head`, so RunWield records no head and
re-baselines on every execution attempt. The `results` include each result's ID and command, so a baseline is reusable
only when both the recorded `head` and the normalized check ID/command set still match the current Plan.

Three outcomes, and they route differently because they mean different things:

- **All unmet** — the checks discriminate. The baseline is persisted, execution preparation continues, and the Engineer
  turn starts normally.
- **Any met** — the Plan returns to Planner with the offending check IDs. This is a Plan defect, and the message should
  say the check is already satisfied rather than implying the Plan is wrong overall, because the honest cause is often
  that the user partially implemented the work by hand.
- **Any broken** — surfaced as a Plan defect with the command, exit status or timeout/spawn reason, and captured output.
  A command that cannot run tells us nothing about the objective, and silently treating it as red would let a typo'd
  check pass the baseline and then fail validation. It must not route to Engineer repair.

A failed baseline must unwind execution preparation cleanly. If RunWield created a fresh worktree to prove the baseline,
that worktree and registry entry are rolled back; if it was reusing existing recoverable evidence, the evidence is
preserved but execution is not marked started. The user-visible invariant is that no Engineer turn starts, no active
execution workflow is installed, and the Plan does not move to `in_progress`.

No new runner module: `runObjectiveChecks` and `summarizeObjectiveChecks` already exist from the dependency Plan, and
that Plan deliberately keeps `objective-checks.ts` free of validation imports so the execution path can call it. Add
only a small baseline classifier/helper if keeping the routing predicates out of `workflow.js` makes the code clearer.

## Files to Modify

- `src/shared/workflow/workflow.js` — baseline during execution preparation before `execution_started` and the Engineer
  turn; route already-met and broken baseline outcomes back to planning/user-facing Plan-defect handling instead of
  Engineer repair.
- `src/shared/workflow/workflow.test.js` — cover the execution-path routing and lifecycle/worktree invariants for
  all-unmet, any-met, broken, stale-baseline, and legacy no-check Plans.
- `src/shared/workflow/objective-checks.ts` — a baseline-specific classifier over existing results, if the routing logic
  does not fit naturally at the call site.
- `src/shared/workflow/objective-checks.test.ts` — cover the baseline classifier/helper if one is added.
- `src/plan-front-matter.js` — add `objectiveChecksBaseline` to the ordered Plan Front Matter keys if the field is
  formatted as known metadata rather than preserved as an unknown key.
- `src/plan-store.js` — `objectiveChecksBaseline` as `{ recordedAt, head, results }` in Plan Front Matter, with result
  normalization strict enough to detect stale head/check-set evidence.
- `src/plan-store.test.js` — round-trip, normalization, invalid-entry, and legacy compatibility coverage for
  `objectiveChecksBaseline`.
- `src/agent-definitions/planner.md` — state that RunWield verifies redness before execution, so Planner knows an
  already-green check comes back.
- `docs/domain-language.md` — update Objective-Failing Check language to say RunWield now verifies the
  pre-implementation red state before execution and the post-implementation green state during Mechanical Validation.

## Reuse Opportunities

- `src/shared/workflow/objective-checks.ts` — `runObjectiveChecks` and `summarizeObjectiveChecks` from the dependency
  Plan; the rejection message reuses that summary format so baseline and validation failures read the same.
- `src/shared/workflow/workflow.js` — the existing plan-load-failure recovery path in `executePlan` is the model for
  returning a Plan to Planner without starting execution.
- `src/shared/workflow/state-transition.ts` — `runExecutionPreparationTransition` already owns the atomic boundary for
  worktree creation, Plan materialization, baseline-tree capture, registry settlement, and `execution_started`; use its
  rollback/journal behavior rather than adding a second lock.
- `src/shared/worktree.js` / worktree registry entries — worktree creation already records `baseCommit`, which is the
  Git `head` the Objective-Failing Check baseline should bind to.
- `src/plan-store.js` — `updatePlanFrontMatter` and Front Matter merge helpers are the existing route for durable
  RunWield-owned Plan metadata writes.

## Implementation Steps

- [ ] `src/plan-store.js` accepts, validates, normalizes, and round-trips `objectiveChecksBaseline` as
      `{ recordedAt, head, results }`. Plans without the field load unchanged, and malformed baseline metadata
      normalizes away rather than blocking legacy Plan loading.
- [ ] `objectiveChecksBaseline.results` preserve each check result's `id`, `command`, `status`, exit/spawn/timeout
      detail, bounded stdout/stderr, and duration from `runObjectiveChecks`; the stored result data is sufficient to
      name already-met and broken checks without re-running them.
- [ ] `startActiveExecutionWorkflow` runs the Plan's checks against the unmodified execution tree before it records
      `execution_started`, installs an active execution workflow, or allows the Engineer turn to start.
- [ ] For Git worktree execution, the baseline runs in the prepared execution worktree and records the base commit that
      the worktree was created from or safely reused at; for non-Git in-place execution, the baseline runs in the
      project root and records no `head`.
- [ ] A baseline where every check is `"unmet"` persists `objectiveChecksBaseline`, then proceeds to execution unchanged
      from today's behavior.
- [ ] A baseline where any check is `"met"` returns the Plan to Planner with the offending check IDs and the reason that
      an already-green check cannot discriminate the objective. No Engineer turn starts, no active execution workflow is
      installed, and the Plan does not reach `in_progress`.
- [ ] A baseline where any check is `"broken"` surfaces the command, exit status or spawn/timeout reason, and captured
      output as a Plan defect and does not silently proceed or route to Engineer repair.
- [ ] If a fresh worktree or registry entry was created only to run a baseline that is met/broken, preparation rollback
      removes that fresh evidence; if existing recoverable worktree evidence was reused, it is preserved but not marked
      active or started.
- [ ] A recorded `objectiveChecksBaseline` is trusted only when the recorded `head` matches the current execution base
      commit and the recorded result IDs/commands exactly match the current normalized `objectiveChecks`. Otherwise the
      Plan is re-baselined rather than executing on stale evidence.
- [ ] A legacy Plan with no `objectiveChecks` skips baselining and executes as it does today.
- [ ] `executePlan` handles the typed baseline-rejection outcome by reopening/routing to Planner rather than returning a
      generic execution-incomplete result that would leave the session owned by Engineer.
- [ ] `planner.md` states that RunWield runs the checks against the unmodified tree before execution and that an
      already-green check is returned, replacing the current self-check wording.
- [ ] `docs/domain-language.md` describes Objective-Failing Checks as mechanically observed red before execution and
      green during Mechanical Validation.
- [ ] `src/shared/workflow/workflow.test.js` contains behavior tests named
      `baseline rejects already-met Objective-Failing Checks before Engineer starts` and
      `re-baselines Objective-Failing Checks when head or command set changes`; these tests fail against today's code
      and prove the lifecycle/worktree invariants above.
- [ ] `src/shared/workflow/objective-checks.test.ts`, `src/shared/workflow/workflow.test.js`, and
      `src/plan-store.test.js` cover all-unmet, any-met, any-broken, stale-head or changed-command re-baseline, and the
      legacy skip.

## Verification Plan

- Automated: `deno task ci`.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check src/shared/workflow/objective-checks.test.ts src/shared/workflow/workflow.test.js src/plan-store.test.js`
- Automated: `deno task test:golden-tui` — a Golden scenario approves a Plan whose only check is already green and
  asserts it returns to Planner with no Engineer turn, no active execution workflow, and no durable in-progress Plan.
- Manual: submit a Plan whose only check is `true` and confirm Planner receives the rejection rather than execution
  starting.
- Manual: approve a normal Plan and confirm the baseline adds no user-visible delay beyond the check commands
  themselves.
- Existing behavior to preserve: execution of legacy Plans with no `objectiveChecks`, worktree creation and the
  Readiness Gate for Plans that pass the baseline, rollback/preservation behavior for execution preparation failures,
  and every Mechanical Validation behavior from the dependency Plan.
- Behavior expected to stop existing: a Plan executing on checks that were already satisfied before any work began.

### Objective-Failing Checks

- `OC1` — `grep -q "objectiveChecksBaseline" src/shared/workflow/workflow.js` — the baseline runs on the execution path,
  not just in a helper nothing calls.
- `OC2` — `grep -q "objectiveChecksBaseline" src/plan-store.js` — the result is durable Front Matter, so a resumed Plan
  can tell whether it was baselined and against what.
- `OC3` —
  `grep -q "baseline rejects already-met Objective-Failing Checks before Engineer starts" src/shared/workflow/workflow.test.js && deno run -A scripts/run-tests.js -A --no-check --filter "baseline rejects already-met Objective-Failing Checks before Engineer starts" src/shared/workflow/workflow.test.js`
  — an already-green baseline is rejected before Engineer ownership or lifecycle start.
- `OC4` —
  `grep -q "re-baselines Objective-Failing Checks when head or command set changes" src/shared/workflow/workflow.test.js && deno run -A scripts/run-tests.js -A --no-check --filter "re-baselines Objective-Failing Checks when head or command set changes" src/shared/workflow/workflow.test.js`
  — stale baseline evidence cannot be trusted when the execution base or check commands changed.

## Execution Policy

- `executionAgent: "engineer"`
- `collaborationRecommendation: "autonomous"`
- No dev server or browser verification is required; this is workflow/lifecycle behavior, not browser UI work.

## Edge Cases & Considerations

- **The rejection must not read as an accusation.** A green check at baseline often means the user hand-implemented part
  of the work. Say which check is already satisfied and let Planner narrow it, rather than implying the Plan is wrong.
- Baselining runs model-authored shell commands before any Engineer work, on the user's machine, under the same
  authority as CI. Enforce the same per-check timeout the dependency Plan sets.
- The baseline runs in the resolved execution cwd. For a worktree-based execution this must happen against the same base
  commit the worktree is cut from, or the two endpoints are not comparable.
- A `deno test`-shaped check is slower at baseline than a grep, and now runs twice per Plan. Acceptable, but if baseline
  latency becomes visible the fix is fewer or cheaper checks, not skipping the baseline.
- Non-Git in-place execution has no `head`. Record the baseline without one and re-baseline on every execution attempt,
  rather than trusting a baseline that cannot be invalidated.
- A Plan returned to Planner for a green check must not lose its approval history, install Engineer as the active owner,
  or leave a half-created worktree registry entry.
