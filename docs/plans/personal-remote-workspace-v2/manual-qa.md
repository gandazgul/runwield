# Manual QA for personal-remote-workspace-v2

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="personal-remote-workspace-v2/01-durable-plan-to-session-continuity" -->

## Durable Plan-to-Session Continuity

Manual verification steps for personal-remote-workspace-v2/01-durable-plan-to-session-continuity

- [ ] In one terminal, create a Plan, quit the planning TUI, and run `wld load-plan <plan>`; confirm that the original
      conversation opens and the Plan menu is available.
- [ ] In the TUI, start a new Session, send one message, and run `/load-plan <plan>`; confirm that the command asks
      whether to switch or stay, and verify that staying keeps the current Session.
- [ ] Keep the planning TUI open. In a second terminal, run `wld load-plan <plan>`; confirm that the message names the
      TUI as the owning surface, the second terminal stays in a new Session, and the original TUI receives no message.
- [ ] With the Workspace development server running, request `/api/owner/projects/<id>/plans/<planId>/sessions`; confirm
      that the idle planning Session has `safePlanningResume: true`, and that an open TUI reports
      `activeSurface: "tui"`.

<!-- runwield:manual-qa:end child="personal-remote-workspace-v2/01-durable-plan-to-session-continuity" -->

<!-- runwield:manual-qa:start child="personal-remote-workspace-v2/02-shared-core-notifications-and-workspace-browser-delivery" -->

## Shared Core Notifications and Workspace Browser Delivery

Manual verification steps for personal-remote-workspace-v2/02-shared-core-notifications-and-workspace-browser-delivery

- [ ] Open the Workspace in a clean browser profile and verify the bell shows the correct default, enabled, blocked, and
      unavailable states; verify its keyboard focus, accessible name, tooltip, and position beside Plan Review actions.
- [ ] Enable alerts, background a Session tab, complete one Agent turn, and verify one browser notification shows the
      shared title and message; click it and verify it closes and attempts to focus the Session tab.
- [ ] With the Session tab visible and focused, complete an Agent turn and verify no notification appears; reload after
      completion and verify no old notification replays.
- [ ] Open the same Session in two tabs and verify each tab can alert independently; verify the local Plan Board has no
      bell.
- [ ] In a supported terminal, run an Agent turn and `/compact`; verify the existing Agent-stop and compaction
      notifications retain their current terminal title and focus behavior.

<!-- runwield:manual-qa:end child="personal-remote-workspace-v2/02-shared-core-notifications-and-workspace-browser-delivery" -->
