---
planId: "d604dd4b-b9f8-4330-8a6a-6e31ed7507ca"
classification: "FEATURE"
complexity: "HIGH"
summary: "Add fenced Session Activation Leases, committed Session generations, non-mutating timeline projection, and the narrow Workspace/TUI/ACP Runtime APIs needed to resume an idle Session safely."
affectedPaths:
    - "src/shared/owner-coordination/"
    - "src/shared/session/"
    - "src/shared/types.js"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/server/"
    - "src/ui/workspace/routes/"
    - "src/ui/tui/"
    - "src/acp/"
    - "src/cmd/acp/"
    - "src/cmd/workspace/"
    - "src/cmd/load-plan/"
    - "src/cmd/resume/"
    - "src/cmd/new/"
    - "src/cmd/init/"
    - "src/cmd/reload/"
    - "src/cmd/name/"
    - "src/cmd/quit/"
    - "docs/usage.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-21T23:56:51-04:00"
updatedAt: "2026-07-23T20:51:42.917Z"
status: "in_progress"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 4
dependencies:
    - "03-secure-persistent-workspace-bootstrap-and-device-pairing"
humanReviewMode: null
humanReviewDecision: null
executionBaselineTree: "f5112a8f2da167a5851203ff1f58f1402584d337"
worktreeId: "776120b1"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-personal-remote-workspace-v1-04-activation-gated-776120b1"
worktreeBranch: "runwield/worktree/personal-remote-workspace-v1-04-activation-gated-776120b1"
worktreeBaseBranch: "main"
worktreeStatus: "active"
---

# Activation-Gated Workspace Session Continuation APIs

## Context

Slices 2 and 3 delivered the owner coordination database, stable RunWield Session catalog, persistent owner Workspace,
registered Project authorization, and paired-device authentication. The next tracer bullet is resuming an idle Ideator
Session from Workspace without allowing two processes to mutate one Pi Session Transcript from stale in-memory leaves.

The current Runtime cannot provide that guarantee. `SessionRuntime.loadSession()` opens a writable Pi Session Manager
before cross-process authorization, `HostedSession` derives durable metadata from that live manager, and TUI and ACP
retain writable managers while idle. A Workspace-only lock would not exclude those sibling processes. This slice must
therefore introduce the common activation-aware Runtime operation and make TUI/ACP participate for managed Session
creation, dormant load, ordinary text turns, and turn cancellation/checkpoint settlement.

The user chose a bounded compatibility transition. For Sessions in registered Projects, direct mutation paths beyond
managed start/load and an ordinary text turn fail closed until slice 7. This includes direct Plan loading/execution,
standalone compaction, Session rename/reload, shell recording, images, model/thinking changes, steering, and queues.
Operations reached inside an already fenced TUI/ACP text turn may use that turn's proof, including Agent handoff,
interactions, workflow tool outcomes, and automatic turn settlement. Projects that have positively never entered owner
coordination retain legacy behavior. Slice 7 converts deferred methods to fenced implementations and hardens lower-level
write paths.

Workspace continuation is narrower: only an idle Ideator Session is eligible. Workspace uses a positive conversation-
only capability profile with no workflow handler, materializing tools, interactions, handoffs, compaction, images, or
repository/memory mutation. Planner continuation waits for the Durable Workflow Checkpoint slices rather than exposing a
Planner that cannot safely use `user_interview` or `plan_written`.

Workspace also needs committed history without writable hydration. This slice owns the complete one-shot, non-mutating
committed-prefix reader and semantic projector. Slice 6 adds generation watching, unseen-event selection, automatic idle
TUI refresh, dedupe state, and draft preservation. Before that watcher exists, a stale TUI submission will project the
newly committed history, restore the unsent User Request, and require explicit resubmission instead of sending against
history the user has not seen.

## Objective

Implement the first enforceable Session Activation Lease and committed-generation vertical slice so that:

- stable RunWield Session ID, not Pi or process-local Runtime identity, is the coordination key;
- Workspace, TUI, and ACP acquire fenced activation before writable hydration or an ordinary managed Session turn;
- safe-idle release dehydrates the managed Hosted Session into a dormant shell with no manager, Agent Session, handler,
  interaction, queue, subagent, or activation proof;
