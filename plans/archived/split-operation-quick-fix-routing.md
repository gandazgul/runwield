---
planId: "8bc1fc1c-5747-426d-92fa-c45b8876efae"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Split OPERATION from QUICK_FIX routing and add no-plan Engineer mechanical validation."
affectedPaths:
    - "src/constants.js"
    - "src/tools/triage-report.js"
    - "src/agent-definitions/router.md"
    - "src/agent-definitions/operator.md"
    - "src/agent-definitions/engineer.md"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/workflow/validation.js"
    - "docs/workflows.md"
frontend: false
createdAt: "2026-07-02T14:05:13-04:00"
updatedAt: "2026-07-17T04:51:30.256Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-02T19:34:44.604Z"
workRecord:
    status: "generated"
    recordId: "f5bfa8dc-752c-4ade-9590-e4079e2df32c"
    path: "docs/work-records/2026-07-17-split-operation-and-quick-fix-routing.md"
    lastAttemptAt: "2026-07-17T04:51:20.908Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-02T19:34:41.792Z"
---

# Split OPERATION and QUICK_FIX Routing

## Context

`QUICK_FIX` currently mixes direct operational work with small code changes and routes both to Operator. The new domain
model separates non-code operations from bounded no-plan code implementation so execution ownership and validation match
the risk profile.

Resolved decisions from the request and project decisions:

- `OPERATION` becomes a distinct Routing Intent enum value.
- Canonical Routing Intent order is `INQUIRY`, `IDEATION`, `OPERATION`, `QUICK_FIX`, `FEATURE`, `PROJECT`.
- `OPERATION` routes to Operator for direct non-code repository/environment operations and self-verification.
- `QUICK_FIX` routes to Engineer for bounded no-plan code implementation.
- `QUICK_FIX` runs no-plan Mechanical Validation after Engineer calls `task_completed`: configured local CI, repair by
  Engineer, capped at three total repair attempts.
- `QUICK_FIX` does not run Reviewer/semantic review or Plannotator code review because there is no Plan to compare
  against.
- Dependency upgrades may start as `OPERATION` only when explicitly requested; if CI fails or code edits are required,
  Operator returns to Router with concise context for fresh triage.

## Objective

Update routing, agent definitions, workflow dispatch, validation behavior, docs, and tests so RunWield supports the new
six-intent routing model and directs each no-plan path to the right executor:

- `OPERATION` → Operator, no RunWield validation loop.
- `QUICK_FIX` → Engineer, no Plan file, Mechanical Validation only.
- `FEATURE`/`PROJECT` → existing saved-plan lifecycle and workflow validation.

## Approach

Add `OPERATION` to the canonical Routing Intent list and update Router guidance so operational work routes to Operator
while small code changes route to Engineer. Split the current direct `QUICK_FIX` dispatch path in the orchestrator into
two paths:

- `OPERATION`: the current direct Operator execution shape, including a warning if Operator stops without
  `task_completed`, but no external validation after completion.
- `QUICK_FIX`: direct Engineer execution followed by a dedicated no-plan Mechanical Validation loop when Engineer calls
  `task_completed`.

Implement the Mechanical Validation loop as a separate exported helper in `src/shared/workflow/validation.js` instead of
reusing `runValidationLoop` with a fake plan name. It should reuse `runLocalCI` and the existing completion-gated repair
pattern, but must avoid Plan-specific behavior: no Plan Events, no Plan Status changes, no implementation diff
requirement, no Reviewer, no Plannotator code review, and no worktree merge-back.

## Files to Modify

- `src/constants.js` — add `OPERATION` to `ROUTING_INTENTS` in the agreed order.
- `src/tools/triage-report.js` — update `routingIntent` descriptions and affected-path guidance for `OPERATION` vs
  `QUICK_FIX`; preserve Plan Classification behavior only for `FEATURE`/`PROJECT`.
