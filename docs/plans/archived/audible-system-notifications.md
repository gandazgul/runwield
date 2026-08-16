---
planId: "6be1cd31-a2a2-4ca6-9f4c-d3e7982cd121"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Emit a portable terminal bell for RunWield TUI attention notifications so terminal tabs can provide audible, visual, or urgency feedback."
affectedPaths:
    - "src/ui/tui/system-notifications.js"
    - "src/ui/tui/system-notifications.test.js"
    - "config.schema.json"
    - "docs/settings.md"
    - "TODO.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-25T22:34:40-04:00"
updatedAt: "2026-07-26T03:09:04.966Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
implementedAt: "2026-07-26T02:57:31.687Z"
verifiedAt: "2026-07-26T03:06:31.885Z"
executionReport: "- Implemented portable TUI terminal BEL for enabled RunWield attention notifications, with `notifications.terminalBell` defaulting to `true` and literal `false` suppressing BEL only.\n- Preserved existing macOS desktop notification delivery/click behavior and kept `terminal-notifier`/`osascript` commands free of native sound options to avoid duplicate alerts.\n- Updated config schema, settings docs, and marked the notification sound TODO complete.\n- Verified: `deno test -A src/ui/tui/system-notifications.test.js` passed; `deno fmt --check src/ui/tui/system-notifications.js src/ui/tui/system-notifications.test.js docs/settings.md TODO.md config.schema.json` passed; `deno run ci` passed (1717 tests).\n- Manual terminal-emulator checks were not run in this non-interactive session; automated tests cover injected BEL emission, opt-out, disabled events, fallback, and failure isolation."
workRecord:
    status: "generated"
    recordId: "b3d1dc0c-e754-470c-86f6-86cb2aeecd45"
    path: "docs/work-records/2026-07-26-added-tui-terminal-bell-notifications.md"
    lastAttemptAt: "2026-07-26T03:08:58.548Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "4ea17428fda84631b015adba82e33e6b3daf118e"
    targetBranch: "main"
    targetHeadBeforeMerge: "965af817d70f7a2f723190b3aeb2ca776ac30373"
---

# Terminal Bell for TUI Notifications

## Context

RunWield's TUI already handles semantic attention events when an agent returns control without an automated
continuation, `plan_written` starts Plan review, or `user_interview` requests input. Delivery is centralized in
`src/ui/tui/system-notifications.js`: it prefers optional `terminal-notifier` for macOS desktop notifications with click
activation and falls back to `osascript`. Other platforms currently receive no desktop notification from this boundary.

Desktop notifications alone do not mark the terminal tab or pane that originated the event. Emitting the ASCII BEL
control character (`\x07`) through the RunWield TUI's own stdout allows the owning terminal to apply its configured bell
behavior. Depending on terminal settings, that may include sound, a visual flash, window urgency, or an unfocused-tab
marker. Kitty, for example, supports an audio bell, window attention, and `bell_on_tab`; WezTerm exposes a pane-specific
bell event. RunWield should trigger the standard terminal capability rather than implement terminal-specific tab
highlighting.

The confirmed product behavior is to emit one terminal BEL by default for all three existing attention events on every
platform where the TUI runs. Existing macOS desktop notification commands should remain silent so users do not receive
two requested sounds. The terminal emulator and any multiplexer remain authoritative over whether BEL is audible,
visual, propagated, or ignored.

## Objective

Emit exactly one best-effort terminal BEL for every enabled RunWield TUI attention event, independently of macOS desktop
notification support or delivery success. Add a global/project `notifications.terminalBell` boolean that defaults to
`true`; literal `false` preserves desktop notifications while suppressing BEL. Keep Runtime semantics, desktop messages,
click activation, and non-fatal notification behavior unchanged.

## Approach

Extend the existing normalized `NotificationSettings` shape with `terminalBell`. Resolve it using the module's
established opt-out convention: only literal `false` disables the bell, while missing or malformed values retain the new
default.

