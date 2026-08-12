---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
summary: "Harden cross-surface Session activation, segment generation and projection, canonical Plan checks, and execution handoff context boundaries."
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
planId: "3ad362d3-ea4c-4cb2-bebe-755e85a6361a"
---

# Cross-Surface Workflow Invariant Hardening

## Context

The backend foundation spans Session Activation, ordered transcript segments, aggregate projection, action-time
canonical Plan checks, and execution/repair handoff. Before larger browser UX builds on it, integration tests must prove
these invariants across TUI, Workspace, ACP, commands, process restart, and rollover crash points.

## Objective

Harden and test only these authority boundaries:

- one activated process mutates a stable Session;
- readers validate committed generation and current-segment evidence before aggregate projection;
- writable hydration uses the committed current segment;
- consequential Plan actions revalidate canonical revision, lifecycle status, and worktree evidence;
- execution and repair handoffs preserve their bounded context rules; and
- diagnostics explain activation, segment integrity, stale canonical evidence, and recovery failures.

## Approach

Build multi-process and crash-point tests around existing boundaries. Add only targeted diagnostics and fixes revealed
by the tests. Preserve sibling adapter direction and avoid new product UI.

## Files to Modify

- `src/shared/owner-coordination/` — activation, generation, segment, and operation-receipt tests and diagnostics.
- `src/shared/session/` — current-segment hydration, aggregate projection, and context-boundary tests.
- `src/shared/workflow/` — canonical Plan/worktree checks and execution-handoff crash tests.
- `src/ui/tui/`, `src/acp/`, and `src/ui/workspace/server/` — cross-surface activation and projection scenarios.
- `src/cmd/` — prove applicable commands use the shared canonical checks.
- `docs/usage.md` — document recovery and unsupported direct-writer behavior if gaps are found.

## Reuse Opportunities

- `src/shared/session/architecture-boundary.test.js`.
- Existing activation, projection, owner DB, Plan Lifecycle, worktree, Workspace, and ACP fixtures.
- `src/ui/tui/system-notifications.js` for actionable recovery language.

## Implementation Steps

- [ ] Build multi-process fixtures for competing mutations and read-only aggregate observation.
- [ ] Test current generation/segment proof, sealed evidence, activation loss, and transcript-ahead reconciliation.
- [ ] Test canonical Plan revision/status and worktree checks through Workspace and command entry points.
- [ ] Test execution and repair rollover interruption plus Planner/Engineer/Reviewer context exclusion.
- [ ] Add sanitized diagnostics for blocked activation, stale protocol, wrong current segment, damaged sealed evidence,
      changed canonical Plan evidence, and rollover recovery.
- [ ] Run and stabilize the full quality gate.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: fail if any adapter mutates a managed Session without Session Activation and current-segment proof.
- Automated: fail if covered Plan actions bypass current canonical status/revision/worktree checks.
- Automated: fail if aggregate projection emits partial unverified generations or handoff leaks predecessor context.
- Manual: open TUI and Workspace on one Session, confirm one writer wins, the observer refreshes, and drafts survive.

## Edge Cases & Considerations

- Heartbeat age alone is not permission to take over uncertain work.
- Unsupported direct Pi writers cannot be fenced retroactively; conflicting evidence blocks mutation.
- Keep diagnostics sanitized and owner-actionable.
- Keep fixes proportional to the tested invariants.
