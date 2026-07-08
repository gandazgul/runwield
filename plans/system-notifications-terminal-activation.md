---
planId: "44a682b4-1ecf-43c0-a3f2-f8e65a3ecd26"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement system notifications when the agent stops, calls `plan_written`, or calls `user_interview`. Notifications should activate the terminal tab when clicked. This requires integrating a notification system (likely via a Deno module or OS-level call) and identifying the correct hooks in `agent-handler.js` and the specific tool implementations."
affectedPaths:
    - "src/shared/session/agent-handler.js"
    - "src/tools/user-interview.js"
    - "src/tools/plan-written.js"
frontend: false
createdAt: "2026-07-07T15:02:17-04:00"
updatedAt: "2026-07-07T20:19:26.252Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-07T20:07:41.915Z"
verifiedAt: "2026-07-07T20:19:26.252Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-07T20:19:21.996Z"
routingIntent: "FEATURE"
sessionName: "system notifications for agent events"
---

# System Notifications with Terminal Activation

## Context

The request is to make `wld` send a desktop/system notification when attention is needed:

- an agent stops and control returns to the user,
- the agent invokes `plan_written`,
- the agent invokes `user_interview`.

Clicking the notification should bring the user back to the terminal emulator tab where the `wld` process is running.

Current source seams:

- `src/shared/session/agent-handler.js` is the workflow-aware boundary for an active agent turn and already decides
  whether follow-up workflow execution starts or control returns.
- `src/shared/session/session.js` subscribes to agent events, including `tool_execution_start`, `message_end`, and
  `turn_end`; it already tracks tool invocations and renders tool blocks.
- `src/tools/plan-written.js` owns the blocking plan review / approval flow and already emits TUI system messages.
- `src/tools/user-interview.js` owns blocking structured prompts via `uiAPI.promptSelect` / `uiAPI.promptText`.
- Because `src/shared/session/session.js` receives `tool_execution_start` before tool execution, `plan_written` and
  `user_interview` notifications can be wired centrally without changing the tool implementations themselves.
- `src/ui/tui/terminal-title.js` already sets a human-readable terminal title (`wld - <session>`), but title alone may
  not uniquely identify a tab.
- Deno compile uses `-A`, so shelling out to OS notification/activation helpers is compatible with the existing
  permission model.

Confirmed product direction from the planning interview:

- Exact click-to-tab behavior is terminal-specific; there is no required generic solution for every terminal.
- Notifications should include the RunWield session name/context so the user can identify the source even when exact
  activation is unavailable.
- Use `terminal-notifier` as an optional macOS click-capable notifier when installed; fall back gracefully when it is
  absent.
- Notify whenever an agent turn returns control to the user and no automated workflow continues.

Platform constraint: macOS Terminal.app and iTerm2 can usually activate a tab by its TTY via AppleScript. WezTerm can
activate a pane by `$WEZTERM_PANE`. Kitty needs remote-control support for exact pane/window focus; otherwise the
reliable fallback is app activation plus a clearly named notification.

## Objective

Build a small notification boundary that can be called from workflow/tool seams without scattering OS-specific code. It
should:

- send attention notifications for agent idle/stop, `plan_written`, and `user_interview`,
- include enough terminal identity metadata to activate the current terminal tab/pane where supported,
- fail silently/non-disruptively when notifications are unsupported, denied, or activation fails,
- be unit-testable through dependency injection,
- preserve current TUI and workflow behavior.

## Approach

Add a new pure JavaScript notification helper module, tentatively `src/shared/system-notifications.js`, that
centralizes:

- settings resolution (`notifications.enabled`, event enablement, and activation preference),
- current terminal identity detection (`tty`, `TERM_PROGRAM`, `TERM`, `ITERM_SESSION_ID`, `WEZTERM_PANE`, Kitty env
  vars, process id, terminal title),
- notification dispatch,
- best-effort click activation command construction.

Confirmed v1 behavior:

- Enable notifications by default when a supported system notifier is available; otherwise do nothing and keep running.
- Add a settings escape hatch in global/project settings:
  - `notifications.enabled: boolean`
  - optional `notifications.events.agentStopped|planWritten|userInterview: boolean`
  - optional `notifications.activation: "tab" | "app" | "none"`
- For macOS, prefer a click-capable notifier path. Detect optional `terminal-notifier` at runtime and use it when
  present. When it is absent, fall back gracefully to a non-clickable `osascript display notification` or no-op; the
  notification body/title must still include the session name/context so the user can identify the source manually.
- Activate exact tabs/panes where the terminal provides a reliable target:
  - Terminal.app / iTerm2: AppleScript selects the window/tab/session whose TTY matches the captured `tty`.
  - WezTerm: use `wezterm cli activate-pane --pane-id <WEZTERM_PANE>` when present.
  - Kitty: use `kitty @ focus-window` only when remote-control variables are present/enabled; otherwise fall back to
    activating the Kitty app.
- Notify on `plan_written` and `user_interview` at the start of the blocking user-facing interaction, so the user is
  alerted while input is needed.
- Notify on agent stopped only at the point where control is actually returned to the user, not when RunWield is
  immediately continuing an automated workflow.

## Files to Modify

- `src/shared/system-notifications.js` — new OS/terminal notification helper with dependency-injected command runner,
  env lookup, settings lookup, terminal identity capture, and event-specific public functions.
