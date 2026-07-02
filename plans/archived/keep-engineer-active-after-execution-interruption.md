---
planId: "2b3837d2-647b-4141-a8d5-743633cc0472"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Modify the engineer execution flow to prevent bouncing back to the planner or ending the session when the engineer fails or stops without calling `task_completed`. Instead, output a notification and keep the engineer as the active agent so the user can continue the session."
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/orchestrator.js"
createdAt: "2026-06-24T21:02:48-04:00"
updatedAt: "2026-06-25T02:21:29.234Z"
status: "verified"
origin: "internal"
failureReason: "git merge --no-ff runwield/worktree/keep-engineer-active-after-execution-interruptio-0652e268 failed: error: Your local changes to the following files would be overwritten by merge: plans/keep-engineer-active-after-execution-interruption.md Please commit your changes or stash them before you merge. Aborting Merge with strategy ort failed."
implementedAt: "2026-06-25T01:57:09.144Z"
verifiedAt: "2026-06-25T02:21:29.234Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "engineer session persistence"
---

# Keep Engineer Active After Execution Interruption

## Context

Plan execution currently runs the Engineer with `runAgentSession({ useRootSession: true })`, but the post-execution
decision paths can restore the planning owner (Planner/Architect) when execution is incomplete. `runEngineerWithPlan`
also lets prompt errors propagate, so API failures or user cancellation can unwind the workflow instead of producing a
recoverable “stopped without task_completed” message. The requested behavior is: when Engineer execution is interrupted,
canceled, fails at the API layer, or simply ends without `task_completed`, RunWield should print a clear message and
keep the Engineer root session active so a follow-up like “continue” has the full execution context.

## Objective

Make incomplete Engineer execution resumable in-place:

- Do not bounce back to Planner/Architect after incomplete Engineer execution.
- Do not tear down or replace the Engineer root session after API errors, Esc cancellation, or missing `task_completed`.
- Keep the active execution workflow/worktree alive so a later Engineer `task_completed` can proceed into validation.
- Preserve existing successful execution and validation behavior.

## Approach

Treat missing `task_completed` and Engineer prompt errors as resumable interruptions rather than terminal workflow
failures. `runEngineerWithPlan` should catch prompt-time failures, append a RunWield system message, and return an
incomplete execution result. `executeSingleEngineerPlan` should leave the active workflow in place and avoid marking the
plan/worktree as failed for this resumable state. The post-execution handlers in both triage dispatch and active-agent
plan approval flows should switch/stay to the Engineer handler on incomplete execution, not the planner/architect
handler.

## Files to Modify

- `src/shared/workflow/workflow.js` — catch Engineer prompt failures, return incomplete execution metadata, update the
  missing-`task_completed` message, and keep resumable execution state active instead of recording `execution_failed`
  immediately.
- `src/shared/workflow/orchestrator.js` — when approved plan execution returns `executionComplete: false`, set the
  active agent to Engineer instead of Planner/Architect.
- `src/shared/session/agent-handler.js` — mirror the same incomplete-execution behavior for plan approvals that
  originate from the active Planner/Architect handler, and mark interrupted plans as `implementation_finished` when a
  later Engineer `task_completed` resumes validation.
- `src/shared/workflow/orchestrator.test.js` — update/add assertions that incomplete FEATURE/PROJECT execution leaves
  Engineer active.
- `src/shared/session/agent-handler.test.js` — update/add assertions that incomplete execution from an approved plan
  leaves Engineer active.
- `src/shared/workflow/workflow.test.js` — add regression coverage for incomplete execution being treated as resumable
  and not as implementation completion.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/constants.js` — reuse `AGENTS.ENGINEER` instead of hard-coded agent names.
- `src/shared/session/agent-handler.js#createAgentHandler` — use the normal active-agent handler path so the next user
  message routes to Engineer.
- `src/shared/interactive/chat-session.js#setActiveAgent` — setting Engineer while the root session is already Engineer
  updates the active on-message handler without queuing a destructive root swap.
- `src/shared/session/session-state.js#getRootAgentSession` — use only if needed to recover the current root message
  stream after a caught prompt error.
- `src/shared/workflow/workflow-results.js#readLatestTaskCompletedOutcome` — keep existing completion detection for
  successful Engineer runs.
- `src/shared/workflow/plan-lifecycle.js#recordPlanEvent` — reuse the existing `implementation_finished` transition
  before validation when an interrupted Engineer later calls `task_completed`.

## Implementation Steps

- [ ] Step 1: Update `runEngineerWithPlan` in `src/shared/workflow/workflow.js` to catch errors thrown by
      `runAgentSession` after the Engineer root session has started.
  - Convert the caught error to a concise reason string.
  - Append a RunWield system message along the lines of
    `Engineer stopped without task_completed; execution is paused. Say "continue" to resume with the Engineer.` Include
    the error reason for API/cancel failures when available.
  - Return `{ completed: false, messages, error }`, using the current root session messages when available or `[]` as a
    fallback.
