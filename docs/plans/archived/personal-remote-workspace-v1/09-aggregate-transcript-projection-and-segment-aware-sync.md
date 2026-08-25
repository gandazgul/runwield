---
planId: "fa961cdd-f6c6-42ed-bdd8-bdb6322e1f72"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Project sealed and current transcript segments as one non-mutating Session timeline with segment-namespaced event and cursor identities. Record sealed-segment evidence so a mutated or truncated segment fails closed, and extend idle synchronization so TUI, Workspace, and ACP observe segment-aware generations without hydrating a writer."
affectedPaths:
    - "src/shared/owner-coordination/schema.js"
    - "src/shared/owner-coordination/database.js"
    - "src/shared/owner-coordination/sessions.js"
    - "src/shared/owner-coordination/index.js"
    - "src/shared/types.js"
    - "src/shared/session/session-transcript-manifest.ts"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/hosted-session.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/acp/server.js"
    - "src/acp/session-map.js"
    - "src/ui/workspace/server/session-continuation.js"
    - "docs/domain-language.md"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'OWNER_COORDINATION_SCHEMA_VERSION = 7' src/shared/owner-coordination/schema.js && grep -q 'OWNER_COORDINATION_SCHEMA_V7_SQL' src/shared/owner-coordination/database.js && awk '/OWNER_COORDINATION_SCHEMA_V7_SQL/,0' src/shared/owner-coordination/schema.js | grep -q 'sealed_byte_length' && awk '/OWNER_COORDINATION_SCHEMA_V7_SQL/,0' src/shared/owner-coordination/schema.js | grep -q 'sealed_digest_hex' && awk '/OWNER_COORDINATION_SCHEMA_V7_SQL/,0' src/shared/owner-coordination/schema.js | grep -q 'UPDATE session_committed_generations'"
      rationale: "Red today: the version constant is 6 and no V7 block exists. The database.js clause matters because schema.js only exports SQL text; a V7 block never exec'd by the migration runner leaves every real owner database at version 6. The digest column pins tamper evidence rather than a bookkeeping-only column, and the UPDATE clause pins the legacy generation backfill, without which every pre-slice-8 Session goes degraded."
    - id: "OC2"
      command: "test -f src/shared/owner-coordination/session-segment-evidence.test.js && grep -q 'openOwnerCoordinationDatabase' src/shared/owner-coordination/session-segment-evidence.test.js && grep -q 'sealSessionTranscriptSegment' src/shared/owner-coordination/session-segment-evidence.test.js && deno run -A scripts/run-tests.js -A --no-check src/shared/owner-coordination/session-segment-evidence.test.js && deno run -A scripts/run-tests.js -A --no-check src/shared/owner-coordination/session-segments.test.js"
      rationale: "Red today: the file does not exist, so the guard fails before the runner. OC1 is satisfied by empty columns nothing ever writes; this forces seal-time capture to actually happen. openOwnerCoordinationDatabase forces the test through the real migration runner rather than hand-built rows. The trailing session-segments.test.js clause passes today, so slice 8's manifest behavior cannot be regressed to buy evidence capture, nor escaped by deleting that suite."
    - id: "OC3"
      command: "test -f src/shared/session/session-transcript-manifest.ts && grep -qE '^export (async )?function projectAggregateTranscript\\(' src/shared/session/session-transcript-manifest.ts && test -f src/shared/session/session-transcript-manifest.test.js && grep -q 'listSessionTranscriptSegments' src/shared/session/session-transcript-manifest.test.js && deno run -A scripts/run-tests.js -A --no-check src/shared/session/session-transcript-manifest.test.js && deno run -A scripts/run-tests.js -A --no-check src/shared/session/session-transcript-projection.test.js"
      rationale: "Red today: neither file exists. The ^export anchor blocks satisfying this with a local helper or a re-exported alias of projectCommittedTranscript. Naming listSessionTranscriptSegments forces the test through the real manifest rather than a hand-passed file list, so a single-segment pass-through cannot pass. The trailing projection suite passes today and holds single-segment and digest-mismatch behavior, so aggregation cannot be bought by weakening the existing reader."
    - id: "OC4"
      command: "test -f src/ui/tui/segment-aware-sync.test.js && grep -q 'projectAggregateTranscript' src/ui/tui/segment-aware-sync.test.js && grep -q 'session_replaced' src/ui/tui/segment-aware-sync.test.js && grep -q 'session-transcript-manifest' src/shared/session/session-runtime.js && deno run -A scripts/run-tests.js -A --no-check src/ui/tui/segment-aware-sync.test.js && deno run -A scripts/run-tests.js -A --no-check src/ui/tui/runtime-adapter.test.js"
      rationale: "Red today: the file does not exist and session-runtime.js imports no manifest module. Covers the half of the objective that is not storage. The session-runtime.js clause stops the manifest module landing green while the runtime still reads one file, which OC3 alone permits. Naming session_replaced forces the no-replacement property to be asserted. The trailing runtime-adapter.test.js clause passes today and holds eventId deduplication."
    - id: "OC5"
      command: "test -f src/acp/segment-stable-identity.test.js && grep -q 'piSessionId' src/acp/segment-stable-identity.test.js && grep -q 'runwieldSessionId' src/acp/segment-stable-identity.test.js && deno run -A scripts/run-tests.js -A --no-check src/acp/segment-stable-identity.test.js && deno run -A scripts/run-tests.js -A --no-check src/acp/session-map.test.js"
      rationale: "Red today: the file does not exist. Covers the transport-identity property, which no other check reaches. Naming both piSessionId and runwieldSessionId forces the test to actually distinguish the two rather than asserting an id is merely non-empty. The trailing session-map.test.js clause passes today, so stable identity cannot be bought by regressing existing ACP session mapping."
    - id: "OC6"
      command: "grep -q 'Sealed Session Transcript Segment' docs/domain-language.md && grep -q 'Aggregate Transcript Projection' docs/domain-language.md"
      rationale: "Red today: neither term appears in the glossary. This is the weakest check in the set - a text match cannot prove the definitions are good - but the glossary step is part of the objective and the surrounding behavioral checks carry the real proof. It exists so the documentation step cannot be silently dropped."
    - id: "OC7"
      command: "test -f src/shared/session/session-transcript-manifest.test.js && grep -q 'Deno.utime' src/shared/session/session-transcript-manifest.test.js && deno run -A scripts/run-tests.js -A --no-check src/shared/session/session-transcript-manifest.test.js"
      rationale: "Red today: the file does not exist. Pins the no-re-hash steady state, which OC3 permits an implementation to ignore by hashing every sealed segment on every poll. Deno.utime is the only way to write the caching assertion without a seam: rewrite a verified segment's bytes at identical length, restore its mtime, and project again. An implementation that re-hashes each read fails closed there, so the grep cannot be satisfied by a token mention that never runs."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T20:48:25.344Z"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 9
