---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/session-attention.ts"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-runtime-interactions.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/system-notifications.ts"
    - "src/ui/workspace/server/session-attention.ts"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/routes/owner-session-api.js"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/layouts/WorkspaceLayout.astro"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/workspace/react/BrowserNotificationPermissionControl.tsx"
    - "src/ui/workspace/browser/session-tab-notifications.ts"
    - "src/ui/workspace/static/workspace.css"
    - "docs/domain-language.md"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-09-03T00:53:56.723Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v2"
order: 2
dependencies:
    []
planId: "46942300-8b9c-4af5-bdaf-1b69ea39be34"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
---

# Durable Session Attention and Browser Tab Notifications

## Context

Session Runtime emits `attention_requested` when an Agent stops, and the TUI turns that event into a terminal
notification. The live event is sent from `createAgentHandler` before `SessionRuntime.#runManagedOperation` syncs the
Session Transcript and publishes its generation. It has no stable attention identity, stable RunWield Session ID, or
committed generation. Production does not write or resolve `runwield.attention`; only projection tests construct the
preliminary entry shape.

That order cannot support Workspace. A TUI-owned Session can run in another process, an idle Workspace Session page does
not continue to poll, and a tab can refresh or reconnect after the live event. Workspace needs committed evidence that
survives those cases without becoming the writer or a second workflow authority.

The parent Epic settles the product behavior. V2 sends browser notifications only for `agentStopped`. Each loaded
Session tab watches only its exact Session. A focused, visible tab showing that Session suppresses the browser system
notification in every duplicate copy. Otherwise, one loaded background copy sends it and clicking it focuses that exact
tab. Different Sessions can notify independently. No loaded tab means no delivery promise. There is no notification
center or other in-app notification state.

The owner selected one Workspace-wide permission control in the shared Workspace header. Browser permission applies to
the origin, not to one Session, so a Session-sidebar control would give the wrong impression. The control does not
appear in the local Plan Board shell. Child Plan 03 must preserve it when it changes Workspace navigation.

## Objective

- Commit versioned Session Attention request and resolution records in the same shared managed-operation transaction
  used by TUI, Workspace, and Agent Client Protocol (ACP). Each request contains one stable attention ID, `agentStopped`
  reason, stable RunWield Session ID, Agent and Session labels, recorded time, and the generation that commits it.
- Publish live `attention_requested` only after that generation is durable. TUI notification behavior continues from the
  post-commit event; Workspace can recover the same attention from committed Session evidence without seeing the live
  event.
- Resolve an exact outstanding attention ID in the generation that commits the next accepted user response or accepted
  interaction result. Refresh, reconnect, process restart, and a later response cannot revive resolved attention.
- Give each loaded Workspace Session screen an authenticated, Session-specific stream of committed attention changes,
  including changes produced by another process while the screen initially believes the Session is idle.
- Add a compact Workspace-header bell that requests browser permission only from its click and reports enabled, blocked,
  or unavailable state. Permission denial and unsupported browser capabilities do not affect Session Attention.
- Coordinate duplicate tabs in the browser so one stable attention ID produces at most one system notification or one
  focused-tab suppression result. Clicking a notification focuses the loaded Session tab that created it.

## Approach

Put durable meaning in Core and keep notification delivery in adapters.

```text
Agent Handler finishes
  returns agentStopped attention intent; it does not publish the event
SessionRuntime managed operation
  reads prior unresolved Session Attention
  commits matching resolution when this operation accepted a response
  appends the new runwield.attention request with nextGeneration
  syncs transcript and publishes nextGeneration
  emits attention_requested with the same stable ID and committed generation
    TUI -> terminal notification
    Workspace server -> also discoverable from committed Session files
```

`src/shared/session/session-attention.ts` owns one versioned journal shape and its reducer:

