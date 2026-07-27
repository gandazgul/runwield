---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement backend workflow context handoffs: Approve & Run creates the initial execution segment, and each semantic rejection creates a fresh persisted repair segment with bounded context and exact-once continuation."
affectedPaths:
    - "src/shared/workflow/"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/workflow-context-session.js"
    - "src/shared/session/workflow-messages.js"
    - "src/shared/owner-coordination/sessions.js"
    - "src/shared/owner-coordination/session-activations.js"
    - "src/cmd/load-plan/"
    - "src/ui/workspace/server/"
executionAgent: "engineer"
createdAt: "2026-07-26T20:48:25.377Z"
updatedAt: "2026-07-27T19:30:00.000Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 13
dependencies:
    - "12-plan-workflow-lease-enforcement"
---

# Execution and Semantic Repair Segment Handoff Backend

## Context

Approve & Run is the product-critical point where a planning Session becomes an implementation Session without leaking
Planner context into Engineer context. ADR-012 requires that segment rollover happen only after readiness and execution
preparation succeed. The execution segment is seeded only with the approved Plan, approval annotations/images, current
lifecycle/worktree state, and execution ownership.

Semantic repair is a second correctness-sensitive handoff. Reusing the implementation transcript gives the Engineer
Reviewer feedback only after implementation and prior validation have consumed most of the context window. This backend
slice therefore consumes durable checkpoints, segment rollover primitives, and Plan Workflow Leases for both initial
execution and repeated semantic-repair context boundaries. It does not build the browser Plan review UI.

## Objective

Implement execution handoff backend behavior so that:

- Approve & Run consumes exactly one approval checkpoint under expected Session, Plan, Plan revision, lease generation,
  Session generation, and current planning segment;
- Readiness Gate and execution preparation run before any execution segment is created;
- Approve for Later creates no execution segment;
- a fresh execution segment is created and made current only after preparation succeeds;
- Engineer's first turn starts exactly once with approved Plan, approval annotations/images, lifecycle/worktree state,
  and execution ownership, without Planner messages or Planner summaries;
- the initial execution segment remains current through implementation, isolated Reviewer passes, and validation until a
  semantic rejection establishes a successor context boundary;
- each semantic rejection seals the current execution or repair segment and activates a fresh persisted semantic repair
  segment under the same stable Session, Plan Workflow Lease, and execution worktree;
- the repair segment receives frozen Plan requirements, current execution/CI state, the complete open Review Issue set,
  applicable prior repair claims, and bounded repository/diff access without predecessor Engineer or Reviewer history;
- interruption resumes the current repair segment, while a later semantic rejection creates another fresh successor;
- crash recovery after segment activation resumes the typed pending Engineer continuation exactly once or routes
  uncertain effects to recovery.

## Approach

Add workflow continuation handlers for approval checkpoints. Keep all consequential work behind Session Activation and
Plan Workflow Lease validation. Use the generic rollover primitives from slice 10 for segment creation and manifest
switching, then seed the new current segment through existing workflow context/message patterns. Treat Reviewer work as
isolated disposable Agent Sessions that never replace the root segment. Treat Engineer semantic repair as a persisted
successor segment because it mutates the worktree and owns recoverable effects.

## Files to Modify

- `src/shared/workflow/` — add approval continuation handlers, readiness/preparation integration, execution and semantic
  repair segment seeding, validation ownership, structured repair handoff, and recovery routing.
- `src/shared/session/session-runtime.js` — expose internal workflow operations needed to consume checkpoints and start
  Engineer under activation capability.
- `src/shared/session/hosted-session.js` — support exact-once Engineer startup after segment activation and safe
  recovery when startup is pending.
- `src/shared/session/workflow-context-session.js` — persist execution segment context, Plan approval evidence, and
  semantic repair attempt context plus private continuation markers.
- `src/shared/session/workflow-messages.js` — format approved Plan/execution and bounded repair seed messages without
  predecessor transcript content.
- `src/shared/owner-coordination/sessions.js` — use transactional rollover APIs for execution and semantic repair
  segment creation and recovery checks.
- `src/shared/owner-coordination/session-activations.js` — validate generation/current-segment/fence during approval
  consumption and rollover.
- `src/cmd/load-plan/` — ensure executable Plan approval/run flows route through the new backend continuation path where
  applicable.
- `src/ui/workspace/server/` — expose backend endpoints or service calls for later Workspace UI actions without
  UI-specific logic.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- Transactional rollover primitives from slice 10 — create and activate execution and repeated semantic repair segments
  safely.
- Durable checkpoints from slice 11 — consume approval outcomes exactly once.
- Plan Workflow Leases from slice 12 — preserve workflow ownership across handoff and validation.
- `src/shared/workflow/workflow.js` and `validation.js` — reuse execution, validation, repair, and result flow.
- `src/shared/session/workflow-context-session.js` — reuse persisted workflow context entries for execution state.
- ADR-012 behavior captured in existing docs and tests — use as acceptance criteria for context boundary semantics.

## Implementation Steps

- [ ] Implement typed continuation handlers for Feedback, Approve for Later, and Approve & Run checkpoint outcomes at
      the backend workflow layer.
- [ ] Run readiness and execution preparation before execution segment creation, including worktree selection and
      collaboration-style decisions.
- [ ] Use rollover primitives to create/synchronize a fresh execution segment and publish it current with a pending
      Engineer continuation marker.
- [ ] Seed the execution segment with approved Plan content, approval annotations/images, current lifecycle/worktree
      state, and execution ownership only.
- [ ] Start Engineer's first turn exactly once after segment activation and persist recovery evidence around every crash
      point.
- [ ] On semantic rejection, checkpoint the structured Review Issue Ledger, transactionally roll to a semantic repair
      segment, and seed only the bounded repair packet plus repository/diff inspection capabilities.
- [ ] Resume interruption in the active repair segment, but create a new successor segment for every later semantic
      rejection; never fall back to a near-exhausted predecessor when rollover fails.
- [ ] Keep Engineer active in the latest execution or repair segment through successful verification until a later new
      User Request.
- [ ] Add tests for Approve for Later, preparation failure, orphan segment recovery, exact-once Engineer startup, image
      handoff, Reviewer isolation, repeated semantic repair rollover, repair-context exclusion, and ledger recovery.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: Approve & Run and semantic-repair crash-point tests should cover before readiness, after successor JSONL
  creation, after lineage sync, after manifest switch, before Engineer's first turn, during validation repair, and after
  successful validation.
- Automated: prove Engineer prompt/model context excludes Planner messages and summaries while owner-visible aggregate
  timeline still includes planning history.
- Automated: prove each semantic repair prompt/model context excludes predecessor Engineer and Reviewer histories while
  the aggregate timeline includes prior execution/repair segments and the active ledger survives interruption.
- Automated: prove Approve for Later creates no execution segment and later Run performs its own
  readiness/preparation/rollover.
- Manual: run a TUI-created Plan through a simulated approval service and inspect the resulting execution segment,
  aggregate timeline, and active Agent state.

## Edge Cases & Considerations

- Approval is scoped and not ambient authorization for changed Plans, other Sessions, or later revisions.
- Failure before manifest switch leaves the predecessor planning, execution, or repair segment current; failure after
  switch resumes or recovers in the activated successor segment.
- Isolated Reviewer Sessions never replace the root current segment.
- A repair JSONL is private lifecycle-scoped Session history, not a Plan, Work Record, project Memory, or substitute for
  the active Review Issue Ledger checkpoint.
- Approval images must resolve across the segment transition without granting Engineer access to the planning segment
  model history.
