---
planId: "7c2a6b78-6dbd-4e78-8979-fbe3aa49621e"
classification: "FEATURE"
complexity: "HIGH"
summary: "Replace the managed-Session compatibility gate with one fenced mutation boundary covering TUI, Workspace, ACP, standalone commands, writable hydration, cancellation, compaction, configuration, images, shell execution, and Runtime workflow operations."
affectedPaths:
    - "src/shared/owner-coordination/session-activations.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session-host.js"
    - "src/shared/session/root-session.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/session-runtime-interactions.js"
    - "src/shared/session/session.js"
    - "src/shared/session/agent-handler.js"
    - "src/shared/session/agent-switching.js"
    - "src/shared/session/active-agent-session.js"
    - "src/shared/session/workflow-context-session.js"
    - "src/shared/session/workflow-messages.js"
    - "src/shared/session/architecture-boundary.test.js"
    - "src/shared/workflow/"
    - "src/tools/pair-checkpoint.js"
    - "src/ui/tui/"
    - "src/acp/server.js"
    - "src/acp/session-map.js"
    - "src/cmd/acp/"
    - "src/cmd/init/"
    - "src/cmd/resume/"
    - "src/cmd/new/"
    - "src/cmd/reload/"
    - "src/cmd/name/"
    - "src/cmd/compact/"
    - "src/cmd/settings/"
    - "src/cmd/agents/"
    - "src/cmd/quit/"
    - "src/cmd/load-plan/"
    - "src/cmd/sleep/"
    - "src/cmd/plans/pull.js"
    - "src/ui/workspace/server/session-continuation.js"
    - "docs/usage.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-21T23:56:51-04:00"
updatedAt: "2026-07-26T21:08:48.832Z"
status: "implemented"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 7
dependencies:
    - "06-read-only-transcript-projection-and-idle-tui-sync"
failureReason: "CI validation failed after 3 repair attempts."
worktreeStatus: "validation_failed"
---

# Activation Enforcement Hardening Across Adapters

## Context

Verified slices 4 and 6 now provide the Personal Workspace activation foundation: owner protocol acknowledgement, stable
RunWield Session IDs, fenced Session Activation Leases, exact transcript evidence, committed Session generations,
managed dormant Hosted Sessions, activation-aware ordinary turns, non-mutating transcript projection, and automatic idle
TUI synchronization. Slice 4 intentionally left most direct managed mutators unsupported until this feature.

The current compatibility gate is not sufficient as a final safety boundary. `SessionRuntime` rejects many public
mutators only when a managed Hosted Session is dormant; once another operation has installed a writable manager, an
unrelated public call can use it without proving that it belongs to the active operation. Other methods—including image
persistence, shell execution/recording, thinking changes, interaction requests, cancellation, close, and resumable
Session inspection—either have no managed guard or can construct/use writable Pi state before activation. ACP also
constructs an owner-unaware Runtime in its stdio entry point and prompts through `promptSession()`, while standalone
`wld init` creates an owner-unaware Runtime. `closeSessionWhenIdle()` waits for the inner Agent turn but not the outer
activation operation that dehydrates, synchronizes, and publishes the generation.

ADR-011 remains controlling: TUI, Workspace, and ACP are sibling `SessionRuntime` consumers; only one process may
hydrate or mutate a stable Session; every safe hydrated operation publishes a committed Session generation; heartbeat
loss or uncertain effects fail closed; and positively unregistered Projects retain legacy behavior. This feature secures
Session/transcript mutation and current in-memory continuation. Slice 8 owns Durable Workflow Checkpoints and restart-
safe interaction outcomes. Slice 9 owns Plan Workflow Leases and cross-Session exclusivity for Plan Lifecycle,
validation, worktree, and recovery effects.

## Objective

Replace the slice 4 managed-mutator compatibility gate with comprehensive activation enforcement so that:

- every public `SessionRuntime` method has an explicit, test-enforced classification: read-only, non-mutating
  projection/adapter state, managed initialization or adoption, fenced standalone mutation, nested-only mutation under
  the current activation operation, cancellation/cleanup, or unmanaged-only compatibility;