- `src/tools/task-completed.js` — update tool text so `QUICK_FIX` no longer says self-verification is the only
  validation path; distinguish Operator `OPERATION` self-verification from Engineer quick-fix completion.
- `src/agent-definitions/router.md` — define `OPERATION`, redefine `QUICK_FIX`, add uncertainty rules, and update
  dependency-upgrade escalation guidance.
- `src/agent-definitions/operator.md` — narrow Operator scope to operations; add dependency-upgrade mini-flow and
  immediate `return_to_router` escalation rules when code edits or failing CI exceed OPERATION scope.
- `src/agent-definitions/engineer.md` — allow direct `QUICK_FIX` execution in addition to approved Plan execution;
  clarify no-plan Mechanical Validation expectations.
- `src/shared/workflow/orchestrator.js` — update Routing Intent typedefs/normalization, route `OPERATION` to Operator,
  route `QUICK_FIX` to Engineer, and invoke no-plan Mechanical Validation after completed quick fixes.
- `src/shared/workflow/validation.js` — add a no-plan Mechanical Validation helper using local CI and Engineer repairs;
  keep `runValidationLoop` reserved for saved-plan validation.
- `src/shared/session/agent-handler.test.js` — update stale QUICK_FIX-as-Operator/legacy workflow expectations if they
  fail after the direct dispatch changes; direct quick fixes should be covered primarily in orchestrator tests.
- `scripts/router-eval-utils.js`, `scripts/curate-router-judgement-csv.js`, `scripts/evaluate-router-judgements.js`,
  `scripts/run-router-golden-set.js`, and router-eval tests — update intent order, materializing sets, disagreement
  labels, seeded operation examples, CLI help strings, and fixtures.
