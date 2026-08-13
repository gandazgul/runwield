---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Build owner Workspace Plan review and approval actions (Feedback, Approve for Later, Approve & Run) under Session Activation, reusing the verified slice 12 canonical checks and slice 13 execution handoff."
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
updatedAt: "2026-08-13T00:24:38-04:00"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 16
dependencies:
    - "15-complete-workspace-session-navigation-and-timeline-ux"
    - "13-execution-segment-handoff-backend"
planId: "f2df38b7-4a48-4e28-b41d-08a72c966536"
---

# Workspace Plan Review and Approve UI

## Context

The flagship journey starts planning in TUI, reviews the Plan from a phone, sends Feedback or approval, observes
progress, and returns to a synchronized TUI. Owner actions must run while the stable Session holds Session Activation
and must revalidate canonical Plan/worktree evidence — both already implemented and verified in slice 12; this slice
calls them and shows their errors plainly.

Deferred to the hardening slice (17): recovery-action UI (this slice shows the error and says to recover in the TUI) and
a dedicated execution-progress view (this slice links back to the Session timeline from slice 15 instead).

## Objective

- Review a Session-associated Plan using existing Plan/Epic and Plannotator foundations.
- Submit Feedback, Approve for Later, and Approve & Run under Session Activation.
- Display current canonical Plan status/revision, relevant worktree evidence, acting Session, and warnings.
- Reject stale submissions plainly: show the canonical-check error from slice 12 and a refresh action. Recovery beyond
  refresh happens in the TUI for now.
- After Approve & Run, link to the Session timeline to observe execution; no dedicated progress view in this slice.
- Attach a request ID to each mutating endpoint so a retried delivery of the same request is not performed twice (reuses
  the receipts built in slice 12; no new machinery).
- Keep owner review authorization separate from public Shared Plan capability review.

## Approach

Extend existing Workspace Plan surfaces. Route consequential actions through slice 12 and execution startup through
slice 13. A duplicate HTTP delivery may return its bounded prior response; a new request revalidates all canonical
evidence. Pending review conversation remains process-local, so process loss reloads committed history and the owner
asks the Agent to continue.

## Files to Modify

- `src/ui/workspace/server/plan-adapter.js` — canonical Plan reads and Session-activated actions.
- `src/ui/workspace/server/` — review and approval endpoints over the slice 12 Session-activated actions.
- `src/ui/workspace/pages/plans/` and related routes — owner review and approval.
- `src/ui/workspace/components/` and `islands/` — status, warnings, stale-evidence errors, and timeline links.
- `src/ui/workspace/react/` — owner Plannotator annotations where appropriate.
- `src/shared/workflow/` and `src/shared/session/` — UI-safe Session correlation helpers only if needed.
- `docs/design-system.md` — document only reusable new approval patterns.

## Reuse Opportunities

- Existing Plan/Epic and Plannotator components.
- `src/ui/workspace/server/plan-adapter.js` canonical loading.
- `src/shared/workflow/plan-lifecycle.js` canonical transitions.
- Slice 12 Session-activated Plan actions and slice 13 rollover handoff.
- Existing `owner_session_operations` receipts for bounded endpoint deduplication.

## Implementation Steps

- [ ] Owner Plan review routes exist and are linked from the Session timeline (slice 15).
- [ ] The review page renders canonical Plan status/revision, relevant worktree evidence, acting Session, and warnings.
- [ ] Feedback, Approve for Later, and Approve & Run submit through the slice 12 Session-activated shared actions, and
      Approve & Run starts execution through the slice 13 handoff.
- [ ] Each mutating endpoint carries a bounded request ID and duplicate delivery of the same request returns the prior
      response instead of acting twice.
- [ ] A stale-evidence rejection renders the canonical-check error with a refresh action and plain text pointing deeper
      recovery to the TUI; no recovery-action UI exists in this slice.
- [ ] After Approve & Run, the page links to the Session timeline where execution progress is observed.
- [ ] Tests cover duplicate delivery, stale revisions/statuses, changed worktrees, incompatible activation, reconnect,
      and public Shared Plan capability isolation.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: prove each consequential action requires Session Activation and current canonical Plan/worktree evidence.
- Automated: prove duplicate delivery of one request is idempotent while a new request rechecks current evidence.
- Automated: prove public Shared Plan capabilities cannot access owner actions.
- Manual headed browser: review a TUI-created Plan on a phone viewport, send Feedback, Approve & Run, follow the link to
  the Session timeline to observe progress, and confirm synchronized TUI history.

## Edge Cases & Considerations

- Approval is scoped to the acting Session, Plan ID/revision/status, expected segment, and relevant worktree evidence.
- Manual Plan edits must be detected before action execution (slice 12 owns the check; this slice shows the error).
- Browser disconnect does not cancel running work; owner-process loss during a pending review prompt means the owner
  asks the Agent to continue after reload.
- Owner Plan review and Shared Plan review remain separate authorization paths.
- Recovery-action UI and a dedicated progress view are out of scope here; slice 17 owns them.