- except for slice 4's unavoidable initial Pi header creation, a managed writable Pi Session Manager is created, opened,
  retained, or used only after acquiring the Session Activation Lease and verifying the expected committed generation
  and exact transcript evidence; the header-only path catalogs and acquires before Agent setup or any further mutation;
- manager presence, Runtime busy state, or an active lease cannot authorize a second public mutator—the active operation
  must hold an unexported operation-scoped capability;
- managed rename, Agent/model/thinking changes, reload, manual compaction, local shell execution/optional transcript
  exchange, image-backed submission, initialization, ordinary turns, and Runtime workflow operations either complete
  through one fenced generation checkpoint or fail before Session/transcript mutation;
- steering, queues, interactions, Agent handoffs, auto-compaction, workflow calls, and cancellation that occur inside an
  active operation use only that operation's authority and are fully settled before publication;
- TUI, Workspace, ACP, and standalone Session commands compose the same owner-aware Runtime boundary, report sanitized
  blocked/stale states, and cannot bypass activation through adapter-specific paths;
- close, replacement, cancellation, and process shutdown wait for the complete outer activation operation rather than
  disposing a manager or Hosted Session after `TURN_END` but before generation publication; and
- stale fences, expired heartbeats, database epoch/protocol mismatch, transcript-ahead/database-ahead evidence,
  registered-root catalog ambiguity, and older-process rollout uncertainty remain conservative and cannot poison a newer
  owner or silently fall back to unmanaged mutation.

Durable checkpoint tables, exact-once cross-process interaction consumption, Plan Workflow Lease schema/enforcement,
automatic takeover, and replay of interrupted model/tool/filesystem effects are out of scope.

## Approach

Refactor the existing `promptManagedSession()` sequence into one private Runtime-owned managed operation executor. It
accepts a closed set of named operation descriptors, obtains the expected generation, acquires activation, verifies the
entire guarded transcript before hydration, starts a monitored heartbeat, optionally hydrates and activates the Agent,
runs the operation, settles cancellation/interactions/queues, dehydrates every writable reference, synchronizes the
canonical transcript, captures exact evidence, and publishes/releases the next generation. Failure before hydration may
release unchanged only after re-proving unchanged evidence; failure after hydration or an uncertain side effect marks
the current fenced operation uncertain without replay or takeover.

Create an unexported operation capability bound to Runtime Session ID, stable RunWield Session ID, operation ID, fence,
and lifetime. Managed public methods may start a named standalone operation, or reject when another operation is active;
they must not infer authority from a live manager. Nested Agent/workflow helpers receive only a capability-bound
internal facade/closure and cannot manufacture authority. `HostedSession` enforces this boundary for installing or using
writable manager/Agent/workflow state, while read synchronization retains its separate non-mutating projection
authority. `SessionHost` maintains one live Hosted Session shell per stable RunWield Session ID in a Runtime.

Use a complete method-classification matrix rather than scattered guards:

- **Read-only:** snapshots, keyboard help, context/config listings, and other methods that do not touch Pi writable
  APIs. Managed resumable listing/inspection/export must use owner catalog plus exact-prefix projection/read helpers; in
  particular, token inspection must not call writable `SessionManager.open()`, list/continue, or migration APIs.
- **Projection/adapter-local:** event subscription, committed synchronization, and installing an interaction adapter may
  remain lease-free, but they cannot create a writable manager, launch an interaction, change committed summary state,
  or leak activation proof details.
- **Fenced standalone mutation:** rename, Agent/model/thinking application, reload, manual compaction, initialization,
  local shell execution/optional tool exchange, and named workflow actions acquire their own activation and publish a
  generation. Persisting user preferences in settings is kept distinct from claiming that managed Session configuration
  changed.
- **Nested-only mutation:** steering and queue changes, image persistence for an accepted User Request, handoffs,
  auto-compaction, workflow sub-operations, and in-memory structured interactions are permitted only inside the current
  operation capability. For managed image paste, TUI retains/preflights the raw attachment and persists it only after
  the submission wins activation. Every arbitrary local shell spawn acquires before execution because `persist: false`
  cannot prove that a command is filesystem-read-only; a future unfenced diagnostic path would need a closed,
  mechanically read-only command set.
- **Cancellation/cleanup:** cancellation targets the current operation controller and lets that operation perform
  settlement and checkpointing. Close/replacement/shutdown await the full managed-operation promise; forced loss after
  possible effects leaves uncertainty rather than disposing and claiming an idle checkpoint.

