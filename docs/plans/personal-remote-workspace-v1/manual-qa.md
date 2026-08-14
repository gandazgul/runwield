# Manual QA for personal-remote-workspace-v1

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="personal-remote-workspace-v1/15-complete-workspace-session-navigation-and-timeline-ux" -->

## Complete Workspace Session Navigation and Timeline UX

Manual verification steps for personal-remote-workspace-v1/15-complete-workspace-session-navigation-and-timeline-ux

- [ ] Start the paired owner server with Session Activation enabled and open Workspace in the browser. Go to Projects ->
      Sessions and verify the page loads with the correct data on desktop and mobile without showing API 404 or
      unauthorized errors.
- [ ] On a phone-size viewport (~390×844), create a new Session with a normal user request from Sessions list, wait for
      Router handoff, answer one live interaction, refresh the page, and verify the draft text and timeline remain
      visible and usable.
- [ ] Continue one idle Session from Workspace to TUI and back to Workspace with one stable Session identity. Verify
      committed history is linear and no duplicate turns are created.
- [ ] While TUI is still renewing owner control, verify the **Take control** action is not available. Stop the TUI
      process, wait for the owner deadline, accept the warning, force control, and verify you can send the next message
      from Workspace.
- [ ] In the force dialog, verify the warning clearly says prior commands may still finish, cancel closes the dialog
      without changes, and confirming force does not claim to undo or cancel prior external effects.
- [ ] Edit or corrupt a disposable current transcript file, then run through force recovery flow and verify the feature
      blocks recovery and shows plain recovery guidance instead of trusting malformed history.

<!-- runwield:manual-qa:end child="personal-remote-workspace-v1/15-complete-workspace-session-navigation-and-timeline-ux" -->
