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
    - "src/shared/session/agent-handler.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/session/workflow-context-session.test.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/validation-loop-core.test.js"
    - "src/shared/workflow/validation-loop-review.test.js"
    - "src/shared/workflow/validation-loop-repair.test.js"
    - "src/shared/workflow/validation-loop-human-review.test.js"
    - "src/shared/workflow/validation-loop-delivery.test.js"
    - "src/shared/workflow/validation-loop-recovery.test.js"
    - "src/ui/tui/chat-session.test.js"
    - "docs/architecture.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T23:43:58-04:00"
updatedAt: "2026-07-31T14:25:28.256Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-31T04:41:51.222Z"
verifiedAt: "2026-07-31T14:24:48.425Z"
userVerifiedAt: null
executionReport: "- Implemented workflow footer context derivation/persistence, execution-start seeding, root transcript-segment preservation/re-persistence, and Runtime snapshot fallback from active execution workflow.\n- Updated validation loop active workflow handling so Reviewer/repair cycles keep validation continuation state through pauses and repair dispatch while terminal outcomes explicitly clear active execution ownership.\n- Added regression coverage for legacy FEATURE normalization, duplicate context markers, manager swaps/null manager behavior, snapshot fallback precedence, and Reviewer footer rendering; updated architecture docs for the new source/projection boundaries.\n- Verification passed: `deno run -A scripts/run-tests.js src/shared/session/workflow-context-session.test.js src/shared/session/hosted-session.test.js src/shared/session/session-runtime.test.js src/shared/session/agent-handler.test.js src/shared/workflow/workflow.test.js src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-review.test.js src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-loop-human-review.test.js src/shared/workflow/validation-loop-delivery.test.js src/shared/workflow/validation-loop-recovery.test.js src/ui/tui/chat-session.test.js` (277 passed).\n- Verification passed: `deno task ci`."
workRecord:
    status: "generated"
    recordId: "ffd03b4f-beb9-44fa-93eb-b15eaf045769"
    path: "docs/work-records/2026-07-31-preserved-footer-context-through-validation-loops.md"
    lastAttemptAt: "2026-07-31T14:25:18.565Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-31T14:24:47.995Z"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "dbca240dbc126d851d31356b0c6accec51f86b28"
    targetBranch: "main"
    targetHeadBeforeMerge: "e5f07f4386b99b6ff48ee34c0d9c8078bb3e3ddf"
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
Plan name, Planned Change/Epic/Quick Fix label, and Complexity while the Reviewer and repair agents are active.
Discovery points to the state path, not the renderer:

- `buildFooterWorkflowLabelParts()` already renders context for `engineer`, `frontend-engineer`, `reviewer`,
  Reviewer-Feedback Engineer display names, and other non-excluded agents when `workflowContext` is present.
- `HostedSession.setRootSessionManager()` currently replaces `this.workflowContext` with whatever is persisted in the
  newly attached root `SessionManager`. A fresh execution `Session Transcript Segment` can have no
  `runwield.workflow_context` entry, so a valid planning-segment context can be dropped when execution/validation
  attaches another manager.
- `startActiveExecutionWorkflow()` records a durable active execution workflow containing `planName` and `triageMeta`,
  but it does not also seed the footer workflow context into the current execution segment.
- `runValidationLoop()` captures the active execution workflow and then clears it at validation start. Later repair
  paths only restore an active execution workflow for Frontend Engineer, and clear it again after completed repair. That
  makes validation/review/repair windows especially likely to have no authoritative execution context for the footer to
  project from.
- Work Record `Converging Semantic Review Rounds` confirms semantic review now uses the Reviewer plus a
  Reviewer-Feedback Engineer repair path. Its verification was user-attested rather than established by RunWield
  Workflow Validation, so preserve that implementation shape but add regression coverage in this Plan.

The intended outcome: from initial Plan execution through Semantic Code Review, Reviewer-Feedback Engineer repair, human
Code Review feedback repair, CI repair, merge repair, pauses, and re-review, the footer should continue to show the
currently active Agent plus the same Plan name, Planned Change/Epic/Quick Fix label, and Complexity until a new Triage
replaces the workflow context or the Session is disposed.