Harden `session-activations.js` so every Runtime-driven uncertain or reconcile-required transition from an active state
uses full proof/fence compare-and-set semantics. A stale process cannot mark a newer activation unhealthy. Heartbeat
failure is latched into the operation, aborts cancellable work, and prevents later phase/publication calls from being
mistaken for success. Preserve the existing activation protocol marker and database epoch as the pre-v3 rollout gate; do
not invent unsafe detection of invisible legacy processes.

Resolve managed versus unmanaged status before any Pi hydration. A Session under a current or historical registered
Project root, including nested working directories and uncataloged/missing-path load requests, must catalog or return a
typed blocked result. It must never fall through to the unmanaged open path. Only positive owner-coordination evidence
that a Project has never been managed preserves legacy behavior.

Update each adapter without introducing dependencies among them. TUI routes mutable slash commands and submission
through named Runtime operations, preserves slice 6 draft/sync behavior, and keeps pasted images in memory until
activation. ACP composes one owner store and owner-aware Runtime for the full stdio process, retains stable RunWield
Session ID/generation in its transport mapping, subscribes before request acceptance, chooses managed versus unmanaged
prompting correctly, maps activation failures to sanitized `ACP_INVALID_STATE`, and closes owned resources. Workspace
keeps its existing receipt/continuation service but delegates mutation safety to the common Runtime executor. Standalone
`init` and related command-created Runtime paths compose owner coordination and use the same classification.

## Files to Modify

- `src/shared/session/session-runtime.js` — add the managed operation executor, operation-scoped authority, exhaustive
  public-method classification, full-operation settlement tracking, managed read alternatives, and fenced
  implementations for deferred mutation families; remove manager-presence authorization.
- `src/shared/session/hosted-session.js` — track private managed operation lifecycle, assert authority for writable
  manager/Agent/workflow mutations, strengthen dehydration, and keep dormant projection metadata separate from active
  mutation state.
- `src/shared/session/session-host.js` — enforce one Hosted Session shell per stable RunWield Session ID and release the
  mapping only after safe disposal.
- `src/shared/owner-coordination/session-activations.js` — make uncertain/reconcile transitions proof-aware and fenced,
  surface heartbeat loss to the operation, and preserve monotonic activation/generation behavior.
- `src/shared/session/root-session.js` and `session-transcript-projection.js` — provide non-mutating managed Session
  inspection/export/context estimation and guarded locator classification before any Pi writable open/list/continue API.
- `src/shared/session/session-runtime-interactions.js` — require the active operation authority for managed in-memory
  interaction requests and cancellation while preserving current adapter semantics; durable records remain slice 8.
- `src/shared/session/session.js`, `agent-handler.js`, `agent-switching.js`, `active-agent-session.js`,
  `workflow-context-session.js`, and `workflow-messages.js` — route nested manager/Agent/transcript mutation through the
  capability-bound Runtime facade and remove raw managed-state bypasses.
- `src/shared/workflow/` and `src/tools/pair-checkpoint.js` — propagate only scoped Session operation authority through
  current in-memory workflow and interaction paths without adding durable checkpoints or Plan Workflow Leases.
- `src/shared/session/architecture-boundary.test.js` and focused Session tests — enforce sibling adapters, hidden
  manager/proof/capability boundaries, method classification, stable managed identity, and dehydration invariants.
- `src/ui/tui/chat-session.js`, `bash-interceptor.js`, `slash-dispatch.js`, `model-welcome.js`, `runtime-adapter.js`,
  and `managed-session-sync.js` — route all managed mutations through Runtime, retain raw pasted images until accepted,
  coordinate submit/sync/cancel/close races, preserve drafts, and render sanitized blocked states.
- `src/acp/server.js`, `session-map.js`, and `src/cmd/acp/` — fix owner-aware Runtime/store composition, stable Session
  mapping, pre-acceptance subscriptions, managed prompting, cancellation/close settlement, error mapping, and cleanup.
