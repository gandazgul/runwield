---
planId: "e5dc3b60-334b-4a38-a8cf-ddd4cf6659a9"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Notify the user when the interactive /compact command reaches any terminal outcome."
affectedPaths:
    - "src/cmd/compact/index.js"
    - "src/cmd/compact/index.test.js"
    - "src/cmd/registry.js"
    - "src/ui/tui/slash-dispatch.js"
    - "src/ui/tui/slash-dispatch.test.js"
    - "src/ui/tui/system-notifications.js"
    - "src/ui/tui/system-notifications.test.js"
    - "config.schema.json"
    - "docs/settings.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T21:09:52-04:00"
updatedAt: "2026-07-27T03:19:09.421Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
implementedAt: "2026-07-27T01:17:14.691Z"
verifiedAt: "2026-07-27T03:18:57.659Z"
userVerifiedAt: null
executionReport: "- Implemented `compactionFinished` notification event with default-enabled settings, schema, docs, and tests.\n- Wired TUI slash dispatch to pass notification callbacks into commands; `/compact` now sends one best-effort generic notification after success, failure, cancellation, or no-op outcomes.\n- Added coverage for event settings, dispatch dependency injection, and `/compact` terminal-outcome notifications.\n- Verification: `deno test src/ui/tui/system-notifications.test.js src/ui/tui/slash-dispatch.test.js src/cmd/compact/index.test.js` initially failed without env permissions; reran with `deno test -A --no-check ...` and passed.\n- Verification: `deno task ci` passed (1822 tests, 0 failed).\n- Manual interactive TUI checks were not run in this non-interactive API session."
workRecord:
    status: "generated"
    recordId: "1b47a356-624c-4045-98bf-7e63d92f226d"
    path: "docs/work-records/2026-07-27-compact-command-completion-notifications.md"
    lastAttemptAt: "2026-07-27T03:19:03.132Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "a96a3de0cc7848e626d710812ed37f5d7568fc25"
    targetBranch: "main"
    targetHeadBeforeMerge: "9e7264dd4227b48d81c63ec06bf105a5737c820a"
---

# Compact Completion Notification

## Context

The User Request is to add a notification when `/compact` finishes. In RunWield terminology, `/compact` is an
interactive TUI slash command that manually compacts the current Session context through
`SessionRuntime.compactSession()`.

Current behavior in `src/cmd/compact/index.js`:

- requires an active interactive TUI `uiAPI`, `sessionRuntime`, and `sessionId`;
- appends `Compacting context... (Esc to cancel)`;
- awaits `sessionRuntime.compactSession(sessionId, customInstructions)`;
- on success, appends `Session compacted.`, `Tokens before: ...`, and the generated summary;
- on failure/cancellation/no-op, appends a specific terminal outcome message.

Current notification behavior lives in `src/ui/tui/system-notifications.js`. It supports terminal BEL plus best-effort
desktop notifications for configured TUI attention events. Settings are documented and schema-backed under
`notifications.events` with existing event flags for `agentStopped`, `planWritten`, and `userInterview`.

The planning decision from the user is that `/compact` should notify after **all terminal outcomes**: successful
compaction, failed compaction, user cancellation, and the `Nothing to compact` no-op case.

## Objective

Add a configurable TUI attention notification that fires once after an invoked `/compact` command reaches any terminal
outcome, without changing the compaction result text or making notification delivery part of compaction success/failure.

The notification should be generic, because the TUI already prints the authoritative outcome details. Suggested
user-facing copy:

- title: `Compaction finished — <Session Name>`
- message: `The /compact command finished. Return to view the result.\nSession: <Terminal Title>`

## Approach

Extend the existing notification event model with a new event named `compactionFinished`, default it to enabled, and
route the interactive slash command's notification dependency through the TUI slash-dispatch layer.

Do not emit this notification from `SessionRuntime.compactSession()` itself: compaction may also be invoked by non-TUI
flows such as resume compaction, and this request is specifically for the manual `/compact` finish point. Keeping the
notification in the slash command preserves the user-visible behavior and avoids treating internal Runtime compaction as
a TUI attention event.

The `/compact` command should append its success/failure/cancellation/no-op message first, then fire the best-effort
notification. Notification failures must be swallowed and must not alter the command outcome.

## Files to Modify

- `src/ui/tui/system-notifications.js` — add `compactionFinished` to notification labels, messages, JSDoc typedefs,
  settings normalization, and known-event validation.
- `src/ui/tui/system-notifications.test.js` — update default settings expectations and add coverage that
  `compactionFinished` can be sent and can be disabled independently.
- `src/ui/tui/slash-dispatch.js` — pass the TUI notification helper into built-in slash command `CommandContext` so
  commands can trigger notifications without importing TUI notification delivery directly from `src/cmd/`.
- `src/ui/tui/slash-dispatch.test.js` — verify built-in slash command dispatch receives the notification dependency.
- `src/cmd/registry.js` — extend `CommandContext` JSDoc with an optional `notifyRunWieldEvent` callback using JSDoc
  types only.
- `src/cmd/compact/index.js` — after every terminal result from an attempted compaction, call
  `notifyRunWieldEvent("compactionFinished", { sessionName })` best-effort. Use
  `sessionRuntime.getSessionSnapshot(sessionId)?.name` when available for notification context.
- `src/cmd/compact/index.test.js` — add tests that notifications fire once for success, cancellation, no-op, and
  failure, and do not fire when no active Runtime session exists.
- `config.schema.json` — add `notifications.events.compactionFinished` with default `true` and update the notification
  description.
