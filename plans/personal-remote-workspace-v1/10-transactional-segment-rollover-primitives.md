---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add fenced primitives for creating, sealing, synchronizing, and switching the current transcript segment with safe two-store recovery. These backend APIs provide the exact-once rollover foundation used later by Approve & Run."
affectedPaths:
    - "src/shared/owner-coordination/sessions.js"
    - "src/shared/owner-coordination/session-activations.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/root-session.js"
    - "src/shared/session/workflow-context-session.js"
    - "src/shared/workflow/"
executionAgent: "engineer"
createdAt: "2026-07-26T20:48:25.345Z"
updatedAt: "2026-07-26T20:48:25.345Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 10
dependencies:
    - "09-aggregate-transcript-projection-and-segment-aware-sync"
---

# Transactional Segment Rollover Primitives

## Context

The architecture requires segment rollover at the planning-to-execution handoff and future context boundaries. JSONL
transcript files and SQLite cannot be committed atomically together, so rollover must use a strict ordering: commit
canonical transcript/lineage evidence first, then publish manifest/current pointer and generation state under a fenced
activation transaction, then reconcile transcript-ahead or database-behind crashes conservatively.

## Objective

Implement backend rollover primitives so that:

- an active Session owner can create a successor transcript segment with private lineage metadata;
- the predecessor segment can be sealed with final immutable evidence;
- the new segment becomes current only after the new JSONL and lineage are synchronized;
- manifest/current pointer publication, checkpoint state, and Session generation updates happen in one fenced SQLite
  transaction;
- crash recovery distinguishes no-op retry, removable/recoverable orphan, transcript-ahead/database-behind, and
  uncertain effects;
- no segment-level locks are introduced and Session Activation remains the mutation authority.

## Approach

Add a small, explicit rollover API below `SessionRuntime` that requires the current activation operation capability and
expected current segment proof. Keep this generic: the API creates and activates a new segment but does not decide why
the rollover happens or seed Engineer-specific content. Later workflow slices will call these primitives for Approve &
Run.

## Files to Modify

- `src/shared/owner-coordination/sessions.js` — add transactional successor creation, predecessor sealing, current
  pointer switch, and orphan/reconciliation helpers.
- `src/shared/owner-coordination/session-activations.js` — require matching fence, generation, and current segment for
  rollover publication.
- `src/shared/session/session-runtime.js` — expose internal rollover operations bound to managed activation capability.
- `src/shared/session/hosted-session.js` — dehydrate the old writable manager and install the successor manager only
  through rollover authority.
- `src/shared/session/root-session.js` — create guarded successor transcript files and verify lineage/header/path
  evidence.
- `src/shared/session/workflow-context-session.js` — persist minimal lineage and pending continuation markers where
  applicable.
- `src/shared/workflow/` — add neutral rollover result and recovery evidence types for later workflow use.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- Segment manifest APIs from slice 8 — seal and switch durable segment state.
- Aggregate projection APIs from slice 9 — verify projected generation after rollover.
- `src/shared/owner-coordination/session-activations.js` — reuse fenced activation and heartbeat semantics.
- `src/shared/session/root-session.js` — reuse safe transcript path/header validation.
- `src/shared/session/workflow-context-session.js` — reuse persisted custom entry conventions for private lineage and
  continuation markers.

## Implementation Steps

- [ ] Define rollover operation input/output shapes with expected Session generation, current segment ID, predecessor
      evidence, successor kind, and lineage metadata.
- [ ] Implement successor transcript creation and lineage synchronization before any SQLite current pointer switch.
- [ ] Implement predecessor sealing and exact evidence capture for the final committed prefix.
- [ ] Publish sealed predecessor, successor current pointer, generation update, and pending continuation marker in one
      fenced transaction.
- [ ] Add reconciliation helpers for crash points before successor creation, after successor file creation, after
      lineage sync, after predecessor seal, and after manifest switch.
- [ ] Add tests for wrong-current-segment proof, stale fence, orphan successor, database-ahead detection, duplicate
      rollover attempts, and aggregate projection after rollover.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: crash-point tests should prove safe outcomes for every transition before and after manifest publication.
- Automated: projection tests should prove rollover appears as one stable Session with ordered segment history and no
  duplicate events.
- Automated: activation tests should prove a second surface cannot mutate another segment while rollover is in progress.
- Manual: use a test harness or fixture command to create a successor segment and verify the old segment is sealed, the
  new one is current, and legacy Session identity is preserved.

## Edge Cases & Considerations

- Never publish a manifest/current pointer naming an unsynchronized successor segment.
- Failure before manifest switch leaves the predecessor current; failure after switch leaves a typed
  continuation/recovery state.
- Orphaned successor files are reconciliation candidates, not visible Sessions.
- Segment rollover must not grant permission for another surface to mutate a different segment of the same Session.