- `src/cmd/init/`, `resume/`, `new/`, `reload/`, `name/`, `compact/`, `settings/`, `agents/`, `quit/`, `load-plan/`,
  `sleep/`, and `src/cmd/plans/pull.js` — preflight managed state before side effects and invoke named fenced Runtime
  operations instead of direct manager/Hosted Session mutation, raw `promptSession()`, or owner-unaware Runtime
  construction.
- `src/ui/workspace/server/session-continuation.js` — consume the generalized managed operation result and retain
  idempotent receipts/event buffering without duplicating activation logic.
- Focused `*.test.js` files beside all modules above — cover each mutation family, independent-process races, failure
  injection, adapter behavior, and unmanaged compatibility.
- `docs/usage.md` — replace the slice 4 unsupported-mutator rollout list with supported fenced behavior,
  blocked/recovery semantics, and ACP/TUI/standalone compatibility guidance.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime.js` `promptManagedSession()` — extract and generalize its
  acquire/evidence/hydrate/settle/dehydrate/fsync/publish sequence rather than creating one lock wrapper per adapter.
- `src/shared/owner-coordination/session-activations.js` activation proof and generation APIs — preserve the accepted
  state machine and strengthen proof-aware failure transitions instead of adding a second lock mechanism.
- `src/shared/session/session-transcript-projection.js` `projectCommittedTranscript()` and committed cursor helpers —
  reuse exact-prefix parsing for read-only inspection, export, context estimation, and post-commit acknowledgement.
- `src/shared/session/hosted-session.js` `dehydrateManagedSession()` — extend the existing dormant-shell lifecycle to
  clear Runtime-owned queue/interaction/authority references as well as manager and Agent state.
- `src/ui/tui/managed-session-sync.js` and `runtime-adapter.js` — preserve slice 6 synchronization, stable event dedupe,
  ownership status, and draft-safe refresh around the stronger mutation boundary.
- `src/acp/session-map.js` — extend the existing ACP-to-Runtime mapping with stable managed identity/generation rather
  than exposing owner database records to ACP clients.
- `src/ui/workspace/server/session-continuation.js` — retain server-owned request receipts, subscriptions, heartbeats,
  and event buffers while delegating the generalized mutation transaction to Runtime.
- Existing same-session exclusion, cancellation settlement, busy-operation, and architecture-boundary tests — adapt
  these contracts so presentation busy state is not confused with activation authority.

## Implementation Steps

- [ ] Verify the execution base contains the verified slice 4/6 contracts: owner activation protocol and epoch,
      activation/generation services, exact-prefix projector, managed dormant adoption and prompting, stable projected
      event IDs, `refresh_required`, and idle TUI synchronization. Stop for dependency integration if any are missing;
      do not recreate or weaken them.
- [ ] Build a checked-in method-classification table/test for every `SessionRuntime` prototype method. Classify each as
      read-only, projection/adapter-local, initializer/adopter, fenced standalone mutation, nested-only mutation,
      cancellation/cleanup, or positively unmanaged compatibility; make the test fail when a new public method is added
      without an explicit policy.
- [ ] Generalize `promptManagedSession()` into a private named managed-operation executor with expected-generation
      validation, one same-Session operation in flight, acquisition before hydration/effects, exact pre-hydration
      evidence comparison, monitored heartbeat, operation phases, cancellation, dehydration, file/directory sync,
      evidence capture, generation publication, and conservative failure handling. Preserve slice 4's sole creation
      exception: create only the initial Pi header, catalog it, then acquire before Agent setup or further mutation.
      Keep accepted User Request/events after activation and before the corresponding effect.
- [ ] Add an unexported operation-scoped capability and capability-bound internal helpers. Reject public managed
      mutation during another operation even while its manager is live; allow only the operation's nested Agent,
      workflow, steering, queue, compaction, image, interaction, and settlement calls. Do not expose proof, fence,
      operation ID, transcript locator, manager, or capability through events, snapshots, adapters, or callbacks.
- [ ] Harden Hosted Session and Session Host invariants. Assert authority around writable manager/Agent/workflow state,
      prevent duplicate shells for one stable Session in a Runtime, and make dehydration remove manager, root/sub-Agent
      Sessions, handlers, queue sources/messages, active interactions, subprocess cancellation handles, turn state,
      workflow execution state, subscriptions that retain writable sources, and operation authority before publication.
- [ ] Make heartbeat and failure transitions fully fenced. Latch heartbeat failure, abort cancellable work, prevent
      stale publication, and require complete current proof for active-to-uncertain/reconcile-required updates. Add a
      separate explicit administrative/recovery seam for future slices rather than allowing an unfenced Runtime update.
- [ ] Resolve managed identity before Pi access. Cover current/historical registered roots, nested cwd values,
      uncataloged transcripts, omitted or stale `sessionPath`, locator conflicts, disabled/moved Projects, missing
      activation rows, protocol/epoch mismatch, and bootstrap-required state. Only positively unregistered Projects may
      use legacy Session Manager open/create/list behavior.
- [ ] Replace writable managed inspection paths. Implement resumable token/model/message inspection and export from the
      committed exact prefix without Pi writable open/list/continue/migration calls; keep synchronization and inspection
      byte/mtime neutral and reject malformed, truncated, transcript-ahead, or database-ahead evidence. For every method
      classified read-only—including Session info/context/last-assistant text/memory-backup location, replay, export,
      and share consumers—return committed-prefix data or a typed unsupported result rather than silent empty/stale
      data.
- [ ] Convert committed configuration mutators to fenced operations: Session rename, Agent switch, model/provider
      change, thinking-level change, and reload/rebuild. Emit durable Session-state changes only after successful
      application/checkpoint and restore/refresh UI state when activation loses a race. Persist project-wide
      auto-compaction preferences without hydrating a managed Session; apply them to a live Agent only inside the
      current operation or on its next activation.
- [ ] Convert manual compaction and resume-before-compaction to the common managed operation. Acquire before writable
      inspection/hydration, keep activation through compaction settlement and transcript rewrite, publish one
      generation, and route abort/failure after possible rewrite to uncertainty rather than silently resuming or
      retrying.
- [ ] Move managed image persistence inside the accepted submission operation. TUI paste performs only in-memory
      retention and non-mutating preflight; activation rejection preserves the exact raw attachment/draft, while a
      winning operation persists each image once before prompting and includes it in the resulting checkpoint.
- [ ] Fence every arbitrary local shell command before process spawn, including `persist: false`; shell persistence
      controls transcript recording, not filesystem safety. Hold activation through command completion, cancellation,
      optional transcript exchange recording, and publication, and reject before command execution when blocked. Add no
      unfenced shell carve-out unless it is a closed, mechanically read-only diagnostic API.
- [ ] Route initialization and workflow operations through named managed operations. Make standalone `wld init`,
      `/sleep`, `plans pull`, and all command-created Runtime paths owner-aware; preflight before memory/remote/Plan or
      transcript effects; hold Session activation through current in-memory interactions and nested execution/validation
      work. Do not add Durable Workflow Checkpoints or Plan Workflow Lease checks in this slice.
- [ ] Make managed Epic child continuation a two-operation handoff: fully dehydrate and publish the source Session
      first, then create/catalog and activate the destination Session with a distinct capability. Never close/replace
      the source or mutate the destination while source checkpoint publication is pending, and never reuse source
      authority for the destination.
- [ ] Rework cancellation, close, Session replacement, and shutdown around the outer managed-operation promise. A cancel
      signals only the current operation, settles Agent/compaction/shell/interactions/queues, then lets the owner
      publish or mark uncertainty. Close and adapter disconnect wait through dehydrate/fsync/publication and never make
      a possibly active Session appear safely idle.
- [ ] Update TUI command/submission composition and slice 6 synchronization races. Ensure stale or active-elsewhere
      results append no accepted User Request, preserve exact text/images/history/focus, refresh committed state, and
      require explicit resubmission. Keep ownership/protocol messages sanitized and positively unmanaged TUI behavior
      unchanged.
- [ ] Fix ACP process composition and mapping. Open one owner store, construct one owner-aware Runtime, retain stable
      RunWield Session ID and generation behind each ACP ID, subscribe before invoking a prompt, select
      `promptManagedSession`/generalized operation for managed Sessions, map blocked/stale/uncertain/unsupported
      outcomes to `ACP_INVALID_STATE`, and await full operation settlement before close/connection cleanup.
- [ ] Update Workspace continuation to consume the common managed operation without duplicating proof logic. Preserve
      Ideator-only capability restrictions, idempotent receipts, browser-disconnect behavior, event buffering, and owner
      authorization from slice 4.
- [ ] Add focused unit, integration, subprocess, fault-injection, and adapter tests; update usage documentation; run the
      full quality gate and fix every failure.

## Verification Plan

- Automated: run focused tests beside owner coordination, Session Runtime/Host/Hosted Session, transcript projection,
  TUI, ACP, Workspace continuation, and each affected command while developing; then run `deno task ci` and fix all
  failures.
- Automated: enumerate `SessionRuntime.prototype` and prove every public method has exactly one classification. Canary
  tests must fail if a managed mutator accesses a manager, Agent, transcript, queue source, interaction, or workflow
  state without the current operation capability.
- Automated: instrument Pi Session Manager create/open/list/continue/migration APIs and transcript bytes/mtime. Apart
  from the initial header-only creation exception, managed list, inspection, export, projection, stale refresh, and
  blocked mutation call none of those writable APIs and make no filesystem or generation change. Exercise every
  read-only classification while dormant and prove it returns committed-prefix data or a typed unsupported result with
  no locator/proof leakage. Writable APIs are invoked only after successful acquisition and exact evidence validation.
- Automated: race independent stores/processes across ordinary prompt, rename, Agent/model/thinking change, reload,
  compaction, local shell, image submission, initialization, and workflow operations. Exactly one same-Session operation
  wins; public re-entry while the winner's manager is live is rejected; unrelated Sessions and Projects remain
  concurrent.
- Automated: inject failure before/after acquisition, evidence validation, hydration, Agent activation, command spawn,
  image write, interaction wait, cancellation, compaction rewrite, operation settlement, dehydration, fsync, evidence
  capture, SQLite publication, and close. Pre-hydration unchanged failures release only after proof; possible committed
  or external effects become uncertain; no User Request, command, tool, or filesystem effect is replayed automatically.
- Automated: expire or invalidate heartbeat/fence during each active phase. Cancellable work is signaled, generation
  publication fails closed, and a stale process cannot mark a later owner uncertain or reconcile-required.
- Automated: after every successful managed operation, prove exactly one next generation, exact transcript evidence,
  dormant manager-free state, no active Agent/handler/subagent/queue/interaction/subprocess/operation capability, and no
  duplicate live/projected semantic event or notification.
- Automated: cover current and historical registered roots, nested cwd, omitted/mismatched path, uncataloged transcript,
  moved/disabled Project, missing activation row, protocol marker mismatch, replaced database epoch, bootstrap-required,
  transcript-ahead, database-ahead, truncation, malformed JSONL, and locator conflict. All managed evidence fails closed
  without unmanaged fallback or private path/proof leakage.
- Automated: TUI tests paste multiple raw images, preserve multiline whitespace-sensitive drafts/history/focus, lose an
  activation race, synchronize, and explicitly resubmit once. Rejected images create no file; accepted images persist
  once under the winning operation. Model/thinking/name UI changes appear durable only after checkpoint success.
- Automated: every arbitrary shell rejection occurs before subprocess spawn; successful/canceled commands hold
  activation through optional exchange recording and publication. `persist: false` records no transcript exchange but
  remains fenced and cannot retain an active interaction after return.
- Automated: compaction tests cover resume estimation without writable open, successful transcript rewrite,
  cancellation, write failure, heartbeat loss, and close during checkpointing. No path silently falls back to
  uncompacted managed resume after a possibly partial rewrite.
- Automated: ACP tests cover managed new/load/prompt/cancel/close, pre-acceptance subscription ordering, stable identity
  and generation updates, same-Session contention with TUI/Workspace, sanitized `ACP_INVALID_STATE`, connection loss,
  and owned Runtime/store cleanup while preserving JSON-RPC framing and unmanaged behavior.
- Automated: standalone `init`, `/sleep`, `plans pull`, `/load-plan`, and other mutable command tests prove owner-aware
  Runtime composition, preflight before command/workflow effects, full-operation close settlement, and unchanged
  behavior in positively unregistered Projects.
- Automated: managed Epic continuation publishes and releases the source generation before destination activation,
  assigns distinct stable Session identity/authority, survives failure between those phases without a false replacement,
  and rejects same-destination races without reusing the source capability.
- Manual cross-surface: open the same managed Session in TUI and ACP/Workspace, race prompts and one configuration
  change, and verify one surface wins while the others remain synchronized readers, preserve drafts, and can retry after
  the committed checkpoint.
- Manual mutation journey: on a managed Session perform rename, model/thinking change, image-backed User Request,
  persistent `!` shell command, manual compaction, and a Plan-loading workflow. After each safe idle point, verify the
  generation advances, another surface reflects committed state, and no writable Runtime remains hydrated.
- Manual cancellation/shutdown: cancel a long Agent turn, shell command, and compaction, then close the owning ACP/TUI
  surface during settlement. Verify close waits for safe publication or reports blocked recovery; it never exposes a
  false idle state or duplicates an effect.
- Expected result: every managed writable path shares one fenced Runtime boundary, one same-Session writer exists across
  TUI/Workspace/ACP/commands, safe operations end at exact committed generations, and ambiguous effects remain blocked
  for explicit recovery.

## Edge Cases & Considerations

- **Session activation versus Plan ownership:** holding Session activation serializes one Session's transcript and
  active work; it does not stop another Session from driving the same Plan. Slice 9 adds the separate Plan Workflow
  Lease.
- **In-memory interactions versus Durable Workflow Checkpoints:** this slice may hold activation while a live Runtime
  waits and may cancel/settle that wait. It does not make the interaction restart-safe or exactly-once across process
  loss; slice 8 owns that state machine.
- **Fencing cannot undo side effects:** a fence prevents stale coordination publication, not a shell command, tool,
  model request, compaction rewrite, image write, or Plan effect already started. Heartbeat loss after such a boundary
  is uncertain and never authorizes automatic replay/takeover.
- **Manager presence is not authority:** a managed manager exists transiently inside one operation. Public calls during
  that window must still reject unless reached through the bound internal capability.
- **Initial managed creation:** Pi requires creation of the initial transcript header before owner coordination can
  catalog its locator. This remains the one narrow pre-acquisition write: no Agent setup or subsequent mutation occurs
  until catalog and activation succeed.
- **Hydrated no-op operations:** ADR-011/slice 4 require every safely checkpointed hydrated operation to publish the
  next generation even when transcript bytes are unchanged. Only a proven pre-hydration abandonment may release
  unchanged.
- **Persistent versus non-persistent shell:** `persist` controls transcript exchange recording, not whether an arbitrary
  command can change files. Every shell spawn is fenced; any future unfenced diagnostics must expose a closed,
  mechanically read-only operation rather than accepting arbitrary shell text.
- **Configuration preferences:** settings persistence and committed Session model/Agent/thinking state are different
  effects. A local preference may be saved independently, but adapters must not announce a managed Session state change
  until its fenced operation commits.
- **Image draft safety:** pasted image bytes may be large, but keeping them as bounded attachment drafts until
  submission is safer than creating an orphaned Session file before activation. Preserve slice 6 exact draft
  restoration.
- **Close semantics:** browser/ACP/TUI disconnection is not cancellation by itself. Explicit cancellation signals the
  owner; resource disposal waits for the outer activation operation or leaves durable uncertainty.
- **Read-only really means non-mutating:** Pi list/open/continue may migrate or rewrite. Managed observation, resume
  estimation, and export must use direct exact-prefix readers even if the current Pi API appears read-like.
- **Legacy coexistence:** the existing owner protocol marker/database epoch remains the explicit operator
  acknowledgement that incompatible processes were stopped. Registered or historically registered roots fail closed when
  evidence is incomplete; only positive unmanaged evidence keeps legacy behavior.
- **Adapter boundaries:** TUI and ACP must not import Workspace application services. Adapters receive sanitized
  operation outcomes and semantic events, never owner database handles, proofs, managers, or operation capabilities.
- **No takeover/recovery UI in this slice:** `uncertain` and `reconcile_required` remain visible blocked states. Future
  recovery must use explicit evidence and user judgment rather than heartbeat age alone.
- **Language and implementation:** use canonical Session, Session Transcript, Session Activation Lease, Session
  generation, TUI, Workspace, and ACP terms from `CONTEXT.md`/ADR-011. Implement executable code as JavaScript with
  JSDoc typedefs; do not add TypeScript outside the permitted Workspace subtree.
