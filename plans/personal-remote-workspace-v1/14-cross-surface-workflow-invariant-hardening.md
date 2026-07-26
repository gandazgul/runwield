---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add integration tests, diagnostics, and recovery checks that prove the segment, checkpoint, activation, and Plan lease invariants before larger Workspace UX builds on them. This is an executable hardening checkpoint rather than a review-only slice."
affectedPaths:
    - "src/shared/owner-coordination/"
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "src/ui/tui/"
    - "src/acp/"
    - "src/ui/workspace/server/"
    - "src/cmd/"
    - "docs/usage.md"
executionAgent: "engineer"
createdAt: "2026-07-26T20:48:25.378Z"
updatedAt: "2026-07-26T20:48:25.378Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 14
dependencies:
    - "13-execution-segment-handoff-backend"
---

# Cross-Surface Workflow Invariant Hardening

## Context

The backend foundation now spans owner coordination, segmented transcript projection, activation leases, durable
checkpoints, Plan Workflow Leases, and execution handoff. Before investing in the larger browser UX, Personal Workspace
needs an executable confidence checkpoint that proves the architecture holds across TUI, Workspace, ACP, CLI commands,
process restart, and crash-point recovery.

This is not a review-only task. It adds tests, diagnostics, and targeted hardening changes that make the invariants
observable and enforceable.

## Objective

Harden and verify cross-surface workflow invariants so that:

- only one process can hydrate or mutate a stable Session at a time;
- observers can read aggregate committed timelines without writable hydration;
- Session generation, current segment, checkpoint, and Plan lease evidence are validated consistently;
- Plan approval and execution segment handoff never leak Planner context into Engineer context;
- stale fences, wrong segments, duplicate checkpoint submissions, and competing Plan actions fail closed;
- diagnostics explain blocked, uncertain, reconcile-required, and recovery states without exposing sensitive internals;
- existing TUI, ACP, Workspace, QUICK_FIX, non-Git, Shared Plan, Plan Lifecycle, validation, and worktree behavior
  remains compatible where it does not violate the new invariants.

## Approach

Build multi-process and crash-point integration tests around the critical seams. Add small diagnostics and repair
affordances where failures are currently opaque. Use the existing architecture-boundary tests to keep adapter dependency
direction intact. Do not introduce new product UI beyond minimal status surfaces needed to understand recovery states.

## Files to Modify

- `src/shared/owner-coordination/` — add invariant tests and diagnostics for schema, activation, segments, checkpoints,
  and leases.
- `src/shared/session/` — add projection, hydration, current-segment, context-boundary, and recovery tests.
- `src/shared/workflow/` — add Plan lease, execution handoff, validation, and crash-point tests.
- `src/ui/tui/` — verify idle sync, draft preservation, blocked ownership states, and recovery messages.
- `src/acp/` — verify stable RunWield Session identity, aggregate loading, and activation rejection/continuation.
- `src/ui/workspace/server/` — verify checkpoint resolution APIs, Session control checks, and Shared Space separation at
  the server boundary.
- `src/cmd/` — verify standalone commands cannot bypass activation or Plan leases.
- `docs/usage.md` — document upgraded protocol refusal, recovery guidance, and private-network operational cautions if
  gaps are found.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/architecture-boundary.test.js` — extend adapter dependency boundary coverage.
- Existing activation, projection, owner DB, Workspace, ACP, Plan Lifecycle, and worktree tests — convert key cases into
  cross-surface scenarios.
- `src/ui/tui/system-notifications.js` — reuse status/attention language for blocked and recovery states.
- Durable checkpoint and lease diagnostics from earlier slices — surface consistent recovery reasons.

## Implementation Steps

- [ ] Build multi-process test fixtures for competing TUI/Workspace/ACP mutation attempts and read-only observation.
- [ ] Add crash-point tests covering transcript-ahead/database-behind, database-ahead detection, checkpoint resolution
      before consumption, lease generation mismatch, and execution handoff interruption.
- [ ] Add context-boundary tests proving Engineer receives approved execution seed only and aggregate owner timeline
      still includes planning history.
- [ ] Add bypass tests for CLI commands, Workspace handlers, ACP loading, validation, worktree registry mutation,
      cancellation, compaction, settings/model changes, images, and local shell execution.
- [ ] Add diagnostics for blocked activation, uncertain effects, stale protocol, wrong-current-segment proof,
      sealed-segment integrity failure, and Plan lease conflict.
- [ ] Update documentation for any manual recovery states and unsupported mixed-version/direct-Pi writer cases.
- [ ] Run and stabilize the full quality gate.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: new integration tests should fail if any adapter can mutate a managed Session without Session Activation
  and correct current-segment proof.
- Automated: tests should fail if any Plan lifecycle/worktree/validation path can bypass Plan Workflow Lease ownership.
- Automated: tests should fail if Approve & Run can create duplicate execution segments, duplicate Engineer starts, or
  Planner-context leakage.
- Manual: perform a small cross-surface smoke test with TUI and Workspace open to the same Session, confirming one
  writer wins, the loser refreshes, and drafts survive.

## Edge Cases & Considerations

- Heartbeat age is evidence, not permission to replay uncertain effects.
- Older/direct Pi writers cannot be fenced retroactively; detected conflicting evidence must block mutation and route to
  recovery.
- Keep diagnostics sanitized and actionable for a local owner.
- This slice may reveal small fixes in previous modules; keep fixes targeted to invariant enforcement rather than
  expanding product scope.