dependencies:
    - "08-segment-manifest-and-legacy-migration"
implementedAt: "2026-08-12T04:11:14.914Z"
verifiedAt: "2026-08-12T13:34:01.491Z"
userVerifiedAt: null
executionReport: "- Implemented schema v7 migration, sealed-segment evidence columns, migration execution, and legacy generation `current_segment_id` backfill.\n- Updated `sealSessionTranscriptSegment` to require supplied evidence, verify it against disk inside the transaction, and store sealed byte length/digest/terminal entry without leaving mismatched seals behind.\n- Added aggregate manifest projection with ordered manifest validation, sealed/current evidence verification, segment-namespaced replay IDs, cursor replay-from-start recovery, and per-process sealed digest caching keyed by segment/size/mtime.\n- Routed managed Session read/sync through `projectAggregateTranscript`; exposed segment APIs on `openOwnerCoordinationStore`; preserved current-segment-only writable/context behavior.\n- Added coverage for seal evidence, multi-segment projection, duplicate Pi entry IDs, missing/truncated/extended/byte-modified sealed segments, cursor resume/recovery, hash-once cache behavior via `Deno.utime`, TUI no-`session_replaced` dedupe, and ACP stable RunWield identity.\n- Updated `docs/domain-language.md` with Sealed Session Transcript Segment and Aggregate Transcript Projection terminology.\n- Verification passed: `deno task ci`; targeted plan suites also passed (`session-transcript-manifest`, `session-segment-evidence`, TUI segment/runtime-adapter, ACP segment/session-map).\n- Test count delta: added 4 test files; no tests removed or replaced."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "633ee235cbe9fcfb3723d74c9c2a0b6149c6d43c"
    targetBranch: "main"
    targetHeadBeforeMerge: "4c175965b4197bab194f9b8e707d5223faa8fb6f"
