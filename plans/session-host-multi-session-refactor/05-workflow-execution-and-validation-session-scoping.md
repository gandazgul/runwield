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
updatedAt: "2026-07-06T02:55:24.694Z"
status: "verified"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 5
dependencies:
    - "routing-and-return-to-router-session-scoping"
verifiedAt: "2026-07-06T02:55:24.694Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Workflow Execution and Validation Session Scoping

## Context

This child FEATURE belongs to the Session Host multi-session refactor Epic. The behavior is sourced from the parent
Epic, `docs/adr/009-session-host-as-external-integration-boundary.md`, `docs/adr/003-plan-recovery-baseline-tree.md`,
`docs/adr/005-concurrent-worktree-isolation.md`, and the verified dependency slice
`04-routing-and-return-to-router-session-scoping.md`.

Plan execution and validation currently keep active workflow metadata in process-global session state. Current code
paths read or write that global through `getActiveExecutionWorkflow()`, `setActiveExecutionWorkflow()`,
`clearActiveExecutionWorkflow()`, and `getActiveExecutionCwd()` in `workflow.js`, `validation.js`, `load-plan`, and
`agent-handler`. `plan-written` also reaches for the root session manager globally when it starts Slicer follow-up work.
That state includes plan name, triage metadata, baseline tree, primary project root, execution cwd, worktree id,
worktree branch, and worktree base branch. In a multi-session process, that state must belong to the HostedSession that
started, resumed, or validated the Plan.

Precondition: this plan assumes earlier Session Host slices have introduced `HostedSession`, wired the TUI through one
current HostedSession, and made routing/return-to-router use explicit HostedSession context. If those APIs are missing
on the execution branch, stop and restore/execute the dependency slices first rather than recreating the whole Session
Host foundation inside this slice.

## Objective

Scope active execution workflow state, validation continuation, `load-plan` recovery, and `plan_written` follow-up
behavior to the current HostedSession.

The visible behavior should not change for the single TUI session:

- Approved FEATURE Plans can still execute immediately after `plan_written` approval.
- `load-plan` can still continue, retry validation, recover, or re-open Plans using existing prompts.
- Workflow Validation still uses the execution baseline tree and execution worktree cwd.
- Worktree lifecycle events and Plan Lifecycle statuses keep their current semantics.

The new capability proof is that two Hosted Sessions in one process can hold independent active execution workflow
metadata and that clearing, retrying validation, or resuming one session cannot clear or mutate the other.

## Approach

Thread explicit HostedSession context through workflow entry points and command/tool contexts that need active execution
state. Move the active workflow pointer and related execution-cwd lookup behind HostedSession methods or properties.
Keep worktree registry state project-root scoped; this slice scopes the live workflow pointer, not the registry file
format.

Recommended implementation shape:

- Add or use HostedSession methods equivalent to `getActiveExecutionWorkflow()`, `setActiveExecutionWorkflow(workflow)`,
  `clearActiveExecutionWorkflow()`, and `getActiveExecutionCwd()`.
- Refactor `startActiveExecutionWorkflow()`, `markActiveWorktreeStatus()`, `executePlan()`, and
  `executeSingleEngineerPlan()` to receive the current HostedSession through an options object or dependency context.
- Refactor `runValidationLoop()` and `runMechanicalValidation()` to receive HostedSession where they restore final Agent
  state, drain workflow handoffs, create repair handlers, or read active workflow metadata.
- Refactor `runLoadPlanCommand()` and its recovery helpers to receive HostedSession from command options and to
  rehydrate/clear workflow state only on that session.
- Refactor `createPlanWrittenTool()` and its `session.js` auto-wiring so Slicer and follow-up Plan workflow work use the
  current HostedSession's session manager rather than importing the root manager from singleton state.
- Leave Plan Lifecycle event names, status transitions, worktree metadata shape, and validation policy unchanged.

Use pure JavaScript with JSDoc typedefs only; do not introduce TypeScript syntax or `.ts` files.

## Files to Modify

- `src/shared/session/hosted-session.js` — add or extend active execution workflow accessors if the dependency slices
  have not already provided them.
- `src/shared/session/session-state.js` — remove production active-execution-workflow ownership from singleton state, or
  reduce old exports to temporary test/deprecation shims only if final cleanup owns deletion.
- `src/shared/session/session.js` — pass the current HostedSession into `createPlanWrittenTool()` when auto-wiring the
  `plan_written` tool for Planner/Architect root sessions.
- `src/shared/workflow/workflow.js` — scope `startActiveExecutionWorkflow()`, `markActiveWorktreeStatus()`, root-message
  fallback access, execution cwd, and worktree metadata to the supplied HostedSession.
- `src/shared/workflow/validation.js` — read active workflow, baseline tree, execution cwd, worktree context, pending
  handoff drain, and final-agent continuation from HostedSession.
- `src/cmd/load-plan/index.js` — pass HostedSession through load-plan execution/review/recovery flows and clear/set
  workflow state on the current session only.
- `src/tools/plan-written.js` — use HostedSession context for session manager access and review-loop/workflow follow-up
  instead of importing root session globals.
- `src/shared/session/agent-handler.js` — finish task-completed workflow continuation logic against the current
  HostedSession active workflow state.
- `src/shared/workflow/workflow.test.js` — adapt execution workflow tests to HostedSession context and add two-session
  isolation coverage for active workflow metadata.
- `src/shared/workflow/validation.test.js` — adapt validation tests so active workflow setup/clear occurs through
  HostedSession and add coverage that validation clears only the validating session.
- `src/cmd/load-plan/index.test.js` — adapt load-plan tests to pass HostedSession command context and prove recovery
  rehydration does not mutate another session.