- Session generation publication happens only after exact transcript bytes are settled, synchronized, and verified;
- paired Workspace clients can list eligible Sessions, inspect activation state, read a committed semantic timeline,
  bootstrap legacy evidence through an authenticated mutation, and start one idempotent server-owned continuation;
- same-Session races have one winner while unrelated Sessions remain independently activatable;
- stale, expired, interrupted, transcript-ahead, database-ahead, or replaced-database states block ordinary continuation
  without automatic takeover or User Request replay;
- stale TUI submission refreshes committed history and restores the draft for explicit resubmission; and
- owner continuation remains disabled until the operator acknowledges that pre-v3 RunWield processes have stopped.

This slice does not add Durable Workflow Checkpoints, Plan Workflow Leases, Workspace Planner continuation, automatic
idle TUI synchronization, complete managed mutator support, recovery/takeover endpoints, or phone UI. Slices 5–9 extend
those capabilities without replacing the activation, generation, and projection contracts defined here.

## Approach

### Owner protocol and activation state

Upgrade the owner database to v3 and add a separate owner-only activation protocol marker under `~/.wld/`. The database
stores a random database epoch; the marker stores the acknowledged protocol version and matching epoch. Migration alone
does not opt in. `wld workspace serve --enable-session-activation` atomically writes the marker only after warning that
all incompatible processes must be stopped. Until acknowledgement, managed mutations from Workspace, TUI, and ACP are
blocked. If an acknowledged database is missing or replaced, the epoch mismatch blocks Session mutation globally until
explicit reconstruction and re-acknowledgement, so a previously managed transcript cannot silently fall back to legacy
writes.

Legacy eligibility is based on Project/root evidence, never merely on a missing Session row. A transcript under a
current or historical registered Project root must catalog before mutation or fail closed. Once cataloged, Project
disable/removal, health loss, locator conflict, or a missing activation row blocks new mutation; it never enables an
unmanaged writer. Historical roots remain identity evidence, but mutation requires an enabled, healthy current Project
and an unambiguous guarded locator. An already active owner with an unexpired exact proof may checkpoint/release after
Project eligibility changes, but may not start another turn.

Keep one retained `session_activation_state` row per Session and append-only `session_committed_generations`. Activation
states are `uninitialized`, `idle`, `active`, `uncertain`, and `reconcile_required`; active phases are explicitly
limited to `bootstrap`, `preparing`, `hydrated`, `turning`, and `checkpointing`. Existing bootstrap acquires through
`uninitialized -> active/bootstrap`, while managed-new initialization uses `uninitialized -> active/preparing`; both may
publish generation `0` and enter `idle`, or transition to `uninitialized`, `uncertain`, or `reconcile_required`
according to whether writable hydration/effects occurred. Normal acquisition from `idle` checks the caller's exact
expected generation, increments a monotonic fence, and binds owner instance, process kind, operation ID, phase, and
heartbeat deadline. Heartbeat, phase changes, publication, pre-hydration release, and failure transitions use
compare-and-set over the complete proof. A heartbeat at or after expiry is rejected and moves the Session to
`uncertain`. Neither `uncertain` nor `reconcile_required` has an automatic path back to `idle` in this slice.

Fencing prevents stale SQLite publication; it cannot undo a Pi file append. Safety therefore depends on never granting a
new owner after heartbeat loss or uncertain effects. A failure before writable hydration may release without advancing
generation only when the full file still exactly matches committed evidence. Once hydration occurs, every safe
checkpoint publishes exactly the next generation even if its final bytes happen to be unchanged; otherwise the Session
becomes uncertain. Such a pre-hydration release is an abandoned acquisition, not a Session checkpoint.

### Generation and transcript evidence

Each generation records the evidence version, SHA-256 of the exact raw byte range `[0, byteLength)`, byte length,
terminal entry ID, stable Session/Project/locator identity, producing operation/fence, and publication time. Original
line endings are part of the digest. `terminalEntryId` is nullable only for a valid header-only transcript, and a
committed prefix must end on a complete JSONL record boundary. Readers use positional reads of exactly that prefix;
shorter or mismatched bytes fail closed, while later uncommitted bytes are ignored only for read projection.

