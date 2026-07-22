---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add owner Workspace Plan review, Feedback, Approve for Later, Approve & Run, and Plan Recovery flows backed by durable checkpoints and Plan Workflow Leases."
affectedPaths:
    - "src/ui/workspace/server/"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/"
    - "src/shared/workflow/"
    - "src/shared/session/"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-22T03:56:51.475Z"
updatedAt: "2026-07-22T03:56:51.475Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 12
dependencies:
    - "11-complete-workspace-session-navigation-and-timeline-ux"
    - "09-plan-workflow-lease-enforcement"
---

# Durable Workspace Plan Review and Approve Run

## Context

A flagship Personal Workspace journey is: start planning in TUI, review the generated Plan from a phone, send Feedback
or approval, authorize immediate or later execution, observe progress, and return to an automatically synchronized TUI.
This requires durable checkpoints and Plan Workflow Leases so browser actions are scoped, exact-once, and recoverable.

## Objective

Build durable owner Workspace Plan flows:

- review a Session-owned Plan from Workspace using existing Plan/Epic and Plannotator foundations;
- submit Feedback through a durable checkpoint;
- choose Approve for Later or Approve & Run with authorization scoped to one Session, Plan, Plan revision, and lease
  generation;
- display execution/review/recovery progress and outcomes;
- support Plan Recovery when expected Plan/worktree evidence has changed or ownership is uncertain;
- keep owner Workspace review distinct from public Shared Plan capability review.

## Approach

Extend existing Workspace Plan and Plannotator surfaces rather than rebuilding review UI. Route owner actions through
checkpoint and Plan Workflow Lease services. Use canonical Plan markdown and lifecycle modules for status and content.
Keep duplicate submissions and browser reconnect idempotent/exact-once at the checkpoint layer.

## Files to Modify

- `src/ui/workspace/server/plan-adapter.js` — add owner checkpoint/lease-aware Plan actions while preserving canonical
  Plan reads.
- `src/ui/workspace/server/` — add Plan checkpoint, approval, execution authorization, and recovery endpoints.
- `src/ui/workspace/pages/plans/` and related routes — add owner Plan review/approval/recovery routes.
- `src/ui/workspace/components/`, `islands/`, and `react/` — extend Plan review, Feedback, approval, recovery, and
  progress components.
- `src/shared/workflow/` — consume durable Plan checkpoint outcomes and dispatch typed continuations.
- `src/shared/session/` — correlate Plan review events with Session timelines and synchronization.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server/plan-adapter.js` — reuse canonical Plan loading and lifecycle-safe handler patterns.
- Existing Plan/Epic components and Plannotator React surfaces — reuse review and annotation UI.
- `src/shared/workflow/plan-lifecycle.js` — keep canonical status/action semantics.
- Durable checkpoint APIs from slice 8 and Plan leases from slice 9 — enforce exact-once scoped authorization.
- `src/shared/collaboration/` — reuse UI concepts where helpful, but not public Shared Space capability authorization.

## Implementation Steps

- [ ] Add owner Plan review routes linked from Session timeline and Attention Dashboard pending checkpoints.
- [ ] Render Plan content, current status, expected revision, owning Session, lease state, and recovery warnings.
- [ ] Implement Feedback, Approve for Later, and Approve & Run actions through durable checkpoint resolution APIs.
- [ ] Implement typed continuation dispatch for approved execution and feedback routing, validating expected Plan
      revision and lease generation before effects.
- [ ] Add progress/status updates that appear in Workspace and synchronize back to idle TUI.
- [ ] Add Plan Recovery UI for changed Plan status/revision, missing worktree, stale lease, or uncertain checkpoint
      states.
- [ ] Add tests for duplicate approval clicks, reconnect retries, stale Plan revision, incompatible Session, Shared
      Space separation, and recovery paths.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: tests should prove Feedback, Approve for Later, Approve & Run, and Recovery consume checkpoints exactly
  once and cannot bypass Plan Workflow Leases.
- Manual headed browser: run `deno task workspace:dev`, use a phone-sized viewport to review a TUI-created Plan, send
  Feedback, approve with Approve & Run, observe execution progress, and verify the TUI synchronizes outcome
  automatically.
- Manual security: verify public Shared Plan capability links cannot access owner review actions or inherit
  paired-device authorization.

## Edge Cases & Considerations

- Approve & Run is not ambient authorization; it is scoped to one checkpoint, Session, Plan, revision, and lease
  generation.
- Manual Plan edits must be detected before consuming an approval.
- Browser disconnect during execution must not cancel the workflow or duplicate approval.
- Owner Plan review and Shared Plan review are separate authorization paths even if they share UI components.
