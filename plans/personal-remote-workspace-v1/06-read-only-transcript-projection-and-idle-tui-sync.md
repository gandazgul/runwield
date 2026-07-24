---
planId: "959c9e85-75d6-44c5-b882-a646b134bbc9"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add generation-driven, non-mutating transcript synchronization so committed Workspace or ACP turns appear in an already-open idle TUI without duplicate events or lost drafts."
affectedPaths:
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/types.js"
    - "src/ui/tui/managed-session-sync.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/chat-session.js"
    - "src/ui/tui/api.js"
    - "src/ui/tui/types.js"
    - "src/ui/tui/blocks.js"
    - "docs/usage.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-21T23:56:51-04:00"
updatedAt: "2026-07-24T18:17:31.382Z"
status: "implemented"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 6
dependencies:
    - "04-activation-gated-workspace-session-continuation-apis"
failureReason: "Semantic validation did not approve after 3 cycles."
implementedAt: "2026-07-24T17:02:29.687Z"
executionReport: "- Blocked before implementation: approved Plan requires slice 4 source modules/symbols to be present and explicitly says to stop rather than recreate them if absent.\n- Verified missing required slice 4 files: `src/shared/session/session-transcript-projection.js`, `src/shared/owner-coordination/session-activations.js`, `src/shared/owner-coordination/activation-protocol.js`, `src/ui/workspace/routes/owner-session-api.js`, and `src/ui/workspace/server/session-continuation.js`.\n- Verified missing required slice 4 symbols: `projectCommittedTranscript`, `adoptManagedSession`, `promptManagedSession`, `refresh_required`, and `inspectSessionActivation`.\n- No implementation changes were made; full `deno task ci` was not run because execution is blocked until the slice 4 implementation is integrated into this worktree."
worktreeStatus: "validation_failed"
---

# Read-Only Transcript Projection and Idle TUI Sync

## Context

ADR-011 requires an already-open TUI to observe committed Workspace or ACP changes without reopening the Session or
holding a writable Pi Session Manager. Observation must not acquire a Session Activation Lease: the TUI remains a reader
while another surface owns activation and hydrates a writable Runtime only after it wins activation for its next
mutation.

Slice 4 is the hard foundation for this feature. It owns the owner coordination database, committed Session generations,
exact-prefix transcript evidence, the one-shot non-mutating projector, stable projected `eventId` values, managed
dormant Hosted Sessions, activation-aware managed prompts, and stale-submit `refresh_required` behavior. This slice must
extend those contracts rather than call Pi `SessionManager.open()`, parse JSONL in TUI code, or create another ownership
path.

At planning time, the slice 4 implementation is present only as uncommitted changes in its execution worktree and is not
available on `main`. Execution must first confirm that the selected base contains the verified slice 4 modules and
managed TUI participation. If they are absent, stop for dependency integration; do not reconstruct slice 4 inside this
feature.

The current TUI already renders semantic SessionRuntime events through `runtime-adapter.js`, keeps editor text and
pasted image previews in `chat-session.js`, and exposes footer/workflow summaries through Runtime snapshots. The missing
seam is a managed-Session synchronization controller that polls durable generation state while the local Session is
dormant, asks Runtime to project only a verified committed prefix, and updates the existing adapter without touching
editor state.

## Objective

Implement automatic synchronization for open, managed, safely idle TUI Sessions so that:

- a newly committed Workspace or ACP Session generation appears without manual Session resume or local activation;
- transcript reads use only the slice 4 exact-prefix projector and never writable Pi list/open/continue APIs;
- projected semantic events render once, in committed projection order, using stable `eventId` values;
- Session Name, active Agent, model/thinking state, workflow/Plan context, terminal title, and available attention state
  refresh from the same committed snapshot;
- exact unsent editor text, pasted image attachments/previews, input history, and focus survive automatic and
  stale-submit refreshes;
