---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Implement execution and semantic-repair segment handoffs using canonical Plan checks and the transactional rollover continuation marker."
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
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 13
dependencies:
    - "12-session-activated-plan-actions"
planId: "4f16e83d-f127-42cd-8ea3-39fbbfec35fb"
status: "validated_reviewer"
---

# Execution and Semantic Repair Segment Handoff Backend

## Context

Approve & Run must move from planning to implementation without exposing Planner history to Engineer context. ADR-012
requires readiness and execution preparation before rollover. Semantic repair needs the same bounded context boundary so
that each repair starts in a fresh persisted segment rather than an exhausted predecessor.

Slice 10 already provides transactional rollover and an opaque continuation marker in the current segment. Slice 12
provides action-time checks against canonical Plan status, revision, and worktree evidence under Session Activation.
Those mechanisms are sufficient for both handoffs.

## Objective

- Run readiness and preparation before creating an execution segment.
- Revalidate canonical Plan and worktree evidence immediately before consequential actions.
- Make a fresh execution segment current with only the approved Plan, annotations/images, lifecycle/worktree state, and
  execution ownership.
- Keep execution current through implementation, isolated review, and validation.
- Roll each semantic rejection into a fresh repair segment with the frozen requirements, current execution/CI state,
  complete open Review Issues, applicable repair claims, and bounded repository/diff access.
- If interrupted before rollover commits, leave the predecessor current and require retry. If interrupted after commit,
  resume from the current segment's opaque continuation marker.
- Add no second continuation store.

## Approach

Route approval and repair actions through Session Activation and slice 12 canonical checks. Use slice 10's transaction
to create, synchronize, and activate each successor. The current segment marker is the sole persisted startup signal.
Reviewer Sessions remain isolated and disposable; repair segments remain ordered owner-visible Session history.

## Files to Modify

- `src/shared/workflow/` — readiness, preparation, handoff orchestration, repair packets, validation, and recovery.
- `src/shared/session/session-runtime.js` and `hosted-session.js` — activated workflow startup and current-marker
  resume.
- `src/shared/session/workflow-context-session.js` — execution/repair context and the existing opaque marker.
- `src/shared/session/workflow-messages.js` — bounded execution and repair seed messages.
- `src/shared/owner-coordination/sessions.js` and `session-activations.js` — transactional rollover under current
  proofs.
- `src/cmd/load-plan/` and `src/ui/workspace/server/` — route applicable run actions through the shared backend.

## Reuse Opportunities

- Slice 10 transactional rollover primitives.
- Slice 12 Session-activated canonical Plan action checks.
- `src/shared/workflow/workflow.js` and `validation.js`.
- `src/shared/session/workflow-context-session.js` current-segment marker.

## Implementation Steps

- [ ] Revalidate approval action, canonical Plan revision/status, and worktree evidence under Session Activation.
- [ ] Run readiness and execution preparation; Approve for Later creates no segment.
- [ ] Transactionally activate an execution segment with the opaque Engineer continuation marker and bounded seed.
- [ ] Resume Engineer from the marker in the committed current segment; pre-rollover failure requires explicit retry.
- [ ] On semantic rejection, transactionally activate a repair segment and seed only the bounded repair packet.
- [ ] Keep Engineer active in the latest execution/repair segment through successful validation.
- [ ] Test preparation failure, rollover crash points, image handoff, Reviewer isolation, repeated repairs, context
      exclusion, canonical evidence changes, and current-marker resume.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: prove pre-rollover interruption leaves the predecessor current and post-rollover interruption resumes the
  current marker without creating another successor.
- Automated: prove Engineer context excludes Planner history and each repair excludes predecessor Engineer/Reviewer
  history while aggregate projection retains all segments.
- Automated: prove changed Plan/worktree evidence blocks handoff and Approve for Later creates no segment.

## Edge Cases & Considerations

- Approval is not ambient authorization for a changed Plan, another Session, or a later revision.
- An unattached successor is reconciled by slice 10 rules and never exposed as a separate Session.
- Approval images cross the boundary without granting access to planning model history.
- The Review Issue Ledger remains lifecycle-scoped workflow state; the rollover marker only identifies startup context.