validationCiAttempts: 0
validationSemanticRounds: 1
updatedAt: "2026-08-24T21:23:47.295Z"
archivedAt: "2026-08-24T21:23:47.295Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/09-aggregate-transcript-projection-and-segment-aware-sync.md"
---

# Aggregate Transcript Projection and Segment-Aware Sync

## Context

Slice 8 landed a durable segment manifest — `session_transcript_segments`, a current-segment pointer, and
`session_committed_generations.current_segment_id`. Every pre-existing Session was migrated to exactly one segment at
ordinal 0. Nothing above that storage layer consumes it yet, and four gaps block a continuous Session timeline:

1. `projectCommittedTranscript` (`session-transcript-projection.js:440`) takes a single `sessionPath` and a single
   digest. It has no concept of a manifest.
2. Event identity is file-local. `makeEventId` (`:60`) builds `entryId:kind:blockIndex` from the Pi entry ID, which is
   unique only within one JSONL file. The TUI deduplicates by `eventId` in a `Set` (`runtime-adapter.js:116-125`), so
   two segments carrying the same Pi entry ID silently drop the second segment's event.
3. Slice 8's four segment functions live in `sessions.js` but were never added to the `openOwnerCoordinationStore`
   facade in `index.js`, which is what `session-runtime.js` and the Workspace continuation server actually call.
4. **No tamper evidence exists for a sealed segment.** The table records the transcript path and seal time, not byte
   length or digest.

Gap 4 matters because verification is not new here. `session_committed_generations` already stores `byte_length`,
`terminal_entry_id`, and `digest_hex`, and `projectCommittedTranscript` throws on any mismatch (`:451-456`). Every read
of a Session today is digest-checked. Once a Session spans several files, leaving sealed segments unverified produces an
asymmetric guarantee — the newest file is tamper-evident and everything before it is not — and no reader can tell which
part of the scrollback carries the guarantee.

The threat model is not an attacker. It is Pi rewriting a transcript (the reason `readCatalogSafeRootSessionLocator` and
the never-open-a-writable-manager rule exist), a crash mid-write leaving a partial trailing line, concurrent surfaces,
and hand edits.

## Objective

Implement aggregate, non-mutating transcript projection so that:

- all sealed planning, execution, and semantic repair segments plus the committed prefix of the current segment render
  as one ordered Session timeline;
- sealing a segment captures its final byte length, SHA-256 digest, and terminal entry ID, and readers verify every
  sealed segment against that record;
- event IDs, cursor IDs, image references, and deduplication keys include stable segment identity;
- readers validate the complete manifest and evidence before emitting any part of a generation, and a missing, mutated,
  truncated, or lineage-ambiguous sealed segment fails closed;
- an unresolvable client cursor over a fully verified generation is recovered by full replay rather than failing closed,
  because verified evidence means the history is trustworthy and only the client's position is unknown;