- `docs/settings.md` — document the new event flag, defaults, and example JSON.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/system-notifications.js` — reuse `notifyRunWieldEventQuietly()`, `notifyRunWieldEvent()`,
  `resolveNotificationSettings()`, terminal detection, BEL emission, and desktop-notification command building.
- `src/ui/tui/slash-dispatch.js` — reuse the existing built-in slash command dispatch seam that already supplies
  `uiAPI`, `sessionRuntime`, and `sessionId`.
- `src/cmd/compact/index.js` — reuse the existing single command outcome path; add notification after the final message
  rather than changing compaction semantics.
- `src/cmd/compact/index.test.js` and `src/ui/tui/system-notifications.test.js` — follow existing dependency-injection
  patterns for recording command and notification behavior.

## Implementation Steps

- [ ] Step 1: Extend `src/ui/tui/system-notifications.js` with a `compactionFinished` notification event.
  - Add `compactionFinished: "Compaction finished"` to `EVENT_LABELS`.
  - Add a generic finished message to `EVENT_MESSAGES`.
  - Update `NotificationEventName` and `NotificationEventSettings` JSDoc typedefs.
  - Default `events.compactionFinished` to enabled in `resolveNotificationSettings()`.
  - Include `compactionFinished` in `isKnownEvent()`.
- [ ] Step 2: Update notification tests in `src/ui/tui/system-notifications.test.js`.
  - Update default and malformed settings expectations to include `compactionFinished: true`.
  - Add or adapt a send test to call `notifyRunWieldEvent("compactionFinished", ...)` and assert title/message/session
    context.
  - Add disabled-event coverage for `{ events: { compactionFinished: false } }` producing `reason: "event_disabled"`
    with no BEL or command attempts.
- [ ] Step 3: Add a notification callback to command dispatch.
  - In `src/cmd/registry.js`, add optional `notifyRunWieldEvent` to `CommandContext` JSDoc.
  - In `src/ui/tui/slash-dispatch.js`, import or otherwise reference `notifyRunWieldEventQuietly`, add the optional
    callback to `SlashContext`, and pass `ctx.notifyRunWieldEvent || notifyRunWieldEventQuietly` into built-in command
    execution.
  - Update `src/ui/tui/slash-dispatch.test.js` to assert built-in commands receive `commandDeps.notifyRunWieldEvent`.
- [ ] Step 4: Wire `/compact` completion notification in `src/cmd/compact/index.js`.
  - Track whether compaction was actually attempted; do not notify for the preflight cases where interactive UI,
    `sessionRuntime`, or `sessionId` is missing.
  - For success, append the existing header and summary, then notify.
  - For caught cancellation, no-op, and failure outcomes, append the existing specific message, then notify.
  - Wrap notification invocation in a small best-effort helper so any thrown/rejected notification callback is ignored.
  - Resolve session context with `sessionRuntime.getSessionSnapshot?.(sessionId)?.name || undefined`.
- [ ] Step 5: Update `src/cmd/compact/index.test.js`.
  - Extend the fake Runtime with `getSessionSnapshot()` returning a Session Name.
  - Assert success calls the notifier once with event `compactionFinished` and the Session Name.
  - Assert each terminal error/no-op/cancel outcome also calls the notifier once after the outcome is handled.
  - Assert missing active Runtime session does not notify.
- [ ] Step 6: Update settings schema and docs.
  - In `config.schema.json`, add `events.compactionFinished` with boolean type and default `true`.
  - Update the `notifications` setting description to mention `/compact` completion.
  - In `docs/settings.md`, update the prose, defaults list, and JSON example to include `events.compactionFinished`.

## Verification Plan

- Automated: run the focused tests first:
  - `deno test src/ui/tui/system-notifications.test.js src/ui/tui/slash-dispatch.test.js src/cmd/compact/index.test.js`
- Automated: run the repository validation suite:
  - `deno task ci`
- Manual: in an interactive TUI Session, run `/compact` on a session with enough context to compact.
  - Expected: TUI prints the existing compaction success output and summary, then one notification/BEL is emitted
    according to `notifications` settings.
- Manual: in an interactive TUI Session, run `/compact` where there is not enough content to compact.
  - Expected: TUI prints `Nothing to compact — the session doesn't have enough messages yet.` and one generic
    compaction-finished notification/BEL is emitted.
- Manual: start `/compact` and cancel with Esc if cancellation is practically reproducible.
  - Expected: TUI prints `Compaction cancelled.` and one generic compaction-finished notification/BEL is emitted.
- Manual: temporarily configure `notifications.events.compactionFinished: false`.
  - Expected: `/compact` still prints all normal TUI output but emits no BEL and attempts no desktop notification for
    the compaction-finished event.
- Expected results for key scenarios:
  - Notification delivery is best-effort and never changes compaction success/failure behavior.
  - Existing notification events (`agentStopped`, `planWritten`, `userInterview`) keep their current defaults and
    behavior.
  - The new event is controlled independently from other notification events.

## Edge Cases & Considerations

- The notification should fire only after a `/compact` invocation reaches a terminal result, not when the command is
  rejected before compaction starts because there is no active interactive Session.
- Because the user requested notification for all terminal outcomes, the desktop notification copy must not imply
  success. The TUI remains the source for exact result details.
- `notifications.enabled: false` and `notifications.terminalBell: false` must continue to apply uniformly through
  `resolveNotificationSettings()`.
- Avoid adding TypeScript syntax; all new typing must be JSDoc in `.js` files.
- This plan intentionally does not add `compactionFinished` to `RuntimeEventTypes.ATTENTION_REQUESTED` unless
  implementation discovers an existing Runtime attention path is required. The planned seam is slash-command-local
  notification delivery through `CommandContext`.
