---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add Session-owned Plan Workflow Leases around lifecycle, validation, worktree, recovery, and manual Plan actions. Lease policy preserves ownership by the same stable Session across process handoff and segment rollover until terminal outcome or explicit release/recovery."
affectedPaths:
    - "src/shared/owner-coordination/schema.js"
    - "src/shared/workflow/"
    - "src/shared/worktree-registry.js"
    - "src/plan-store.js"
    - "src/cmd/load-plan/"
    - "src/cmd/"
    - "src/ui/workspace/server/"
    - "src/ui/tui/"
executionAgent: "engineer"
createdAt: "2026-07-26T20:48:25.345Z"
updatedAt: "2026-07-26T20:48:25.345Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 12
dependencies:
    - "11-durable-checkpoints-and-interaction-persistence"
---

# Plan Workflow Lease Enforcement

## Context

Session activation prevents concurrent transcript writers, but Plan execution and lifecycle effects also need durable
ownership. `recordPlanEvent()` writes canonical Plan front matter and is called from CLI workflows, validation, and
Workspace handlers. The worktree registry lock serializes registry writes but does not identify which Session is
entitled to drive a Plan.

Personal Workspace needs a Plan Workflow Lease keyed by Project and durable Plan ID, owned by a stable RunWield Session
ID, and fenced by lease generation. Segment rollover and active process changes must not transfer or duplicate Plan
ownership.

## Objective

Implement Plan Workflow Lease enforcement so that:

- Plan workflows acquire, validate, hold, release, transfer, or recover leases through one shared coordinator;
- consequential Plan lifecycle, validation, execution, worktree, recovery, and manual actions enforce compatible lease
  ownership below all adapters;
- the same Session can continue ownership after TUI, Workspace, or ACP handoff and after segment rollover;
- a different Session is rejected until terminal outcome, explicit hold/release, explicit takeover, or Plan Recovery;
- canonical Plan markdown and worktree registry remain sources of truth while checkpoints record expected
  revisions/evidence;
- PROJECT parent Plans and executable child FEATURE Plans use distinct Plan IDs and distinct leases.

## Approach

Add lease state to the owner coordination database and enforce it in shared workflow/lifecycle modules rather than only
Workspace routes. Define policy for acquisition, retention, hold, release, transfer, and recovery against canonical Plan
statuses/events. Wrap consequential uses of Plan lifecycle and worktree operations with lease validation and evidence
recording.

## Files to Modify

- `src/shared/owner-coordination/schema.js` — add Plan Workflow Lease tables, generations, ownership status, and
  indexes.
- `src/shared/workflow/plan-lifecycle.js` — enforce compatible Plan Workflow Lease ownership around `recordPlanEvent()`
  and lifecycle transitions.
- `src/shared/workflow/workflow.js`, `validation.js`, and `workflow-results.js` — carry Session/lease identity through
  execution, validation, repair, merge, and recovery paths.
- `src/shared/worktree-registry.js` — expose worktree evidence and verify lease-compatible consequential registry
  changes.
- `src/plan-store.js` — expose canonical Plan revision/status evidence for expected-state checks.
- `src/cmd/load-plan/` and `src/cmd/` — ensure CLI Plan actions participate in the same lease checks.
- `src/ui/workspace/server/` and `src/ui/tui/` — expose lease status and route incompatible actions to recovery or
  takeover flows.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/plan-lifecycle.js` — keep canonical Plan state machine and add authorization around its use.
- `src/shared/worktree-registry.js` — reuse registry locking and evidence patterns.
- `src/shared/workflow/validation.js` — reuse validation/result flow while adding lease context.
- Durable checkpoint APIs from slice 11 — reuse expected generation and exact-once continuation semantics.
- Segment identity from slices 8–10 — preserve lease ownership across current-segment changes.

## Implementation Steps

- [ ] Add owner DB schema for Plan Workflow Leases keyed by Project ID and durable Plan ID with owner Session ID, lease
      generation, status, timestamps, and recovery metadata.
- [ ] Define and implement policy for acquire, retain, hold, release, transfer, takeover request, and
      recovery-compatible lease operations.
- [ ] Map lease policy to canonical Plan Events/statuses, including Approve for Later, on-hold, terminal
      success/failure, and explicit user-authorized release.
- [ ] Expose canonical Plan revision/status and worktree evidence helpers without moving artifact ownership into SQLite.
- [ ] Enforce lease checks in lifecycle transitions, execution start/finish, validation, merge/recovery, worktree
      registry mutation, CLI actions, and Workspace manual Plan actions.
- [ ] Add tests for same-Session process handoff, segment rollover preservation, different-Session rejection, child Plan
      lease separation, manual edit detection, stale lease generation, validation bypass prevention, and recovery
      routing.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: prove Plan Workflow Lease ownership persists when the same Session moves from TUI to Workspace or ACP and
  across segment rollover.
- Automated: prove a different Session cannot bypass the lease through CLI, Workspace lifecycle handlers, ACP,
  validation, recovery, or worktree registry changes.
- Automated: crash-point tests should cover Plan front matter written before checkpoint publication, registry update
  failures, stale worktree evidence, and explicit recovery.
- Manual: start a Plan workflow in TUI, view compatible actions from Workspace under the same Session, then attempt an
  incompatible action from another Session and verify rejection/recovery guidance.

## Edge Cases & Considerations

- Direct repository edits cannot be prevented; expected Plan revision/status checks must detect them.
- SQLite cannot atomically commit with markdown/worktree files; canonical artifacts must be written before coordination
  publication.
- Non-Git and QUICK_FIX flows without Plan leases require conservative Session recovery when side effects are uncertain.
- Automatic child continuation may acquire the next child lease for the same Session but cannot treat a PROJECT parent
  lease as ambient ownership.