- idle TUI and other observers refresh from committed generations across segment changes without `session_replaced`
  behavior;
- compaction, context reporting, and writable hydration continue to target only the current segment.

## Approach

Add a new module, `src/shared/session/session-transcript-manifest.ts`, that owns manifest-level reading: resolve the
ordered segment list, verify each segment's evidence, concatenate the replay, and namespace identity. Leave
`session-transcript-projection.js` owning file-level primitives — replay construction, prefix reading, digest capture,
cursor selection — which the new module reuses. That seam keeps the 715-line projection module from absorbing a second
responsibility, and puts the new code in TypeScript as `language-policy:check` requires for new production source.

Record sealed evidence at seal time rather than deriving it at read time. Slice 10's plan already lists "predecessor
sealing and exact evidence capture" as its own step; moving the capture here does not add work to the epic, it puts the
capture where this slice's tests can exercise it instead of shipping a slice whose headline guarantee has nothing to
test against.

Verify in two tiers, because verification re-reads and re-hashes from byte 0 and aggregation would otherwise make every
generation advance cost O(entire history):

- **stat always** — one `stat` per sealed segment, O(1), comparing byte length against the sealed record. This catches
  truncation and append, the realistic failure modes;
- **full digest at most once per process per segment**, cached on `(segmentId, size, mtime)` and re-hashed only when
  `stat` disagrees with the cache. Sealed segments are immutable by construction — SQLite triggers reject update and
  delete on them (`schema.js:385-397`) — so caching a verification result is sound rather than optimistic.

The steady state is the constraint that matters. An idle TUI polls the same generation repeatedly; a Session may hold
many megabytes of sealed history. Re-hashing that on every poll would make an idle surface the most expensive thing in
the process, so the steady-state read path must perform **zero digest reads** — `stat` only. Content hashing is a
first-touch integrity check here, not a change-detection mechanism: change is detected by the committed generation
counter, which already exists. Do not build content-addressed history.

The deliberate consequence: within one process, after a sealed segment has verified once, an in-place byte edit that
preserves both size and mtime is not detected. That is accepted, not overlooked. The threat model is Pi rewriting a
file, a crash leaving a partial line, or a hand edit — all of which move size or mtime — and the SQLite immutability
triggers are the primary guard. A same-size same-mtime forgery is an attacker, and an attacker with write access to the
transcript directory also has write access to the owner database that holds the digests.

Do not implement segment rollover creation in this slice; consume manifests produced by slice 8 and later slice 10.

## Files to Modify

- `src/shared/owner-coordination/schema.js` — schema v7: `sealed_byte_length`, `sealed_digest_hex`, and
  `sealed_terminal_entry_id` on `session_transcript_segments`, plus a backfill setting each NULL
  `session_committed_generations.current_segment_id` to its Session's only segment.
- `src/shared/owner-coordination/database.js` — execute the v7 block from `runOwnerCoordinationMigrations`, alongside
  the existing V5/V6 clauses.
- `src/shared/owner-coordination/sessions.js` — `sealSessionTranscriptSegment` captures and stores final evidence;
  reject a seal whose evidence is absent or does not match the file on disk.
- `src/shared/owner-coordination/index.js` — expose the segment manifest functions on the store facade so
  `session-runtime.js` and the Workspace server can reach them.
- `src/shared/types.js` — extend `SessionTranscriptSegment` with the sealed evidence fields.
- `src/shared/session/session-transcript-manifest.ts` — new module owning aggregate reading: ordered segment resolution,
  tiered evidence verification, segment-namespaced replay, and aggregate cursor selection.
- `src/shared/session/session-transcript-projection.js` — accept a segment scope in `createReplayEvents` so event IDs
  carry segment identity; keep every existing file-level primitive exported for the manifest module to reuse.
- `src/shared/session/session-runtime.js` — `synchronizeManagedSession` and the managed read path project through the
  manifest module; compaction, context reporting, and writable hydration stay current-segment-only.
