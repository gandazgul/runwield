---
planId: "a584ccdc-1a39-43ce-bf14-b245b8c5a80b"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Move plan execution, validation, load-plan continuation, and plan-written follow-up state onto the current HostedSession so concurrent sessions cannot share active execution workflow state."
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/validation.js"
    - "src/cmd/load-plan/index.js"
    - "src/tools/plan-written.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/validation.test.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/shared/session/agent-handler.test.js"
frontend: false
createdAt: "2026-07-03T18:03:46.155Z"
updatedAt: "2026-07-03T18:03:46.155Z"
status: "draft"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 5
dependencies:
    - "routing-and-return-to-router-session-scoping"
---

# Workflow Execution and Validation Session Scoping

## Context

Plan execution and validation currently use global active execution workflow state to remember plan name, triage
metadata, baseline tree, project root, execution cwd, worktree id, and worktree branch. `load-plan`, `plan-written`,
`agent-handler`, `workflow.js`, and `validation.js` all participate in this flow. In a multi-session process, that state
must belong to the HostedSession that started or resumed the workflow.

This slice follows routing scoping. The TUI and routing paths should now be HostedSession-aware, but plan
execution/validation may still rely on old global workflow state until this work lands.

## Objective

Scope active execution workflow state, validation continuation, load-plan recovery, and plan-written follow-up behavior
to the current HostedSession. Prove that two Hosted Sessions can hold independent workflow state and that plan
execution/validation tests pass through the new context.

## Approach

Thread HostedSession through workflow entry points and command/tool contexts that need active execution state. Replace
`getActiveExecutionWorkflow()`, `setActiveExecutionWorkflow()`, `clearActiveExecutionWorkflow()`, and
`getActiveExecutionCwd()` production usage with HostedSession methods. Keep worktree semantics and plan lifecycle events
unchanged; move ownership only.

Skipped tests are still allowed for final command cleanup or full TUI restoration, but all workflow/validation/load-plan
tests owned by this slice should be unskipped and passing.

## Files to Modify

- `src/shared/workflow/workflow.js` — scope `startActiveExecutionWorkflow()`, `markActiveWorktreeStatus()`, root-message
  access, execution cwd, and worktree metadata to HostedSession.
- `src/shared/workflow/validation.js` — read active workflow, baseline tree, execution cwd, and final-agent continuation
  from HostedSession.
- `src/cmd/load-plan/index.js` — pass HostedSession through load-plan execution/review/recovery flows and clear/set
  workflow state on the current session only.
- `src/tools/plan-written.js` — use HostedSession context for session manager access and review-loop/workflow follow-up
  instead of importing root session globals.
- `src/shared/session/agent-handler.js` — finish task-completed workflow continuation logic against HostedSession active
  workflow state.
- `src/shared/workflow/workflow.test.js` — adapt execution workflow tests to HostedSession context and add two-session
  isolation coverage.
- `src/shared/workflow/validation.test.js` — adapt validation tests and unskip workflow-state cases owned by this slice.
- `src/cmd/load-plan/index.test.js` — adapt load-plan tests to pass HostedSession command context.
- `src/tools/__tests__/plan-written.test.js` — add or adapt tests for HostedSession-scoped session manager/workflow
  behavior.
- `src/shared/session/agent-handler.test.js` — adapt task_completed workflow continuation assertions.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/worktree-registry.js` and related worktree helpers — reuse current execution worktree creation,
  lookup, status updates, and cleanup.
- `src/shared/workflow/plan-lifecycle.js` — reuse plan event recording without changing event names or metadata shape.
- `src/shared/workflow/validation.js` — reuse validation loop decisions, Plannotator review integration, and final-agent
  switching logic.
- `src/cmd/load-plan/index.js` — reuse existing recovery prompts and plan-state transitions; change only session context
  ownership.
- `src/shared/session/hosted-session.js` — reuse active execution workflow accessors created in the first slice.

## Implementation Steps

- [ ] Step 1: Write or unskip tests proving HostedSession A and HostedSession B can each have different active execution
      workflow metadata without cross-session mutation.
- [ ] Step 2: Refactor `workflow.js` to accept HostedSession in execution entry points and to store workflow/worktree
      metadata on that HostedSession.
- [ ] Step 3: Refactor `validation.js` to read baseline tree, execution cwd, worktree context, and final-agent
      continuation from HostedSession.
- [ ] Step 4: Refactor `load-plan` command paths to receive HostedSession in command options and to set/clear workflow
      state only on that session.
- [ ] Step 5: Refactor `plan-written` to use HostedSession-provided session manager and workflow context for follow-up
      execution/review flows.
- [ ] Step 6: Update `agent-handler` task_completed handling to clear or continue validation based on the current
      HostedSession's workflow.
- [ ] Step 7: Unskip all workflow/validation/load-plan tests owned by this slice and leave only final-cleanup tests
      skipped with clear labels.

## Verification Plan

- Automated: run `src/shared/workflow/workflow.test.js`, `src/shared/workflow/validation.test.js`, and
  `src/cmd/load-plan/index.test.js`.
- Automated: run plan-written and agent-handler tests affected by workflow continuation.
- Automated: run `deno run ci`; CI must pass with only explicitly justified final-slice skipped tests.
- Automated: verify enabled tests prove active execution workflow, execution cwd, baseline tree, and worktree metadata
  are scoped to the target HostedSession.
- Manual: run a simple FEATURE or QUICK_FIX flow far enough to start execution/validation if credentials and environment
  allow; confirm workflow state messages still appear coherent in the TUI.
- Expected result: plan execution and validation no longer depend on process-global active execution workflow state.

## Edge Cases & Considerations

- Worktree registry remains project-root scoped. This slice scopes the active workflow pointer, not the underlying
  worktree registry file format.
- `CWD` remains the primary project root for this Epic unless existing execution cwd plumbing already provides a more
  specific root. Add guards rather than broad multi-project redesign.
- Clearing workflow state during review/reopen/load-plan paths must not clear another HostedSession's workflow.
- Avoid changing plan lifecycle statuses or validation policy while moving state ownership.
