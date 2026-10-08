# Manual QA for attached-mode-claude-feature-preview

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="attached-mode-claude-feature-preview/01-activate-and-resume-an-attached-workflow" -->

## Activate and resume an Attached Workflow

Manual verification steps for attached-mode-claude-feature-preview/01-activate-and-resume-an-attached-workflow

- [ ] In a project, activate an Attached Workflow and confirm the JSON reports a new workflow, revision 1, and a pending
      Triage action.
- [ ] Confirm activation creates no repository files and does not change `.gitignore`.
- [ ] In a fresh process, submit a valid PLANNED_CHANGE Triage outcome and confirm status reports `awaiting_planning` at
      revision 2 with the next action to plan.
- [ ] Repeat the same submission and confirm it returns the saved result without changing the record.
- [ ] Submit an unsupported Routing Intent and confirm the workflow closes with an unsupported-in-preview result.

<!-- runwield:manual-qa:end child="attached-mode-claude-feature-preview/01-activate-and-resume-an-attached-workflow" -->

<!-- runwield:manual-qa:start child="attached-mode-claude-feature-preview/02-plan-one-feature-request-inside-claude-code" -->

## Plan one FEATURE request inside Claude Code

Manual verification steps for attached-mode-claude-feature-preview/02-plan-one-feature-request-inside-claude-code

- [ ] Load the plugin with `claude --plugin-dir src/attached/claude/plugin` and run
      `/runwield:request add a dark-mode toggle`; confirm Claude shows the setup preview before it writes the Plan.
- [ ] Confirm Claude writes the Plan under `docs/plans/` and submits it; run `wld` and confirm the Plan appears in
      `draft` with a Plan ID.
- [ ] Ask Claude an unrelated question after submission; confirm it answers normally.

<!-- runwield:manual-qa:end child="attached-mode-claude-feature-preview/02-plan-one-feature-request-inside-claude-code" -->

<!-- runwield:manual-qa:start child="attached-mode-claude-feature-preview/03-review-and-approve-plans-through-durable-plannotator-decisions" -->

## Review and approve Plans through durable Plannotator decisions

Manual verification steps for
attached-mode-claude-feature-preview/03-review-and-approve-plans-through-durable-plannotator-decisions

- [ ] In Claude Code, submit a plan and confirm the Plannotator review opens in the browser.
- [ ] Submit feedback, confirm Claude receives it, revises the plan, and opens the next review round in the same browser
      page.
- [ ] Approve a reviewed plan and confirm its status becomes `ready_for_work`.
- [ ] With a review pending, stop the MCP server; start a fresh Claude conversation and run `/runwield:plan-review`.
      Confirm the review reopens and the old browser endpoint is no longer active.

<!-- runwield:manual-qa:end child="attached-mode-claude-feature-preview/03-review-and-approve-plans-through-durable-plannotator-decisions" -->
