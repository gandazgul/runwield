---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Build owner Workspace Plan review and approval actions under Session Activation with canonical Plan/worktree checks and bounded endpoint request idempotency."
affectedPaths:
    - "src/ui/workspace/server/"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/"
    - "src/shared/workflow/"
    - "src/shared/session/"
    - "docs/design-system.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-26T20:48:25.378Z"
updatedAt: "2026-07-26T20:48:25.378Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 17
dependencies:
    - "16-complete-workspace-session-navigation-and-timeline-ux"
    - "13-execution-segment-handoff-backend"
planId: "f2df38b7-4a48-4e28-b41d-08a72c966536"
---

# Workspace Plan Review, Approve, and Recovery UI

## Context

The flagship journey starts planning in TUI, reviews the Plan from a phone, sends Feedback or approval, observes
execution, and returns to a synchronized TUI. Owner actions must run while the stable Session holds Session Activation
and must revalidate canonical Plan/worktree evidence. Browser retries can reuse bounded endpoint operation receipts, but
those receipts do not describe workflow progress.

## Objective

- Review a Session-associated Plan using existing Plan/Epic and Plannotator foundations.
- Submit Feedback, Approve for Later, Approve & Run, and recovery actions under Session Activation.
- Display current canonical Plan status/revision, relevant worktree evidence, acting Session, action scope, and
  warnings.
- Revalidate canonical evidence at action time and reject stale submissions with refresh/recovery guidance.
- Use request IDs only to deduplicate delivery of one endpoint request.
- Show execution, validation, repair, completion, and recovery progress from canonical and transcript projections.
- Keep owner review authorization separate from public Shared Plan capability review.

## Approach

Extend existing Workspace Plan surfaces. Route consequential actions through slice 12 and execution startup through
slice 13. A duplicate HTTP delivery may return its bounded prior response; a new request revalidates all canonical
evidence. Pending review conversation remains process-local, so process loss reloads committed history and asks the
owner to retry.

## Files to Modify

- `src/ui/workspace/server/plan-adapter.js` — canonical Plan reads and Session-activated actions.
- `src/ui/workspace/server/` — review, approval, progress, recovery, and request-idempotency endpoints.
- `src/ui/workspace/pages/plans/` and related routes — owner review, approval, progress, and recovery.
- `src/ui/workspace/components/` and `islands/` — status, action scope, warnings, progress, retry, and recovery UI.
- `src/ui/workspace/react/` — owner Plannotator annotations where appropriate.
- `src/shared/workflow/` and `src/shared/session/` — UI-safe canonical progress and Session correlation helpers.
- `docs/design-system.md` — document only reusable new approval/recovery patterns.

## Reuse Opportunities

- Existing Plan/Epic and Plannotator components.
- `src/ui/workspace/server/plan-adapter.js` canonical loading.
- `src/shared/workflow/plan-lifecycle.js` canonical transitions.
- Slice 12 Session-activated Plan actions and slice 13 rollover handoff.
- Existing `owner_session_operations` receipts for bounded endpoint deduplication.

## Implementation Steps

- [ ] Add owner Plan review routes linked from Session timeline and Attention Dashboard.
- [ ] Render canonical Plan status/revision, relevant worktree evidence, acting Session, action scope, and warnings.
- [ ] Implement Feedback, Approve for Later, Approve & Run, and recovery through Session-activated shared actions.
- [ ] Attach bounded request IDs to mutating endpoints and keep receipts separate from projected workflow progress.
- [ ] Show execution/validation/repair/completion from aggregate transcript and canonical artifacts.
- [ ] On stale evidence or process loss, refresh committed state and provide retry/recovery guidance.
- [ ] Preserve Shared Space trust separation and test duplicate delivery, stale revisions/statuses, changed worktrees,
      incompatible activation, reconnect, and public-capability isolation.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: prove each consequential action requires Session Activation and current canonical Plan/worktree evidence.
- Automated: prove duplicate delivery of one request is idempotent while a new request rechecks current evidence.
- Automated: prove public Shared Plan capabilities cannot access owner actions.
- Manual headed browser: review a TUI-created Plan on a phone viewport, send Feedback, Approve & Run, observe progress,
  and confirm synchronized TUI history.

## Edge Cases & Considerations

- Approval is scoped to the acting Session, Plan ID/revision/status, expected segment, and relevant worktree evidence.
- Manual Plan edits must be detected before action execution.
- Browser disconnect does not cancel running work; owner-process loss during a pending review prompt requires retry.
- Owner Plan review and Shared Plan review remain separate authorization paths.