Existing cataloged Sessions migrate to `uninitialized` without filesystem access. Their CSRF-protected bootstrap
operation acquires the bootstrap phase, uses direct read-only file APIs (never Pi list/open/continue APIs), validates
the guarded path/header/file identity and a stable complete prefix, publishes generation `0`, and releases without
creating an Agent Session or changing transcript bytes. GET list/timeline routes report `bootstrap_required`; they never
perform bootstrap as a side effect.

For a new managed TUI Session, model onboarding completes before persistent Session creation so no lease is held while
waiting for configuration. Runtime then creates the unavoidable Pi header, keeps it hidden from adapters, catalogs it as
`source = created` with its activation row, acquires activation, performs initial Agent setup under the fence,
dehydrates, synchronizes the exact file, and publishes generation `0`. ACP follows the same sequence without interactive
onboarding. Failure after header/catalog creation leaves an uninitialized or uncertain managed Session; it never falls
back to legacy writes.

Before writable hydration, compare the entire current guarded file to the expected generation's length and digest. Any
extra tail, replacement, truncation, malformed committed record, terminal mismatch, or digest mismatch moves the Session
to `reconcile_required` and prevents acceptance of the User Request. After a turn settles, dispose/unsubscribe the root
Agent Session, extensions, subagents, queues, and interactions; dispose the manager; synchronize the exact transcript
file; then hash and parse evidence from that same guarded file before publishing generation and release in one SQLite
transaction. For a newly created transcript, synchronize both the transcript file and its parent Session directory so
the directory entry is durable before generation `0` publication. Configure and test SQLite durability for coordination
publication (`synchronous = FULL`).

### Runtime ownership and projection

Put lease ownership below adapters. Add one high-level activation-aware Runtime operation that owns:

1. protocol/Project/Session eligibility and expected-generation validation;
2. activation acquisition and heartbeat;
3. full-file committed-evidence comparison;
4. writable Pi hydration and Agent activation;
5. the allowed turn or initialization action;
6. proof-aware cancellation and settlement;
7. Agent/manager dehydration, file synchronization, and evidence capture; and
8. fenced generation publication/release or conservative failure transition.

Workspace, TUI, and ACP invoke and subscribe to this operation; they never receive a fence, manager, locator, database
handle, or owner identity. Runtime remains busy through checkpoint publication, while `TURN_END` means the Agent turn is
settled rather than that the whole activation operation is idle. Activation must succeed before `USER_MESSAGE` or
`TURN_START` is emitted, so a rejected request is not presented as accepted. ACP and Workspace subscribe before invoking
the operation.

Extend `HostedSession` with distinct RunWield Session, Project, Pi, Runtime, and adapter identities plus retained
committed metadata. Add a dedicated dehydration lifecycle separate from `dispose()`: dormant shells keep stable
identity, name, Agent/workflow summary, generation, and projected snapshot data but no writable or continuation-capable
reference. `closeSession` still destroys the shell. Update `SessionSnapshot` and event types without exposing private
IDs or proofs.

Extract replay shaping into `session-transcript-projection.js`. The module independently parses raw JSONL, validates the
header and terminal parent chain, derives committed name/Agent/model/workflow state and unresolved-tool eligibility, and
projects the same consumer-ready semantic events as live replay. Each event gets stable
`eventId = <entryId>:<eventKind>:<blockIndex>` (`blockIndex = 0` for entry-level events). Cursor scope is
`(generation, eventId)`; lookup follows projection order rather than lexical ID order, and unknown/stale cursors are
rejected. Slice 6 must reuse this one-shot projector rather than add another parser.

For a stale managed TUI submission, the Runtime rejects before accepting the User Request, projects the latest committed
generation through the existing TUI adapter, and returns a typed `refresh_required` result. Slice 4 retains the stable
event IDs rendered for that open Session and emits only IDs not already shown, preventing duplicates without guessing
cross-generation cursor order. TUI restores the exact untrimmed editor text and attachments without duplicating history
and requires explicit resubmission. Slice 6 generalizes that transient dedupe state and makes refresh automatic while
idle.

