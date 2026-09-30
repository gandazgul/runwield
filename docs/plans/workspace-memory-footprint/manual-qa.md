# Manual QA for workspace-memory-footprint

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="workspace-memory-footprint/01-reuse-workspace-renderer" -->

## Reuse the Workspace Page Renderer

Manual verification steps for workspace-memory-footprint/01-reuse-workspace-renderer

- [ ] Start the isolated fixture server and record the localhost URL it prints.
- [ ] In a uniquely named `agent-browser` session, navigate between two Sessions, two Plans, Plan Review, Code Review,
      and a question page ten times; confirm each page shows the current content and loads successfully.
- [ ] Edit a Plan body, revisit the Plan, and confirm the updated content appears.
- [ ] Confirm review controls work, Plan links and editing work, and authentication still protects restricted pages.
- [ ] Check the browser console and network responses for errors, then confirm the server memory samples are recorded.

<!-- runwield:manual-qa:end child="workspace-memory-footprint/01-reuse-workspace-renderer" -->
