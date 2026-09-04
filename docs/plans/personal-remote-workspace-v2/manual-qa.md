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