```text
runwield.attention requested
  version: 1
  state: requested
  attentionId: UUID
  reason: agentStopped
  runwieldSessionId: stable Session ID
  agentName, sessionName, recordedAt
  generation: the generation being committed

runwield.attention resolved
  version: 1
  state: resolved
  attentionId: exact requested ID
  resolution: user_message | interaction_result
  recordedAt
  generation: the generation being committed
```

The reducer accepts only complete version-1 records, applies resolutions by exact `attentionId`, and returns unresolved
requests in transcript order. It does not treat old loose `runwield.attention` test entries as durable Session
Attention. Old clients safely ignore the new custom data, and existing Sessions need no rewrite.

`AgentHandlerCompleteResult` carries an optional typed `attentionRequest` intent. The existing
`requestAgentStoppedAttention` helper becomes a once-per-turn intent builder and still consumes
`HostedSession.suppressNextAgentStoppedAttention()` after cancellation. `promptSession` preserves the intent in its
managed-operation result. `#runManagedOperation` is the writer because it holds the Session Writer Lock, knows
`nextGeneration`, owns the writable root Session manager, and publishes the committed generation. It appends resolution
records before a new request when both occur in one generation, captures the committed request, and emits the live event
only after `publishGenerationAndRelease` succeeds. A failed or canceled operation cannot publish a live attention event.

A successful managed user turn counts as `user_message` response evidence. `requestHostedSessionInteraction` marks the
current `ManagedOperationCapability` only for accepted `selected`, `text`, or `accepted` outcomes, after the interaction
result exists. Canceled, blocked, and unsupported outcomes do not resolve attention. The checkpoint resolves only the
requests that were unresolved when the operation began; it cannot resolve a new stop request from that same operation.

Workspace adds one Session Attention observer behind the existing owner authorization boundary:

```text
GET /api/owner/projects/:projectId/sessions/:runwieldSessionId/attention/stream
  validate registered Project and Session membership
  emit current committed { generation, attention }
  while at least one subscriber exists
    inspect Session generation outside the browser
    when generation changes, project committed Session Attention once
    emit changed { generation, attention }
```

The server owns one reference-counted watcher per stable Session, not one full transcript poll per browser tab. While it
has subscribers, it checks every 1.5 seconds so a generation change is discovered within two seconds under normal event-
loop operation. It hydrates transcript evidence only when the committed generation changes, shares that result with
subscribers, emits a keepalive, and stops when its final subscriber disconnects. Initial and reconnect snapshots make
the stream recoverable. The payload contains browser-safe IDs, reason, labels, times, and generation; it contains no
transcript path, activation proof, writer identity, or raw transcript entry. Stream errors remain read failures and do
not mutate or resolve attention.

Each detail-mode `SessionSurface` starts a `SessionTabNotificationController` for its exact Project and Session and
connects to that stream even while the Session is idle. The controller uses:

- `BroadcastChannel` presence probes and focus/visibility updates scoped by Project and stable Session;
- the browser Web Locks API to serialize the claim for one Project + Session + attention ID;
- a bounded `localStorage` delivery ledger so reload, reconnect, repeated observation, and owner-server restart do not
  send the same notification again;
- `new Notification(...)` only when permission is already `granted`; the observer never opens the permission prompt;
- a browser notification `tag` keyed by Project + Session + attention ID as a second deduplication guard;
- `notification.onclick = () => { notification.close(); window.focus(); }` in the exact claiming Session tab.

Under the claim lock, the controller first checks the ledger, probes loaded copies, and waits one short coordination
window. If any exact copy reports both `document.visibilityState === "visible"` and `document.hasFocus()`, it stores
`suppressed_visible`. Otherwise, a background copy with granted permission creates one notification and stores
`notified`. Different Session IDs use different claims. If Notification, BroadcastChannel, Web Locks, or durable browser
storage is unavailable, delivery is disabled rather than risking duplicates; committed Session Attention remains valid.
The ledger is capped by count and age so it cannot grow without bound.