### Workspace continuation and adapter rollout

Workspace uses a dedicated Ideator conversation profile propagated through Agent construction. Final tools are selected
from a fixed trusted read-only allowlist after layered Agent resolution; arbitrary Custom Tools, package extensions,
edit fallback, delegation, memory mutation, shell, workflow tools, `user_interview`, `return_to_router`, and handoffs
are disabled. Do not install the generic workflow-aware Agent Handler. Disable images and automatic compaction; context
exhaustion or any attempted interaction/workflow continuation returns a typed unsupported result and checkpoints only
settled transcript output. Eligibility requires durable committed evidence that the active Agent is Ideator and that no
workflow, unresolved tool call, or pending interaction is present.

The browser supplies a random `requestId` with each bootstrap/continuation start. Persist a minimal operation receipt
before Agent invocation, scoped to device, Project, Session, request ID, expected generation, and a normalized request
body digest. Store status/generation/error metadata only—never prompt text or event bodies. An exact retry returns the
same opaque operation/result; reuse with different input is rejected, and loss of the initial `202` cannot invoke the
User Request twice.

`session-continuation.js` owns one process-scoped Runtime/coordinator, bounded safe live-event buffers, heartbeats,
operation status, and draining. Browser disconnect or device revocation stops that client's connection but does not
cancel a turn or release activation. Durable receipts allow status recovery; if an in-memory event buffer is gone, the
client resumes from committed timeline. Shutdown releases only pre-hydration or fully checkpointed operations, while
active uncertain work remains fenced.

TUI and ACP each open one owner store/coordinator for process lifetime, use dormant stable mappings for managed
Sessions, and close them on shutdown. Managed `/load-plan`, resume compaction, `/name`, `/reload`, `/init`, shell
recording, image persistence, direct model/thinking changes, steering, and queued writes return bounded
unsupported/invalid-state results without touching the transcript. Positively unregistered Projects retain existing
behavior. Normal TUI/ACP text turns may perform nested Agent/workflow operations only through an unexported
operation-scoped Runtime capability created by the active managed turn. The mere presence of an active turn/lease never
authorizes a public direct mutator; slash commands and adapter calls cannot obtain or forge the nested capability. This
still does not provide cross-Session Plan exclusivity before slice 9.

## Files to Modify

- `src/shared/owner-coordination/schema.js` and `database.js` — add migration v3, database epoch, retained activation
  state, committed generations, idempotent operation receipts, composite Session/Project integrity, insert-time
  activation-row creation, `synchronous = FULL`, and WAL-safe pre-migration snapshot behavior.
- `src/shared/owner-coordination/paths.js` and new `activation-protocol.js` — resolve, atomically write, permission, and
  verify the owner protocol/epoch marker independently from migration.
- `src/shared/owner-coordination/session-activations.js` — implement the explicit state machine, fenced CAS operations,
  heartbeat/expiry, generation publication, and typed blocked states.
- `src/shared/owner-coordination/sessions.js`, `projects.js`, and `index.js` — support created-session cataloging,
  activation-row invariants, current-root managed resolution, protocol health, and narrow adapter-neutral services.
- `src/shared/session/session-transcript-projection.js`, `root-session.js`, `active-agent-session.js`, and
  `workflow-context-session.js` — implement guarded exact-prefix I/O, file synchronization/evidence, branch/state
  reconstruction, and shared semantic projection without writable Pi APIs.
- `src/shared/session/session-runtime.js`, `hosted-session.js`, `session-host.js`, `session.js`, and
  `agent-switching.js` — inject coordination, add managed initialization/load/turn operations and dormant dehydration,
  propagate the Ideator conversation profile, and enforce the method classification.
- `src/shared/session/session-runtime-events.js` and `src/shared/types.js` — add stable event IDs, typed activation/
  generation outcomes, and safe dormant snapshot metadata.
