---
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
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-25T22:34:40-04:00"
status: "draft"
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

After validating the event and its settings, emit BEL before attempting desktop delivery. This ordering makes the bell
portable and independent: unsupported operating systems, missing notifier commands, denied notification permissions, or
command failures must not suppress it. Conversely, unknown events, globally disabled notifications, and individually
disabled events must emit neither BEL nor a desktop notification. A failed bell write must not prevent desktop delivery.

Do not add native notification sound arguments to `terminal-notifier` or `osascript`, a separate audio process,
terminal-specific urgency commands, or a new Runtime event. The TUI adapter remains the only consumer that turns the
existing `attention_requested` event into terminal/desktop effects, preserving clean ACP and headless stdout.

## Files to Modify

- `src/ui/tui/system-notifications.js` — normalize the terminal-bell setting, add an injectable best-effort BEL writer,
  emit it once at the enabled attention boundary, and expose its outcome in the structured notification result for
  deterministic tests.
- `src/ui/tui/system-notifications.test.js` — cover bell defaults, silent opt-out, cross-platform emission, disabled
  events, writer failure isolation, and independence from desktop command success.
- `config.schema.json` — define and describe `notifications.terminalBell` as a boolean with a default of `true`.
- `docs/settings.md` — document the portable terminal-bell behavior, visual-only opt-out, terminal/multiplexer control,
  and updated settings example.
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
- [ ] Step 4: In `notifyRunWieldEvent()`, emit BEL exactly once after rejecting unknown/globally disabled/event-disabled
      notifications but before desktop command construction. Record the outcome without changing the existing `sent`
      meaning, which continues to describe desktop notification delivery.
- [ ] Step 5: Preserve independent outcomes: continue macOS desktop delivery after a bell-write failure, emit BEL on
      non-macOS/unsupported desktop paths, and do not emit a second BEL when `terminal-notifier` falls back to
      `osascript`.
- [ ] Step 6: Expand unit tests with an injected byte writer to verify the byte is exactly `0x07`, default and malformed
      settings enable it, literal `false` disables it, all known events use it, disabled/unknown events do not, Linux
      can emit it while returning desktop reason `unsupported`, and command/writer failures remain isolated.
- [ ] Step 7: Add `notifications.terminalBell` to the configuration schema and settings documentation. Explain that
      terminal and multiplexer settings determine audio, visual, urgency, and tab-marker behavior; include a
      visual-desktop-only example using `{ "notifications": { "terminalBell": false } }`.
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
