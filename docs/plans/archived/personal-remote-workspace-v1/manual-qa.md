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

<!-- runwield:manual-qa:start child="personal-remote-workspace-v1/16-workspace-plan-review-and-approve-ui" -->

## Workspace Plan Review and Approve UI

Manual verification steps for personal-remote-workspace-v1/16-workspace-plan-review-and-approve-ui

- [ ] On desktop, start a Workspace Planner Session, open the **Plan ready for review** card, and confirm the stable
      Plan page shows the Project, Session, Plan, live-review state, and three-area review layout.
- [ ] On a phone-sized viewport, review a long Plan, open the table-of-contents and annotation drawers, add an
      annotation and Overall feedback, and confirm the sticky actions remain visible without clipped content or
      horizontal overflow.
- [ ] Submit Feedback, Approve for Later, and the classification-correct run or slice action; confirm Feedback and run
      or slice return to the Session timeline, while Approve for Later shows its result and **Return to Session**
      without starting work.
- [ ] Change Plan or worktree state during an open review and confirm submission shows a stale or recovery message,
      keeps unsent annotations and feedback, and requires an explicit refresh or new decision.
- [ ] Stop the process that owns an unanswered review, resume the Session from the other surface, and confirm the old
      review cannot be answered; send the prepared resubmission message explicitly and confirm a new review appears.

<!-- runwield:manual-qa:end child="personal-remote-workspace-v1/16-workspace-plan-review-and-approve-ui" -->

<!-- runwield:manual-qa:start child="personal-remote-workspace-v1/17-workspace-ux-hardening-pass" -->

## Workspace UX Hardening Pass

Manual verification steps for personal-remote-workspace-v1/17-workspace-ux-hardening-pass

- [ ] On desktop and phone layouts, open a Session and confirm the workflow-state sidebar shows execution, validation,
      repair, and completion progress.
- [ ] Paste an image into the Session composer, submit it, then refresh and reconnect; confirm the image remains
      attached to the message.
- [ ] Compare the web Session stream with the same session in the TUI; confirm segment and recovery events use the same
      block types and order, and consecutive same-type events appear in one block.
- [ ] Scroll up in the Session stream, then receive a new event; confirm the view returns to the latest block near the
      composer.
- [ ] Confirm the Session state indicator shows running, blocked, failed, idle, and owned-elsewhere states, and use a
      browser recovery action with its plain-language confirmation.

<!-- runwield:manual-qa:end child="personal-remote-workspace-v1/17-workspace-ux-hardening-pass" -->
