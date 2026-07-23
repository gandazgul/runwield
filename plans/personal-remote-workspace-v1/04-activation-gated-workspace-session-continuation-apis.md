---
planId: "d604dd4b-b9f8-4330-8a6a-6e31ed7507ca"
classification: "FEATURE"
complexity: "HIGH"
summary: "Add fenced Session Activation Leases, committed Session generations, non-mutating timeline projection, and the narrow Workspace/TUI/ACP runtime APIs needed to continue an idle Session safely."
affectedPaths:
    - "src/shared/owner-coordination/"
    - "src/shared/session/"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/server/"
    - "src/ui/workspace/routes/"
    - "src/ui/tui/chat-session.js"
    - "src/acp/server.js"
    - "src/acp/session-map.js"
    - "src/cmd/acp/"
    - "src/cmd/workspace/serve.js"
    - "docs/usage.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-21T23:56:51-04:00"
updatedAt: "2026-07-23T13:58:51-04:00"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 4
dependencies:
    - "03-secure-persistent-workspace-bootstrap-and-device-pairing"
---

# Activation-Gated Workspace Session Continuation APIs

## Context

Slices 2 and 3 delivered the owner coordination database, stable RunWield Session catalog, persistent owner Workspace,
registered Project authorization, and paired-device authentication. The next tracer bullet is continuing an idle
ideation or planning Session from Workspace without allowing two processes to mutate one Pi Session Transcript from
stale in-memory leaves.

The current Runtime does not yet provide that guarantee. `SessionRuntime.loadSession()` calls writable
`SessionManager.open()` before any cross-process authorization, TUI and ACP retain writable managers while idle, and
`HostedSession` knows only its process-local ID and Pi Session Manager ID. A Workspace-only lock would prevent two
browser requests from racing but would not exclude TUI or ACP. The user therefore chose to include minimum TUI/ACP
participation for writable load and ordinary Session turns in this slice; slice 7 remains responsible for the exhaustive
mutation audit and richer handling of compaction, cancellation settlement, shell/tool recording, images, configuration,
and workflow operations.

Workspace also needs to render committed history without obtaining activation. A small read-only projection foundation
belongs here so a GET request never calls `SessionManager.open()` or changes the transcript merely to display it. Slice
6 will extend that foundation with incremental unseen-entry replay, committed-generation monitoring, draft preservation,
and automatic idle TUI synchronization.

Workspace continuation in this slice is deliberately conversation-only. It may continue an idle Ideator or Planner
conversation, but it must not expose materializing workflow tools, durable human gates, Plan review/execution, or
repository-changing operations before Durable Workflow Checkpoints and Plan Workflow Leases land. Existing TUI/ACP
workflows retain their current product behavior while participating in Session activation.

## Objective

Implement the first enforceable Session Activation Lease and committed-generation vertical slice so that:

- an enabled registered Project's stable RunWield Session is the coordination key, distinct from Pi and in-process
  Runtime IDs;
- Workspace, TUI, and ACP acquire fenced activation before writable hydration or an ordinary Session turn;
- Workspace accepts only a conversation-only turn and cannot materialize workflow, Plan, repository, or pending
  interaction effects in this slice;
- an idle cached Runtime is treated as non-writable after release and is rehydrated if another surface advanced the
  committed generation;
- a Session generation is published only after transcript bytes are durably settled and verifiable;
- paired Workspace clients can list eligible Sessions, inspect activation state, read a committed semantic timeline, and
  start one server-owned continuation without receiving a fencing token or filesystem locator;
- activation is released only at a safe idle checkpoint, while stale, interrupted, or transcript-ahead states block
  ordinary continuation and require later recovery; and
- unrelated Sessions remain independently activatable while same-Session races have exactly one winner.

This slice does not implement Durable Workflow Checkpoints, Plan Workflow Leases, automatic TUI synchronization,
complete Session UI, or silent takeover of an uncertain owner. Owner continuation remains disabled until the operator
explicitly enables the coordination protocol after stopping pre-v3 RunWield processes.

## Approach

