---
planId: "905d9252-da29-4c44-83c6-0d84cd780ed4"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Replace the one-locator Session catalog with an ordered transcript-segment manifest and safe legacy migration/reconstruction semantics. This establishes stable RunWield Session identity across multiple Pi JSONL segments without changing conversation bodies."
affectedPaths:
    - "src/shared/owner-coordination/schema.js"
    - "src/shared/owner-coordination/database.js"
    - "src/shared/owner-coordination/sessions.js"
    - "src/shared/owner-coordination/session-activations.js"
    - "src/shared/session/root-session.js"
    - "src/shared/session/workflow-context-session.js"
    - "src/shared/session/active-agent-session.js"
    - "src/shared/types.js"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'OWNER_COORDINATION_SCHEMA_VERSION = 6' src/shared/owner-coordination/schema.js && grep -q 'OWNER_COORDINATION_SCHEMA_V6_SQL' src/shared/owner-coordination/database.js && awk '/OWNER_COORDINATION_SCHEMA_V6_SQL/,0' src/shared/owner-coordination/schema.js | grep -q 'CREATE TABLE IF NOT EXISTS session_transcript_segments' && awk '/OWNER_COORDINATION_SCHEMA_V6_SQL/,0' src/shared/owner-coordination/schema.js | grep -q 'UNIQUE(runwield_session_id, ordinal)'"
      rationale: "Red today: the version constant is 5 and no V6 block or segments table exists. The database.js clause matters because schema.js only exports SQL text; a V6 block that is never exec'd by the migration runner leaves every real owner database at version 5. The UNIQUE(runwield_session_id, ordinal) clause pins manifest ordering, so a segments table that cannot actually order segments does not pass."
    - id: "OC2"
      command: "awk '/OWNER_COORDINATION_SCHEMA_V6_SQL/,0' src/shared/owner-coordination/schema.js | grep -q 'INSERT INTO session_transcript_segments' && awk '/OWNER_COORDINATION_SCHEMA_V6_SQL/,0' src/shared/owner-coordination/schema.js | grep -q 'FROM session_transcript_locators'"
      rationale: "Red today: the V6 range is empty. This is the legacy-migration property specifically. OC1 is satisfied by an empty new table, which would strand every existing cataloged Session with no segment at all; requiring the backfill to select FROM session_transcript_locators forces existing one-locator Sessions to actually become ordinal-zero segments."
    - id: "OC3"
      command: "grep -qE '^export (async )?function listSessionTranscriptSegments\\(' src/shared/owner-coordination/sessions.js && grep -qE '^export (async )?function getCurrentSessionSegment\\(' src/shared/owner-coordination/sessions.js && grep -qE '^export (async )?function appendSessionTranscriptSegment\\(' src/shared/owner-coordination/sessions.js && grep -qE '^export (async )?function sealSessionTranscriptSegment\\(' src/shared/owner-coordination/sessions.js"
      rationale: "Red today: sessions.js exports only the five locator-era functions. Pins the segment interface the downstream slices 09 and 10 consume, so the storage change cannot land with no callable API over it. The ^export anchor blocks satisfying this with a local helper or a re-exported alias of findSessionByLocator."
    - id: "OC4"
      command: "test -f src/shared/owner-coordination/session-segments.test.js && grep -q 'openOwnerCoordinationDatabase' src/shared/owner-coordination/session-segments.test.js && grep -q 'session_transcript_locators' src/shared/owner-coordination/session-segments.test.js && grep -q 'appendSessionTranscriptSegment' src/shared/owner-coordination/session-segments.test.js && deno run -A scripts/run-tests.js -A --no-check src/shared/owner-coordination/session-segments.test.js && deno run -A scripts/run-tests.js -A --no-check src/shared/owner-coordination/sessions.test.js"
      rationale: "Red today: the file does not exist, so the guard fails before the runner. Primary behavioral gate. openOwnerCoordinationDatabase forces the test through the real migration runner rather than hand-built rows; session_transcript_locators forces a genuine legacy fixture. The trailing sessions.test.js clause passes today, so one-locator cataloging cannot be regressed while adding segments, nor escaped by deleting that suite."
    - id: "OC5"
      command: "test -f src/shared/owner-coordination/segment-activation-evidence.test.js && grep -q 'publishGenerationAndRelease' src/shared/owner-coordination/segment-activation-evidence.test.js && deno run -A scripts/run-tests.js -A --no-check src/shared/owner-coordination/segment-activation-evidence.test.js && deno run -A scripts/run-tests.js -A --no-check src/shared/owner-coordination/session-activations.test.js"
      rationale: "Red today: the file does not exist. Covers the half of the objective that is not storage — current segment identity becoming part of durable activation evidence. Naming publishGenerationAndRelease forces the wrong-current-segment rejection to be proven at the real commit boundary. The trailing session-activations.test.js clause passes today and holds Session-scoped locking semantics, so segment awareness cannot be bought by weakening activation."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T20:48:25.344Z"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 8
