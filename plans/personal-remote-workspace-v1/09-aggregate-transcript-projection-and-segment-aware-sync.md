---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Project sealed and current transcript segments as one non-mutating Session timeline with segment-namespaced event and cursor identities. Extend idle synchronization so TUI, Workspace, and ACP observe segment-aware generations without hydrating a writer."
affectedPaths:
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/session-transcript-projection.test.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-runtime.js"
    - "src/ui/tui/managed-session-sync.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/chat-session.js"
    - "src/ui/tui/blocks.js"
    - "src/acp/server.js"
    - "src/acp/session-map.js"
    - "src/ui/workspace/server/session-continuation.js"
executionAgent: "engineer"
createdAt: "2026-07-26T20:48:25.344Z"
updatedAt: "2026-07-27T19:30:00.000Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 9
dependencies:
    - "08-segment-manifest-and-legacy-migration"
---

# Aggregate Transcript Projection and Segment-Aware Sync

## Context

Slice 8 creates a durable segment manifest, but existing projection code still reads one committed transcript prefix and
emits event IDs derived from file-local Pi entry IDs. Personal Workspace needs TUI, Workspace, and ACP to observe one
stable Session as a continuous ordered timeline while preserving the rule that read synchronization never opens a
writable Pi Session Manager.

## Objective

Implement aggregate, non-mutating transcript projection so that:

- all sealed planning, execution, and semantic repair segments plus the committed prefix of the current segment render
  as one ordered Session timeline;
- event IDs, cursor IDs, image references, and deduplication keys include stable segment identity;
- readers validate the complete manifest and evidence before emitting any part of a generation;
- missing, mutated, truncated, or branch-ambiguous sealed segments fail closed;
- idle TUI and other observers refresh from committed generations across segment changes without `session_replaced`
  behavior;
- compaction, context reporting, and writable hydration continue to target only the current segment.

## Approach

Extend the existing non-mutating projection module from a single transcript prefix reader into an aggregate reader over
the segment manifest. Keep the semantic Runtime event contract intact, but namespace all replay identity at the
projection boundary. Update TUI/ACP/Workspace synchronization adapters to consume aggregate cursors and generation
metadata while preserving local drafts and attachments.

Do not implement segment rollover creation in this slice; consume manifests produced by slice 8 and later slice 10.

## Files to Modify

- `src/shared/session/session-transcript-projection.js` — add aggregate manifest reader, sealed/current evidence
  validation, namespaced cursors, and segment-aware event ID generation.
- `src/shared/session/session-transcript-projection.test.js` — cover multi-segment replay, duplicate Pi entry IDs,
  missing/mutated segments, and cursor continuity.
- `src/shared/session/session-runtime-events.js` — ensure semantic event shapes can carry segment metadata without
  breaking consumers.
- `src/shared/session/session-runtime.js` — expose aggregate committed projection APIs and keep writable/context
  operations current-segment-only.
- `src/ui/tui/managed-session-sync.js` — sync unseen aggregate events across generation and segment changes without
  replacing the Session.
- `src/ui/tui/runtime-adapter.js`, `chat-session.js`, and `blocks.js` — preserve drafts/attachments and deduplicate
  segment-namespaced events.
- `src/acp/server.js` and `src/acp/session-map.js` — map ACP-facing Sessions to stable RunWield IDs and aggregate
  projection, not current Pi segment IDs.
- `src/ui/workspace/server/session-continuation.js` — return aggregate timeline data for Workspace observers without
  hydrating a writer.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-transcript-projection.js` — preserve current semantic replay behavior and exact-prefix
  evidence checks.
- `src/shared/session/session-runtime-events.js` — keep the adapter-neutral event contract.
- `src/ui/tui/managed-session-sync.js` — reuse generation-driven idle synchronization behavior from the verified slice 6
  work.
- `src/ui/tui/runtime-adapter.js` — reuse semantic rendering and replay deduplication concepts.
- Segment manifest APIs from slice 8 — use durable segment state rather than rediscovering files ad hoc.

## Implementation Steps

- [ ] Add aggregate projection inputs and cursor types based on stable RunWield Session ID, segment ID, generation, and
      committed prefix evidence.
- [ ] Validate every sealed segment and current committed prefix before emitting any events for a generation.
- [ ] Namespace event IDs, message IDs where needed, image references, and deduplication keys with segment identity.
- [ ] Update TUI idle synchronization to append aggregate events across rollover without clearing the current Session or
      editor state.
- [ ] Update ACP and Workspace read APIs to expose stable RunWield Session identity and aggregate timeline projection.
- [ ] Add tests for duplicate entry IDs in different segments, sealed segment mutation, cursor resume after rollover,
      partial evidence failure, and draft preservation.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: projection tests should prove complete failure before emission when any sealed segment evidence is invalid.
- Automated: projection tests should cover repeated execution-to-semantic-repair rollovers without exposing repair
  segments as separate Sessions or leaking predecessor messages into current model context.
- Automated: TUI sync tests should prove unseen events append across segment changes without `session_replaced`,
  duplicate replay, or lost drafts/attachments.
- Automated: ACP tests should prove transport-facing IDs do not become current Pi segment IDs.
- Manual: open a Session with seeded multiple segments in Workspace/TUI test fixtures and verify one continuous
  scrollback with stable Session identity.

## Edge Cases & Considerations

- Read-only projection must not call `SessionManager.open()` or any Pi path that may migrate or rewrite a transcript.
- Segment rollover is a manifest update, not a user-visible Session replacement.
- Context estimation and compaction must stay current-segment-only even when owner-visible history spans all segments.
- Failing closed may be temporarily inconvenient, but partial history is more dangerous than visible recovery.