- `src/shared/session/hosted-session.js` — `ManagedSessionMetadata` carries the segment-aware cursor.
- `src/ui/tui/runtime-adapter.js` — deduplicate on segment-namespaced event IDs and preserve drafts and attachments
  across a segment change.
- `src/acp/server.js` and `src/acp/session-map.js` — ACP-facing IDs stay bound to the stable RunWield Session, never to
  the current Pi segment.
- `src/ui/workspace/server/session-continuation.js` — read aggregate timeline data without hydrating a writer.
- `docs/domain-language.md` — define the terms this slice makes true.

`managed-session-sync.js`, `chat-session.js`, and `blocks.js` were listed in the previous draft but need no change: the
poll controller only calls `synchronizeManagedSession`, and neither TUI file touches `eventId`.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-transcript-projection.js` — reuse `captureTranscriptEvidence`, `sha256Hex`,
  `createReplayEvents`, `selectProjectedEventsAfterCursor`, `summarizeProjectedEntries`, and `toProjectionFailure`
  rather than reimplementing them at manifest level.
- `src/shared/owner-coordination/sessions.js` — reuse `listSessionTranscriptSegments`, `getCurrentSessionSegment`, and
  `validateGuardedLocator`'s path/header containment checks.
- `src/shared/session/root-session.js` — reuse `isPathInside` and `readCatalogSafeRootSessionLocator` for every segment,
  not just the current one.
- `src/ui/tui/managed-session-sync.js` — the generation-driven idle loop and its short-circuit on an unchanged
  generation (`session-runtime.js:2419`) stay as they are.
- `src/shared/owner-coordination/session-segments.test.js` — reuse its real-migration fixture pattern.

## Implementation Steps

- [ ] `src/shared/owner-coordination/schema.js` exports `OWNER_COORDINATION_SCHEMA_V7_SQL` adding `sealed_byte_length`,
      `sealed_digest_hex`, and `sealed_terminal_entry_id` to `session_transcript_segments`, and backfilling every NULL
      `session_committed_generations.current_segment_id` from the Session's single segment;
      `OWNER_COORDINATION_SCHEMA_VERSION` is `7` and `runOwnerCoordinationMigrations` executes the block.
- [ ] `sealSessionTranscriptSegment` requires final evidence, verifies it against the file on disk inside the same
      transaction, and stores it; a seal with absent or mismatched evidence throws and leaves the segment unsealed.
- [ ] `src/shared/session/session-transcript-manifest.ts` exports `projectAggregateTranscript`, which returns the same
      result shape as `projectCommittedTranscript` plus per-segment metadata, and emits no event for a generation until
      every sealed segment and the current committed prefix have verified.
- [ ] A sealed segment whose file is missing, truncated, extended, or byte-modified causes `projectAggregateTranscript`
      to return a typed failure and zero events, for both a client with no cursor and a client mid-timeline.
- [ ] Every projected `eventId` begins with its segment ID, so two segments holding identical Pi entry IDs produce
      distinct IDs and `runtime-adapter.js` deduplication drops neither.
- [ ] Verification reads each sealed segment's full bytes at most once per process per `(segmentId, size, mtime)`; a
      repeat projection of an unchanged manifest re-`stat`s but does not re-hash. Proven without a seam: project once,
      then overwrite the sealed file's bytes in place preserving its exact length and restore its original mtime with
      `Deno.utime`, then project again — the second projection succeeds from cache. An implementation that re-hashes on
      every read fails this test closed, which is the failure this step exists to catch.
- [ ] A cursor absent from a fully verified generation returns a typed replay-from-start result rather than a
      `ProjectionContinuityError`; a cursor over a generation that failed verification still fails closed.
- [ ] `session-runtime.js` routes `synchronizeManagedSession` and the managed read path through
      `projectAggregateTranscript`; `buildSessionContextReport` and compaction still read only the current segment.
- [ ] `openOwnerCoordinationStore` exposes `listSessionTranscriptSegments`, `getCurrentSessionSegment`,
      `appendSessionTranscriptSegment`, and `sealSessionTranscriptSegment`.
- [ ] ACP session IDs and Workspace continuation responses resolve from the stable RunWield Session ID across a segment
      change, and no `session_replaced` event is emitted for one.
- [ ] `docs/domain-language.md` defines **Sealed Session Transcript Segment** and **Aggregate Transcript Projection**
      with _Avoid_ aliases, and states the relationship that an Aggregate Transcript Projection emits no part of a
      generation until every segment has verified.

## Verification Plan

- Automated: `deno task ci`.
- Automated: `deno run -A scripts/run-tests.js -A --no-check src/shared/session/session-transcript-manifest.test.js`
  covers multi-segment replay ordering, duplicate Pi entry IDs across segments, missing/truncated/byte-modified sealed
  segments, cursor resume across a segment boundary, and the hash-once caching property. The byte-modified case and the
  caching case are not in tension and must both be asserted: a byte modification found on a segment's **first** read in
  a process fails closed, and one made **after** that segment already verified in the same process is served from cache
  when size and mtime are unchanged.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check
  src/shared/owner-coordination/session-segment-evidence.test.js`
  covers seal-time capture against a real migrated database and rejection of a seal whose evidence does not match disk.
