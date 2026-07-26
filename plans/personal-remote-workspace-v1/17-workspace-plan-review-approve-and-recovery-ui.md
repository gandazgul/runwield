---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Build the owner Workspace Plan review, Feedback, Approve for Later, Approve & Run, progress, and Plan Recovery browser flows over the durable checkpoint, Plan lease, and execution handoff backend."
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
---

# Workspace Plan Review, Approve, and Recovery UI

## Context

A flagship Personal Workspace journey is: start planning in TUI, review the generated Plan from a phone, send Feedback
or approval, authorize immediate or later execution, observe progress, and return to an automatically synchronized TUI.
The backend now provides durable checkpoints, Plan Workflow Leases, and exact-once execution segment handoff. This slice
builds the owner browser experience on top of those durable services.

## Objective

Build Workspace Plan review and approval flows so that:

- the owner can review a Session-owned Plan from Workspace using existing Plan/Epic and Plannotator foundations;
- Feedback, Approve for Later, and Approve & Run resolve durable checkpoints exactly once;
- approval UI clearly shows Session, Plan status, expected revision, lease owner, approval scope, and recovery warnings;
- execution, validation, repair, completion, and recovery progress are visible and link back to Session timeline;
- Plan Recovery handles changed Plan revision/status, missing worktree, stale lease, uncertain checkpoint, or segment
  integrity problems;
- owner Workspace review remains distinct from public Shared Plan capability review.

## Approach

Extend existing Workspace Plan and Plannotator surfaces rather than rebuilding review UI. Route owner actions through
checkpoint and Plan Workflow Lease services, and rely on the execution handoff backend for Approve & Run semantics.
Build responsive, accessible browser UI with duplicate-submit protection and reconnect-safe progress updates.

## Files to Modify

- `src/ui/workspace/server/plan-adapter.js` — add owner checkpoint/lease-aware Plan reads and actions while preserving
  canonical Plan loading.
- `src/ui/workspace/server/` — add Plan checkpoint, approval, execution authorization, progress, and recovery endpoints.
- `src/ui/workspace/pages/plans/` and related routes — add owner Plan review, approval, recovery, and progress routes.
- `src/ui/workspace/components/` — add Plan status panels, approval scope summaries, checkpoint banners, recovery cards,
  and progress components.
- `src/ui/workspace/islands/` — add Feedback, Approve for Later, Approve & Run, duplicate-submit handling, reconnect
  polling, and recovery interactions.
- `src/ui/workspace/react/` — extend Plannotator integration for owner review annotations where appropriate.
- `src/shared/workflow/` — expose UI-safe status/progress helpers for approval and recovery states.
- `src/shared/session/` — correlate Plan review/progress events with Session timelines and synchronization.
- `docs/design-system.md` — document any reusable approval/recovery UI pattern added to the shared design system.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server/plan-adapter.js` — reuse canonical Plan loading and lifecycle-safe handler patterns.
- Existing Plan/Epic components and Plannotator React surfaces — reuse review and annotation UI.
- `src/shared/workflow/plan-lifecycle.js` — keep canonical status/action semantics.
- Durable checkpoints from slice 11, Plan leases from slice 12, and execution handoff from slice 13 — enforce exact-once
  scoped authorization.
- `src/shared/collaboration/` — reuse visual concepts where helpful, but not public Shared Space capability
  authorization.

## Implementation Steps

- [ ] Add owner Plan review routes linked from Session timeline, Attention Dashboard, and pending checkpoint states.
- [ ] Render Plan content, annotations, current status, expected revision, owning Session, lease state, segment
      evidence, and recovery warnings.
- [ ] Implement Feedback, Approve for Later, and Approve & Run actions through durable checkpoint resolution APIs with
      duplicate-submit protection.
- [ ] Show execution handoff, running, validation, repair, completed, failed, and recovery progress using backend
      status/projection data.
- [ ] Add Plan Recovery UI for changed Plan status/revision, missing worktree, stale lease, uncertain checkpoint, or
      segment integrity states.
- [ ] Preserve Shared Space capability separation in routes, authorization checks, and UI labels.
- [ ] Add tests for duplicate approval clicks, reconnect retries, stale Plan revision, incompatible Session, Shared
      Space separation, progress updates, and recovery paths.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: Workspace tests should prove Feedback, Approve for Later, Approve & Run, and Recovery consume checkpoints
  exactly once and cannot bypass Plan Workflow Leases.
- Automated: tests should prove owner review routes are unavailable through public Shared Plan capability links.
- Manual headed browser: run `deno task workspace:dev`, use a phone-sized viewport to review a TUI-created Plan, send
  Feedback, approve with Approve & Run, observe execution progress, and verify the TUI synchronizes outcome
  automatically.
- Manual security: verify public Shared Plan capability links cannot access owner review actions or inherit
  paired-device authorization.

## Edge Cases & Considerations

- Approve & Run is scoped to one checkpoint, Session, Plan, Plan revision, lease generation, Session generation, and
  planning segment.
- Manual Plan edits must be detected before approval consumption.
- Browser disconnect during execution must not cancel the workflow or duplicate approval.
- Owner Plan review and Shared Plan review are separate authorization paths even if they share UI components.