- `docs/workflows.md`, `docs/usage.md`, `docs/index.md`, `docs/quickstart.md`, `docs/contributing.md`,
  `docs/router-model-selection.md`, `docs/plan-lifecycle.md`, `README.md`, `CONTEXT.md` — align public workflow language
  with the six intents, OPERATION/QUICK_FIX ownership, Mechanical Validation, and Scope Escalation semantics.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/validation.js` — reuse `runLocalCI` and the completion-gated repair-session pattern; do not reuse
  Plan-specific semantic review, lifecycle, code review, or merge-back logic for quick fixes.
- `src/shared/workflow/orchestrator.js` — reuse the existing direct `QUICK_FIX` dispatch shape for the new `OPERATION`
  route.
- `src/shared/workflow/workflow.js` — reuse `readLatestTaskCompletedOutcome` for both OPERATION completion warnings and
  QUICK_FIX validation gating.
- `src/tools/triage-report.js` — reuse normalization that keeps `classification` only for plan-producing intents.
- `scripts/router-eval-utils.js` — reuse distance/disagreement helpers and extend them to the six-intent order.

## Implementation Steps

- [ ] Step 1: Update canonical Routing Intent data and JSDoc unions to include `OPERATION` in the order `INQUIRY`,
      `IDEATION`, `OPERATION`, `QUICK_FIX`, `FEATURE`, `PROJECT`.
- [ ] Step 2: Update `triage_report` schema descriptions and normalization tests so `OPERATION` is accepted and does not
      produce Plan Classification metadata.
- [ ] Step 3: Revise Router instructions: `OPERATION` is non-code direct work; `QUICK_FIX` is bounded no-plan code work;
      when risk is unclear, bias from `OPERATION` to `QUICK_FIX`, and from `QUICK_FIX` to `FEATURE`.
- [ ] Step 4: Revise Operator instructions: remove small-code-fix ownership, keep operations, add dependency-upgrade
      mini-flow, and require concise `return_to_router` scope escalation when CI/code changes exceed OPERATION scope.
- [ ] Step 5: Revise Engineer instructions to accept direct `QUICK_FIX` prompts, perform normal implementation
      verification before `task_completed`, and expect RunWield to run Mechanical Validation afterward.
- [ ] Step 6: Split orchestrator dispatch: `OPERATION` runs Operator and warns if no `task_completed`; `QUICK_FIX` runs
      Engineer and, only on `task_completed`, starts no-plan Mechanical Validation.
- [ ] Step 7: Implement `runMechanicalValidation` (or similarly named helper) for no-plan QUICK_FIX work: run configured
      local CI from the repository root/current execution root, send failures back to Engineer through the existing
      completion-gated repair pattern, and stop after three total Engineer repair attempts.
- [ ] Step 8: Ensure the no-plan helper reports clear pass/fail system messages and leaves Engineer active for
      follow-up; failure is not a Plan failure and must not record Plan lifecycle state.
- [ ] Step 9: Ensure the no-plan helper does not run semantic Reviewer, Plannotator code review, implementation diff
      checks, Plan Events, Plan Status changes, active execution worktree merge-back, or worktree registry updates.
- [ ] Step 10: Update `task_completed` text and agent docs so user-facing instructions no longer contradict the new
      OPERATION/QUICK_FIX split.
- [ ] Step 11: Update router-eval scripts/tests for the new enum, routing order, materializing boundary, operation
      examples such as commit/status/command requests, and OPERATION/QUICK_FIX disagreement labels.
- [ ] Step 12: Update workflow/tool tests for OPERATION dispatch, QUICK_FIX Engineer dispatch, validation success,
      validation repair success, validation cap failure, no-classification behavior, and no Reviewer for QUICK_FIX.
- [ ] Step 13: Update public docs and README references found by searching for `QUICK_FIX`, routing intent lists, and
      Operator descriptions.

## Verification Plan

- Automated: `deno task ci`
- Targeted tests before full CI when useful:
  - `deno test src/tools/__tests__/triage-report.test.js`
  - `deno test src/shared/workflow/orchestrator.test.js src/shared/workflow/validation.test.js`
  - `deno test src/shared/session/agent-handler.test.js`
  - `deno test scripts/router-eval-utils.test.js scripts/curate-router-judgement-csv.test.js scripts/evaluate-router-judgements.test.js scripts/run-router-golden-set.test.js scripts/write-router-judgement-csv.test.js scripts/extract-router-decisions.test.js`
- Expected results:
  - `OPERATION` is accepted by `triage_report` and does not set `classification`.
  - `QUICK_FIX` still does not set `classification`.
  - Router docs prefer `QUICK_FIX` over `OPERATION` when code risk is unclear, and `FEATURE` over `QUICK_FIX` when
    planning risk is unclear.
  - `OPERATION` dispatches to Operator and ends after Operator `task_completed` without RunWield validation.
  - `QUICK_FIX` dispatches to Engineer, runs Mechanical Validation after Engineer `task_completed`, sends CI failures
    back to Engineer, and stops after three total failed Engineer repair attempts.
  - No Reviewer, Plannotator code review, Plan Event, Plan Status update, or worktree merge-back runs for `QUICK_FIX`
    Mechanical Validation.
  - Documentation consistently lists six routing intents and says `OPERATION -> Operator`, `QUICK_FIX -> Engineer`.

## Edge Cases & Considerations

- Legacy records/tests may still use `classification: "QUICK_FIX"`; preserve backward normalization only where already
  supported, but do not create new Plan Classification behavior for `QUICK_FIX` or `OPERATION`.
- Existing docs and comments that say `QUICK_FIX -> Operator` are obsolete; update them to `OPERATION -> Operator`,
  `QUICK_FIX -> Engineer`.
- Dependency upgrades are risky even as operations; Operator should trust explicit user requests but must escalate via
  Router as soon as CI shows required code changes.
- Mechanical Validation failure is not Plan failure; it should report failure and leave Engineer active for manual
  follow-up rather than recording Plan lifecycle state.
- Keep all implementation code in pure JavaScript with JSDoc typedefs; do not introduce TypeScript syntax.