Add a small best-effort terminal-bell writer inside the TUI notification module. Its production implementation writes a
single encoded `\x07` byte synchronously to `Deno.stdout`; its write dependency is injectable so tests never ring the
real terminal. Direct TUI stdout is the correct destination because it identifies the exact tab/pane that owns the
RunWield process, does not require terminal remote-control permissions, and matches the existing best-effort terminal
control-sequence pattern used by the TUI lifecycle.

Move known-event and settings validation ahead of terminal identity detection. After validation, emit BEL immediately
and only then perform the asynchronous TTY lookup and desktop command construction. This ordering makes the bell prompt,
portable, and independent: slow identity detection, unsupported operating systems, missing notifier commands, denied
notification permissions, or command failures must not suppress it. Conversely, unknown events, globally disabled
notifications, and individually disabled events must emit neither BEL, TTY lookup, nor desktop notification attempt. A
failed bell write must not prevent desktop delivery.

Do not add native notification sound arguments to `terminal-notifier` or `osascript`, a separate audio process,
terminal-specific urgency commands, or a new Runtime event. The TUI adapter remains the only consumer that turns the
existing `attention_requested` event into terminal/desktop effects, preserving clean ACP and headless stdout.

## Files to Modify

- `src/ui/tui/system-notifications.js` — normalize the terminal-bell setting, add an injectable best-effort BEL writer,
  emit it once at the enabled attention boundary, and expose its outcome in the structured notification result for
  deterministic tests.
- `src/ui/tui/system-notifications.test.js` — cover bell defaults, silent opt-out, cross-platform emission, disabled
  events, writer failure isolation, and independence from desktop command success.
- `config.schema.json` — define `notifications.terminalBell` as a boolean with a default of `true`, and broaden the
  existing notification/enablement descriptions to cover both terminal BEL and desktop effects.
- `docs/settings.md` — update the custom-key table and notification section to document portable terminal-bell behavior,
  BEL opt-out, terminal/multiplexer control, enablement semantics, and an updated settings example.
- `TODO.md` — mark the existing notification-sound investigation item complete once implementation and verification
  pass.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `resolveNotificationSettings()` in `src/ui/tui/system-notifications.js` — retain its safe normalization and
  literal-false opt-out convention.
- `notifyRunWieldEvent()` and `notifyRunWieldEventQuietly()` in `src/ui/tui/system-notifications.js` — keep BEL and
  desktop delivery behind the same enabled-event boundary and preserve fire-and-forget failure isolation.
- `SystemNotificationDeps` and `mergeDeps()` in `src/ui/tui/system-notifications.js` — add the injected terminal writer
  alongside existing injected environment, settings, and command dependencies.
- The best-effort direct stdout pattern in `src/ui/tui/tui-manager.js` — follow its guarded terminal control-sequence
  write without moving TUI effects into shared Runtime code.
- `makeCommandRecorder()` and dependency-injected test setup in `src/ui/tui/system-notifications.test.js` — record BEL
  writes and notification commands without producing real side effects during tests.

## Implementation Steps

- [ ] Step 1: Extend the `NotificationSettings`, `SystemNotificationDeps`, and `NotificationResult` JSDoc typedefs with
      the terminal-bell preference, an injected write operation, and a boolean result field such as
      `terminalBellEmitted`.
- [ ] Step 2: Update `resolveNotificationSettings()` so `terminalBell` defaults to `true`, only literal `false` disables
      it, and malformed notification settings remain safe.
- [ ] Step 3: Add a focused best-effort helper that writes one encoded BEL byte (`\x07`) to `Deno.stdout` through the
      injected dependency, returns whether the write succeeded, and catches all write errors without logging into or
      disrupting the live TUI.
- [ ] Step 4: In `notifyRunWieldEvent()`, move known-event and settings checks before `detectTerminalIdentity()`, then
      emit BEL exactly once before any asynchronous identity lookup or desktop command construction. Record the outcome
      without changing the existing `sent` meaning, which continues to describe desktop notification delivery.