- Automated: TUI sync tests prove unseen events append across a segment change without `session_replaced`, without
  duplicate replay, and without losing a pending draft or attachment.
- Automated: ACP tests prove transport-facing IDs do not become the current Pi segment ID.
- Manual: seed a fixture Session with a sealed planning segment plus a current execution segment, open it in the TUI,
  and confirm one continuous scrollback under one Session identity. Then truncate the sealed file by one line and
  confirm the surface goes degraded with an evidence failure rather than rendering a gap.

### Behavior that must still be protected

`session-transcript-projection.test.js`, `session-runtime.test.js`, `runtime-adapter.test.js`,
`session-segments.test.js`, and `session-activations.test.js` all pass today and must still pass. Specifically:

- single-segment Sessions — every Session that exists today — must project exactly as they do now;
- digest and terminal-entry mismatch on the current segment must still fail closed;
- read paths must still never call `SessionManager.open()`;
- Session-scoped activation locking and the wrong-current-segment proof rejection from slice 8 must not weaken.

### Behavior expected to stop existing

One case only: a cursor absent from a **verified** generation currently throws `ProjectionContinuityError` and reports
`cursor_missing`. It must now return a typed replay-from-start result. Any existing assertion on that specific path
should be rewritten to the new contract, not deleted — the fail-closed assertion for an _unverified_ generation stays.
This is safe because full digest verification of every segment runs first and already catches history rewrite, leaving
the cursor check a pure position concern.

## Edge Cases & Considerations

- Read-only projection must not call `SessionManager.open()` or any Pi path that may migrate or rewrite a transcript.
  This now applies to every segment in the manifest, not only the current one.
- Namespacing changes the `eventId` format, invalidating in-flight Workspace client cursors held over the wire. The
  replay-from-start result above is what makes that a recoverable refresh instead of a degraded surface.
- Segment rollover is a manifest update, not a user-visible Session replacement. `session_replaced` stays reserved for
  epic continuation, which is a genuinely different Session (`session-runtime-events.js:57`).
- Context estimation and compaction must stay current-segment-only even when owner-visible history spans all segments.
- Failing closed may be temporarily inconvenient, but partial history is more dangerous than visible recovery.
- The v7 generation backfill is provably unambiguous only because every Session held exactly one segment when v6 ran. It
  must not be re-run against a manifest that has since grown, so scope it to rows where `current_segment_id` is NULL and
  the Session has exactly one segment.
- Nothing in this slice creates a second segment; multi-segment coverage is fixture-driven until slice 10.