- `src/shared/session/architecture-boundary.test.js` — preserve sibling-adapter and hidden-manager boundaries while
  allowing only shared coordination imports below Runtime.
- `src/ui/tui/chat-session.js`, `runtime-adapter.js`, `model-welcome.js`, and `bash-interceptor.js` — compose one
  process coordinator, delay managed persistence until model readiness, adopt dormant/replay behavior, restore stale
  drafts, and fail closed for deferred direct mutations.
- `src/cmd/load-plan/`, `resume/`, `new/`, `init/`, `reload/`, `name/`, and `quit/` — route supported start/load through
  Runtime, return clear managed unsupported states for deferred commands, and close coordination resources.
- `src/acp/server.js`, `session-map.js`, and `src/cmd/acp/` — compose one coordinator, preserve transport IDs while
  mapping stable RunWield identity, subscribe before turns, and map typed activation failures to ACP invalid-state
  responses.
- `src/ui/workspace/server/session-continuation.js` — implement server-owned Ideator operations, idempotent receipts,
  event buffers, polling, heartbeat, and drain/close behavior over the high-level Runtime API.
- `src/ui/workspace/routes/owner-session-api.js` and `owner-api.js` — add authenticated Session list/status, timeline,
  bootstrap, continuation-start, and operation-status routes with bounded parsing and whitelisted DTOs.
- `src/ui/workspace/server.js` and `src/cmd/workspace/serve.js` — compose and close the continuation service, propagate
  shutdown signals, and implement explicit owner-wide activation protocol acknowledgement.
- Focused `*.test.js` files beside these modules plus owner Workspace integration tests — cover migration, state
  transitions, durability order, projection parity, adapter policy, authentication, concurrency, and shutdown.
