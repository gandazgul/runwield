---
planId: "46942300-8b9c-4af5-bdaf-1b69ea39be34"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/notification-content.ts"
    - "src/shared/session/session-runtime-events.js"
    - "src/ui/tui/system-notifications.ts"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/workspace/browser/session-tab-notifications.ts"
    - "src/ui/workspace/react/BrowserNotificationPermissionControl.tsx"
    - "src/ui/workspace/layouts/WorkspaceLayout.astro"
    - "src/ui/workspace/static/workspace.css"
    - "src/shared/session/notification-content.test.ts"
    - "src/ui/tui/system-notifications.test.ts"
    - "src/ui/workspace/browser/session-tab-notifications.test.ts"
    - "src/ui/workspace/session-continuation.integration.test.ts"
    - "src/ui/workspace/workspace-session-ux.test.tsx"
    - "docs/settings.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-09-03T00:53:56.723Z"
status: "ready_for_work"
origin: "internal"
parentPlan: "personal-remote-workspace-v2"
order: 2
dependencies:
    []
userVerifiedAt: null
---

# Shared Core Notifications and Workspace Browser Delivery

## Context

The existing TUI notification behavior is sufficient. The owner explicitly rejected turning browser notifications into
persistent Session attention state. This revision replaces that design with shared notification behavior and a browser
adapter. The Plan ID is retained for continuity.

Core already emits `attention_requested` from Agent handling. The TUI adapter receives it and calls
`system-notifications.ts`, which currently mixes reusable event labels, message text, and settings with
terminal-specific delivery. Workspace already forwards runtime events through its live operation stream. Reuse those
paths.

## Objective

Move reusable notification content and setting interpretation into Core. Keep terminal delivery in TUI and surface
`agentStopped` through browser notifications in Workspace. Preserve existing TUI events and behavior.

A loaded Session tab with permission notifies when it receives a new live Agent-stop event. Suppress delivery when that
tab is focused and visible, according to the shared focus-suppression setting. Clicking the notification closes it and
attempts to focus the originating Session tab. Delivery is best effort, like the TUI.

## Approach

```text
Session Runtime attention_requested
  Workspace operation stream -> Session tab observer -> browser Notification
  TUI Runtime adapter        -> terminal BEL / OSC
                shared content and common policy
```

`src/shared/session/notification-content.ts` becomes the browser-safe owner of notification event names, labels, base
messages, and common setting interpretation. The TUI keeps Deno environment access, terminal detection, terminal-only
settings, OSC sequences, BEL output, and its `Session: W. - <name>` message line. The Workspace server resolves the same
project-over-global setting for the operation's registered Project and sends only the browser-applicable policy.

`SessionSurface` observes the existing cumulative operation snapshots. It claims unseen array positions synchronously
before best-effort delivery, so overlapping server-sent event (SSE) callbacks cannot alert twice. A restored operation
seeds its first snapshot as history. A newly accepted operation starts at position zero before its first snapshot, so a
fast completion remains live. The cursor survives SSE-to-GET fallback for that mounted Session and resets when the
Session or operation identity changes.

The current 500-event operation buffer remains bounded. It reserves at most one additional position for the first live
`agentStopped` attention event when ordinary events fill the buffer. This keeps the stop observable without a new event
service or changing the existing event-index behavior used by review conversations.

A compact bell control in the shared Workspace header requests browser permission only after a click. It shows enable,
enabled, blocked, or unavailable state and coexists with Plan Review actions. The local Plan Board shell remains
unchanged.