Extend the owner database with a retained per-Session activation record and append-only committed-generation evidence.
Existing cataloged Sessions begin in an explicit `uninitialized` state with no committed generation. Their first managed
access performs a fenced, Agent-free bootstrap: acquire exclusively, verify a stable read-only transcript prefix, sync
and capture its terminal evidence, publish it as generation `0`, and release. New Sessions write only the unavoidable Pi
header before stable identity exists, then catalog, acquire, perform first Agent setup, publish generation `0`, and
release. Until bootstrap succeeds, timeline reads report `bootstrap_required` or complete the same server-owned
bootstrap; continuation never guesses baseline evidence.

A normal lease acquisition increments a monotonic fencing token and binds it to a process instance plus one operation
ID. Heartbeat, publication, no-change release, and failure marking use compare-and-set conditions over the stable
Session, Project, owner instance, operation, fence, phase, and expected committed generation. Releasing clears the live
owner but never deletes or resets the row. Expired heartbeat evidence moves the Session to `uncertain`; it never permits
automatic takeover.

Keep SQLite transactions short and synchronous. Improve pre-migration backup to use a WAL-safe SQLite checkpoint/
snapshot mechanism before v3 rather than copying only the main database file. Transcript work stays outside SQLite and
uses this order:

1. acquire activation with the caller's exact expected committed generation;
2. hydrate the writable manager and activate the Agent only after acquisition;
3. run the allowed Session turn while heartbeating and buffering semantic Runtime events;
4. wait for Runtime and Agent idle, dispose the writable manager, sync the exact cataloged transcript, and capture byte
   length, terminal entry ID, and a digest of the committed prefix;
5. insert the next generation and release in one fenced transaction; and
6. if canonical transcript effects exist but publication cannot be proven, never rerun the User Request—retain or mark
   reconcile-needed/uncertain state and report degraded status.

Extract existing replay shaping into a shared pure projection module. A strictly read-only JSONL reader validates the
cataloged path, reads only the byte prefix named by the latest generation, reconstructs the committed branch, and
verifies terminal evidence. Each projected event receives canonical `eventId = <entryId>:<eventKind>:<blockIndex>`;
existing `messageId` and `toolCallId` remain semantic grouping IDs, while `eventId` is the pagination/deduplication
cursor. An uncommitted live tail is ignored, but malformed or mismatched committed evidence fails closed. SQLite stores
only coordination and transcript evidence, never transcript text or event bodies.

Add an adapter-neutral activation coordinator to `SessionRuntime`. A Session is legacy-compatible only when it has
positively never been cataloged or activation-managed. Once managed, disabling/removing its Project or losing root
health blocks new mutation; it must never fall back to unmanaged writes. An already fenced owner may still checkpoint or
release after Project eligibility changes so authorization changes do not strand an active lease.

Represent an idle managed Session as a dormant Hosted Session shell with stable RunWield, Pi, and adapter identities
plus its last committed snapshot, but no writable manager or live Agent. Existing-session startup becomes read-only
locator resolution, catalog lookup/bootstrap, and committed projection. The first later turn acquires, hydrates, runs,
checkpoints, disposes, and returns to dormant state. New-session startup is split so manager/header creation precedes
cataloging, but Agent activation and all later writes occur only under the first fence. Direct mutation methods that
this slice does not adopt must fail closed on dormant managed Sessions; slice 7 will add complete fenced support.

Workspace owns continuation operations server-side rather than exposing acquire/heartbeat/release primitives to the
browser. It uses a conversation-only Runtime policy that removes materializing workflow/outcome tools, structured
interaction tools, shell/repository mutation, Plan actions, and execution. If an unexpected interaction or workflow
continuation is nevertheless requested, terminate the operation as unsupported and checkpoint only settled transcript
output; never leave an in-memory browser gate. Starting a continuation returns an opaque operation ID, survives browser
disconnection, and supports bounded authenticated polling. Device revocation closes that device's connection but does
not cancel the Runtime or release activation.

Because a pre-v3 process cannot honor the database, owner continuation is off by default. `wld workspace serve` requires
an explicit activation-protocol enable flag/acknowledgement stating that older RunWield processes have been stopped and
must not run concurrently. TUI and ACP in the new binary open one shared coordinator for their process lifetime. Full
version/process diagnostics may improve in slice 7, but slice 4 must not expose continuation without this rollout gate.

## Files to Modify

- `src/shared/owner-coordination/schema.js` and `database.js` — add ordered migration v3 for retained activation state
  and committed-generation evidence, including a WAL-safe upgrade snapshot plus existing foreign-key and newer-schema
  refusal behavior.