- `src/shared/system-notifications.test.js` — unit tests for settings resolution, command selection, event
  deduping/quiet no-op behavior, macOS Terminal/iTerm/WezTerm/Kitty activation command construction, and unsupported
  platform fallback.
- `src/shared/session/agent-handler.js` — call the notification helper when the handler reaches an idle/stop state and
  control returns to the user; avoid duplicate notifications before automatic plan execution, validation, or router
  dispatch.
- `src/shared/session/session.js` — use `tool_execution_start` as the central hook for `plan_written` and
  `user_interview` notifications; keep TUI tool rendering unchanged.
- `config.schema.json` — document the new `notifications` settings object.
- `docs/settings.md` — add a short user-facing settings reference for notifications and optional `terminal-notifier`
  click support.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/settings.js` — use `getMergedCustomSetting()` for project-overrides-global notification settings, matching
  existing settings behavior.
- `src/ui/tui/terminal-title.js` — reuse `formatTerminalTitle()` / current session naming as notification context, but
  do not rely on title as the only tab identifier.
- `src/shared/clipboard.js` — mirror the pattern of OS-specific best-effort command execution and dependency injection
  for tests.
- `src/shared/session/session.js` event subscriber — reuse the existing `tool_execution_start` stream so notification
  logic stays centralized and the tools themselves remain focused on their prompt/review workflows.
- Existing Deno test style in `src/tools/__tests__/user-interview.test.js`, `src/tools/__tests__/plan-written.test.js`,
  and `src/shared/session/session-subscribers.test.js`.

## Implementation Steps

- [ ] Step 1: Implement the confirmed v1 scope: terminal-specific activation where available, session-name context in
      all notifications, optional `terminal-notifier` click support on macOS, and graceful fallback otherwise.
- [ ] Step 2: Create `src/shared/system-notifications.js` with JSDoc typedefs for notification settings, terminal
      identity, notification event, command result, and dependency injection. Keep all code pure JavaScript.
- [ ] Step 3: Implement settings resolution with safe defaults and `getMergedCustomSetting("notifications")`;
      unsupported/malformed settings should fall back rather than throw.
- [ ] Step 4: Implement terminal identity detection, including `tty` capture via an injected command runner, relevant
      env vars, process id, and current terminal app inference.
- [ ] Step 5: Implement platform notification dispatch. On unsupported platforms or missing notifier capability, return
      a structured `{sent:false, reason}` result without surfacing errors to the user.
- [ ] Step 6: Implement click activation command generation for the confirmed terminal set. Prefer exact tab/pane
      activation where possible; otherwise use the confirmed fallback behavior.
- [ ] Step 7: Wire `plan_written` and `user_interview` notifications from `attachUiSubscribers()` on
      `tool_execution_start`. Fire-and-forget the async notifier, catch/ignore failures, and do not alter tool block
      rendering or tool execution results.
- [ ] Step 8: Wire agent-stopped notifications in `createAgentHandler()` at user-control return points. Add a small
      local helper/flag so the handler notifies on ordinary fall-through, after validation completes, and before early
      returns that hand control back (for example workflow completion without validation), but does not notify before
      triage dispatch, approved-plan execution, or other immediate automated continuations.
- [ ] Step 9: Add/adjust tests for notification helper behavior, tool start notification hooks, and agent stop
      notification routing. Use injected dependencies; do not send real OS notifications during tests.
- [ ] Step 10: Update `config.schema.json` with the `notifications` object and event/activation fields.
- [ ] Step 11: Update `docs/settings.md` with the notification settings, expected defaults, optional `terminal-notifier`
      install note, and terminal-specific activation caveat.

## Verification Plan

- Automated:
  `deno test -A src/shared/system-notifications.test.js src/shared/session/session-subscribers.test.js src/shared/session/agent-handler.test.js`
- Automated: `deno task -q check`
- Automated: `deno task -q lint`
- Automated: `deno task -q fmt:check`
- Manual: start `wld` in the target terminal, trigger a simple agent response that stops without workflow continuation,
  and confirm a notification appears.
- Manual: click the agent-stopped notification and confirm the correct terminal tab/pane becomes active when the
  terminal supports exact activation; confirm the agreed fallback otherwise.
- Manual: trigger a Planner path that calls `user_interview`; confirm the notification appears before/while the
  structured prompt is waiting, and clicking returns to the prompt.
- Manual: trigger `plan_written`; confirm the notification appears when plan review/user approval is needed, and
  clicking returns to the `wld` terminal tab.
- Manual: disable notifications via settings and confirm no notifications are sent.

## Edge Cases & Considerations

- Exact tab activation cannot be guaranteed for every terminal emulator. The plan must make unsupported-terminal
  fallback explicit rather than silently claiming exact tab support.
- macOS notification click callbacks may require a click-capable notifier helper; plain `osascript display notification`
  is not sufficient for reliable command-on-click behavior.
- Notifications must never break agent execution, tool prompting, plan review, or workflow validation if the OS denies
  permissions or a helper command fails.
- Avoid duplicate notifications for one attention event. In particular, `plan_written` may also cause the agent to stop;
  event sequencing should prevent noisy duplicate notifications where possible.
- Tests should inject command/env/settings dependencies and assert command construction/results rather than sending real
  notifications.
- Confirmed fallback: v1 can focus the terminal application or simply include session context in the notification when
  the active terminal lacks a safe exact-tab API.
