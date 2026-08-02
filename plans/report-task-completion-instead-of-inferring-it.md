---
planId: "08ebe9a4-346e-445a-81b8-136443d56f53"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Have task_completed report the completion to the session instead of the handler inferring it by scanning a turn's messages, so steering mid-execution no longer strands the workflow."
affectedPaths:
    - "src/tools/task-completed.js"
    - "src/tools/__tests__/task-completed.test.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/workflow/workflow-results.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/ui/tui/golden-scenarios/role-journeys.js"
    - "src/ui/tui/testing/coverage-matrix.js"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'agent-handler consumes steered task_completed and runs QUICK_FIX mechanical validation' src/shared/session/agent-handler.test.js && deno task test src/shared/session/agent-handler.test.js --filter 'agent-handler consumes steered task_completed and runs QUICK_FIX mechanical validation'"
      rationale: "This can only pass after the steered completion path has a targeted regression test and the handler notices a task_completed call made outside its own turn window."
    - id: "OC2"
      command: "grep -q 'agent-handler consumes task_completed exactly once across follow-up turns' src/shared/session/agent-handler.test.js && deno task test src/shared/session/agent-handler.test.js --filter 'agent-handler consumes task_completed exactly once across follow-up turns'"
      rationale: "This can only pass after completion is represented as consume-once session state rather than a stale message that can be rediscovered on later turns."
    - id: "OC3"
      command: "grep -q 'task_completed records accepted completion on hosted session only after ownership checks' src/tools/__tests__/task-completed.test.js && deno task test src/tools/__tests__/task-completed.test.js --filter 'task_completed records accepted completion on hosted session only after ownership checks'"
      rationale: "This can only pass after task_completed writes a pending session completion for accepted calls and rejected calls leave no completion that a later workflow could consume."
    - id: "OC4"
      command: "grep -q 'agent-handler ignores isolated task_completed records for root workflow advancement' src/shared/session/agent-handler.test.js && deno task test src/shared/session/agent-handler.test.js --filter 'agent-handler ignores isolated task_completed records for root workflow advancement'"
      rationale: "This can only pass after completions from isolated Agent sessions are scoped away from root workflow advancement."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-01T01:47:01-04:00"
updatedAt: "2026-08-02T22:48:24.438Z"
status: "verified"
origin: "internal"
implementedAt: "2026-08-02T02:37:54.851Z"
verifiedAt: "2026-08-02T22:48:24.438Z"
userVerifiedAt: null
executionReport: "- Implemented HostedSession pending task-completion records: accepted `task_completed` calls now record agent/report/timestamp/owning session and consume exactly once; active workflow set/clear paths clear stale completions.\n- Updated `createAgentHandler` to consume the root-session-owned completion record instead of scanning the root turn message window; removed the obsolete task-completion reader seam and tightened `scripts/injection-seam-baseline.json`.\n- Preserved isolated-session behavior: `readLatestTaskCompletedReport`/message-stream readers remain for isolated callers, and root workflow advancement ignores completions owned by isolated steering targets.\n- Added/updated tests for accepted-vs-rejected recording, consume-once follow-up turns, steered QUICK_FIX completion through `SessionRuntime.steerSession`, isolated completion isolation, and stale-completion clearing; test-count delta: +5 tests, 0 removed.\n- Updated QUICK_FIX golden role journey to include queued steering coverage and declared `recovery:steered-task-completion` in the coverage matrix.\n- Verification passed: objective checks OC1–OC4, `deno task test src/shared/session src/shared/workflow src/tools`, `deno task test src/ui/tui/golden-scenarios/role-journeys.test.js`, `deno task seams:check`, and final `deno task ci` all pass. One full CI attempt hit a transient golden PROJECT timeout; the failing filtered scenario passed on rerun, and a subsequent full `deno task ci` passed."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "316c55eacb9ffc5a2d7d2695fa44f932e216138a"
    targetBranch: "main"
    targetHeadBeforeMerge: "06e49895b97558081cb95d6f1e1b32af2184ca16"
validationCiAttempts: 0
validationSemanticRounds: 0
---

# Report Task Completion Instead of Inferring It

## Context

An execution Agent finishes its work by calling `task_completed`. RunWield is supposed to notice and advance the
workflow — run Mechanical Validation for a QUICK_FIX, or Workflow Validation for a Planned Change.

It does not notice when the user steers.

`createAgentHandler` records the Agent session's message count before the turn starts
(`src/shared/session/agent-handler.js:163`) and afterwards looks for a `task_completed` tool result **only among
messages added after that point** (`:424`). So a completion counts only if it lands inside a turn the handler itself
started.