- `docs/usage.md` — document opt-in, pre-v3 stop/restart requirements, managed compatibility limits, Ideator-only
  Workspace scope, database-epoch recovery, and conservative uncertainty behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/owner-coordination/database.js` — retain ordered migrations, `BEGIN IMMEDIATE`, busy timeout, and hidden
  handle conventions; move backup before migration SQL and use a standalone restorable SQLite snapshot such as
  synchronous `VACUUM INTO` rather than copying the main WAL database file. Validate the observed source schema version
  rather than assuming every upgrade starts at v2.
- `src/shared/owner-coordination/pairing.js` — reuse conditional-update/`changes === 1` compare-and-set patterns for
  fenced transitions and idempotent operation receipts.
- `src/shared/owner-coordination/sessions.js` — reuse stable Session/Project/Pi locator mapping and guarded catalog
  validation; browser DTOs must remain explicit allowlists.
- `src/shared/session/session-runtime.js` `createReplayEvents()` and `promptSession()` — preserve semantic event and
  turn behavior by extracting projection and wrapping the turn in Runtime-owned activation rather than adding adapter
  logic.
- `src/shared/session/root-session.js` `readCatalogSafeRootSessionLocator()` — reuse containment and header identity
  checks, extending them with exact-prefix reads and durable file evidence.
- `src/shared/session/session-runtime-events.js` — preserve consumer-ready message/thinking/tool/usage semantics while
  adding stable projection IDs.
- `src/ui/tui/runtime-adapter.js` — reuse semantic replay rendering for on-submit stale refresh; slice 6 adds idle
  generation watching around the same adapter.
- `src/ui/workspace/server/owner-auth.js`, `owner-projects.js`, and `owner-connections.js` — reuse paired-device/CSRF,
  enabled Project authorization, and revocation-aware connection cleanup.
- `src/ui/workspace/routes/owner-api.js` — reuse `ownerJson`, bounded body parsing, and sanitized error conventions
  after centralizing shared helpers.
- `src/acp/session-map.js` — retain ACP transport-facing identity and prompt lifecycle while attaching stable Session
  metadata below the protocol boundary.

## Implementation Steps

- [ ] Refactor owner migration startup so newer-schema refusal occurs first, then a unique owner-only WAL-complete
      snapshot of the observed pre-migration schema is created outside migration SQL, opened independently, checked with
      `quick_check`, and verified at that same source version; only then enter `BEGIN IMMEDIATE`, re-read version, and
      apply each missing migration through v3. Abort without migration if snapshot creation or validation fails or
      remains busy; cover fresh, v1-to-v3, and v2-to-v3 paths.
- [ ] Add v3 schema and invariants: database epoch, activation state, committed generations, and continuation operation
      receipts; composite `(Session, Project)` parent/foreign keys; trigger or equivalent insert-time creation of an
      `uninitialized` activation row; append-only/monotonic generation constraints; and migration backfill for existing
      Sessions without filesystem reads.
- [ ] Add owner activation protocol marker services and `workspace serve` acknowledgement. Atomically write owner-only
      JSON containing marker schema, protocol version, and database epoch. Test unacknowledged, matching, missing DB,
      mismatched epoch, malformed marker, and explicit re-acknowledgement states across Workspace, TUI, and ACP.
- [ ] Implement the activation state machine with injectable clock/ID factories. Cover both fenced generation-zero paths
      (`uninitialized -> active/bootstrap|preparing -> idle`) and their pre/post-hydration failures. Test every
      legal/illegal transition, late heartbeat, phase mismatch, stale fence/generation, exact retry, pre-hydration
      no-change release, current-owner settlement after Project disable, and permanent blocking after uncertain/
      reconcile states.
- [ ] Resolve managed state from protocol and Project/root evidence. Catalog registered-root transcripts before
      mutation, support `source = created`, require an enabled healthy current root for acquisition, and make missing
      activation rows, historical-only locators, relink conflicts, and database epoch mismatch fail closed without
      legacy fallback.
- [ ] Implement byte-exact generation evidence and Agent-free bootstrap. Validate raw header/JSONL boundaries, path and
      file identity, terminal parent chain, SHA-256 prefix digest, and stable before/after evidence. Expose bootstrap
      only through an authenticated CSRF-protected idempotent operation; GETs report `bootstrap_required`.
- [ ] Build the complete one-shot transcript parser/projector. Reconstruct the committed branch and name/Agent/model/
      workflow/unresolved-tool state, preserve current replay semantics, add stable `eventId`, and enforce bounded
      `(generation, eventId)` pagination with parity fixtures against live Runtime replay.
- [ ] Extend Hosted Session identity and add dedicated dormant dehydration. Dispose
      Agent/extension/subagent/interaction/ queue references before the manager, retain committed metadata for
      snapshots, and distinguish checkpoint release from shell-destroying `closeSession`.
- [ ] Add the Runtime-owned managed operation with heartbeat and explicit phases. Acquire and compare evidence before
      emitting accepted-turn events; hydrate/activate only after validation; keep Runtime busy through checkpoint;
      synchronize/hash after Agent and manager disposal; then publish/release or mark uncertainty without rerunning.
- [ ] Split managed new-session creation from TUI model onboarding. Create the persistent header only after model
      readiness, catalog it and acquire before first Agent setup, publish generation `0`, and return dormant. Apply the
      same catalog/acquire ordering to ACP new Session creation.
- [ ] Classify and test every public Runtime method as read-only, managed start/load, ordinary-turn/nested-under-turn,
      or unsupported while dormant. Use an unexported operation-scoped capability for nested workflow calls; active
      lease presence alone must not authorize `/agent`, compaction, Plan execution/pull, or any public direct mutator.
      Adopt proof-aware turn cancellation/settlement, audit command entry points, fail closed before deferred side
      effects, and prevent stale handlers/managers from escaping Runtime or surviving dehydration.
- [ ] Update TUI to use one process coordinator and dormant managed Sessions. On stale submission, project only stable
      event IDs not already rendered, restore the exact untrimmed text/attachments without another history entry, emit
      no accepted User Request event, and require resubmission. Keep positively unregistered Projects unchanged and
      return clear unsupported messages for deferred commands.
- [ ] Update ACP to use one process coordinator, dormant stable mapping, pre-turn subscriptions, and typed
      `ACP_INVALID_STATE` responses for protocol, ownership, stale, bootstrap, reconcile, and unsupported states without
      leaking paths or proofs.
- [ ] Implement the Workspace Ideator-only conversation profile from a trusted positive read-only allowlist. Assert the
      final Agent Session inventory after layered resolution; disable generic workflow dispatch, interactions, handoffs,
      arbitrary Custom Tools/extensions, edit fallback, images, and auto-compaction. Canary-test that source, Plans,
      worktree registry, settings, and memory state do not change.
- [ ] Implement durable operation receipts and `session-continuation.js`. Record device-scoped request idempotency
      before invocation, subscribe before the Runtime operation, heartbeat and bound event buffers, return/recover
      terminal status, and drain only safely checkpointed operations on shutdown.
- [ ] Add owner Session routes for list/status, committed timeline, bootstrap, continuation start, and operation status.
      Require paired-device auth, CSRF on mutations, enabled Project containment, exact expected generation, and bounded
      text/cursor/request IDs. Return `202` for accepted/existing idempotent operations, `409` for ownership/staleness/
      bootstrap races or key mismatch, and `503` for disabled protocol, epoch recovery, uncertain, or reconcile states.
- [ ] Wire Workspace/TUI/ACP resource lifetimes and shutdown signals so each process closes its coordinator and Runtime;
      never release an active lease unless pre-hydration or fully checkpointed safety is proven.
- [ ] Update usage documentation, add focused unit/integration/subprocess tests, and run the full quality gate.

## Verification Plan

- Automated: run `deno task ci` and fix all failures.
- Automated: migrate temporary v1 and v2 WAL databases containing committed uncheckpointed pages. Prove each standalone
  backup contains them, opens without source `-wal`/`-shm`, preserves the observed source version, passes `quick_check`,
  has owner-only permissions, and is created before migration SQL; also cover a fresh database. Backup failure/BUSY and
  newer-schema refusal must remain non-mutating.
- Automated: use independent database connections and a subprocess race to prove one same-Session winner, unrelated
  Session concurrency, monotonic fences/generations, legal state transitions, exact-operation idempotency, expired-proof
  rejection, and no takeover from `uncertain` or `reconcile_required`.
- Automated: test protocol marker behavior across all adapters. Migration without acknowledgement does not enable
  managed mutation; matching epoch enables it; deleted/replaced DB blocks Session writes globally; explicit
  reconstruction and re-acknowledgement are required.
- Automated: cover existing and new bootstrap. Existing transcripts publish generation `0` without Agent creation,
  writable Pi APIs, byte changes, or mtime changes. Managed new Sessions create no transcript before model readiness and
  perform no Agent setup before catalog/acquire.
- Automated: instrument the exact sequence
  `acquire -> full-file evidence comparison -> manager open/Agent activation -> turn -> Agent settle -> Agent dispose -> manager dispose -> file sync -> evidence capture -> SQLite COMMIT/release`.
  Inject failure at each boundary and prove no duplicate Agent invocation or database-ahead publication. Heartbeat loss
  after hydration must block publication and all later acquisition.
- Automated: projection fixtures prove byte-exact prefix verification, later-tail ignoring, malformed committed-prefix
  rejection, parent-chain reconstruction, stable event IDs/cursors, and semantic parity with repeated live replay. Byte
  and mtime assertions prove list/status/timeline GETs never invoke writable Pi APIs or bootstrap.
- Automated: Runtime/TUI tests cover dormant invariants, no private proof leakage, accepted-event ordering, unforgeable
  nested-operation authority, public direct-mutator rejection before side effects, proof-aware cancellation,
  duplicate-free stale-generation refresh, exact raw draft/attachment/history restoration, no accepted User Request
  event on refresh, and explicit resubmission.
- Automated: ACP tests cover dormant new/load, stable transport mapping, subscription ordering, coordinator cleanup, and
  sanitized invalid-state errors while preserving protocol framing and existing unregistered behavior.
- Automated: Workspace tests cover paired-device auth, CSRF, Project/Session containment, Ideator-only eligibility,
  malicious Agent overrides, final tool inventory, request ID response-loss retries during and after execution, bounded
  polling, revocation without cancellation, shutdown, sanitized DTOs, and unchanged ephemeral/Shared Space authority.
- Manual rollout/API check: stop other RunWield processes, start owner Workspace with activation acknowledgement, pair a
  browser, list a registered Project's Sessions, bootstrap/read one timeline, start an idle Ideator continuation, and
  poll it to completion. Confirm generation advances, activation returns idle, and retrying the same request ID does not
  invoke another turn.
- Manual cross-surface check: leave the same managed Session dormant in TUI, resume it through Workspace, then submit a
  TUI User Request. Confirm the remote committed turn is rendered, the draft is restored without submission, and only a
  second explicit submit acquires/hydrates and writes. Automatic idle refresh remains slice 6.
- Expected result: supported paths have one fenced writer, committed history is readable without writable hydration,
  transcript durability precedes generation publication, and unsupported or uncertain states block rather than bypass,
  take over, or replay effects.

## Edge Cases & Considerations

- **Fencing boundary:** the fence protects coordination publication, not raw Pi appends. Slice 4 prevents a second
  writer by making expiry/uncertainty terminal; slice 7 adds deeper proof checks around every write path.
- **Managed compatibility:** registered managed Sessions intentionally fail closed for direct mutations deferred to
  slice 7. Normal nested TUI/ACP turn workflows remain process-local under one activation and do not imply durable
  cross-surface continuation or Plan Workflow Lease protection.
- **Protocol/database loss:** the epoch marker is intentionally outside the replaceable database. Mismatch blocks all
  Session mutation until explicit reconstruction; it does not guess prior Project/Session identity.
- **Generation zero:** migration cannot derive file evidence. Existing Sessions remain `uninitialized` until an
  exclusive `active/bootstrap` Agent-free bootstrap. New managed TUI Sessions delay persistence until model readiness,
  then use `active/preparing` for Agent activation and synchronize the new file plus parent directory before publishing
  generation `0`.
- **Transcript ahead of SQLite:** any tail before hydration causes `reconcile_required`. If a turn becomes durable but
  publication cannot be proven, never append or invoke it again; recovery is deferred.
- **SQLite ahead of transcript:** durability ordering should prevent this. A short or mismatched published prefix makes
  timeline and mutation fail closed.
- **No-change acquisition:** release without generation advancement is allowed only before hydration with exact
  unchanged evidence. Every safely checkpointed hydrated operation publishes the next generation.
- **Heartbeat/project changes:** deadline expiry invalidates the proof even if the process wakes later. Project disable,
  removal, or health changes do not invalidate an unexpired owner's right to checkpoint/release, but prevent new work.
- **Workspace scope:** only durable evidence of an idle Ideator Session is eligible. Planner, workflows, unresolved
  tools, interactions, images, compaction, and materializing effects wait for later slices.
- **Idempotency:** operation receipts contain hashes and coordination metadata, not User Request text or event bodies.
  Same key/different body is a conflict; ambiguous post-invocation failure never triggers automatic replay.
- **Read while active:** timeline reads show only the last committed prefix and a generic owning-surface state, never
  owner instance, operation, fence, path, or live uncommitted content.
- **Browser disconnect/revocation:** neither cancels a turn nor releases activation. Reconnect uses operation status and
  committed timeline if the live buffer is gone.
- **Process shutdown:** release only before hydration or after a proven checkpoint. A killed owner becomes uncertain and
  requires later recovery.
- **Domain language:** ADR-011 and the aligned Personal Workspace PRDs govern this Plan's use of Session Activation
  Lease and automatic synchronization. Root `CONTEXT.md` still contains the retired “Session Control” term; updating
  that glossary is a separate Ideator/Init follow-up, not part of this Plan.
- **Slice handoff:** this Plan supersedes overlapping draft language in sibling slices: slice 5 consumes an Ideator-only
  API, slice 6 adds watching and generalized incremental idle synchronization around this completed projector, and slice
  7 converts the fail-closed mutator matrix to fenced support rather than reimplementing create/load/prompt activation.
  Slices 8–9 add Durable Workflow Checkpoints and Plan Workflow Leases. The Slicer/Planner should align those draft Plan
  files separately; this feature must not modify sibling Plans during execution.
