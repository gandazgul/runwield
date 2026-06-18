---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add the pretend `project-status` command surface and render a friendly terminal summary from the structured plan-status data."
affectedPaths:
  - "src/constants.js"
  - "src/cmd/registry.js"
  - "src/cmd/project-status/index.js"
  - "src/cmd/__tests__/registry.test.js"
  - "src/cmd/project-status/index.test.js"
createdAt: "2026-06-18T15:10:19.758Z"
updatedAt: "2026-06-18T15:10:19.758Z"
status: "draft"
origin: "internal"
parentPlan: "testing_slicer_epic"
dependencies:
  - "read-project-plan-status-data"
---
# Render Project Status Command Output

## Context

After structured plan data can be read, users need a tiny command that turns it into a friendly project status summary. The Epic chose the command name `project-status` to avoid colliding with the existing auth-oriented `status` command.

## Objective

Add a minimal `project-status` command that can be invoked from the CLI and renders a concise, friendly summary of saved project plans using the data reader from the previous slice.

## Approach

Follow the existing command pattern: create a command module, add a command name constant, register it in `src/cmd/registry.js`, and include focused command tests. The command should delegate data reading to the summary helper and handle only argument parsing, help behavior, and terminal-friendly rendering.

## Files to Modify

- `src/constants.js` — add the `project-status` command name constant.
- `src/cmd/registry.js` — register the new command with CLI surface metadata, description, usage, and handler.
- `src/cmd/project-status/index.js` — implement argument parsing, data-reader invocation, and friendly console output.
- `src/cmd/__tests__/registry.test.js` — verify the command is registered consistently with other CLI commands.
- `src/cmd/project-status/index.test.js` — cover command output using injected summary data or test dependencies.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cmd/plans/index.js` — reuse formatting tone and plan grouping concepts where appropriate.
- `src/cmd/registry.js` — follow existing command definition conventions for display name, usage, notes, and surfaces.
- `src/cmd/command-helpers.js` — reuse command parsing or output helpers if applicable.
- `src/cmd/help/index.js` — reuse the standard command help path for `--help` behavior.

## Implementation Steps

- [ ] Step 1: Add `PROJECT_STATUS: "project-status"` to the command name constants using JSDoc-compatible JavaScript.
- [ ] Step 2: Create `src/cmd/project-status/index.js` with a `runProjectStatusCommand(argv, options = {})` handler that supports `--help` and dependency injection for tests.
- [ ] Step 3: Register the command in `src/cmd/registry.js` with CLI surface, usage text, and a short friendly description.
- [ ] Step 4: Render output from the structured summary, including an empty-state message and a concise non-empty summary.
- [ ] Step 5: Add command and registry tests for successful output, empty output, and help behavior.

## Verification Plan

- Automated: run `deno test src/cmd/project-status/index.test.js src/cmd/__tests__/registry.test.js`.
- Manual: run `deno run --allow-read src/cli.js project-status` from a project with saved plans and confirm the summary is friendly and concise.
- Expected results for key scenarios: empty projects print a clear no-plans message, populated projects print counts by major plan category/status, and `project-status --help` uses the standard help path.

## Edge Cases & Considerations

- Do not reuse the existing `status` command name because it is already auth-related.
- Keep rendering deterministic so tests can assert exact output.
- Keep the command small; richer dashboards, TUI views, and progress bars are deferred.