dependencies:
    - "07c-fenced-session-mutation-families"
implementedAt: "2026-08-12T02:10:55.298Z"
verifiedAt: "2026-08-12T02:30:02.286Z"
userVerifiedAt: null
executionReport: "- Implemented owner coordination schema v6: added durable transcript segment manifest/state tables, migrated legacy `session_transcript_locators` rows into ordinal-0 planning segments, and wired V6 into `runOwnerCoordinationMigrations`.\n- Added segment catalog APIs in `sessions.js`: ordered listing, current-segment lookup, guarded append, sealing, and typed lineage diagnostics; append validates transcript paths through existing root-session containment/header checks.\n- Added segment identity to activation evidence/proofs and committed generations; `publishGenerationAndRelease` now rejects wrong-current-segment proofs while preserving Session-scoped activation locking.\n- Added private segment lineage custom-entry helpers and shared JSDoc typedefs for segment manifest/state/lineage diagnostics.\n- Added automated coverage: 2 new test files (`session-segments.test.js`, `segment-activation-evidence.test.js`); no tests were deleted or replaced.\n- Verification passed: objective-check commands passed; `deno task ci` passed (`271 files passed | 0 failed`)."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "5833944d397f2a9a893b2a113d27073ff7d4182f"
    targetBranch: "main"
    targetHeadBeforeMerge: "92d9e138b3f97f278b1e83d3351c49ee6005e122"
validationCiAttempts: 0
validationSemanticRounds: 2
updatedAt: "2026-08-13T03:07:31.394Z"
archivedAt: "2026-08-13T03:07:31.394Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/08-segment-manifest-and-legacy-migration.md"
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
  rows, indexes, and append/seal constraints. Bump `OWNER_COORDINATION_SCHEMA_VERSION` from `5` to `6` and add
  `OWNER_COORDINATION_SCHEMA_V6_SQL` beside the existing V1–V5 blocks.
- `src/shared/owner-coordination/database.js` — import and apply `OWNER_COORDINATION_SCHEMA_V6_SQL` in
  `runOwnerCoordinationMigrations`. The schema module only exports SQL text; a V6 block that is never `exec`ed here
  leaves every existing owner database at version 5.
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

- [ ] `src/shared/owner-coordination/schema.js` exports `OWNER_COORDINATION_SCHEMA_VERSION` equal to `6` and
      `OWNER_COORDINATION_SCHEMA_V6_SQL`, which creates `session_transcript_segments` with columns for
      `runwield_session_id`, `project_id`, `pi_session_id`, `transcript_path`, `transcript_cwd`, `ordinal`, `kind`,
      `sealed_at`, and header evidence. `runwield_session_id` is NOT unique on this table; a partial unique index
      enforces at most one unsealed segment per RunWield Session, and `UNIQUE(runwield_session_id, ordinal)` enforces
      manifest ordering.