`BrowserNotificationPermissionControl` lives in a separate global-actions slot beside the existing
`data-workspace-header-actions` portal. It uses RunWield controls and semantic tokens. In `default` state it shows a
compact bell action labeled **Enable alerts**. Its click is the only call to `Notification.requestPermission()`. Granted
state shows **Alerts enabled**. Denied state shows **Alerts blocked** with browser-settings guidance and does not call
the prompt again. Unsupported or insecure contexts show **Alerts unavailable**. A constructor failure writes a
same-origin capability marker and dispatches a `runwield:browser-notification-status` event; the header listens to that
event, `storage`, focus, and visibility changes so all loaded copies reflect browser settings or discovered
unavailability. On narrow screens the visible label may collapse to the bell, but the accessible name and title retain
the full state.

The notification keeps the current TUI meaning: title `<Agent>: Agent stopped — <Session Name>` and body
`The agent has
stopped and is waiting for you.` Browser and TUI delivery can differ in focus mechanics, but they
describe the same Core Session Attention reason.

The main option set aside is a Workspace-owned attention writer. It would see only Workspace-owned turns, miss TUI and
ACP stops, and create a second authority. The browser option set aside is `localStorage` or `BroadcastChannel` alone for
claims; neither gives an atomic cross-tab winner, so the implementation uses a browser lock and safely disables delivery
when exact coordination is unavailable.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/session-attention.ts` (new) — owns the versioned journal types, strict normalization, append
  helpers, exact-ID resolution, and committed projection reducer.
- `src/shared/session/agent-handler.ts` — returns one `agentStopped` intent on terminal paths instead of publishing an
  uncommitted live event; preserves cancellation suppression and all current workflow decisions.
- `src/shared/session/session-runtime.js` and `managed-operation.ts` — carry the typed intent and accepted-response
  fact, append resolution/request records with `nextGeneration`, and publish the stable live event only after generation
  publication.
- `src/shared/session/session-runtime-interactions.js` — marks accepted interaction results on the active managed
  capability; canceled, blocked, and unsupported results remain non-responses.
- `src/shared/session/session-runtime-events.js` — make committed `agentStopped` events require `eventId`, stable
  `runwieldSessionId`, and `generation`, while keeping the process-local `planWritten` and `userInterview` variants
  compatible.
- `src/shared/session/session-transcript-projection.js` and aggregate projection tests — replace preliminary last-entry
  parsing with the strict journal reducer and expose unresolved committed Session Attention without turning it into a
  timeline message.
- `src/ui/tui/runtime-adapter.js` and `src/ui/tui/system-notifications.ts` — continue one terminal notification from the
  post-commit event and keep the `agentStopped` copy aligned with browser delivery.
- `src/ui/workspace/server/session-attention.ts` (new), `server/session-continuation.js`, `routes/owner-session-api.js`,
  and `server.js` — add the generation-aware Session observer, authenticated server-sent event route, safe payload,
  reference-counted cleanup, and server shutdown cleanup.
- `src/ui/workspace/browser/session-tab-notifications.ts` (new) and `islands/SessionSurface.jsx` — own the duplicate-tab
  presence, atomic claim, bounded delivery ledger, notification click focus, exact-Session stream subscription, and
  cleanup on unmount or Session change.
- `src/ui/workspace/react/BrowserNotificationPermissionControl.tsx` (new), `layouts/WorkspaceLayout.astro`, and
  `static/workspace.css` — add the selected Workspace-wide header control without changing local Plan Board or
  review-specific action ownership. Use existing `--rw-*` tokens and toolbar geometry.
- `docs/domain-language.md` — define Session Attention and browser notification delivery and their stable relationships
  to Session Transcript, Attention Dashboard, Pending Structured Interaction, and workflow authority.

When the implementation makes proposed domain language true, include the applicable domain-language file:
`docs/domain-language.md` for a single-context project, or the context-specific `domain-language.md` identified by
`docs/domain-language-map.md` for a multi-context project.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime.js#SessionRuntime.#runManagedOperation` — the shared lock, transcript sync,
  generation publication, and post-commit synchronization transaction used by TUI, Workspace, and ACP.
