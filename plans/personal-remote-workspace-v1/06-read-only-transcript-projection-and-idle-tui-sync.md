---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add a genuinely non-mutating transcript reader and idle TUI synchronization so phone-created Session generations appear in an already-open TUI without losing drafts."
affectedPaths:
    - "src/shared/session/root-session.js"
    - "src/shared/session/session-runtime.js"
    - "src/ui/tui/"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/system-notifications.js"
frontend: false
createdAt: "2026-07-22T03:56:51.470Z"
updatedAt: "2026-07-22T03:56:51.470Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 6
dependencies:
    - "04-activation-gated-workspace-session-continuation-apis"
---

# Read-Only Transcript Projection and Idle TUI Sync

## Context

Remote ideation is not complete if returning to an already-open TUI requires manual Session reopening or risks stale
writable state. Pi `SessionManager.open()` may migrate or rewrite files, so idle synchronization needs a genuinely
non-mutating transcript projection path and stable replay IDs.

This slice complements the phone tracer bullet by letting TUI observe committed Workspace generations while idle,
refresh its rendered conversation, preserve the user's unsent editor draft, and acquire activation only for the next
mutation.

## Objective

Implement automatic idle TUI synchronization:

- parse/project unseen transcript entries without opening a writable SessionManager;
- detect committed generation changes from the owner coordination DB;
- replay only unseen semantic events with stable IDs;
- refresh Agent, Plan, and attention summaries where available;
- preserve unsent editor drafts, pasted images, and local review annotations;
- acquire writable activation only when the TUI starts its next mutable turn.

## Approach

Add a read-only transcript reader/projection module beside `root-session.js` and integrate it into TUI idle loops. The
projection should reuse `SessionRuntime` replay event shaping where possible while avoiding code paths that mutate
transcript files. Keep behavior conservative: if projection cannot prove safe ordering or sees a reconciliation
mismatch, surface a recovery/sync warning rather than pretending the TUI is current.

## Files to Modify

- `src/shared/session/root-session.js` — add or delegate to non-mutating transcript locator/projection helpers.
- `src/shared/session/session-runtime.js` — expose replay/projection helpers without requiring writable Runtime
  ownership.
- `src/shared/session/session-runtime-events.js` — reuse stable semantic event construction for projected entries.
- `src/ui/tui/runtime-adapter.js` — refresh TUI state from committed generation changes while idle.
- `src/ui/tui/` — preserve draft/editor state across automatic refresh and show unobtrusive sync/ownership status.
- `src/ui/tui/system-notifications.js` — reuse existing attention notification behavior for synchronized remote updates.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime.js` `createReplayEvents` behavior — reuse event shape, but avoid mutating manager
  open paths.
- `src/shared/session/root-session.js` `getRootSessionBranchEntries` and export helpers — reuse transcript reading
  concepts where safe.
- `src/ui/tui/runtime-adapter.js` — preserve existing semantic Runtime rendering and subscription patterns.
- `src/ui/tui/system-notifications.js` — reuse notification style for remote updates.

## Implementation Steps

- [ ] Implement a non-mutating transcript parser/projection path for stable Session locators.
- [ ] Add committed-generation watcher or polling support for idle TUI Sessions.
- [ ] Deduplicate projected events using stable replay IDs and last-seen generation/entry evidence.
- [ ] Refresh TUI summaries and visible timeline while preserving unsent editor text, attachments, and local
      annotations.
- [ ] Ensure TUI creates a writable SessionManager only after winning activation for the next mutable turn.
- [ ] Add tests for Workspace-generated updates appearing in an open TUI, replay dedupe, draft preservation, and
      projection failure warnings.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: targeted tests should prove the read-only path does not call writable `SessionManager.open()`, only unseen
  entries replay, and draft state survives refresh.
- Manual cross-surface: start an ideation Session in TUI, leave unsent draft text in the editor, continue the Session
  from the phone Workspace UI, return to the open TUI, and verify new messages appear automatically while the draft
  remains intact.
- Expected result: TUI sync is visible but unobtrusive, and the next TUI prompt acquires activation rather than mutating
  stale state.

## Edge Cases & Considerations

- A transcript-ahead/database-behind crash must not duplicate entries to repair projection.
- If read-only parsing sees uncertain ordering, show recovery/degraded sync rather than hiding the issue.
- Idle clients may observe but not reserve the next mutation.
- Draft preservation is a product requirement, not a best-effort enhancement.