`docs/architecture.md` currently describes footer context as originating from `triage_report` or `plan_written`. This
bug fix expands the implemented source boundary to include execution-start seeding, segment-swap preservation, and a
read-only snapshot fallback from active execution workflow state, so the architecture note should be updated in the same
change to keep future planning and maintenance aligned.

## Objective

Fix workflow-context preservation at the source-of-truth boundaries so all runtime surfaces can render the footer
consistently. The implementation should:

- preserve existing `WorkflowContext` when a new non-null root `SessionManager` has no persisted marker;
- seed the current execution segment with one normalized context derived from the approved Plan's Front Matter and Plan
  name;
- keep active execution workflow state present during validation repair/review loops instead of clearing it mid-loop;
- keep `activeExecutionWorkflow.executionAgent` as the execution owner (`engineer` or `frontend-engineer`) while the
  visible active Agent label can temporarily be Reviewer or Reviewer-Feedback Engineer;
- allow `SessionRuntime.getSessionSnapshot()` to project footer context from active execution workflow only when
  explicit `workflowContext` is absent;
- add regression tests that fail on the reported review → fix → review loss.

## Approach

Treat footer context as a projection of authoritative workflow state, not as an authority itself.

1. **Persist explicit context whenever possible.** `triage_report` and `plan_written` already write
   `runwield.workflow_context` entries. Extend this pattern so execution start also records the Plan name and current
   Routing Intent/Complexity in the current execution segment.
2. **Write execution context as one normalized value.** Avoid sequentially mixing old routing metadata with a new Plan
   name. Derive a complete context from the current Plan/execution metadata and persist that normalized value in one
   helper call.
3. **Do not erase good context on segment swaps.** When `HostedSession` attaches a new non-null root `SessionManager`,
   preserve the current context if the new manager lacks a workflow-context marker, and write the preserved context into
   that manager so future projection/resume sees it. `setRootSessionManager(null)` should not itself clear context;
   disposal/dehydration remains the explicit context-clearing path.
4. **Use active execution workflow as a safe fallback.** During active execution/validation, `activeExecutionWorkflow`
   is RunWield-owned workflow truth. If `workflowContext` is unexpectedly null, derive a display-only context from
   `activeExecutionWorkflow.planName` and `activeExecutionWorkflow.triageMeta` for `SessionSnapshot.workflowContext`.
5. **Stop clearing active execution workflow during validation cycles.** Replace the validation-start clear and
   repair-only restore logic with a stable validation workflow record that remains set during Semantic Reviewer,
   Reviewer-Feedback Engineer, human feedback repair, CI repair, merge repair, and pause-for-continuation paths. Clear
   only on genuinely terminal validation/session outcomes where no continuation is expected; never clear merely because
   the active Agent changed to Reviewer or because one repair turn completed.

This keeps the TUI simple: the footer renderer continues to consume `snapshot.workflowContext`; it does not need to
understand validation state.

## Files to Modify

- `src/shared/session/workflow-context-session.js` — export or add a fail-open helper to record an already-normalized
  workflow context into a `SessionManager`; add a helper to derive `WorkflowContext` from an active execution
  workflow/Plan metadata without duplicating normalization logic.
- `src/shared/session/hosted-session.js` — update `setRootSessionManager()` to preserve and re-persist existing workflow
  context when a new manager has no marker; add/use a single context replacement path that emits
  `WORKFLOW_CONTEXT_CHANGED` only for material changes; keep disposal/dehydration behavior explicit.
- `src/shared/session/session-runtime.js` — update `getSessionSnapshot()` to fall back to context derived from
  `activeExecutionWorkflow` only when `session.getWorkflowContext()` and dormant managed metadata are absent; keep
  returned snapshot copies immutable.
- `src/shared/session/agent-handler.js` — audit validation-continuation entry/terminal cleanup paths so task-completed
  continuations do not clear active workflow before the validation loop has a chance to preserve it, while terminal
  non-validation paths still clear as before.
- `src/shared/workflow/workflow.js` — seed footer workflow context from `planName` and
  `triageMeta.classification`/`triageMeta.routingIntent` plus `triageMeta.complexity` in
  `startActiveExecutionWorkflow()` before validation can swap Agents; cover both worktree and non-Git in-place execution
  preparation paths.