- [ ] `runOwnerCoordinationMigrations` in `src/shared/owner-coordination/database.js` execs
      `OWNER_COORDINATION_SCHEMA_V6_SQL` and records version `6`, so opening a version-5 database upgrades it in place.
- [ ] The V6 migration inserts exactly one `ordinal = 0` segment per existing `session_transcript_locators` row,
      carrying that row's `pi_session_id`, `transcript_path`, `transcript_cwd`, and header evidence forward. No
      transcript file on disk is opened, rewritten, or moved by the migration.
- [ ] `kind` accepts `planning`, `execution`, and `semantic_repair` and rejects unknown values via a CHECK constraint.
      Kind is context-boundary metadata: no code branches on it to produce a different user-visible Session type.
- [ ] `src/shared/owner-coordination/sessions.js` exports `listSessionTranscriptSegments`, `getCurrentSessionSegment`,
      `appendSessionTranscriptSegment`, and `sealSessionTranscriptSegment`. `listSessionTranscriptSegments` returns
      segments in ascending `ordinal` order, and `getCurrentSessionSegment` returns the single unsealed segment or
      `null`. None of these is an alias or pass-through over `findSessionByLocator`.
- [ ] `appendSessionTranscriptSegment` validates the new segment's transcript path against the Project root using the
      existing containment checks in `src/shared/session/root-session.js`, and rejects a path outside that root.
- [ ] Private lineage read/write helpers persist minimal segment lineage through the existing custom-entry conventions,
      and a diagnostics function classifies missing, ambiguous, cyclic, and orphaned lineage into distinct typed results
      rather than one generic failure.
- [ ] Committed Session evidence and activation proof structures in
      `src/shared/owner-coordination/session-activations.js` carry the expected current segment identity.
      `publishGenerationAndRelease` rejects a proof whose current segment does not match stored state, and activation
      locking stays Session-scoped — no segment-level lock is introduced.
- [ ] `src/shared/owner-coordination/session-segments.test.js` drives a real version-5 database through
      `openOwnerCoordinationDatabase` and asserts the ordinal-zero migration, multi-segment append and seal ordering,
      duplicate Pi IDs across segments, missing transcript files, and reconstruction diagnostics.
- [ ] `src/shared/owner-coordination/segment-activation-evidence.test.js` asserts that a wrong-current-segment proof is
      rejected by `publishGenerationAndRelease` and that Session-scoped activation semantics still hold.
- [ ] `src/shared/types.js` defines typedefs for the segment manifest, segment state, lineage evidence, and migration
      diagnostics, and the new `sessions.js` exports reference them in their `@param`/`@returns` blocks.

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

### Existing coverage this slice reshapes

`src/shared/owner-coordination/sessions.test.js` and `session-activations.test.js` encode today's one-locator
assumption. That assumption becomes a compatibility surface in this slice, not dead code.

- **Must still pass unchanged:** every existing assertion about locator cataloging, Project root validation, lazy
  cataloging, duplicate-locator rejection, and Session-scoped activation. A Session with exactly one segment must behave
  through the locator APIs exactly as it does today. If one of these tests fails, the compatibility view is wrong —
  repair the code, do not relax the test.
- **Expected to change:** only assertions that treat "one locator per Session" as an invariant of the _data model_
  rather than of the compatibility API. Those become assertions that a Session has exactly one segment at ordinal 0
  until a later slice appends a second.
- **Nothing here is expected to stop existing.** No test in this slice should be deleted. A test that no longer compiles
  must be rewritten against the segment-aware shape, because deleting it silently removes the proof that legacy Sessions
  survived migration.

## Edge Cases & Considerations

- Database loss before lineage upgrade may assign a replacement stable Session ID to a lone legacy JSONL; it must not
  invent a multi-segment grouping.
- A newly created but unattached segment is an orphaned reconciliation candidate, not a separate user-visible Session.
- Segment metadata must not copy conversation content or Planner summaries.
- Keep legacy compatibility temporary and narrow so later slices can remove one-locator assumptions deliberately.