The rejected alternative was persistent Session attention with replay, acknowledgement, and cross-tab coordination. It
would add a second workflow state model for a best-effort alert and was explicitly rejected by the owner.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/notification-content.ts` and `notification-content.test.ts` — own the browser-safe event names,
  labels, base messages, and normalized common notification policy for all existing TUI events.
- `src/shared/session/session-runtime-events.js` and its tests — reference the shared event vocabulary while preserving
  the Runtime's current `agentStopped`, `planWritten`, and `userInterview` attention-event contract.
- `src/ui/tui/system-notifications.ts`, `runtime-adapter.js`, and current notification tests — consume shared content
  and policy while retaining all terminal-specific behavior and event timing.
- `src/ui/workspace/server/session-continuation.js`, owner operation routes, and
  `session-continuation.integration.test.ts` — resolve the operation Project's notification policy, expose it in safe
  operation snapshots, and keep a full-buffer Agent-stop event observable with bounded memory.
- `src/ui/workspace/islands/SessionSurface.jsx` and `workspace-session-ux.test.tsx` — distinguish restored history from
  new live events and pass each newly observed `agentStopped` event to browser delivery before terminal snapshot
  cleanup.
- `src/ui/workspace/browser/session-tab-notifications.ts` and its tests — own direct browser `Notification`, tab-focus,
  click-focus, failure isolation, and cleanup behavior without a delivery ledger or a RunWield-owned injection seam.
- `src/ui/workspace/react/BrowserNotificationPermissionControl.tsx`, `WorkspaceLayout.astro`, and `workspace.css` — add
  the accessible Workspace-wide permission control without displacing review actions or changing the local Plan Board.
- `docs/settings.md` — describe the common settings used by TUI and Workspace, and identify terminal-only keys.

No domain-language update is expected. The change uses the current **Session**, **Workspace**, **TUI**, and **RunWield
Core** meanings without adding or redefining a product term.

## Reuse Opportunities

- `src/shared/settings.js#getMergedCustomSetting` — preserve current project-over-global shallow merge behavior; do not
  add another settings reader.
- `src/shared/session/session-runtime-events.js#RuntimeEventTypes.ATTENTION_REQUESTED` — retain the existing live
  `agentStopped` event and cancellation suppression owned by Agent handling.
- `src/ui/workspace/server/session-continuation.js#subscribeOperation` and `getOperation` — reuse the authenticated SSE
  snapshot and GET fallback path instead of adding polling or cross-process transport.
- `src/ui/workspace/react/WorkspaceHeaderActionsPortal.tsx` and `WorkspaceLayout.astro#[data-workspace-header-actions]`
  — preserve the shared header target and Plan Review action portal; render the global bell as a deterministic sibling,
  not as a replacement portal root.
- `src/ui/design-system/components.css` and `src/ui/design-system/components/react/RunWieldPrimitives.jsx` — reuse
  compact toolbar-button geometry, semantic tokens, focus treatment, and an existing bell icon pattern where available.

## Implementation Steps

1. `src/shared/session/notification-content.ts` exports the canonical `NotificationEventName`, the four existing event
   labels and base messages, a common policy type, and pure normalization/content functions. Missing or malformed values
   keep today's defaults; only literal `false` disables notifications, an event, or focused-tab suppression. The module
   imports no Deno, filesystem, terminal, React, or browser API.
2. `session-runtime-events.js` continues to accept only `agentStopped`, `planWritten`, and `userInterview` as Runtime
   attention reasons, while the shared notification vocabulary also includes the TUI-only `compactionFinished` event.
   Existing projected attention identity and cancellation suppression remain unchanged.
3. `system-notifications.ts` has no private event-label table, event-message table, or duplicate common-policy resolver.
   For every notification request, `createSystemNotificationNotifier` obtains the event label, base message, and common
   policy through the imported Core functions, then adds only terminal-specific identity, settings, and delivery. It
   still emits the exact title shape `[Agent: ]<event label> — <Session Name>` and base message followed by
   `Session: W. - <Session Name>`. Golden TUI suppression, known-focus suppression, per-event settings, BEL-before-OSC
   ordering, Kitty/WezTerm/Ghostty/iTerm protocols, unsupported fallback, `activation`, `terminalBell`, and
   write-failure handling remain protected. `runtime-adapter.js` still requests notification at the existing attention
   event point.