- `src/shared/workflow/validation.js` — remove the validation-start active workflow clear; establish/preserve a
  validation continuation workflow for Reviewer and all repair paths; remove frontend-only repair context handling and
  avoid clearing context after a completed repair cycle; make terminal active-workflow cleanup explicit.
- `src/shared/session/workflow-context-session.test.js` — cover derivation/normalization/persistence helpers, including
  legacy `FEATURE` → `PLANNED_CHANGE`, invalid metadata, and duplicate-marker avoidance.
- `src/shared/session/hosted-session.test.js` — cover root-manager swaps that lack workflow context and prove the
  previous context is preserved and persisted into the new manager; cover `null` manager/dehydrate semantics.
- `src/shared/session/session-runtime.test.js` — cover snapshot fallback from active execution workflow and verify
  explicit persisted workflow context still wins over active workflow metadata.
- `src/shared/session/agent-handler.test.js` — adjust/add tests for task-completed validation continuation and terminal
  cleanup interactions if implementation changes `agent-handler.js`.
- `src/shared/workflow/workflow.test.js` — cover Plan execution start seeding workflow footer context into the active
  session manager from Plan Front Matter for worktree and non-Git in-place execution paths.
- `src/shared/workflow/validation-loop-core.test.js` — adjust success/cancel/blocked expectations around active workflow
  retention and explicit terminal cleanup.
- `src/shared/workflow/validation-loop-review.test.js` — add a regression for Semantic Reviewer rejection followed by
  Reviewer-Feedback Engineer repair and a second review, asserting workflow context remains available during Reviewer
  invocations and after repair dispatch.
- `src/shared/workflow/validation-loop-repair.test.js` — add/adjust repair continuation coverage so Engineer, Frontend
  Engineer, and Reviewer-Feedback Engineer repair paths retain active execution workflow/footer context across
  `task_completed` and pause paths.
- `src/shared/workflow/validation-loop-human-review.test.js` — verify human Code Review feedback repair preserves footer
  context and active workflow across approval/feedback cycles.
- `src/shared/workflow/validation-loop-delivery.test.js` — verify delivery, merge verification, and merge repair paths
  do not clear active workflow before terminal cleanup.
- `src/shared/workflow/validation-loop-recovery.test.js` — verify interrupted/recovered validation continuations restore
  active workflow/footer context from durable workflow state.
- `src/ui/tui/chat-session.test.js` — add a small renderer assertion that `reviewer` is an eligible footer Agent and
  displays `Reviewer - Medium Planned Change - plan-name` when workflow context is present.
- `docs/architecture.md` — update the Runtime boundary/persisted-state tables so they mention execution-start footer
  context seeding, segment-swap preservation, and the display-only active execution workflow snapshot fallback without
  making footer context authoritative for lifecycle decisions.

## Reuse Opportunities

- `src/shared/session/workflow-context-session.js` — reuse `normalizeWorkflowContext()`,
  `normalizeWorkflowRoutingIntent()`, `normalizeWorkflowComplexity()`, `normalizeWorkflowPlanName()`, and
  `workflowContextsEqual()` for all new derivation/persistence paths.
- `src/shared/session/hosted-session.js` — reuse existing event/persistence behavior, but consolidate it behind one
  normalized context replacement helper so `setWorkflowTriageContext()`, `setWorkflowPlanName()`, and execution-start
  seeding cannot diverge.
- `src/shared/workflow/workflow.js` — reuse `startActiveExecutionWorkflow()` because it already has the Plan name,
  effective Plan Front Matter, execution Agent, and current `HostedSession` at the correct boundary.
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
    the latest persisted marker;
  - expose the helper without adding new `__deps`/`__testDeps` seams.
- [ ] Update `HostedSession` workflow-context handling:
  - add an internal `replaceWorkflowContext(nextContext, { persist })`-style helper or equivalent to centralize copying,
    persistence, equality checks, and `WORKFLOW_CONTEXT_CHANGED` emission;
  - make `setWorkflowTriageContext()` and `setWorkflowPlanName()` preserve current in-memory fields when persistence is
    unavailable, while still avoiding stale routing/complexity when execution-start code provides a complete
    replacement;
  - add a `setWorkflowExecutionContext({ planName, triageMeta })` method, or equivalent internal helper, that records a
    single normalized context for the current Plan.