- `src/shared/session/session-transcript-projection.js#projectAggregateTranscript` and `summarizeProjectedEntries` —
  verified committed-prefix reads and the current preliminary attention projection seam.
- `src/shared/session/hosted-session.js#suppressNextAgentStoppedAttention` — preserve Escape cancellation behavior; do
  not create a second cancellation flag.
- `src/ui/tui/system-notifications.ts` — reuse the current `agentStopped` title/body meaning and focused-surface policy.
- `src/ui/workspace/server/session-continuation.js#WorkspaceSessionContinuationService.timeline` — reuse Project/Session
  membership checks and aggregate projection inputs, but do not repeatedly fetch the full timeline in each tab.
- `src/ui/workspace/routes/owner-session-api.js#ownerSessionOperationStreamApi` — reuse owner server-sent event headers,
  safe serialization, initial delivery, and unsubscribe shape.
- `src/ui/workspace/islands/SessionSurface.jsx` — reuse its exact stable Session route identity and React effect
  cleanup; keep notification observation independent from `shouldRefreshSessionAvailability`.
- `src/ui/workspace/layouts/WorkspaceLayout.astro` and `.rw-toolbar-button` — place the permission control in the shared
  Workspace header without entering the review action portal.

## Implementation Steps

- `src/shared/session/session-attention.ts` exports the `runwield.attention` custom type, named request/resolution
  types, strict version-1 normalizers, append helpers, and `readUnresolvedSessionAttention(entries)`. A request is valid
  only with `attentionId`, `reason: "agentStopped"`, stable RunWield Session ID, finite nonnegative generation, and
  valid timestamp. A resolution is valid only with an exact attention ID, accepted resolution kind, generation, and
  timestamp. The reducer ignores malformed and loose legacy entries, resolves only the named request, preserves
  transcript order, and never changes workflow state.
- Every `createAgentHandler` path that currently calls `requestAgentStoppedAttention()` returns one typed
  `attentionRequest`; the helper remains once-per-turn and returns no intent after
  `consumeSuppressedAgentStoppedAttention()` succeeds. The handler no longer calls
  `emitHostedSessionRuntimeEvent(...ATTENTION_REQUESTED...)` for `agentStopped`. `planWritten` and `userInterview` live
  attention remain process-local and unchanged.
- `ManagedOperationCapability` records whether an accepted interaction result occurred. Only `selected`, `text`, and
  `accepted` outcomes set that fact, and only after `requestHostedSessionInteraction` has the result. It is internal
  RunWield machinery, not a new dependency-injection seam.
- `SessionRuntime.#runManagedOperation` identifies unresolved attention from the committed branch before it invokes the
  operation body. After a successful body, it appends exact-ID resolutions for those prior requests when the operation
  contains a user request or accepted interaction result, then appends the returned new `agentStopped` request with
  `nextGeneration`. It syncs and publishes once. It emits the committed request only after `publishGenerationAndRelease`
  returns, with `eventId === attentionId`, stable `runwieldSessionId`, committed `generation`, reason, Agent name, and
  Session name. Publication failure emits no attention event.
- Committed projection returns all unresolved valid requests and a `latestAttention` convenience value. A request and
  resolution in one generation leave no unresolved item; a resolution followed by a new request in one generation
  returns only the new request. `shouldEmitProjectedAttention` compares stable attention IDs, suppresses initial Runtime
  hydration as today, and never emits a resolution as a request.
- TUI receives exactly one post-commit `agentStopped` event for a normal completed turn, no event for a canceled turn,
  and no duplicate when later synchronization reads the same committed attention. Existing terminal focus suppression,
  native protocol selection, and `planWritten`/`userInterview` notifications remain protected.
- `WorkspaceSessionContinuationService` exposes a browser-safe current-attention read and a reference-counted
  subscription per stable Session. A subscription validates Project membership, emits its initial committed snapshot,
  checks the Session generation every 1.5 seconds while subscribed, reads aggregate transcript evidence only after a
  generation change, shares one read across subscribers, emits only changed snapshots, and releases timers, cache, and
  listeners when the final subscriber or service closes.
