---
planId: "32c6af85-eb16-4a4a-b0ae-c4dd261a8162"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Let load-plan open an Implemented Plan's existing execution Agent in its worktree for follow-up conversation"
affectedPaths:
    - "src/cmd/load-plan/plan-recovery-flow.ts"
    - "src/cmd/load-plan/plan-recovery-actions.ts"
    - "src/cmd/load-plan/plan-recovery-flow.test.ts"
    - "src/cmd/load-plan/index.integration.test.ts"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-25T00:31:01-04:00"
updatedAt: "2026-08-25T14:07:02.666Z"
status: "validated_reviewer"
origin: "internal"
implementedAt: "2026-08-25T13:39:52.412Z"
userVerifiedAt: null
executionReport: "- Added `follow_up` recovery action immediately after `Retry Workflow Validation` for Implemented Plans.\n- Rebinds the existing Active Execution Workflow and worktree; supports Plan Engineer and Frontend Engineer; does not execute or validate.\n- Blocks incomplete/unavailable worktrees without creating replacements and keeps recovery available.\n- Added flow, action, and real runtime next-turn regression tests. No tests were removed.\n- Verification passed: focused load-plan tests and `deno task ci` (356 files, 0 failed)."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
validationCheckpoint: null
executionMode: "worktree"
executionBaselineTree: "d5ca738dfb44c2b6f89b69423530a0f35dd6aaa5"
worktreeId: "5e3ee42f"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-load-plan-implemented-follow-up-5e3ee42f"
worktreeBranch: "worktree/load-plan-implemented-follow-up-5e3ee42f"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
validationCiAttempts: 0
validationSemanticRounds: 0
---

# Open Implemented Plan Follow-Up from `load-plan`

## Context

`/load-plan` sends an Implemented Plan into Plan Recovery. The recovery menu can retry Workflow Validation, inspect the
attempt, reopen review, or reset the worktree, but it cannot return the user to the Plan's execution Agent for a normal
follow-up conversation.

The existing execution worktree and its durable workflow owner already contain the implementation context. Sending the
Plan through a new execution or validation run is unnecessary and risks creating a second workflow or worktree.

## Objective

Add a Plan Recovery option for an Implemented Plan that opens the existing Plan Engineer or Frontend Engineer in the
recorded execution worktree. The action must restore the active execution workflow and then leave the Session ready for
the user's next normal message.

The action must not start execution, run Workflow Validation, create a worktree, alter Plan Status, or discard existing
worktree changes.

## Approach

Add a dedicated recovery action, distinct from `continue`, and place it immediately after `Retry Workflow Validation` in
the Implemented Plan recovery menu:

```text
Implemented Plan
  → Retry Workflow Validation
  → Open Plan Engineer for follow-up
  → verify the recorded worktree is available
  → rehydrate Active Execution Workflow from Plan/worktree evidence
  → return handled
  → load-plan's existing finally path activates the workflow owner
  → next user message runs in the execution worktree
```

`rehydrateActiveRecoveryWorkflow` remains the owner of rebuilding the durable workflow projection. The existing
`restorePreviousAgentFlow` path already resolves the canonical execution Agent to the runtime Agent and activates it
from the restored workflow, so this change should not introduce a second agent-switching path.

The option is limited to a usable existing execution generation. If the worktree is missing or its identity is unsafe,
show the existing recovery error and keep the menu available. Do not silently fall back to a fresh execution.

The alternative of asking for follow-up text inside `/load-plan` is intentionally not used. It would create a special
conversation path and would not behave like the next normal Session message.

## Files to Modify

- `src/cmd/load-plan/plan-recovery-flow.ts` — expose the follow-up option for Implemented Plans, dispatch its distinct
  action, and keep it separate from validation retry and execution continuation.
- `src/cmd/load-plan/plan-recovery-actions.ts` — add the follow-up recovery action. Recheck the current worktree,
  require a usable execution context, call `rehydrateActiveRecoveryWorkflow`, record the recovery result, and return
  `handled` without invoking execution or validation.
- `src/cmd/load-plan/plan-recovery-flow.test.ts` — verify the Implemented Plan menu exposes the option, the action
  restores the active workflow with the recorded execution worktree, and blocked/missing worktrees do not activate a
  follow-up.
- `src/cmd/load-plan/index.integration.test.ts` — verify the real `/load-plan` boundary leaves the Session on the Plan's
  canonical execution Agent and execution worktree after the user selects follow-up, with no execution or Workflow
  Validation call.

## Reuse Opportunities

