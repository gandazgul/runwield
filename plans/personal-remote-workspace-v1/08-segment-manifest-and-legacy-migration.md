---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Replace the one-locator Session catalog with an ordered transcript-segment manifest and safe legacy migration/reconstruction semantics. This establishes stable RunWield Session identity across multiple Pi JSONL segments without changing conversation bodies."
affectedPaths:
    - "src/shared/owner-coordination/schema.js"
    - "src/shared/owner-coordination/sessions.js"
    - "src/shared/owner-coordination/session-activations.js"
    - "src/shared/session/root-session.js"
    - "src/shared/session/workflow-context-session.js"
    - "src/shared/session/active-agent-session.js"
    - "src/shared/types.js"
executionAgent: "engineer"
createdAt: "2026-07-26T20:48:25.344Z"
updatedAt: "2026-07-27T19:30:00.000Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 8
dependencies:
    - "07-activation-enforcement-hardening-across-adapters"
---

# Segment Manifest and Legacy Migration

## Context

Personal Remote Workspace v1 now needs one stable RunWield Session to own ordered transcript segments instead of exactly
one Pi Session JSONL. The current owner coordination schema still has `session_transcript_locators` with a unique
locator per RunWield Session, and committed generation evidence is tied to a single transcript. Later checkpoint,
approval, and Workspace timeline work must not build on that one-locator assumption.

This feature introduces the durable segment manifest and migration base while preserving existing cataloged Sessions and
transcript files.

## Objective

Implement segment-aware Session cataloging so that:

- every RunWield Session has an ordered transcript segment manifest;
- existing one-locator Sessions migrate to ordinal-zero segments without rewriting conversation bodies;
- each segment records Pi session identity, transcript path, cwd/root evidence, kind, ordinal, seal/current state, and
  minimal private lineage metadata where available;
- segment kinds can distinguish planning, execution, and semantic repair without changing stable Session identity or
  manifest ordering;
- current segment identity becomes part of durable Session evidence and activation expectations;
- owner database reconstruction can regroup lineage-bearing segments conservatively and mark ambiguous workflows for
  recovery;
- the old one-locator API remains available only as a compatibility view where needed during the rollout.

## Approach

Add owner coordination schema tables for transcript segments and segment manifest/current pointer state. Migrate
existing `session_transcript_locators` rows into a single ordinal-zero segment per RunWield Session and keep
compatibility helpers narrow. Add private lineage helpers that can write or read minimal RunWield segment metadata
through existing custom Session entry patterns without copying transcript content or Planner summaries.

Do not implement aggregate timeline rendering or execution rollover in this slice. This slice is the storage and
migration foundation other slices consume.

## Files to Modify

- `src/shared/owner-coordination/schema.js` — add segment manifest/current pointer schema, migration from one-locator
  rows, indexes, and append/seal constraints.
- `src/shared/owner-coordination/sessions.js` — replace or wrap locator catalog APIs with segment-aware cataloging,
  current-segment lookup, legacy migration, and reconstruction diagnostics.
- `src/shared/owner-coordination/session-activations.js` — include expected current segment identity in activation
  state/evidence shapes without yet changing all projection behavior.
- `src/shared/session/root-session.js` — expose safe locator/header evidence helpers usable for individual segments.
- `src/shared/session/workflow-context-session.js` — reuse custom entry persistence conventions for private segment
  lineage metadata where appropriate.
- `src/shared/session/active-agent-session.js` — reuse persisted custom entry patterns for lineage reads/writes.
- `src/shared/types.js` — add JSDoc typedefs for segment manifest, segment state, lineage evidence, and migration
  diagnostics.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/owner-coordination/database.js` — reuse SQLite migration, transaction, WAL, and backup conventions.
- `src/shared/owner-coordination/sessions.js` — reuse Project root validation, lazy cataloging, and guarded locator
  checks.
- `src/shared/session/root-session.js` — reuse catalog-safe root Session locator parsing and exact path containment
  checks.
- `src/shared/session/workflow-context-session.js` — reuse private custom entry persistence style without exposing
  metadata to Agents as copied conversation.
- `src/shared/owner-coordination/session-activations.js` — preserve Session-scoped activation rather than adding
  segment-level locks.

## Implementation Steps

- [ ] Add segment tables and current pointer fields with constraints for one current writable segment per RunWield
      Session and ordered immutable sealed segments.
- [ ] Define extensible segment-kind validation with initial planning, execution, and semantic-repair kinds; kind is
      context-boundary metadata, not a separate user-visible Session type.
- [ ] Migrate each existing `session_transcript_locators` row into an ordinal-zero initial segment and keep compatible
      read helpers for code not yet converted.
- [ ] Implement APIs to list segments, get current segment, create initial manifest rows, seal a segment, and validate
      segment root/path/header evidence.
- [ ] Add private lineage read/write helpers for new segments and conservative diagnostics for missing, ambiguous,
      cyclic, or orphaned lineage.
- [ ] Include current segment identity in committed Session evidence and activation proof structures while preserving
      existing generation semantics.
- [ ] Add tests for migration, lazy legacy cataloging, path/root validation, duplicate Pi IDs across segments, missing
      files, ambiguous lineage, and database reconstruction diagnostics.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: owner coordination tests should prove one-locator Sessions migrate to ordinal-zero segments without
  transcript body rewrites.
- Automated: reconstruction tests should regroup valid lineage-bearing segments, reject cyclic or ambiguous lineage, and
  mark unprovable workflow associations for recovery.
- Automated: activation evidence tests should reject wrong-current-segment proofs and preserve Session-scoped, not
  segment-scoped, locking.
- Manual: inspect an upgraded owner database for an existing Project and verify existing Sessions still appear with one
  initial segment and unchanged transcript files.

## Edge Cases & Considerations

- Database loss before lineage upgrade may assign a replacement stable Session ID to a lone legacy JSONL; it must not
  invent a multi-segment grouping.
- A newly created but unattached segment is an orphaned reconciliation candidate, not a separate user-visible Session.
- Segment metadata must not copy conversation content or Planner summaries.
- Keep legacy compatibility temporary and narrow so later slices can remove one-locator assumptions deliberately.