- `GET /api/owner/projects/:projectId/sessions/:runwieldSessionId/attention/stream` uses the existing paired-owner
  authentication and Project-root checks, sends server-sent event snapshots and keepalives, unsubscribes on cancel, and
  never exposes paths, activation proof, writer details, transcript data, or mutation actions.
- `SessionTabNotificationController` subscribes only for a persisted detail Session, publishes current focus/visibility
  on mount and browser state changes, answers same-Session presence probes, and closes its stream, channel, timers, and
  live Notification object on cleanup. It does not run for Session lists, the New Session screen, Dashboard, Plan pages,
  or unrelated Session tabs.
- For each unresolved stable attention ID, the controller uses a same-origin Web Lock and bounded local delivery ledger.
  An exact focused visible peer produces one durable browser-local `suppressed_visible` result. Otherwise, exactly one
  loaded background copy with granted permission creates the notification with a Project + Session + attention tag and
  records `notified`; its click closes the notification and focuses that tab. Replayed or resolved snapshots, reconnect,
  reload, and server restart do not send again. Different stable Session IDs remain independent. Missing Notification,
  BroadcastChannel, Web Locks, or writable storage, or a thrown Notification constructor, produces no notification and
  no Core mutation; the constructor failure records local unavailable state and updates the header.
- `BrowserNotificationPermissionControl` appears in the owner Workspace header on all Workspace routes and not in the
  local Plan Board shell. The default-state click alone calls `Notification.requestPermission`; granted, denied, and
  unsupported/insecure states show **Alerts enabled**, **Alerts blocked**, and **Alerts unavailable** respectively.
  Denied state does not offer a repeat browser prompt. The control listens for the controller's
  `runwield:browser-notification-status` event plus same-origin `storage`, focus, and visibility changes, so a
  constructor failure or browser-settings change is reflected without another permission request. It has an accessible
  full label and title at desktop and narrow widths and uses existing RunWield toolbar geometry and semantic tokens. It
  creates no notification list, badge count, or workflow action.
- `docs/domain-language.md` defines **Session Attention** as committed Session Transcript evidence that an
  `agentStopped` event needs owner attention, with one stable ID and exact resolution. It defines browser notification
  delivery as best-effort adapter behavior by a loaded Session tab. Avoid using notification, Pending Structured
  Interaction, Dashboard item, or workflow state as aliases. Relationships state that Core writes Session Attention,
  Workspace and TUI read/deliver it, Attention Dashboard can project it, and delivery never resolves or authorizes work.

## Approval Confirmation

No Work Records are proposed for supersession. The prior terminal-notification Work Records remain valid history and are
reused rather than materially replaced.

## Verification Plan

- Automated Core behavior:
  `deno run -A scripts/run-tests.js src/shared/session/session-attention.test.ts
  src/shared/session/session-transcript-projection.test.js src/shared/session/session-runtime-events.test.js
  src/shared/session/session-runtime-interactions.test.js src/shared/session/agent-handler.test.ts
  src/shared/session/session-runtime.test.js`.
  - A real managed prompt must observe `attention_requested` only after `inspectSessionActivation` reports the event's
    generation and `projectAggregateTranscript` returns the same unresolved attention ID. This test fails against the
    current pre-commit live emitter and fails if the new writer is a no-op.
  - Read the current segment with
    `captureTranscriptEvidence({ transcriptPath, byteLength:
    generation.byteLength })`, inspect its returned raw
    entries without calling `projectAggregateTranscript` or any attention adapter, and assert that the committed prefix
    itself contains the exact version-1 `runwield.attention/requested` custom entry. After the next response, the new
    committed prefix must contain the exact version-1 resolution naming the prior ID and the next request. Delete any
    non-manifest, non-transcript fixture files before reopening the reader and prove the same result. This fails a
    generation-gated sidecar, Workspace database, or projection overlay that does not put both records in canonical
    Session Transcript evidence.
  - Restart the Runtime/store after the stop and prove the same unresolved ID remains. Run the next successful user
    turn, restart again, and prove the old ID is resolved and only that turn's new stop ID remains. An accepted
    interaction result resolves the prior ID; canceled, blocked, and unsupported results do not.
  - Append a valid-looking request beyond the committed byte length without publishing a generation and prove neither
    projection nor Workspace reads it. A forced publication failure produces no live event.
  - Cancellation tests prove Escape suppression writes no request and emits no post-commit event. Existing `planWritten`
    and `userInterview` attention events remain compatible.