Steering does not go through the handler. `SessionRuntime.steerSession` (`src/shared/session/session-runtime.js:631`)
injects the user's text straight into the already-streaming Agent session via `#steerActiveSessionWithTarget`. Whatever
the Agent does next — including calling `task_completed` — happens outside any handler invocation's window.

The result, observed twice in real use: the Agent prints its completion report, and nothing happens. No validation, no
message, no way forward. The handler falls through to `requestAgentStoppedAttention()` (`:511`) and returns. It has been
seen with a QUICK_FIX (Mechanical Validation never ran) and with the Reviewer-Feedback Engineer mid-repair.

The active workflow itself survives: the only two `clearActiveExecutionWorkflow()` calls (`:441`, `:454`) are inside the
`taskCompleted` branch, so nothing is destroyed. The signal is what is lost.

The `fromIndex` restriction exists for a real reason, stated in the comment above `:163`: without it, a follow-up
question after a completed task would re-trigger `executePlan`. But turn position is a proxy for the question actually
being asked, which is _"has this workflow already been completed?"_ — and it is a proxy that steering breaks.

## Objective

Completion is something the Agent reports, not something RunWield reconstructs afterwards.

After this change, `task_completed` records the completion on the session when it runs. The handler reads and consumes
that record instead of scanning messages, so the workflow advances no matter which turn the tool was called in, or
whether the user steered mid-execution. A completion advances the workflow exactly once.

## Approach

Add a consume-once completion record to `HostedSession`, following the pattern already there for
`consumeSuppressedAgentStoppedAttention()` (`src/shared/session/hosted-session.js:483`): a small piece of state, set by
the producer, read-and-cleared by the consumer.

`createTaskCompletedTool` already receives `hostedSession` and already reads `getActiveExecutionWorkflow()`
(`src/tools/task-completed.js:114`), so it can record the completion where it happens, with no new wiring.

The handler then replaces its message scan with a consume. Consuming is what makes the double-advance impossible, and it
expresses the real rule directly: a completion is available until something acts on it, and then it is gone. That is
strictly stronger than the `fromIndex` guard it replaces, because it does not depend on when the tool was called.

Scope the record to the session that ran the turn. This is the one hazard worth designing around rather than discovering
later — see Edge Cases.

## Files to Modify

- `src/tools/task-completed.js` — record the completion on the session after the existing ownership checks pass and the
  message is emitted.
- `src/tools/__tests__/task-completed.test.js` — prove accepted completions record a pending session completion and
  rejected completions leave no pending record.
- `src/shared/session/hosted-session.js` — hold the pending completion (agent name, report, timestamp, owning session)
  and expose a consume-once reader beside `consumeSuppressedAgentStoppedAttention()`.
- `src/shared/session/agent-handler.js` — consume the completion instead of calling
  `readLatestTaskCompletedOutcome(messages, preTurnCount)`; keep every branch that follows unchanged.
- `src/shared/workflow/workflow-results.js` — leave `readLatestTaskCompletedReport` in place for isolated-session
  callers; remove `readLatestTaskCompletedOutcome` only if it ends up with no callers.
- `src/shared/session/agent-handler.test.js` — cover completion outside the handler's turn window, single advancement,
  and the follow-up-question regression.
- `src/ui/tui/golden-scenarios/role-journeys.js` — a steering scenario on the QUICK_FIX journey.
- `src/ui/tui/testing/coverage-matrix.js` — declare the capability the new scenario owns.

## Reuse Opportunities

- `HostedSession.consumeSuppressedAgentStoppedAttention()` (`hosted-session.js:483`) — the consume-once shape to copy,
  including its naming.
- `hostedSession.getActiveExecutionWorkflow()` — already the single home for workflow state; the completion record
  belongs beside it, not in a parallel store.
- `canCompleteActiveExecutionWorkflow(agentName, workflow)` — the existing ownership rule; keep it where it is rather
  than duplicating it into the tool.
- `readLatestTaskCompletedReport` — still correct for isolated sessions, which have their own message list and are read
  synchronously by the caller that ran them (`validation.ts` merge and semantic repair dispatch).
- `SessionRuntime.steerSession` (`session-runtime.js:631`) — the path the regression test must drive; do not simulate
  steering by calling the handler twice.

## Implementation Steps

- [ ] `HostedSession` holds at most one pending task completion and returns it exactly once; a second read returns
      nothing.
- [ ] `task_completed` records the completion when it runs, carrying the reporting Agent's name and report text.
- [ ] Rejected `task_completed` calls (`execution_not_started`, Pair pause, wrong owner) emit the same rejection result
      as today and leave no pending completion to be consumed later.