- `src/tools/__tests__/plan-written.test.js` — add or adapt tests for HostedSession-scoped session manager/Slicer
  behavior.
- `src/shared/session/agent-handler.test.js` — adapt task_completed workflow continuation assertions to scoped
  HostedSession state.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/hosted-session.js` — reuse the existing Session Host state container rather than adding a new
  workflow singleton.
- `src/shared/workflow/worktree-registry.js` and related worktree helpers — reuse current execution worktree creation,
  lookup, status updates, merge-back, and cleanup behavior.
- `src/shared/workflow/plan-lifecycle.js` — reuse Plan Event recording without changing event names or metadata shape.
- `src/shared/workflow/validation.js` — reuse validation loop decisions, Plannotator review integration, merge-back, and
  final-agent switching logic.
- `src/cmd/load-plan/index.js` — reuse existing recovery prompts and plan-state transitions; change only session context
  ownership.
- `src/shared/session/agent-handler.js` — reuse post-planning and task-completed decision flow while changing the source
  of active workflow state.

## Implementation Steps

- [ ] Step 1: Add or unskip tests proving HostedSession A and HostedSession B can each hold different active execution
      workflow metadata, and that clearing A leaves B untouched.
- [ ] Step 2: Add/confirm HostedSession active workflow accessors for setting, reading, clearing, and deriving execution
      cwd with primary `CWD` fallback.
- [ ] Step 3: Refactor `workflow.js` entry points to accept HostedSession and store workflow/worktree metadata on that
      HostedSession when execution starts or worktree status changes.
- [ ] Step 4: Refactor Engineer execution error fallback so root messages are read from the current HostedSession's root
      Agent Session, not a global root session.
- [ ] Step 5: Refactor `validation.js` to read baseline tree, project root, execution cwd, worktree id/branch/base
      branch, handoff drain, and final-agent restoration from the supplied HostedSession.
- [ ] Step 6: Refactor validation repair/session calls so `createAgentHandler()`, `setActiveAgent()`, and repair
      sessions are created with the current HostedSession context.
- [ ] Step 7: Refactor `load-plan` command options and recovery helpers, especially `rehydrateActiveRecoveryWorkflow()`,
      validation retry for implemented Plans, and recovery cleanup paths, to set/clear workflow state only on the
      supplied HostedSession.
- [ ] Step 8: Refactor `plan-written` and `session.js` tool auto-wiring so PROJECT/Slicer follow-up uses the current
      HostedSession's session manager and does not import `getRootSessionManager()` from singleton state.
- [ ] Step 9: Update `agent-handler` task_completed handling so delayed implementation finish and validation
      continuation read, record, clear, or validate only against the bound HostedSession's workflow.
- [ ] Step 10: Remove production imports of active-execution-workflow singleton helpers from files owned by this slice,
      except for explicitly temporary compatibility shims whose deletion is left to the final cleanup slice.
- [ ] Step 11: Unskip all workflow/validation/load-plan tests owned by this slice and leave only final-cleanup tests
      skipped with labels that name child FEATURE 06.

## Verification Plan

- Automated: run focused workflow tests:
  `deno test -A src/shared/workflow/workflow.test.js src/shared/workflow/validation.test.js`.
- Automated: run focused load-plan tests: `deno test -A src/cmd/load-plan/index.test.js`.
- Automated: run focused tool/session tests:
  `deno test -A src/tools/__tests__/plan-written.test.js src/shared/session/agent-handler.test.js`.
- Automated: search the slice-owned production files for old singleton active-workflow access, for example
  `grep -R "getActiveExecutionWorkflow\|setActiveExecutionWorkflow\|clearActiveExecutionWorkflow\|getActiveExecutionCwd\|getRootSessionManager" src/shared/workflow/workflow.js src/shared/workflow/validation.js src/cmd/load-plan/index.js src/tools/plan-written.js src/shared/session/agent-handler.js src/shared/session/session.js`,
  and verify remaining matches are removed or explicitly deferred compatibility shims.
- Automated: run `deno task ci`; CI must pass with only explicitly justified final-slice skipped tests.
- Automated expected result: enabled tests prove active execution workflow, execution cwd, baseline tree, final-agent
  continuation, and worktree metadata are scoped to the target HostedSession.
- Manual: run a simple FEATURE flow far enough to approve and start execution if credentials/environment allow; confirm
  execution messages still appear coherent in the TUI.
- Manual: retry validation through `load-plan` for an implemented Plan if a suitable fixture/worktree is available;
  confirm it uses the recorded execution cwd and baseline tree.
- Expected result: Plan execution and validation no longer depend on process-global active execution workflow state.

## Edge Cases & Considerations

- Worktree registry remains project-root scoped. Do not redesign `.wld/worktrees.json` or branch naming in this slice.
- `CWD` remains the primary project root for this Epic unless existing execution cwd plumbing already provides a more
  specific root. Add guards rather than broad multi-project redesign.
- Clearing workflow state during review, reopen, `task_completed`, validation retry, or recovery must not clear another
  HostedSession's workflow.
- `runValidationLoop()` currently clears active workflow at validation start. Preserve that behavior for the validating
  HostedSession only, so retries do not accidentally reuse stale metadata.
- `load-plan` recovery must still rehydrate `executionBaselineTree` before retrying Workflow Validation for implemented
  Plans; otherwise semantic review may compare against the wrong diff.
- `plan_written` still does not execute the Plan directly. It returns the `approved_execute` outcome; the bound handler
  or load-plan flow dispatches execution afterward.
- Avoid changing Plan Lifecycle statuses, validation approval policy, Plannotator behavior, or worktree merge-back
  semantics while moving state ownership.
