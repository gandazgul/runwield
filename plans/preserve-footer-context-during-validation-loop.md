---
planId: "ccba05d1-e42a-481e-a97d-c213ee7c6526"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Preserve TUI footer workflow context — Plan name, Planned Change/Epic/Quick Fix label, and Complexity — throughout Workflow Validation review/repair/re-review loops."
affectedPaths:
    - "src/shared/session/workflow-context-session.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/validation-loop-review.test.js"
    - "src/shared/workflow/validation-loop-repair.test.js"
    - "src/ui/tui/chat-session.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T23:43:58-04:00"
updatedAt: "2026-07-30T14:41:50.171Z"
status: "feedback"
origin: "internal"
userVerifiedAt: null
humanReviewMode: null
humanReviewDecision: null
worktreeStatus: "abandoned"
routingIntent: "PLANNED_CHANGE"
sessionName: "footer workflow context"
---

# Preserve Footer Context During Validation Loop

## Context

The TUI footer is supposed to keep workflow context visible for eligible workflow agents: active Agent, Complexity,
Routing Intent/Plan Classification label, and Plan name. Existing implementation and Work Record evidence show this was
intentional: footer context is persisted as `runwield.workflow_context`, rendered by `src/ui/tui/chat-session.js`, and
excluded only for Guide/Ideator/Operator.

The reported bug is that during the Workflow Validation review → fix → review loop, the footer loses the Plan context,
Plan name, classification label, and Complexity while the Reviewer and repair Engineer are active. Discovery points to
the state path, not the renderer:

- `buildFooterWorkflowLabelParts()` already renders context for `engineer`, `frontend-engineer`, `reviewer`, and other
  non-excluded agents when `workflowContext` is present.
- `HostedSession.setRootSessionManager()` currently replaces `this.workflowContext` with whatever is persisted in the
  newly attached root `SessionManager`. A fresh execution `Session Transcript Segment` can have no
  `runwield.workflow_context` entry, so a valid planning-segment context can be dropped when execution/validation
  attaches another manager.
- `startActiveExecutionWorkflow()` records a durable active execution workflow containing `planName` and `triageMeta`,
  but it does not also seed the footer workflow context into the current segment.
- `runValidationLoop()` captures the active execution workflow and then clears it at validation start. Later repair
  paths only restore an active execution workflow for Frontend Engineer, and clear it again after completed repair. That
  makes validation/review/repair windows especially likely to have no authoritative execution context for the footer to
  project from.

The intended outcome: from initial Plan execution through Semantic Code Review, human Code Review feedback repair, merge
repair, pauses, and re-review, the footer should continue to show the active validation Agent plus the same Plan name,
Planned Change/Epic/Quick Fix label, and Complexity until a new Triage replaces the workflow context or the Session is
disposed.

## Objective

Fix workflow-context preservation at the source of truth boundaries so all runtime surfaces can render the footer
consistently. The implementation should:

- preserve existing `WorkflowContext` when a new root `SessionManager` has no persisted marker;
- seed the current execution segment with context derived from the approved Plan's front matter and Plan name;
- keep active execution workflow state present during validation repair/review loops instead of clearing it mid-loop;
- allow `SessionRuntime.getSessionSnapshot()` to project footer context from active execution workflow only when
  explicit `workflowContext` is absent;
- add regression tests that fail on the reported review → fix → review loss.

## Approach

Treat footer context as a projection of authoritative workflow state, not as an authority itself.

1. **Persist explicit context whenever possible.** `triage_report` and `plan_written` already write
   `runwield.workflow_context` entries. Extend this pattern so execution start also records the Plan name and
   `triageMeta` classification/complexity in the current execution segment.
2. **Do not erase good context on segment swaps.** When `HostedSession` attaches a new root `SessionManager`, preserve
   the current context if the new manager lacks a workflow-context marker, and write the preserved context into that
   manager so future projection/resume sees it.