- `src/shared/owner-coordination/session-activations.js` — implement fenced acquire, inspect, heartbeat, phase change,
  publish-and-release, no-change release, and uncertain/reconcile-needed transitions with synchronous CAS transactions.
- `src/shared/owner-coordination/sessions.js` and `projects.js` — distinguish positively never-managed roots from
  cataloged-but-ineligible Sessions, resolve the stable Project/Session pair, and never auto-register Projects.
- `src/shared/owner-coordination/index.js` — expose typed JSDoc coordination methods while keeping SQLite handles and
  fencing tokens out of adapters and browser DTOs.
- `src/shared/session/session-transcript-projection.js` — host pure branch reconstruction and semantic replay projection
  with stable event IDs, reused by live Runtime replay and committed read APIs.
- `src/shared/session/root-session.js` — add guarded read-only committed-prefix parsing and transcript
  durability/evidence helpers without using `SessionManager.open()` on read paths.
- `src/shared/session/hosted-session.js` and `session-host.js` — retain distinct stable RunWield, Pi, and process-local
  identities plus current activation/generation metadata for Runtime assertions and stale-cache invalidation.
- `src/shared/session/session-runtime.js` and `session.js` — split manager creation from Agent activation, inject the
  activation coordinator, support dormant managed Sessions, gate writable hydration/turns, and reuse extracted
  projection without changing semantic event ownership.
- `src/ui/tui/chat-session.js` — replace writable `continueRecent()` startup for managed Sessions with read-only
  resolution/dormant adoption, use activation-aware turns, and show bounded ownership/reconciliation errors; automatic
  committed-history refresh remains slice 6.
- `src/acp/server.js`, `session-map.js`, and `src/cmd/acp/` — give the ACP process one coordinator/store lifetime, map
  transport IDs to dormant stable Sessions, and return invalid-state responses when activation is unavailable.
- `src/ui/workspace/server/session-continuation.js` — own the Workspace process/operation identities, Runtime lifetime,
  heartbeat, buffered operation progress, checkpoint publication, release, and shutdown behavior.
- `src/ui/workspace/routes/owner-session-api.js` and `owner-api.js` — add authenticated, Project-scoped Session DTO,
  timeline, continuation-start, and continuation-status handlers with shared bounded parsing and sanitized errors.
- `src/ui/workspace/server.js` and `src/cmd/workspace/serve.js` — compose one persistent continuation service, require
  explicit activation-protocol enablement, register routes, and drain safely without affecting other Workspace modes.
- `docs/usage.md` — document the rollout gate, stop/restart requirement for pre-v3 processes, supported continuation
  boundary, and recovery behavior.
