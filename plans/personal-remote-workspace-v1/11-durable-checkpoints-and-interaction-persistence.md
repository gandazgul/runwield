---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Persist typed human gates and structured interactions with segment-aware evidence so decisions survive process loss and are consumed exactly once. This covers generic checkpoint state and interaction plumbing, leaving Plan execution-specific continuation to later slices."
affectedPaths:
    - "src/shared/owner-coordination/schema.js"
    - "src/shared/session/session-runtime-interactions.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/workflow/"
    - "src/ui/workspace/server/"
    - "src/ui/tui/"
executionAgent: "engineer"
createdAt: "2026-07-26T20:48:25.345Z"
updatedAt: "2026-07-26T20:48:25.345Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 11
dependencies:
    - "10-transactional-segment-rollover-primitives"
---

# Durable Checkpoints and Interaction Persistence

## Context

Current structured interactions and many workflow continuations rely on in-memory promises and call stacks. That works
within one process but cannot support phone review, browser disconnect, process restart, or exact-once cross-surface
outcomes. With segment-aware Session identity and rollover primitives in place, checkpoints can bind to the correct
Session generation and current segment evidence.

## Objective

Implement durable checkpoint and interaction persistence so that:

- checkpoint records bind Session, optional Plan, expected Session generation, expected current segment, optional lease
  evidence, pending decision type, outcome, and continuation policy;
- checkpoint states follow Pending, Resolved, Canceled, Uncertain, Resuming, and Consumed transitions;
- resolution and consumption use compare-and-set semantics so duplicate submissions or stale owners cannot apply an
  outcome twice;
- `SessionRuntime` structured interactions can be represented durably while preserving existing semantic events;
- generic continuation policy is conservative and never replays arbitrary interrupted model/tool/command/filesystem
  stacks.

## Approach

Add checkpoint schema and shared coordination APIs below adapters. Integrate the existing interaction request/response
layer with durable records. Keep typed continuation definitions explicit but do not implement Approve & Run execution
behavior here; this slice provides the durable state machine and generic interaction plumbing that Plan workflow slices
consume.

## Files to Modify

- `src/shared/owner-coordination/schema.js` — add checkpoint, checkpoint outcome, interaction request, and state
  transition schema.
- `src/shared/session/session-runtime-interactions.js` — persist structured interaction requests and correlate outcomes
  with semantic events.
- `src/shared/session/session-runtime.js` — add checkpoint publication, resolution, claim, consumption, cancellation,
  and reconciliation APIs.
- `src/shared/session/hosted-session.js` — coordinate active in-memory interactions with durable checkpoint records.
- `src/shared/workflow/` — add durable checkpoint helper modules and typed continuation scaffolding.
- `src/ui/workspace/server/` — expose authenticated query/resolve APIs for pending checkpoints without workflow-specific
  UI assumptions.
- `src/ui/tui/` — surface durable pending/recovered interactions where applicable.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime-interactions.js` — reuse current structured interaction semantics.
- `src/shared/session/session-runtime-events.js` — emit stable semantic interaction/checkpoint events.
- `src/shared/workflow/guided-review.js` and `src/shared/workflow/decisions.js` — reuse structured decision concepts.
- Owner DB transaction and migration utilities — add checkpoint schema consistently with activation and segment tables.
- Segment evidence APIs from slices 8–10 — bind checkpoints to expected current segment identity.

## Implementation Steps

- [ ] Add checkpoint and durable interaction tables, indexes, state constraints, and migration tests.
- [ ] Implement create, resolve, cancel, claim-for-resume, consume, mark-uncertain, and list-pending operations with
      CAS/fencing checks.
- [ ] Integrate `SessionRuntime.requestInteraction` with durable interaction records while preserving existing adapter
      behavior.
- [ ] Add typed continuation policy definitions for generic structured interaction, Plan review, Feedback, Approve for
      Later, Approve & Run, Plan Recovery, and human code review without yet implementing every continuation body.
- [ ] Add reconciliation behavior for resolved-but-not-consumed, resuming-but-lost, duplicate submission, stale
      generation, and wrong-current-segment cases.
- [ ] Add tests for duplicate browser submissions, reconnect retries, stale fencing, process restart, segment mismatch,
      and exact-once consumption.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: tests should prove Pending-to-Resolved-to-Resuming-to-Consumed transitions are fenced and exact-once.
- Automated: crash-point tests should cover checkpoint resolution before consumption and owner loss during Resuming.
- Automated: stale generation or wrong-current-segment evidence must prevent consumption and route to recovery/uncertain
  state.
- Manual: create a pending structured interaction, resolve it through a simulated Workspace call, restart the owning
  process where practical, and verify the outcome is consumed once or remains visibly recoverable.

## Edge Cases & Considerations

- A checkpoint is a typed state transition, not a serialized function.
- Browser disconnect never resolves or cancels a checkpoint by itself.
- Resolution advances checkpoint state, not Session transcript generation.
- Arbitrary interrupted model/tool/command stacks are not transparently replayed.