- [ ] Step 2: Update the no-`task_completed` branch in `runEngineerWithPlan` to use the same resumable wording instead
      of saying validation is waiting.
- [ ] Step 3: Update `executeSingleEngineerPlan` so incomplete Engineer execution is not recorded as terminal
      `execution_failed` and does not mark the worktree as `execution_failed`.
  - Return `{ repairRequired: false, executionComplete: false, error: engineerResult.error }`.
  - Keep the active execution workflow in session state so a later Engineer `task_completed` can trigger validation
    through the existing `agent-handler` task completion path.
- [ ] Step 4: In `src/shared/workflow/orchestrator.js`, change the post-execution decision context for approved
      FEATURE/PROJECT execution so incomplete execution stays with `AGENTS.ENGINEER`, not the planning agent.
  - Import/use `AGENTS.ENGINEER` already available from `constants.js`.
  - Ensure `setActiveAgent(AGENTS.ENGINEER, createAgentHandler(AGENTS.ENGINEER), uiAPI)` is reached for
    `stay_with_agent` decisions.
- [ ] Step 5: In `src/shared/session/agent-handler.js`, import `AGENTS` and make the incomplete approved-plan execution
      path restore/stay with `AGENTS.ENGINEER`.
  - Keep validation `finalAgentName` for successful execution unchanged unless tests reveal a direct conflict; this
    request only targets interrupted/incomplete Engineer execution.
- [ ] Step 6: In the existing `taskCompleted` + active-workflow branch of `src/shared/session/agent-handler.js`, record
      the delayed implementation finish before starting validation.
  - Import/reuse `recordPlanEvent` from `src/shared/workflow/plan-lifecycle.js`.
  - When `workflow.planName !== "quick-fix"`, call
    `recordPlanEvent({ cwd: CWD, planName: workflow.planName, event: "implementation_finished", currentStatus: "in_progress", details: { triageMeta: workflow.triageMeta } })`
    before `runValidationLoopImpl(...)`.
  - If this metadata update fails, append a clear RunWield system message and do not start validation; validation
    lifecycle events assume the plan is already `implemented`.
- [ ] Step 7: Add/update regression tests.
  - Update the existing `dispatchPostTriage restores PROJECT owner after incomplete execution` test to expect Engineer
    and rename it to describe the new behavior.
  - Add or adjust a FEATURE equivalent if coverage is not already clear.
  - Update `agent-handler restores invoking agent when approved_execute execution is incomplete` to expect Engineer and
    rename it.
  - Add a workflow-level test that an incomplete execution result does not emit `implementation_finished`; if
    implementation exposes error metadata, assert it is preserved.
  - Add an agent-handler test for the delayed continuation path: with an active execution workflow and an Engineer
    `task_completed`, assert `implementation_finished` is recorded before validation.
- [ ] Step 8: Run formatting and tests for touched files, then full CI.

## Verification Plan

- Automated:
  `deno fmt src/shared/workflow/workflow.js src/shared/workflow/orchestrator.js src/shared/session/agent-handler.js src/shared/workflow/orchestrator.test.js src/shared/session/agent-handler.test.js src/shared/workflow/workflow.test.js`
- Automated:
  `deno test src/shared/workflow/orchestrator.test.js src/shared/session/agent-handler.test.js src/shared/workflow/workflow.test.js`
- Automated: `deno run ci`
- Manual: Approve a FEATURE plan for execution, interrupt/cancel the Engineer before `task_completed`, then type
  `continue`.
- Manual expected result: RunWield prints a clear stopped-without-`task_completed` message, the footer/active handler
  remains Engineer, and `continue` is sent to the same Engineer context rather than Planner/Router.
- Manual: Simulate or encounter an API failure during Engineer execution.
- Manual expected result: the workflow does not unwind to Planner/Architect; the root session remains alive with
  Engineer active and enough context to retry/continue.

## Edge Cases & Considerations

- If `runAgentSession` fails before the Engineer root session can be created, there may be no Engineer context to
  preserve. In that case, surface the error clearly; prefer Engineer active when a root session exists.
- Avoid clearing `activeExecutionWorkflow` on interruption; clearing it would prevent a later Engineer `task_completed`
  from entering validation.
- Avoid marking the plan as `failed` for resumable interruptions; a later `continue` should not have to recover a failed
  plan status before validation can run.
- Because resumable interruptions leave the plan `in_progress`, the later `task_completed` continuation must record
  `implementation_finished` before validation records `validation_passed` or `validation_failed`.
- Do not change Operator/validation repair behavior unless required by failing tests; this feature targets initial
  approved-plan Engineer execution.
- Preserve pure JavaScript and JSDoc style; do not add TypeScript syntax.