4. Each live Workspace operation snapshot includes a resolved browser policy with only `enabled`, `events.agentStopped`,
   and `suppressWhenFocused`. Resolution uses `getMergedCustomSetting("notifications",
   project.currentRoot)` for that
   operation's registered Project. Safe GET and SSE responses expose no root path, raw settings, or unrelated custom
   values.
5. `WorkspaceSessionContinuationService.appendOperationEvent` keeps at most 500 ordinary events and, when that capacity
   is already full, one first `attention_requested` event whose reason is `agentStopped`. The reserved event is appended
   at a new stable position and reaches both `subscribeOperation` and `getOperation`; later overflow stays dropped and
   memory remains bounded.
6. `session-tab-notifications.ts` uses the browser's real `Notification`, `document.visibilityState`,
   `document.hasFocus()`, and `window.focus()` boundaries. It delivers only permitted, enabled `agentStopped` events;
   suppresses only when the document is both visible and focused and the setting enables suppression; uses shared title
   and base message text; closes and focuses the originating tab on click; catches constructor/click failures; and
   closes tracked notifications and clears handlers on disposal. It adds no persistence, service worker, Web Lock,
   delivery ledger, or product-owned dependency-injection seam.
7. `SessionSurface` has one Session/operation-scoped observation cursor. It recognizes the production event shape
   `{ type: "attention_requested", reason: "agentStopped" }`; a status change or shorthand `{ type: "agentStopped" }`
   cannot synthesize an alert. Restored operation snapshots seed the cursor without delivery; newly accepted operation
   snapshots scan from position zero; each position is claimed before browser delivery starts; repeated snapshots and
   overlapping callbacks do not alert twice; SSE-to-GET fallback keeps the same cursor; and Session identity, operation
   identity, or unmount disposes old browser notifications and resets observation. A terminal operation snapshot is
   scanned before `setOperation(null)` and timeline reload.
8. `BrowserNotificationPermissionControl.tsx` renders in every owner Workspace header as a compact accessible bell.
   `default` permission offers **Enable alerts** and calls `Notification.requestPermission()` only from that click;
   `granted` shows **Alerts enabled**; `denied` shows **Alerts blocked** with browser-settings guidance; and missing API
   support shows **Alerts unavailable**. Blocked and unavailable states do not prompt again. The control has a stable
   sibling position beside `[data-workspace-header-actions]`, keeps Plan Review approval controls reachable at narrow
   widths, and does not appear in the local Plan Board shell.
9. `docs/settings.md` states that `enabled`, `events.agentStopped`, and `suppressWhenFocused` also govern Workspace
   browser alerts. It keeps `terminalBell`, `activation`, and non-`agentStopped` event delivery documented as TUI-only
   for this slice.

## Approval Confirmation

No Work Record supersession is proposed.

## Verification Plan

- Automated shared/TUI behavior:
  ```sh
  deno run -A scripts/run-tests.js \
    src/shared/session/notification-content.test.ts \
    src/shared/session/session-runtime-events.test.js \
    src/shared/session/session-runtime.test.js \
    src/shared/session/agent-handler.test.ts \
    src/ui/tui/system-notifications.test.ts \
    src/ui/tui/runtime-adapter.test.js \
    src/cmd/compact/index.test.js
  ```
  These tests must prove all four labels/messages and default/disabled setting behavior from the shared module. Existing
  TUI tests must still prove terminal title/body shape, BEL/OSC protocols and ordering, focus and Golden suppression,
  cancellation suppression, unsupported fallback, and write-failure isolation. Semantic inspection must follow
  `createSystemNotificationNotifier -> shared content/policy functions -> terminal-only composition` and reject an
  unused shared import, copied label/message tables, or a renamed duplicate common-policy resolver. No existing TUI
  event is expected to stop working.