- [ ] `createAgentHandler` advances the workflow from the consumed record rather than from `preTurnCount`, and every
      existing branch after it — `executionStarted === false`, Pair pause/stop, ownership refusal, QUICK_FIX Mechanical
      Validation, `shouldRunWorkflowValidation`, `finalizePlanImplementation`, Workflow Validation, Epic continuation —
      behaves as it does today.
- [ ] A `task_completed` called during a steered turn advances the workflow.
- [ ] A completion advances the workflow once; a follow-up question in a later turn does not advance it again.
- [ ] A `task_completed` from an isolated Agent session does not advance the root workflow.
- [ ] Starting a new execution workflow leaves no completion from a previous one pending.

## Verification Plan

- Automated:
  - `deno task test src/shared/session src/shared/workflow src/tools`
  - `deno task test src/ui/tui/golden-scenarios/role-journeys.test.js`
  - `deno task seams:check` — must not increase.
  - `deno task ci`
- Behavior that must remain protected after reshaping this code:
  - `task_completed` still owns the visible completion report and tool-result details used by Work Records.
  - Ownership refusal, `execution_not_started`, Pair pause, Frontend Engineer preflight telemetry, and Reviewer-Feedback
    Engineer completion on the owner's behalf keep their current user-visible results.
  - Isolated execution callers still read task-completion reports from their own returned message stream.
- Behavior expected to stop existing:
  - The root handler no longer treats the root turn's starting message count as the source of truth for whether an
    execution workflow completed.

### Objective-Failing Checks

- `OC1` —
  `grep -q 'agent-handler consumes steered task_completed and runs QUICK_FIX mechanical validation' src/shared/session/agent-handler.test.js && deno task test src/shared/session/agent-handler.test.js --filter 'agent-handler consumes steered task_completed and runs QUICK_FIX mechanical validation'`
  — proves a steered completion advances QUICK_FIX Mechanical Validation; it fails today because no test covers the
  steered completion path and the handler cannot see that completion.
- `OC2` —
  `grep -q 'agent-handler consumes task_completed exactly once across follow-up turns' src/shared/session/agent-handler.test.js && deno task test src/shared/session/agent-handler.test.js --filter 'agent-handler consumes task_completed exactly once across follow-up turns'`
  — protects the stale-completion regression that `preTurnCount` originally avoided, while requiring the new
  consume-once behavior.
- `OC3` —
  `grep -q 'task_completed records accepted completion on hosted session only after ownership checks' src/tools/__tests__/task-completed.test.js && deno task test src/tools/__tests__/task-completed.test.js --filter 'task_completed records accepted completion on hosted session only after ownership checks'`
  — proves the producer writes only accepted completions, so a rejected tool call cannot advance a later workflow.
- `OC4` —
  `grep -q 'agent-handler ignores isolated task_completed records for root workflow advancement' src/shared/session/agent-handler.test.js && deno task test src/shared/session/agent-handler.test.js --filter 'agent-handler ignores isolated task_completed records for root workflow advancement'`
  — proves completions from isolated Agent sessions remain local to their callers and cannot advance the root workflow.

- Manual:
  - Start a QUICK_FIX, send a steering message while the Engineer is working, let it answer and finish, and confirm CI
    runs without further prompting.
  - Repeat during a Reviewer-Feedback repair and confirm the review round continues.
- Expected results:
  - Steering changes what the Agent does and never changes whether RunWield notices it finished.

## Edge Cases & Considerations

- **Isolated sessions are the hazard.** Semantic review repairs and merge repairs run through `runIsolatedAgentSession`
  against the same `HostedSession`, and their Agents call `task_completed` too. If those writes land in the same slot,
  the root handler will consume a completion that was never meant for it and advance the workflow early. Scope the
  record to the session that produced it, and have the root handler accept only its own. The isolated callers already
  read their own return value and must keep doing so.
- A completion left pending because the turn ended some other way must not advance a _later_, unrelated workflow.
  Clearing on new-workflow start is the guard.
- Do not move the ownership check into the tool. `canCompleteActiveExecutionWorkflow` currently refuses politely and
  requests attention; relocating it changes who reports the refusal and what the user sees.
- This does not change what `task_completed` returns to the model, its parameter description, or when an Agent is
  allowed to call it. A repair Agent completing on the owner's behalf keeps working as it does now.
- Do not add `__deps` seams. `HostedSession` is real in these tests already.
- The steering regression test must go through `SessionRuntime.steerSession`. A test that calls the handler twice proves
  nothing: that path already works today, and is why this bug survived.