3. **Use active execution workflow as a safe fallback.** During active execution/validation, `activeExecutionWorkflow`
   is RunWield-owned workflow truth. If `workflowContext` is unexpectedly null, derive a display-only context from
   `activeExecutionWorkflow.planName` and `activeExecutionWorkflow.triageMeta` for `SessionSnapshot.workflowContext`.
4. **Stop clearing active execution workflow during validation cycles.** Replace the validation-start clear and
   repair-only restore logic with a stable validation workflow record that remains set during Semantic Reviewer, repair
   Engineer/Frontend Engineer, human feedback repair, merge repair, and pause-for-continuation paths. Clear only on
   genuinely terminal validation/session outcomes where no continuation is expected; never clear merely because the
   active Agent changed to Reviewer or because one repair turn completed.

This keeps the TUI simple: the footer renderer continues to consume `snapshot.workflowContext`; it does not need to
understand validation state.

## Files to Modify

- `src/shared/session/workflow-context-session.js` — export or add a small fail-open helper to record an
  already-normalized workflow context into a `SessionManager`; add a helper to derive `WorkflowContext` from an active
  execution workflow/Plan metadata without duplicating normalization logic.
- `src/shared/session/hosted-session.js` — update `setRootSessionManager()` to preserve and re-persist existing workflow
  context when the new manager has no marker; emit `WORKFLOW_CONTEXT_CHANGED` when attaching a manager materially
  changes context; keep disposal/dehydration behavior explicit.
- `src/shared/session/session-runtime.js` — update `getSessionSnapshot()` to fall back to context derived from
  `activeExecutionWorkflow` only when `session.getWorkflowContext()` and dormant managed metadata are absent; keep
  returned snapshot copies immutable.
- `src/shared/workflow/workflow.js` — seed footer workflow context from `planName` and
  `triageMeta.classification`/`triageMeta.complexity` in `startActiveExecutionWorkflow()` before validation can swap
  Agents.
- `src/shared/workflow/validation.js` — remove the validation-start active workflow clear; establish/preserve a
  validation continuation workflow for Reviewer and all repair paths; remove frontend-only repair context handling and
  avoid clearing context after a completed repair cycle.
- `src/shared/session/hosted-session.test.js` — cover root-manager swaps that lack workflow context and prove the
  previous context is preserved and persisted into the new manager.
- `src/shared/session/session-runtime.test.js` — cover snapshot fallback from active execution workflow and verify
  explicit persisted workflow context still wins over active workflow metadata.
- `src/shared/workflow/workflow.test.js` — cover Plan execution start seeding workflow footer context into the active
  session manager from Plan front matter.
- `src/shared/workflow/validation-loop-review.test.js` — add a regression for Semantic Reviewer rejection followed by
  repair and a second review, asserting workflow context remains available during Reviewer invocations and after repair
  dispatch.
- `src/shared/workflow/validation-loop-repair.test.js` — add/adjust repair continuation coverage so Engineer and
  Frontend Engineer repair paths both retain active execution workflow/footer context across task_completed and pause
  paths.
- `src/ui/tui/chat-session.test.js` — add a small renderer assertion that `reviewer` is an eligible footer Agent and
  displays `Reviewer - Medium Planned Change - plan-name` when workflow context is present.

## Reuse Opportunities

- `src/shared/session/workflow-context-session.js` — reuse `normalizeWorkflowContext()`,
  `normalizeWorkflowRoutingIntent()`, `normalizeWorkflowComplexity()`, `normalizeWorkflowPlanName()`, and
  `workflowContextsEqual()` for all new derivation/persistence paths.
- `src/shared/session/hosted-session.js` — reuse existing `setWorkflowTriageContext()` and `setWorkflowPlanName()`
  event/persistence behavior rather than writing custom entries directly from workflow modules.
- `src/shared/workflow/workflow.js` — reuse `startActiveExecutionWorkflow()` because it already has the Plan name,
  effective Plan front matter, execution Agent, and current `HostedSession` at the correct boundary.
