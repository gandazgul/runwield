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
