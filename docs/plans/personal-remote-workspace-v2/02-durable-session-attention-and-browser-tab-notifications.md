---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/ui/tui/system-notifications.ts"
    - "src/ui/workspace/server/"
    - "src/ui/workspace/pages/projects/[projectId]/sessions/[runwieldSessionId].astro"
    - "src/ui/workspace/static/"
    - "src/ui/workspace/react/"
    - "docs/domain-language.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
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
---

# Durable Session Attention and Browser Tab Notifications

## Context

Session Runtime already emits live `attention_requested` events for `agentStopped`, and the TUI turns them into terminal
notifications. Workspace needs stronger evidence. A TUI-owned Session may run in another process, and a browser tab can
refresh after the live event.

The event is not workflow state. It is a durable signal that a loaded Session needs the owner. Workspace must read and
deliver it, not become the writer.

## Objective

Commit stable Session attention for `agentStopped` in the shared Core Agent-completion transaction used by TUI,
Workspace, and Agent Client Protocol. The transaction writes a stable event ID, reason, Session identity, and committed
generation before live publication.

Each loaded Workspace Session tab observes only its exact Session attention feed. If a focused visible tab already shows
that Session, no browser system notification is shown. Otherwise, loaded background copies coordinate so exactly one
copy shows the notification after permission. Clicking it focuses that exact Session tab.

## Approach

Move the source of truth into the Core commit path, then keep browser delivery as a local adapter.

```text
Agent stops
  Core commits runwield.attention and response evidence
  committed generation is available
  live attention event publishes stable ID
  each loaded Session tab observes its Session feed
  browser-local claim picks one notifier
```

The option set aside is an owner-server-only attention writer. It would make Workspace see its own Sessions, but it
would miss TUI and Agent Client Protocol stops and create a second attention authority.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/agent-handler.ts` and shared Agent-completion handling — commit stable `runwield.attention` before
  `agentStopped` becomes eligible for delivery.
- `src/shared/session/session-runtime-events.js` — carry stable attention identity and committed generation facts on
  live events.
- `src/shared/session/session-transcript-projection.js` — read unresolved and resolved attention from committed
  transcript evidence.
- `src/ui/tui/system-notifications.ts` — keep terminal notification meaning aligned with the durable Core event.
- `src/ui/workspace/server/` — expose authenticated stable-Session attention reads for loaded Session screens.
- `src/ui/workspace/pages/projects/[projectId]/sessions/[runwieldSessionId].astro`, `src/ui/workspace/static/`, and
  `src/ui/workspace/react/` — observe the exact Session feed and implement browser notification permission, suppression,
  claim, and click-focus behavior.
- `docs/domain-language.md` — define durable Session attention language and its relationship to notifications and
  Dashboard items.

When the implementation makes proposed domain language true, include the applicable domain-language file:
`docs/domain-language.md` for a single-context project, or the context-specific `domain-language.md` identified by
`docs/domain-language-map.md` for a multi-context project.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/system-notifications.ts` — reuse the current `agentStopped` message meaning.
- `src/shared/session/session-runtime-events.js#RuntimeEventTypes.ATTENTION_REQUESTED` — extend the existing event
  instead of adding a parallel browser event.
- `src/shared/session/session-transcript-projection.js#summarizeProjectedEntries` — reuse the existing preliminary
  `runwield.attention` reader and make it production-backed.
- Workspace Session page event/subscription code — reuse current Session loading and reconnect patterns.
- Browser-local storage or channel patterns already used in `src/ui/workspace/static/` — coordinate duplicate loaded
  tabs without server-side notification ownership.

## Implementation Steps

- The shared Core Agent-completion transaction commits `runwield.attention` with stable event ID, reason, Session
  identity, and generation before live publication.
- A later committed user response or interaction result resolves the matching attention event so refresh, reconnect, and
  server restart do not notify again.
- Live runtime events carry enough stable identity for TUI, Workspace, and Agent Client Protocol readers to agree on the
  same event.
- Workspace Session screens can read unresolved attention for only their own stable Session.
- Browser tabs suppress the system notification when any focused visible tab is showing the exact Session.
- If no exact visible tab is focused, loaded background copies claim the stable attention event so only one browser
  notification appears.
- Clicking the notification focuses the exact loaded Session tab that claimed it.
- Permission denial or unsupported Notification APIs cause no repeated prompts and do not change durable attention
  evidence.
- `docs/domain-language.md` describes Session attention, avoided aliases, and stable relationships to Session
  Transcript, Attention Dashboard, and browser notification delivery.

## Verification Plan

- Automated: run `deno run -A scripts/run-tests.js src/ui/workspace/session-tab-notifications.browser.test.ts`.
- Automated: add integration coverage that at least one Agent stop from a separate TUI process commits attention and is
  visible to a loaded Workspace Session.
- Automated browser behavior: use two different Session tabs and duplicate tabs for one Session; prove notification
  claim, exact-tab focus, response clearing, refresh, reconnect, and server restart behavior.
- Automated: prove component markup alone is not the check; the test must observe browser notification behavior or the
  nearest supported headed-browser substitute.
- Manual headed browser: run `deno task workspace:dev` and then verify against a real paired owner server because the
  catalog does not exercise cross-process Sessions.
- Manual: grant notification permission from a user action, send one Session to the background, stop its Agent, and
  confirm exactly one notification appears and focuses the correct tab.
- Expected result: loaded Session tabs notify like separate TUIs, but no tab claims workflow authority or creates a new
  in-app notification state.
- When applicable: confirm the glossary describes implemented behavior and does not promote unimplemented proposals.

## Edge Cases & Considerations

- V2 sends browser notifications only for `agentStopped`.
- Questions waiting inside TUI or Agent Client Protocol remain process-local and use their owning surface notification.
- No loaded tab for the affected Session means no browser notification is promised.
- Dashboard attention remains durable even when browser notification permission is denied.
- Browser notification delivery must not acknowledge, resolve, or authorize workflow work.