- Automated Workspace behavior:
  ```sh
  deno run -A scripts/run-tests.js \
    src/ui/workspace/browser/session-tab-notifications.test.ts \
    src/ui/workspace/session-continuation.integration.test.ts \
    src/ui/workspace/workspace-session-ux.test.tsx \
    src/ui/workspace/workspace-plan-review-ux.test.tsx \
    src/ui/workspace/owner-workspace.test.js \
    src/ui/workspace/workspace-shell-navigation.test.ts
  ```
  The browser-adapter test must install fake browser globals, create a real notification object, and assert its shared
  title/body plus click-driven close and focus; a stub that returns success without constructing `Notification` must
  fail. Cover denied and missing APIs, disabled settings, visible-and-focused suppression, background delivery,
  constructor failure, and disposal. The service integration must use a registered Project setting, observe the
  production operation snapshot boundary, fill 500 ordinary events, append a stop, and prove both SSE subscription and
  GET snapshots expose that bounded final event. One vertical test must pass that returned, still-`running` snapshot
  unmodified into the exact observation function used by `SessionSurface`; its event must have
  `{ type: "attention_requested", reason: "agentStopped" }`, and it must construct exactly one Notification before any
  completed status exists. Repeat the same snapshot through overlapping SSE-style calls and GET fallback, then assert no
  duplicate. Also prove restored history is quiet and terminal cleanup does not skip a newly observed stop. A shorthand
  event or a synthetic notification caused only by `status: "completed"` must fail this test.
- Mechanical checks:
  ```sh
  deno task workspace:check
  deno task seams:check
  deno task ci
  ```
- Headed browser, desktop and narrow widths: run `deno task workspace:dev` and open `http://127.0.0.1:5173/dev`. Verify
  the bell's default, enabled, blocked, and unavailable presentations; keyboard focus and browser tooltip/accessible
  name; and that it remains visible without covering Plan Review approval actions. Verify the local Plan Board has no
  bell. Use a clean browser profile or reset site permission between permission states.
- Real owner flow: run `deno task workspace:remote`, open a paired owner Workspace Session, click **Enable alerts**,
  submit a turn, and background that exact tab. One Agent stop must produce one browser notification with the shared
  title and message. Clicking it must close the notification and attempt to focus that tab. Repeat while the tab is
  visible and focused to prove suppression. Deny permission in a clean profile and prove the Session still completes.
  Reload during or after a completed operation and prove no old alert replays. Open the same Session twice and confirm
  duplicate tabs may each alert; no cross-tab guarantee is expected.
- TUI smoke check: run an ordinary Agent turn and `/compact` in a supported terminal. Confirm the existing Agent-stop
  and compaction notifications still use the terminal title line and current terminal focus behavior.

Existing behavior that must remain protected: Runtime cancellation suppresses the next Agent-stop alert; projected
attention records notify only when their stable event identity changes; TUI notification settings and all four event
kinds keep their current meaning; Workspace operation SSE and GET fallback continue to drive Session transient state;
and Plan Review actions remain in the shared header.

Behavior expected to stop existing: documentation and browser behavior that treat `notifications` as TUI-only. No
Session, workflow, Plan, Dashboard, or transcript state is removed or replaced.

## Edge Cases & Considerations

- Permission is browser-origin state. The header control reports permission, while each operation's Project settings
  decide whether that Session tab can deliver an alert.
- Focus suppression means both `document.visibilityState === "visible"` and `document.hasFocus() === true`. A visible
  but unfocused window can alert. `suppressWhenFocused: false` permits an alert even in the focused tab.
- `window.focus()` and notification clicks are browser-controlled and best effort. Failure changes no Session or
  workflow state.
- A reloaded, disconnected, or closed Session tab can miss an alert. Historical snapshots do not replay alerts.
- Each loaded tab owns its in-memory cursor. Duplicate tabs may both alert; no tab is the notification authority for
  another tab.
- Browser delivery covers only live Workspace `agentStopped` events. Separate TUI and Agent Client Protocol processes
  keep their own notification surfaces; this Plan adds no cross-process transport.
- The existing project-over-global settings merge remains shallow. No settings migration or schema change is required.
- Notification failure must not reject an Agent turn, delay operation completion, create a Dashboard item, or write a
  transcript, attention record, acknowledgement, or resolution.