- active, blocked, and degraded ownership/sync states are visible without exposing paths, owner instance IDs,
  operations, fences, or lease proofs; and
- the next mutable TUI action still acquires activation through the slice 4 Runtime path and fails closed if another
  generation wins the race.

Only committed checkpoints synchronize. Cross-process token streaming, mid-tool transfer, automatic activation takeover,
reconciliation repair, and the broader mutator hardening assigned to slice 7 remain out of scope.

## Approach

Keep coordination and transcript authority below the adapter boundary. Extend SessionRuntime with one read-only managed
synchronization operation that inspects the stable Session record, projects the latest published generation through
`session-transcript-projection.js`, validates continuity from the TUI's last acknowledged committed cursor, updates the
dormant Hosted Session snapshot, and emits only unseen consumer-ready events. TUI code schedules this operation but does
not receive a database handle, transcript locator, activation proof, or raw JSONL entries.

Treat each managed Hosted Session's acknowledged projection as `(generation, lastEventId)`. Initial replay establishes
the cursor. After a locally owned managed turn commits, Runtime projects the resulting generation without re-emitting it
so the live-rendered turn is acknowledged and will not replay on the next remote generation. For a later generation, the
previous cursor must still occur in projection order; events after it are candidates, and a small adapter-level
`eventId` set provides retry deduplication. A generation that changes only summary state still advances the acknowledged
cursor/snapshot. A missing cursor, reordered/non-ancestral projection, evidence mismatch, or malformed committed prefix
is a typed degraded state: do not advance local generation, partially render, acquire activation, or attempt repair.

Add a TUI-owned `managed-session-sync.js` controller with an injectable clock/timer and a conservative approximately
one-second polling interval. It runs only for a managed dormant Session, permits at most one refresh in flight, pauses
around local Runtime work and Session replacement, and disposes its timer/subscriptions on replacement or shutdown. A
poll may still expose the last committed generation while another surface is active; it never reads uncommitted tail
content. Consecutive generation jumps are handled by projecting the latest verified prefix once, preserving event order.

Represent synchronization in the Runtime contract with a validated typed event and snapshot state such as `current`,
`syncing`, `active_elsewhere`, `blocked`, or `degraded`, plus local/latest committed generations and a generic owning
surface kind where safe. Update a compact input-accessory/footer status rather than appending a polling log to the
conversation. Successfully projected conversation events are their own visible update. Persistent projection failures
show a recovery/sync warning and disable managed submission until a later poll proves the Session current.

Automatic refresh must be structurally draft-safe: it appends semantic events and updates summary/status components but
never clears or recreates the editor, attachment array, preview container, history, or focus. Unify the slice 4 stale
submit path around an explicit draft snapshot containing exact untrimmed text and attachments. If activation rejects
with `refresh_required`, synchronize first, restore that snapshot exactly, avoid adding another history entry or
accepted User Request event, and require explicit resubmission. Serialize watcher refresh and submit refresh so they
cannot render an event twice or overwrite one another.

A generation refresh alone does not create a new desktop-notification category. If the committed projection contains an
existing attention event, preserve the established notification policy and deduplicate by stable event ID; replaying a
previously seen attention event must not notify again.

## Files to Modify

- `src/shared/session/session-transcript-projection.js` — reuse the exact committed-prefix reader, expose ordered cursor
  continuity selection and complete committed summary state, and return typed projection failures without any writable
  Pi API.
- `src/shared/session/session-runtime.js` — add the read-only managed synchronization operation, serialize it with
  managed prompting, update acknowledged projection state after remote and local commits, emit unseen semantic events,
  and keep activation/hydration exclusively in the existing managed mutation path.
- `src/shared/session/hosted-session.js` — retain bounded committed generation/cursor, projected summary, and sync state
  on dormant managed shells without retaining a manager, Agent Session, handler, interaction, queue, or lease proof.