- Automated cross-process Workspace behavior:
  `deno run -A scripts/run-tests.js src/ui/workspace/session-attention.integration.test.ts
  src/ui/workspace/owner-workspace.test.js`.
  - Start the production Session Attention observer against a real registered Project and file-backed Session. Spawn a
    separate Deno child that constructs the production Session Runtime with `ownerProcessKind: "tui"`, uses the existing
    fake-model boundary to complete one real Agent Handler turn, and exits after generation publication. The already
    loaded Workspace subscription receives the stable committed ID within two observer intervals without a Workspace
    writer or process-local event.
  - Two subscribers for one Session share one generation observer/read; a different Session has an independent stream.
    Resolution emits `attention: null`. Reconnect and service restart return current committed state. Unsubscribe and
    service close leave no watcher timer.
  - Owner route tests cover authentication, registered Project and exact Session membership, safe payload fields,
    initial event, keepalive/cancel cleanup, and damaged committed evidence without leaking paths or writer facts.
- Automated browser policy:
  `deno run -A scripts/run-tests.js src/ui/workspace/session-tab-notifications.browser.test.ts
  src/ui/workspace/workspace-session-ux.test.tsx`.
  Use the real controller with deterministic implementations of the genuine browser boundaries (Notification,
  BroadcastChannel, Web Locks, storage, focus, and visibility), not a replacement notification algorithm.
  - Two background copies of Session A observing one ID create one notification; invoking its click focuses only the
    claiming A tab.
  - A focused visible copy of A plus background duplicates creates zero notifications and stores one suppression result;
    hiding it later does not notify for the same ID.
  - Background Session A and Session B each notify once. Duplicate A tabs still produce only one A notification.
  - Repeated snapshots, disconnect/reconnect, reload with the same ledger, server restart, and a resolved snapshot
    create no repeat notification.
  - Default, denied, insecure, unsupported, constructor-thrown, storage-failed, and lock-unavailable cases create no
    notification and never call `requestPermission` from the Session observer. A constructor failure publishes local
    unavailable state to the header and is not retried for the same ID. The header control calls permission once only
    from the explicit click and renders the selected labels and accessibility state.
  - These assertions fail if the controller is empty, always suppresses, uses a pass-through claim, or keys only by
    attention ID without Project and stable Session identity.
- Automated regression: run `deno task workspace:check`, `deno task seams:check`, `deno task workspace:test`, and
  `deno task ci`. Do not add or re-baseline an injection seam for Core writes, claims, or locks.
- Headed browser visual check: run `deno task workspace:dev` at `http://127.0.0.1:5173` for the shared header. Use an
  isolated headed `agent-browser` session at 1440×1000 and a phone viewport. Confirm **Enable alerts** is compact,
  keyboard reachable, visibly focused, does not collide with Plan Review actions, and becomes icon-compact without
  clipping on narrow screens. Capture desktop and phone screenshots and check browser console/errors. The fixture need
  not simulate cross-process attention.