- `src/cmd/load-plan/plan-recovery-worktree.ts:rehydrateActiveRecoveryWorkflow` — rebuild the Active Execution Workflow
  from Plan Front Matter and resolved worktree evidence; do not duplicate workflow construction.
- `src/cmd/load-plan/plan-recovery-actions.ts:confirmRecoveryWorktreeAvailable` — use the existing safety check before
  binding a follow-up to a worktree.
- `src/cmd/load-plan/plan-session-surface.ts:restorePreviousAgentFlow` — preserve the existing mapping from canonical
  execution Agent to runtime Agent and the existing Session restoration behavior.
- `src/shared/workflow/execution-agent.ts` — retain the existing Plan Engineer/Frontend Engineer policy resolution.
- Existing recovery and Session runtime tests — follow their real Git fixture and Session workflow assertions instead of
  adding dependency-injection seams.

## Implementation Steps

- [ ] `RecoveryActionName` includes a distinct follow-up action, and `promptRecoveryAction` places a clearly labeled
      “Open Plan Engineer for follow-up” option as the second option after “Retry Workflow Validation” for an
      Implemented Plan with a usable recorded execution generation; Frontend Engineer Plans use equivalent wording that
      identifies Frontend Engineer.
- [ ] The follow-up action verifies the current recovery worktree with the existing safety boundary, rejects missing or
      incomplete worktree evidence without mutation, and leaves the recovery menu available after a blocked attempt.
- [ ] A successful follow-up action calls `rehydrateActiveRecoveryWorkflow` with the Plan's canonical execution policy
      and existing worktree context, so Active Execution Workflow contains the original Plan name, canonical execution
      Agent, project root, execution worktree path, and worktree identity; it does not call `executePlan` or
      `runValidation`.
- [ ] The successful action records a distinct recovery result and returns `handled`, allowing `runLoadPlanCommand`'s
      existing restoration path to activate `plan-engineer` or `frontend-engineer` without restoring Router or Planner.
- [ ] Recovery tests prove both ordinary Plan Engineer and Frontend Engineer follow-up bindings, prove the execution
      worktree path is preserved, and prove the Plan Status and worktree metadata remain unchanged.
- [ ] The real `load-plan` integration test proves selecting follow-up leaves the next Session turn owned by the Plan's
      execution Agent in the existing execution worktree; the test fails if the implementation only displays a menu,
      starts a fresh execution, runs validation, or switches to a pass-through Agent.

## Approval Confirmation

No `supersedes` Work Records are proposed.

## Verification Plan

- Automated: run `deno task test --filter load-plan` if supported by the repository test runner; otherwise run the
  focused tests with
  `deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts src/cmd/load-plan/index.integration.test.ts`.
- Automated: run `deno task ci` to confirm type checking, seam enforcement, and the full regression suite.
- Behavioral: create an Implemented Plan with a real execution worktree, select the new follow-up option, and assert the
  active workflow's `executionAgent`, `executionCwd`, Plan name, and worktree identity. Assert execution and validation
  counters remain unchanged.
- Behavioral: repeat with a Frontend Engineer Plan and assert the runtime Agent is `frontend-engineer`, not Plan
  Engineer or Planner.
- Behavioral: remove or invalidate the worktree and select follow-up. The command must report the existing recovery
  failure, must not create a replacement worktree, and must leave the recovery menu available.
- Regression: select Retry Workflow Validation for an Implemented Plan and confirm its existing validation behavior is
  unchanged. Select Continue execution for an In-Progress or Failed Plan and confirm it still runs execution repair; the
  new follow-up action must not replace either behavior.
- Manual: run `/load-plan <implemented-plan>`, choose the follow-up option, then send a normal User Request. Confirm the
  response is produced by the Plan's execution Agent with the execution worktree as its working directory, without an
  intermediate validation or execution prompt.

## Edge Cases & Considerations

- A Plan with a lost, deleted, or incomplete worktree cannot safely receive follow-up work. Keep it in Plan Recovery and
  require the user to restore, reset, or abandon it through the existing choices.
- The execution worktree Plan is authoritative after execution starts. Rehydration must not rewrite protected Plan
  Lifecycle fields merely to open the conversation.
- The action must preserve active workflow ownership across the `load-plan` command's `finally` restoration. Clearing
  the workflow or restoring the initial Router would make the next User Request run in the wrong Agent or directory.
- Implemented is a validation-boundary status, not a terminal completion claim. Follow-up must therefore leave it at
  `implemented` and retain the ability to retry Workflow Validation later.
- No glossary update is needed: `Implemented Plan`, `Plan Engineer`, `Frontend Engineer`, `Plan Recovery`, and
  `Active
  Execution Workflow` already describe the intended behavior.
