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

<!-- runwield:manual-qa:start child="personal-remote-workspace-v2/03-plan-centered-workspace-home-and-navigation" -->

## Plan-Centered Workspace Home and Navigation

Manual verification steps for personal-remote-workspace-v2/03-plan-centered-workspace-home-and-navigation

- [ ] Open the Workspace root with a remembered Session and confirm that it stays on the Attention Dashboard.
- [ ] At desktop and phone widths, check the four Dashboard categories, empty/loading/error states, keyboard focus,
      drawer behavior, themes, and no horizontal overflow.
- [ ] Open Dashboard rows and confirm that each link reaches the owning Plan, review, Session, or Project; expand
      navigation and verify Plans contain only proven associated Sessions.
- [ ] Open a Plan home and a Session Workflow sidebar. Confirm that both show the same connected steps, current step,
      blocker, next action, and working Session link.
- [ ] Use Review, Answer, Run, Resume, or Recover and confirm that each opens or focuses the existing workflow action
      and does not create a duplicate interaction.
- [ ] In a TUI Session, use the displayed workflow action at wide and narrow widths. Confirm that composer text and
      Enter, Escape, Ctrl+C, and Ctrl+] behavior remain unchanged.

<!-- runwield:manual-qa:end child="personal-remote-workspace-v2/03-plan-centered-workspace-home-and-navigation" -->

<!-- runwield:manual-qa:start child="personal-remote-workspace-v2/04-unified-workspace-search-and-artifact-reading" -->

## Unified Workspace Search and Artifact Reading

Manual verification steps for personal-remote-workspace-v2/04-unified-workspace-search-and-artifact-reading

- [ ] At desktop and phone widths, open Search from the button and Cmd+K or Ctrl+K; confirm the query field receives
      focus, Escape closes the dialog and restores focus, and touch controls work.
- [ ] Enter a query, use Project and content-type filters, navigate results with the keyboard, and open View all
      results; confirm the query, filters, order, and result selection remain consistent.
- [ ] Check loading, no-match, and Project failure states; confirm long names do not cause horizontal overflow and
      results show Project and content-type labels.
- [ ] Open each supported document type; confirm the single Workspace header, phone Contents toggle, read-only content,
      and Back to Search behavior. Confirm existing Session artifacts show Back to Session.
- [ ] With two registered Projects, change or remove an indexed file externally; refresh and confirm stale content is
      not shown as a current result and healthy Project results remain available.

<!-- runwield:manual-qa:end child="personal-remote-workspace-v2/04-unified-workspace-search-and-artifact-reading" -->