- `src/shared/session/session-runtime-events.js` and `src/shared/types.js` — define and validate the consumer-ready sync
  state event/snapshot fields and ensure projected events retain stable IDs without exposing coordination internals.
- `src/ui/tui/managed-session-sync.js` — add the single-flight idle polling controller, pause/resume/dispose lifecycle,
  typed retry behavior, and injected timing dependencies for deterministic tests.
- `src/ui/tui/runtime-adapter.js` — track projected event IDs per open Session, suppress retry duplicates, render
  existing semantic events, apply sync-state updates, and preserve existing validation/attention behavior.
- `src/ui/tui/chat-session.js` — compose the sync controller for managed Sessions, rebind it on Runtime Session
  replacement, coordinate submit races, and capture/restore exact editor and attachment drafts without clearing local UI
  state during automatic refresh.
- `src/ui/tui/api.js`, `types.js`, and `blocks.js` — expose a compact, replaceable managed Session sync/ownership status
  component and the editor draft access needed by `chat-session.js`, following existing TUI block and focus patterns.
- Focused `*.test.js` files beside the modules above — cover projection continuity, Runtime state, polling lifecycle,
  rendering dedupe, status sanitization, draft preservation, and notification behavior.
- `docs/usage.md` — document automatic committed-generation TUI refresh, quiet read-only observation, ownership status,
  draft preservation, and degraded/recovery behavior under activation opt-in.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-transcript-projection.js` `projectCommittedTranscript()` and `createReplayEvents()` from
  slice 4 — remain the only transcript parser/projector and stable projected-event source.
- `src/shared/owner-coordination/session-activations.js` `inspectSessionActivation()` — read latest activation and
  generation state without acquiring a lease; wrap it behind Runtime rather than importing it into TUI.
- `src/shared/session/session-runtime.js` `adoptManagedSession()` and `promptManagedSession()` from slice 4 — preserve
  the dormant shell and activation-aware mutation boundary, adding synchronization rather than another load path.
- `src/ui/tui/runtime-adapter.js` — continue rendering the same validated semantic events used by live and replay paths;
  dedupe before entering existing message/tool/attention handlers.
- `src/ui/tui/chat-session.js` `restoreQueuedItemToEditor()` and pasted-image preview construction — extract/generalize
  these mechanics for exact refresh restoration instead of creating a second editor representation.
- `src/ui/tui/api.js` input accessory and existing block replacement patterns — show ephemeral ownership/sync state
  without adding repeated system messages to the timeline.
- `src/ui/tui/system-notifications.js` `notifyRunWieldEventQuietly()` — call the existing helper only after
  `runtime-adapter.js` accepts a genuinely unseen attention event; keep notification policy and settings unchanged.

## Implementation Steps

- [ ] Verify the execution base contains slice 4's `session-transcript-projection.js`, owner activation/generation APIs,
      managed dormant Hosted Session metadata, `adoptManagedSession()`, `promptManagedSession()`, stable projected
      `eventId` values, and stale-submit `refresh_required` contract. Stop for dependency integration if any are absent;
      do not duplicate or weaken them in this slice.
- [ ] Add focused projection fixtures for successive generations. Prove the prior committed cursor is found by
      projection order, only later semantic events are selected, summary-only generations advance safely, generation
      jumps preserve order, and missing/reordered/non-ancestral cursors fail before returning partial events.
- [ ] Complete projected summary extraction required by the dormant snapshot: Session Name, active Agent,
      model/provider, thinking level, workflow/Plan context, and any committed attention state already represented by
      transcript entries. Keep private transcript content out of coordination state and browser/TUI status DTOs.
- [ ] Extend managed Hosted Session metadata with acknowledged generation/cursor, committed summary, and sanitized sync
      state. Assert dehydration still removes every writable or continuation-capable reference and that projection state
      survives only for the lifetime of the dormant Runtime shell.
- [ ] Define and validate the Runtime sync event/snapshot contract. Include local/latest generation and generic owning
      surface only; reject malformed state and prohibit transcript paths, Pi IDs, owner instance IDs, operation IDs,
      fences, and proofs.
- [ ] Implement the Runtime-owned read synchronization operation. Inspect activation/generation, project the exact
      published prefix, ignore later uncommitted bytes, validate continuity, atomically update dormant metadata, and
      emit unseen events followed by summary/sync changes. Never call Pi list/open/continue/migrate APIs or acquire
      activation.
- [ ] Reconcile locally committed turns into projection state without rendering them twice. After a successful managed
      publication, project/acknowledge the new committed cursor in no-emit mode; if that parity check fails, enter
      degraded state rather than allowing a later remote refresh to guess which live events were seen.
- [ ] Add `managed-session-sync.js` with one in-flight poll, injectable timing, immediate first inspection, bounded
      retry after ordinary read errors, and pause/dispose hooks. Poll only managed dormant Sessions; pause during local
      mutable work and rebind cleanly when a Runtime Session is replaced.
- [ ] Add adapter-level stable-event dedupe before existing render handlers. Preserve assistant/tool grouping and
      validation state, update Session Name/terminal title and footer summaries once, and suppress duplicate attention
      notifications across retries or repeated polls.
- [ ] Add the compact TUI sync/ownership status component. Show current/syncing, the generic active surface, blocked
      mutation, and persistent degraded/recovery states with text rather than color alone. Do not append one timeline
      message per poll or expose coordination internals.
- [ ] Make automatic refresh draft-neutral and centralize stale-submit restoration. Snapshot exact editor text before
      managed submission, copy attachment references, preserve previews/history/focus, restore only when the request was
      not accepted, and require a second explicit submit after successful refresh. Do not trim restored text, duplicate
      history, duplicate attachments, or emit an accepted User Request event.
- [ ] Serialize poll and submit races. A submit uses the last acknowledged generation, pauses polling, and invokes only
      the slice 4 managed prompt path. If another commit wins, synchronize and restore; if activation is active
      elsewhere or state is blocked/degraded, keep the draft and leave mutation disabled until state becomes safely
      current.
- [ ] Preserve positively unregistered Projects and unmanaged Sessions exactly: no owner database polling, no managed
      status block, and no changes to legacy prompt/replay behavior.
- [ ] Add unit, integration, and subprocess/file-observation tests, update usage documentation, and run the full quality
      gate.

## Verification Plan

- Automated: run focused tests for transcript projection, SessionRuntime/HostedSession, TUI adapter, sync controller,
  chat draft handling, API blocks, and notifications while developing; then run `deno task ci` and fix all failures.
- Automated: instrument Pi Session Manager constructors/list/open/continue/migration methods and filesystem metadata.
  Repeated idle polls and successful projection must call none of those writable APIs and must not change transcript
  bytes, size, mtime, parent directory contents, or owner activation state/fence.
- Automated: publish generation `n + 1` and multiple-generation jumps through an independent owner database connection.
  Prove one single-flight poll renders only unseen stable event IDs in projection order, repeated polls render nothing,
  summary-only commits update snapshots, and later uncommitted JSONL bytes are not displayed.
- Automated: cover committed-prefix truncation, digest/terminal mismatch, malformed JSONL, unknown cursor, branch
  continuity mismatch, database-ahead state, transcript-ahead state, protocol disabled, bootstrap required, uncertain,
  and reconcile-required states. The TUI must retain its prior cursor, show a sanitized degraded/blocked status, avoid
  partial output, and not hydrate or submit.
- Automated: prove an active Workspace or ACP owner is displayed only by generic surface kind, committed history remains
  readable, no live transient token/tool delta is inferred, and no owner instance, operation, fence, path, or proof
  reaches Runtime events or TUI text.
- Automated: enter exact draft text containing leading/trailing whitespace and multiple lines, attach multiple images,
  and set focus/history. Commit a remote generation during idle polling and during submit. In both cases prove the
  draft, attachment order/previews, history, and focus survive; stale submission emits no accepted User Request and
  explicit resubmission writes exactly once.
- Automated: publish a locally owned managed turn followed by a remote turn. Prove Runtime acknowledges the local
  generation without replaying its live-rendered events, then renders the remote generation exactly once. Repeat the
  same poll/result and prove message, tool, validation, and attention handlers are not invoked again.
- Automated: use fake timers to verify immediate inspection, approximately one-second idle polling, one in-flight read,
  pause during local work, retry after transient read failure, disposal on Session replacement/shutdown, and no timers
  for unmanaged Sessions.
- Automated: notification tests prove ordinary synchronization is quiet, a genuine unseen projected attention event
  follows existing user settings once, and retries/reloads of the same stable event ID do not notify again.
- Manual cross-surface: with slice 4 landed and activation acknowledged, open a managed Ideator Session in TUI and leave
  a multiline draft plus pasted image. Continue the same Session through the owner Workspace/API, wait at a safe
  checkpoint, and verify the committed user/assistant messages and updated Agent/Session summary appear automatically
  while the exact draft remains editable.
- Manual ownership/race: start another Workspace continuation while the TUI is open. Confirm the TUI shows that
  Workspace is active without showing private ownership data, does not display partial live tokens, becomes current
  after commit, and acquires/hydrates only after a later explicit TUI submission wins activation.
- Manual degraded-state: force a committed-evidence mismatch in a disposable fixture and confirm the TUI keeps prior
  content/draft, shows a recovery-oriented warning, disables managed submission, and performs no automatic repair or
  takeover.
- Expected result: an open managed TUI follows durable remote Session progress within the polling interval, renders each
  committed semantic event once, preserves every unsent local draft artifact, and remains a non-owning reader until the
  next fenced mutation succeeds.

## Edge Cases & Considerations

- **Dependency integration:** slice 4 is a hard source dependency, not merely Plan metadata. Its currently uncommitted
  execution-worktree changes must be integrated before this feature executes; a missing foundation is a blocker.
- **Committed versus live truth:** active remote turns expose only the last committed prefix and generic ownership
  state. Mid-token/tool progress remains local to the owning surface.
- **Cursor continuity:** stable IDs are interpreted by projector order, never lexical order. A prior cursor absent from
  a later projection is a reconciliation signal, not permission to replay the full Session into an existing timeline.
- **Local-turn dedupe:** live events and projected entries use different publication timing. A no-emit projection after
  local commit is required so the next remote generation does not replay the local turn.
- **Summary-only generations:** compaction/configuration metadata may advance generation without new visible messages.
  Refresh summary/cursor state without inventing a conversation event.
- **Read races:** a later generation may publish while an earlier prefix is being read. Exact byte length and digest
  make the earlier committed prefix safe; the next poll observes the newer generation.
- **Draft boundary:** automatic synchronization must not call broad `clearMessages()`/Session replacement helpers that
  also clear editor or attachment state. Stale-submit restoration applies only when Runtime proves the User Request was
  not accepted.
- **Mutation boundary:** polling and projection never reserve the next mutation. The database transaction still chooses
  the winner when TUI, Workspace, or ACP races to acquire activation.
- **Blocked states:** heartbeat expiry, `uncertain`, `reconcile_required`, protocol/epoch failure, and
  bootstrap-required state remain fail-closed. This slice reports them but does not add takeover, bootstrap side
  effects, or repair.
- **Compatibility:** positively unregistered Projects retain legacy TUI behavior. Managed direct mutators deferred by
  slice 4 remain unsupported until slice 7; synchronization does not authorize them.
- **Notifications:** remote synchronization itself is not an attention event. Existing attention reasons remain
  user-configurable and must be stable-ID deduplicated when projected.