- `src/shared/workflow/validation.js` — reuse the existing `pauseForExecutionContinuation()` active workflow handoff
  shape, extending it to cover normal validation/review cycles rather than only incomplete repair.
- `src/ui/tui/chat-session.js` — keep existing `FOOTER_ROUTING_META`, `FOOTER_COMPLEXITY_META`, and exclusion rules; no
  new visual pattern is needed.

## Implementation Steps

- [ ] Add workflow-context derivation/persistence helpers in `src/shared/session/workflow-context-session.js`:
  - derive `routingIntent` from `triageMeta.routingIntent` or `triageMeta.classification`, accepting legacy `FEATURE`
    through existing normalization;
  - derive `complexity` from `triageMeta.complexity`;
  - derive `planName` from `workflow.planName` or the explicit Plan name;
  - return `null` unless at least Plan name or valid routing+complexity is available;
  - persist normalized context via `appendCustomEntry(WORKFLOW_CONTEXT_CUSTOM_TYPE, context)` only when it differs from
    the latest persisted marker.
- [ ] Update `HostedSession.setRootSessionManager()`:
  - capture the previous in-memory `workflowContext` before replacing the manager;
  - if the new manager has persisted context, adopt it and emit `WORKFLOW_CONTEXT_CHANGED` when different;
  - if the new manager has no persisted context but previous context exists, keep previous context and write it to the
    new manager;
  - if neither exists, leave context null;
  - keep fail-open behavior so marker read/write failures do not block Session activation.
- [ ] Add a small `HostedSession` method or internal helper if needed to avoid duplicating context replacement/event
      emission between `setRootSessionManager()`, `setWorkflowTriageContext()`, and `setWorkflowPlanName()`.
- [ ] In `startActiveExecutionWorkflow()` in `src/shared/workflow/workflow.js`, call the existing
      `hostedSession.setWorkflowTriageContext({ routingIntent: triageMeta.classification || triageMeta.routingIntent, complexity: triageMeta.complexity })`
      and `hostedSession.setWorkflowPlanName(planName)` once the effective Plan metadata is known and before
      setting/using active execution workflow. Ensure missing/invalid metadata is fail-open and does not prevent
      execution.
- [ ] In `SessionRuntime.getSessionSnapshot()`, compute `activeExecutionWorkflow` before `workflowContext`, then use
      this precedence: explicit hosted `workflowContext`, dormant managed `workflowContext`, derived context from active
      execution workflow, otherwise `null`. Do not persist from this fallback; snapshot projection must not mutate
      authority.
- [ ] In `runValidationLoop()`:
  - replace the `if (activeWorkflow) hostedSession.clearActiveExecutionWorkflow()` block with construction of a
    `validationWorkflow` object based on `activeWorkflow`, `resolvedExecutionContext`, `planName`, `triageMeta`,
    `executionAgent`, `projectRoot`, and `executionCwd`;
  - set `validationContinuation: true` on that workflow while validation is active;
  - call `hostedSession.setActiveExecutionWorkflow(validationWorkflow)` before the first Semantic Reviewer turn;
  - update `runWorkflowRepair()` to set/preserve this workflow for both Engineer and Frontend Engineer repair, not only
    Frontend Engineer;
  - remove the post-repair `clearActiveExecutionWorkflow()` call;
  - ensure `pauseForExecutionContinuation()` preserves any validation workflow fields and does not downgrade to an empty
    object when active workflow is present.
- [ ] Audit terminal validation returns in `runValidationLoop()` and callers in
      `src/shared/session/agent-handler.js`/`src/shared/workflow/workflow.js` for active workflow clearing. Preserve
      active workflow for `paused` results; clear only after terminal verified/failed/canceled outcomes if that is the
      existing terminal lifecycle policy, and never clear `workflowContext` itself except on new Triage/dispose.