- Focused `*.test.js` files beside the modules above plus `src/ui/workspace/owner-workspace.test.js` — cover migration,
  fencing, persistence order, projection, adapters, authentication, concurrency, and shutdown.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/owner-coordination/database.js` — reuse ordered migrations, `BEGIN IMMEDIATE`, busy timeout, and hidden
  database-handle conventions; replace unsafe main-file copying during a live WAL database upgrade with a supported
  SQLite checkpoint/snapshot and never run transcript I/O inside synchronous transactions.
- `src/shared/owner-coordination/sessions.js` — reuse the stable Session-to-Project/Pi-transcript mapping and guarded
  locator validation; whitelist browser DTOs because catalog records contain private absolute paths.
- `src/shared/owner-coordination/pairing.js` — follow its conditional-update/`changes === 1` CAS pattern for fenced
  activation transitions.
- `src/shared/session/session-runtime.js` `createReplayEvents()` — extract and reuse its semantic message, Agent, tool,
  usage, compaction, and workflow projection instead of creating Workspace-specific transcript parsing.
- `src/shared/session/root-session.js` `readCatalogSafeRootSessionLocator()` and path guards — reuse containment and
  header validation while extending the read-only path beyond the header only up to published committed evidence.
- `src/shared/session/session-runtime-events.js` — preserve the consumer-ready semantic Runtime event contract; owner
  routes project a safe subset rather than importing Runtime normalizers into Workspace.
- `src/ui/workspace/server/owner-auth.js`, `owner-projects.js`, and `owner-connections.js` — reuse paired-device/CSRF,
  enabled Project root authorization, and revocation-aware connection cleanup.
- `src/ui/workspace/routes/owner-api.js` — reuse `ownerJson`, sanitized error behavior, and bounded JSON parsing after
  centralizing the helpers needed by the new route module.
- `src/acp/session-map.js` and `src/ui/tui/runtime-adapter.js` — preserve existing adapter-facing identities and
  semantic rendering while adding activation metadata below them.

## Implementation Steps

- [ ] Upgrade owner persistence to schema v3. Before migration, create a WAL-safe SQLite snapshot/checkpoint instead of
      copying only the main file. Add `session_activation_state` with nullable generation for `uninitialized` Sessions
      and append-only `session_committed_generations` keyed by `(runwield_session_id, generation)`. Enforce the matching
      Session/Project pair, monotonic fence/generation values, legal states/phases, and unique active operation
      identity.
- [ ] Implement typed activation services with injectable clock/ID factories: inspect, bootstrap-acquire, normal
      acquire, heartbeat, phase change, publish-and-release, no-change release, and mark uncertain/reconcile-needed.
      Every write after acquisition matches Session, Project, owner instance, operation, fence, phase, and expected
      generation. Exact operation retries may be idempotent; stale proofs and other operations fail. Heartbeat expiry
      marks uncertain and never permits takeover.
- [ ] Define managed-state resolution independently from current Project eligibility. Positively never-cataloged roots
      may retain legacy behavior. Any Session with a stable catalog/activation record remains managed forever; disabled,
      removed, missing, unreadable, or relink-conflicted Projects reject new acquisition rather than falling back to an
      unmanaged writer. Permit only the current valid proof to checkpoint/release after eligibility changes.
- [ ] Implement generation bootstrap. Migration backfills existing stable Sessions as `uninitialized` without touching
      files. First managed read/turn acquires the bootstrap phase, captures the same stable transcript prefix before and
      after sync, publishes generation `0`, and releases without invoking an Agent. New-session setup creates the Pi
      header, catalogs it, acquires, activates the initial Agent under the fence, then publishes generation `0` and
      disposes. Concurrent or failed bootstrap returns typed `bootstrap_required`, ownership, or reconciliation status.
- [ ] Implement fenced checkpoints. After a changed turn, wait for Runtime and Agent idle, dispose the writable manager,
      open and sync the exact guarded locator, parse the settled prefix, and capture byte length, terminal entry ID, and
      digest. One transaction verifies the old generation/fence, inserts exactly the next generation, and releases. A
      no-change operation may release only after equal before/after evidence. Publication failure never retries the User
      Request and leaves recoverable reconcile-needed/uncertain evidence.
- [ ] Extract `createReplayEvents()` into a pure shared projection module. Preserve current semantic events,
      `messageId`, and `toolCallId`; add canonical `eventId = <entryId>:<eventKind>:<blockIndex>` as the committed
      cursor. Add a non-mutating JSONL parser that validates catalog containment/header identity, reads only the
      published byte prefix, reconstructs the terminal branch, verifies digest/evidence, bounds output, and ignores only
      bytes after the committed prefix. Malformed committed data fails closed.
- [ ] Extend `HostedSession`, `SessionHost`, Runtime snapshots, and results with separate RunWield Session, Project, Pi,
      Runtime, and adapter IDs. Add a dormant managed-session state that retains committed projection/snapshot data but
      owns no manager, Agent, interaction promise, or write proof. Ensure no locator, owner instance, operation ID, or
      fence leaks through public snapshots.
- [ ] Refactor Runtime startup ordering. Existing managed Session startup uses read-only catalog resolution/bootstrap
      and creates a dormant shell; it must not call `SessionManager.continueRecent()`/`open()` or activate an Agent. On
      a turn, acquire first, call `openPersistedRootSession()`, activate the Agent, run, checkpoint, dispose, and return
      to dormant. Split new manager/header creation from `switchAgent()` so TUI and ACP can catalog/acquire before Agent
      setup or the first User Request.
- [ ] Classify every public Runtime operation as read-only, adopted, nested-under-turn, or unsupported for dormant
      managed Sessions. This slice adopts existing load/start and ordinary TUI/ACP turns. Nested operations require the
      active turn's proof. Direct compaction, cancellation settlement, model/thinking changes, shell/tool recording,
      images, steering/queues, and workflow entry points fail closed without a proof; encode the classification in tests
      so slice 7 can add complete fenced behavior without reopening bypasses.
- [ ] Give TUI and ACP one owner-coordination store/coordinator per process and close it on shutdown. For registered
      Projects, replace current writable continue/load behavior with dormant adoption and use the activated turn path;
      catalog new transcript headers before first Agent setup. Preserve only positively unregistered Project behavior.
      ACP keeps transport IDs, maps the stable ID in RunWield metadata, and returns sanitized invalid-state errors for
      ownership/bootstrap/reconciliation conflicts.
- [ ] Implement a Workspace conversation-only Runtime policy. Permit text/image-free Ideator or Planner conversation
      while removing `plan_written`, execution/outcome tools, `user_interview`, shell/repository tools, Plan actions,
      and other materializing Custom Tools from that operation. Reject a Session already in workflow, execution, or
      pending interaction state. Treat any unexpected interaction/handoff into a disallowed workflow as unsupported,
      settle what is already durable, checkpoint safely, and never leave a pending browser continuation.
- [ ] Build `session-continuation.js` as a server-owned operation service over one Workspace Runtime. Validate stable
      Project/Session association and conversation-only eligibility, bootstrap when needed, acquire with a process plus
      opaque operation ID, subscribe before the turn, heartbeat, buffer bounded safe events, checkpoint/release, and
      retain terminal status for polling. Disconnect/revocation closes only that client. Shutdown drains proven idle
      operations; active work remains fenced and later becomes uncertain.
- [ ] Add owner Session routes: Session list/status, committed timeline with generation/event cursor, continuation
      start, and operation status. Require paired-device auth and CSRF on start, server-side enabled Project
      authorization, and exact `expectedGeneration`. Return `202` with an opaque operation ID, `409` for
      ownership/staleness/bootstrap races, and `503` for reconcile-needed or rollout-disabled state. Whitelist DTOs;
      omit roots, transcript/Pi/Runtime IDs, fences, owner IDs, raw tool arguments, and internal errors.
- [ ] Gate owner continuation startup behind an explicit `wld workspace serve` activation-protocol option. Without it,
      read-only Project/Plan behavior remains available but Session continuation routes report disabled. The option must
      warn that all pre-v3 TUI/ACP/Workspace processes must be stopped and cannot run concurrently. Document the
      rollout, managed/unmanaged boundary, conversation-only scope, and conservative recovery behavior in
      `docs/usage.md`.
- [ ] Add focused migration, coordination, projection, Runtime, TUI, ACP, Workspace service, route, and shutdown tests.
      Use two database connections and at least one subprocess race. Cover WAL-safe v2-to-v3 upgrade, legacy/new
      bootstrap, disabled managed Projects, startup ordering, exact durability/publication order, direct-mutator denial,
      one-winner races, unrelated Sessions, rollout gating, auth/CSRF, reconnect/revocation, and sanitized DTOs.

## Verification Plan

- Automated: run `deno task ci` and fix all failures.
- Automated: migrate a real temporary v2 WAL database with uncheckpointed committed pages; prove the v3 safety snapshot
  contains them, migration is ordered/idempotent, and newer-schema refusal remains non-mutating.
- Automated: use independent connections and a subprocess race to prove one same-Session winner, unrelated Session
  acquisition, monotonic fences/generations, exact-operation idempotency, stale-proof rejection, disabled-managed
  fail-closed behavior, and no automatic stale-owner takeover.
- Automated: cover existing and new Session bootstrap. Existing transcripts become generation `0` without Agent or JSONL
  mutation; new Sessions perform no Agent setup before catalog/acquire. Concurrent bootstrap converges, and failed or
  unstable evidence returns typed blocked/reconciliation state.
- Automated: instrument Runtime dependencies for
  `acquire -> writable open/Agent activation -> turn -> Runtime+Agent idle -> manager dispose -> exact-file sync/evidence -> generation publish+release`.
  Inject failure at each boundary and prove no duplicate Agent turn or database-ahead-of-transcript publication.
- Automated: byte-for-byte and modification-time tests prove list/status/timeline reads never call writable Pi APIs or
  modify JSONL. Timeline projection validates the committed prefix, ignores a later tail, rejects mismatched evidence,
  and emits stable `eventId` values across repeated reads and Runtime replay.
- Automated: adapter tests cover dormant TUI/ACP startup, process-scoped store cleanup, registered versus positively
  never-registered Projects, disabled managed Projects, ownership conflicts, ACP stable mapping, direct-mutator denial,
  and unchanged semantic event contracts.
- Automated: Workspace tests cover rollout-disabled `503`, paired-device auth, CSRF, Project/Session containment,
  conversation-only tool policy, expected generation, one-winner continuation races, reconnect polling, revocation
  without cancellation, shutdown, sanitized DTOs, and unchanged ephemeral/Shared Space authorization.
- Manual rollout/API check: stop other RunWield processes, start owner Workspace with explicit activation-protocol
  enablement, pair a browser, list a registered Project's Sessions, bootstrap/read one timeline, start an idle ideation
  continuation, and poll it to completion. Confirm generation advances and activation returns to idle; a second client
  using the old generation receives a conflict.
- Manual cross-surface check: open the same managed Session dormant in TUI, continue it through Workspace, then submit
  the next TUI User Request. The TUI must acquire and hydrate before writing; automatic display of the remote turn
  remains slice 6.
- Expected result: supported load/turn paths have one fenced writer, committed history is readable without writable
  hydration, transcript durability precedes publication, and unsupported/uncertain states block rather than bypassing or
  replaying effects.

## Edge Cases & Considerations

- **Interim enforcement boundary:** slice 4 classifies all public Runtime mutators and fails closed where support is
  deferred. Slice 7 owns seamless fenced implementations and root-write hardening, not discovery of bypasses left open
  here.
- **Generation bootstrap:** schema migration cannot derive filesystem evidence. Existing Sessions remain explicitly
  uninitialized until an exclusive Agent-free bootstrap publishes generation `0`; no API may treat nullable generation
  as an empty transcript or safe default.
- **Managed versus eligible:** once cataloged/managed, a Session never falls back to legacy mutation. Project disable,
  removal, health loss, or relink conflict blocks new acquisition while preserving the current owner's ability to settle
  and release.
- **Workspace scope:** remote turns are conversation-only. Plan materialization/review/execution, repository effects,
  structured interactions, and workflow continuation wait for slices 8, 9, and 12; TUI/ACP keep existing workflows under
  Session activation.
- **Upgrade boundary:** an already-running old binary cannot be fenced retroactively. Continuation therefore requires an
  explicit rollout acknowledgement after old processes are stopped; operators must not restart incompatible binaries
  concurrently.
- **Heartbeat age:** expiry never proves an interrupted model call, command, tool, or filesystem effect is safe to
  repeat. No takeover or recovery endpoint is added here.
- **Transcript ahead of SQLite:** if the turn is durable but publication fails, never append or invoke it again. Report
  reconcile-needed/uncertain state even when SQLite is temporarily unavailable.
- **SQLite ahead of transcript:** durability order and terminal evidence must prevent this. Detection makes timeline
  reads fail closed instead of presenting absent content.
- **Dormant Runtime:** safe-idle release disposes the writable manager and Agent while retaining adapter/stable identity
  and committed projection. The next mutation always acquires and hydrates anew.
- **Read while active:** timeline readers use only the last published prefix. They may show the prior generation while a
  turn is live and label the owning surface without exposing owner identity.
- **Branch and malformed tail:** committed evidence names one terminal branch. Ignore bytes after the prefix, but never
  skip malformed data inside it or guess another leaf.
- **Browser disconnect and revocation:** neither cancels a turn nor releases activation. The server operation continues
  to a safe checkpoint; reconnect falls back to committed history if its in-memory buffer is gone.
- **Process shutdown:** release only Sessions proven idle and checkpointed. A killed owner leaves fenced stale state
  that becomes uncertain; cleanup must not claim safety it cannot prove.
- **Database loss:** source, Plans, and Session Transcripts survive, but activation/generation identity is not guessed.
  Reconstruction treats potentially active work conservatively.
- **Path and content privacy:** DTOs omit roots, locators, Pi/Runtime IDs, fences, owner IDs, and internal errors.
  Session text remains owner-private content; raw tool arguments/details stay outside this narrow timeline.
- **No adapter inversion:** TUI and ACP consume shared coordination/Runtime services and never import Workspace routes.
  Workspace remains a sibling Runtime consumer, not a central proxy.
- **Slice handoff:** slice 6 extends this reader with unseen-entry synchronization rather than adding a second parser;
  slice 7 completes mutator support without replacing this fencing contract.