- [ ] Step 5: Preserve independent outcomes: continue macOS desktop delivery after a bell-write failure, emit BEL on
      non-macOS/unsupported desktop paths, and do not emit a second BEL when `terminal-notifier` falls back to
      `osascript`.
- [ ] Step 6: Expand unit tests with an injected byte writer to verify the byte is exactly `0x07`, default and malformed
      settings enable it, literal `false` disables BEL while still allowing desktop delivery, all known events use it,
      and Linux can emit it while returning desktop reason `unsupported`. Prove globally disabled, event-disabled, and
      unknown events perform no BEL write, TTY lookup, or desktop attempt; writer/command failures remain isolated;
      `terminal-notifier` fallback emits only one BEL; and both desktop command variants remain free of native sound
      options/actions.
- [ ] Step 7: Add `notifications.terminalBell` to the configuration schema and update the existing top-level
      notification and `enabled` descriptions plus the settings custom-key table/section. State that `enabled: false`
      gates both BEL and desktop delivery, while `terminalBell: false` suppresses all BEL-derived terminal effects but
      keeps desktop delivery. Explain that terminal and multiplexer settings determine audio, visual, urgency, and
      tab-marker behavior, and include `{ "notifications": { "terminalBell": false } }` as the opt-out example.
- [ ] Step 8: Mark the corresponding `TODO.md` item complete after automated and manual checks pass.

## Verification Plan

- Automated: `deno test -A src/ui/tui/system-notifications.test.js`
- Automated: `deno run ci`
- Manual: in Kitty with its terminal bell enabled, leave the RunWield tab unfocused and trigger each of `agentStopped`,
  `planWritten`, and `userInterview`; each event should emit one configured bell response and mark the originating tab
  according to Kitty's `bell_on_tab` behavior while the macOS desktop notification still appears.
- Manual: repeat one event in another available terminal such as WezTerm, iTerm2, or Terminal.app; confirm that
  terminal's configured BEL behavior targets the RunWield tab/pane without altering TUI rendering.
- Manual: set `notifications.terminalBell` to `false`; desktop notifications should retain their current appearance and
  click activation, with no BEL-triggered terminal response.
- Manual: disable one event under `notifications.events`; triggering that event should produce neither BEL nor a desktop
  notification.
- Manual: on a non-macOS TUI or with macOS notifier commands unavailable, trigger an enabled event; BEL should still be
  emitted even though desktop delivery is unsupported.
- Expected: BEL writer failures, unsupported desktop platforms, missing notifier commands, command failures, and denied
  notification permissions remain non-fatal and do not interrupt the Session or workflow.

## Edge Cases & Considerations

- This intentionally changes the default for existing TUI users by emitting BEL on attention events. The documented
  `notifications.terminalBell: false` setting provides a compatibility and accessibility escape hatch.
- BEL does not guarantee audible sound or visible highlighting. Terminal emulator, operating-system, and multiplexer
  configuration can mute, transform, intercept, or ignore it; RunWield should document this rather than bypass user
  controls.
- Emit BEL through the TUI process's stdout only. Do not write from SessionRuntime, ACP, Headless Mode, or shared
  workflow code, where a control byte could corrupt protocol output.
- A single attention event must produce at most one BEL even when desktop delivery retries from `terminal-notifier` to
  `osascript`.
- The structured result must distinguish desktop delivery (`sent`) from BEL emission so an unsupported desktop platform
  can truthfully report `sent: false` and `terminalBellEmitted: true`.
- Synchronous output is limited to one byte and wrapped in error handling. If direct stdout causes a renderer regression
  in a supported terminal, route the same byte through an established `ProcessTerminal` raw-write capability only after
  verifying that API; do not render BEL as visible transcript content.
- Native macOS notification sounds and named/custom sound selection are excluded to avoid duplicate alerts and divergent
  platform semantics.