- [ ] Update `HostedSession.setRootSessionManager()`:
  - capture the previous in-memory `workflowContext` before replacing the manager;
  - if a new manager has persisted context, adopt it and emit `WORKFLOW_CONTEXT_CHANGED` when different;
  - if a new manager has no persisted context but previous context exists, keep previous context and write it to the new
    manager;
  - if `sessionManager` is `null`, leave `workflowContext` unchanged; rely on `dehydrateManagedSession()`/dispose/new
    Triage paths to clear context intentionally;
  - keep fail-open behavior so marker read/write failures do not block Session activation.
- [ ] In `startActiveExecutionWorkflow()` in `src/shared/workflow/workflow.js`, seed footer workflow context once the
      effective Plan metadata is known and before setting/using active execution workflow:
  - use the single execution-context helper rather than sequentially mixing old and new context;
  - cover both non-Git in-place and worktree execution branches;
  - ensure missing/invalid metadata is fail-open and does not prevent execution.
- [ ] In `SessionRuntime.getSessionSnapshot()`, compute `activeExecutionWorkflow` before `workflowContext`, then use
      this precedence: explicit hosted `workflowContext`, dormant managed `workflowContext`, derived context from active
      execution workflow, otherwise `null`. Do not persist from this fallback; snapshot projection must not mutate
      authority.
- [ ] In `runValidationLoop()`:
  - replace the `if (activeWorkflow) hostedSession.clearActiveExecutionWorkflow()` block with construction of a
    `validationWorkflow` object based on `activeWorkflow`, `resolvedExecutionContext`, `planName`, `triageMeta`,
    execution owner, `projectRoot`, and `executionCwd`;
  - keep `validationWorkflow.executionAgent` as the execution owner (`engineer` or `frontend-engineer`), not Reviewer;
  - set `validationContinuation: true` on that workflow while validation is active;
  - call `hostedSession.setActiveExecutionWorkflow(validationWorkflow)` before the first Semantic Reviewer turn;
  - update `runWorkflowRepair()` to set/preserve this workflow for Engineer, Frontend Engineer, and Reviewer-Feedback
    Engineer repair paths instead of frontend-only context handling;
  - remove the post-repair `clearActiveExecutionWorkflow()` call;
  - ensure `pauseForExecutionContinuation()` preserves any validation workflow fields and does not downgrade to an empty
    object when active workflow is present.
- [ ] Audit terminal validation returns in `runValidationLoop()` and callers in
      `src/shared/session/agent-handler.js`/`src/shared/workflow/workflow.js` for active workflow clearing:
  - preserve active workflow for `paused` and continuation results;
  - explicitly clear active workflow after terminal verified/failed/canceled/blocked outcomes if that is the existing
    terminal lifecycle policy;
  - never clear `workflowContext` itself except on new Triage, dehydrate/dispose, or another existing explicit Session
    reset path.
- [ ] Update `docs/architecture.md` where it documents workflow footer context and persisted/transient Session state:
  - include execution start as a source that seeds `runwield.workflow_context`;
  - mention that root Session Transcript Segment swaps preserve and re-persist existing footer context when the new
    segment has no marker;
  - note that `activeExecutionWorkflow` can supply a display-only `SessionSnapshot.workflowContext` fallback, but
    remains live workflow authority rather than footer-context persistence.
- [ ] Add regression coverage before the behavioral fix where practical:
  - `workflow-context-session.test.js`: derivation normalizes legacy `FEATURE`, rejects incomplete routing/complexity
    pairs, preserves Plan-name-only context, and avoids duplicate persisted markers;
  - `hosted-session.test.js`: previous context survives `setRootSessionManager(emptyExecutionManager)` and the empty
    manager receives a `runwield.workflow_context` entry; `setRootSessionManager(null)` does not clear context, while
    dehydrate/dispose still does;
  - `session-runtime.test.js`: snapshot returns derived
    `{ routingIntent: "PLANNED_CHANGE", complexity: "MEDIUM", planName: "footer-plan" }` from active execution workflow
    when explicit context is null, and explicit persisted context takes precedence when both exist;
  - `workflow.test.js`: Plan execution start writes footer context into the session manager from Plan Front Matter for
    both execution preparation modes;
  - `validation-loop-review.test.js`: fake reviewer rejection → Reviewer-Feedback Engineer completion → second reviewer
    invocation observes unchanged `hostedSession.getWorkflowContext()` and `getActiveExecutionWorkflow().planName`;
  - `validation-loop-repair.test.js`: Engineer, Frontend Engineer, and Reviewer-Feedback Engineer repair paths retain
    active workflow/footer context after repair completion and on pause;
  - `validation-loop-human-review.test.js`, `validation-loop-delivery.test.js`, and `validation-loop-recovery.test.js`:
    update any existing assertions that assumed mid-loop active workflow clearing, while preserving terminal cleanup
    assertions;
  - `chat-session.test.js`: Reviewer footer label includes Complexity, Planned Change label, and Plan name.