- Real notification check: run `deno task workspace:build`, then `wld workspace serve --no-open` and use the paired
  owner URL (`http://127.0.0.1:8787` by default; use the configured HTTPS public origin for a remote device). Click
  **Enable alerts** and grant permission. Open Session A twice and Session B once.
  1. Keep one A copy focused and visible; complete its Agent from a TUI and confirm no system notification appears in
     either A copy.
  2. Send another A turn, background all A copies, let its Agent stop, and confirm exactly one notification. Click it
     and confirm the claiming A tab receives focus, not B or Dashboard.
  3. Background B and stop both A and B; confirm one notification per Session.
  4. Reload/reconnect an A copy and restart the owner server while its attention remains unresolved; confirm the stable
     ID is not notified again. Send a user response, refresh, and confirm the old attention is absent.
  5. In a fresh browser profile, deny permission. Confirm the header reports **Alerts blocked**, Session work and the
     durable Attention Dashboard item remain available, and no automatic repeat prompt appears.
- Expected result: Core commits and resolves stable Session Attention before any adapter delivery. Loaded Workspace
  Session tabs behave like separate TUIs for Agent-stop attention, while duplicate tabs notify once, a visible exact
  Session stays quiet, and Workspace gains no workflow or resolution authority.
- Existing behavior that must remain protected: Session Writer Lock and generation publication order; transcript-prefix
  verification; TUI/Workspace/ACP use of one Session Runtime; Escape cancellation suppression; TUI native notification
  protocols and focus policy; `planWritten` and `userInterview` notifications; owner pairing and Project membership;
  Session timeline, composer, live Workspace operation stream, Plan Review header actions, local Plan Board shell, and
  direct Session URLs.
- Behavior expected to stop existing: `agentStopped` live publication before generation commit; production acceptance of
  loose unversioned `runwield.attention` as durable evidence; an idle loaded Session tab ceasing all observation; and
  duplicate browser tabs independently notifying for the same stable event.
- Confirm `docs/domain-language.md` describes only implemented Session Attention and browser delivery behavior and does
  not claim closed-tab delivery, durable Pending Structured Interactions, notification workflow authority, or a new
  in-app notification surface.

## Edge Cases & Considerations

- A committed response can resolve prior attention and the resulting Agent can stop again in the same generation. Record
  the exact resolutions first and the new request second so projection returns only the new attention.
- A crash before generation publication can leave transcript tail bytes. They are not Session Attention until the
  committed prefix includes them. A crash after publication but before live delivery is recovered by Workspace from the
  committed stream and by Runtime synchronization policy without another writer.
- Browser delivery is best effort. Secure-context rules, operating-system policy, browser focus restrictions, battery
  throttling, and user settings can prevent or delay it. MDN documents that the page-level `Notification` constructor
  throws in nearly all mobile browsers; because this Epic defers service workers, V2 notification delivery is a desktop
  browser capability. A constructor failure changes the local header state to unavailable. The phone viewport check
  verifies only header layout. These failures cannot acknowledge, resolve, or authorize work.
- The server-side observer checks generations so browser background timer throttling does not hide a separate TUI stop.
  It must coalesce concurrent subscribers and slow reads so one damaged or slow Session does not create overlapping
  transcript projections.
- A newly opened tab can observe an existing unresolved attention. If that exact Session is focused and visible, the
  event is recorded as suppressed and does not notify later merely because the tab becomes hidden. No loaded tab at stop
  time still carries no delivery guarantee.
- Browser-local claim outcomes are projections. Clearing site data can remove deduplication history but cannot change
  Session Attention. The bounded ledger must not store transcript text, credentials, or workflow evidence.
- Duplicate tabs can open, refresh, or close during the presence probe. The Web Lock serializes the final decision;
  stale peers expire, and failure to establish reliable coordination disables delivery instead of risking duplicates.
- Service workers, Web Push, native host alerts, closed-tab delivery, Dashboard-owned notification delivery, and browser
  notifications for `planWritten`, `userInterview`, or process-local Pending Structured Interactions are later work.
- The current working tree contains an unrelated uncommitted Session-name snapshot change in
  `src/shared/session/session-runtime.js` and its test. Preserve it if it is present in the execution checkout; do not
  overwrite or reinterpret it as part of Session Attention.