- [ ] Add regression coverage before the behavioral fix where practical:
  - `hosted-session.test.js`: previous context survives `setRootSessionManager(emptyExecutionManager)` and the empty
    manager receives a `runwield.workflow_context` entry;
  - `session-runtime.test.js`: snapshot returns derived
    `{ routingIntent: "PLANNED_CHANGE", complexity: "MEDIUM", planName: "footer-plan" }` from active execution workflow
    when explicit context is null, and explicit persisted context takes precedence when both exist;
  - `workflow.test.js`: Plan execution start writes footer context into the session manager from Plan front matter;
  - `validation-loop-review.test.js`: fake reviewer rejection → fake repair completion → second reviewer invocation
    observes unchanged `hostedSession.getWorkflowContext()` and `getActiveExecutionWorkflow().planName`;
  - `validation-loop-repair.test.js`: Engineer and Frontend Engineer repair paths retain active workflow/footer context
    after repair completion and on pause;
  - `chat-session.test.js`: Reviewer footer label includes Complexity, Planned Change label, and Plan name.
- [ ] Run focused tests, then full repository verification.

## Verification Plan

- Automated:
  `deno test src/shared/session/hosted-session.test.js src/shared/session/session-runtime.test.js src/shared/workflow/workflow.test.js src/shared/workflow/validation-loop-review.test.js src/shared/workflow/validation-loop-repair.test.js src/ui/tui/chat-session.test.js`
- Automated: `deno task ci`
- Manual: start or load a Planned Change Plan that reaches Workflow Validation, force or use a Semantic Review
  rejection, let the repair Agent run, then observe the second Semantic Review.
- Manual expected result: throughout Reviewer, repair Engineer/Frontend Engineer, and re-review turns, the TUI footer
  continues to show the active Agent plus the same Complexity, Planned Change/Epic/Quick Fix label, and Plan name.
- Manual expected result: Guide/Ideator/Operator remain excluded from workflow footer labels, preserving existing visual
  behavior.
- Expected results for key scenarios:
  - execution segment starts with no persisted workflow-context marker: footer context is preserved from the previous
    Session state and persisted into the new segment;
  - explicit persisted context and active execution workflow disagree: explicit `workflowContext` wins in snapshots,
    preserving committed transcript authority;
  - active validation workflow exists but explicit context is absent: snapshots derive a display-only context from
    active workflow metadata;
  - Semantic Reviewer runs as an isolated sub-agent: active Agent label changes to Reviewer, but Plan/routing/complexity
    context remains;
  - repair Agent completes and validation loops back: active workflow is not cleared between cycles, so footer context
    does not flicker or disappear.

## Edge Cases & Considerations

- **Authority boundary:** do not read footer/snapshot/cache fields to decide lifecycle state. `workflowContext` remains
  display context; active execution workflow and Plan Lifecycle remain authoritative for execution/validation.
- **Session Transcript Segment boundary:** execution segments may intentionally omit Planner history. The context marker
  must be copied/seeded as structured workflow state, not by copying Planner transcript messages.
- **Legacy terminology:** legacy `FEATURE` classification/routing must continue to render as `Planned Change`; use
  existing normalization instead of adding a separate label path.
- **Managed/dormant Sessions:** avoid mutating dormant managed metadata from snapshot fallback. Managed catalog
  `workflowContext` remains a projection cache updated during normal checkpoint/publish flows.
- **Terminal cleanup:** retaining active workflow during repair loops should not leave stale execution ownership after
  terminal validation. Keep/restore the existing terminal cleanup semantics, but make terminal cleanup explicit and
  tested if touched.
- **Concurrent broader work:** the untracked draft `plans/converging-semantic-review-rounds.md` and edited semantic
  review PRD also target `validation.js`. If that broader convergence work executes first, rebase this fix onto its
  revised validation loop and keep the footer-context invariants/tests from this Plan.
- **No glossary change:** this bug fix does not introduce or redefine domain language; `CONTEXT.md` should not be
  modified for this Plan.