- [ ] Run focused tests, then full repository verification.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/session/workflow-context-session.test.js src/shared/session/hosted-session.test.js src/shared/session/session-runtime.test.js src/shared/session/agent-handler.test.js src/shared/workflow/workflow.test.js src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-review.test.js src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-loop-human-review.test.js src/shared/workflow/validation-loop-delivery.test.js src/shared/workflow/validation-loop-recovery.test.js src/ui/tui/chat-session.test.js`
- Automated: `deno task ci`
- Documentation: confirm `docs/architecture.md` describes the implemented footer-context sources and still states that
  display projections do not own lifecycle truth.
- Manual: start or load a Planned Change Plan that reaches Workflow Validation, force or use a Semantic Review
  rejection, let the Reviewer-Feedback Engineer repair run, then observe the second Semantic Review.
- Manual expected result: throughout Reviewer, Reviewer-Feedback Engineer, Engineer/Frontend Engineer repair, human Code
  Review feedback repair, and re-review turns, the TUI footer continues to show the active Agent plus the same
  Complexity, Planned Change/Epic/Quick Fix label, and Plan name.
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
  - Reviewer-Feedback Engineer or execution repair completes and validation loops back: active workflow is not cleared
    between cycles, so footer context does not flicker or disappear;
  - terminal verified/failed/canceled validation paths do not leave stale active execution ownership, while preserving
    `workflowContext` for the Session until the next Triage/reset.

## Edge Cases & Considerations

- **Authority boundary:** do not read footer/snapshot/cache fields to decide lifecycle state. `workflowContext` remains
  display context; active execution workflow and Plan Lifecycle remain authoritative for execution/validation.
- **Active execution workflow ownership:** `HostedSession.setActiveExecutionWorkflow()` accepts only Engineer or
  Frontend Engineer ownership. Do not set Reviewer as `executionAgent`; the visible Reviewer label comes from active
  Agent/session state, not from active execution workflow ownership.
- **Session Transcript Segment boundary:** execution segments may intentionally omit Planner history. The context marker
  must be copied/seeded as structured workflow state, not by copying Planner transcript messages.
- **Legacy terminology:** legacy `FEATURE` classification/routing must continue to render as `Planned Change`; use
  existing normalization instead of adding a separate label path.
- **Managed/dormant Sessions:** avoid mutating dormant managed metadata from snapshot fallback. Managed catalog
  `workflowContext` remains a projection cache updated during normal checkpoint/publish flows.
- **Terminal cleanup:** retaining active workflow during repair loops should not leave stale execution ownership after
  terminal validation. Make terminal cleanup explicit and tested if touched; never clear `workflowContext` as part of
  terminal validation cleanup.
- **Concurrent broader work:** semantic review convergence is now represented by Work Record
  `docs/work-records/2026-07-29-converging-semantic-review-rounds.md` with user-attested verification. If validation
  loop source has moved further, rebase this fix onto the current Reviewer/Reviewer-Feedback Engineer flow and keep the
  footer-context invariants/tests from this Plan.
- **JavaScript/TypeScript scope:** this bug fix touches existing large legacy JavaScript runtime modules. Do not add new
  JavaScript files or new injection seams. Keep JSDoc typedefs precise in touched JS; if a new helper module is
  extracted, write it in TypeScript.
- **No glossary change:** this bug fix does not introduce or redefine domain language; `CONTEXT.md` should not be
  modified for this Plan. The only documentation change is an architecture note that keeps existing source-of-truth and
  projection boundaries accurate.
