---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add the smallest meaningful verification path showing `project-status` can read sample plan data and render expected command output."
affectedPaths:
  - "src/cmd/project-status/index.test.js"
  - "src/cmd/__tests__/getArgumentCompletions.test.js"
  - "docs/usage.md"
createdAt: "2026-06-18T15:10:19.759Z"
updatedAt: "2026-06-18T15:10:19.759Z"
status: "draft"
origin: "internal"
parentPlan: "testing_slicer_epic"
dependencies:
  - "read-project-plan-status-data"
  - "render-project-status-command-output"
---
# Verify Project Status End-to-End Path

## Context

The data-reading and rendering slices cover their local behavior, but the Epic also asks for a minimal verification path. This slice proves the pretend command works across the full path from saved plan data to terminal output without expanding the feature into a large integration suite.

## Objective

Add a lightweight end-to-end or smoke-style verification path for `project-status` that exercises sample saved plan data and confirms the rendered output includes the expected friendly summary.

## Approach

Prefer a focused integration-style test over broad manual QA. Use the repository's existing filesystem-backed test pattern to create representative plan files, invoke the command handler or CLI-level dispatch with test dependencies, capture console output, and assert the important lines. Add a small usage note only if the command should appear in user-facing docs.

## Files to Modify

- `src/cmd/project-status/index.test.js` — add an integration-style test that uses sample plan files and captures rendered output.
- `src/cmd/__tests__/getArgumentCompletions.test.js` — include the new command only if command completions are expected to list CLI/slash commands consistently.
- `docs/usage.md` — add a short usage example if the pretend command is documented.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.test.js` — reuse filesystem fixture patterns for creating saved plan markdown with front matter.
- `src/cmd/__tests__/registry.test.js` — reuse command registry expectations for newly added command surfaces.
- `src/cmd/plans/index.test.js` — reuse console-output capture patterns for plan-oriented commands.

## Implementation Steps

- [ ] Step 1: Add or reuse a test helper that creates a temporary plans directory with one Epic and one child FEATURE plan.
- [ ] Step 2: Invoke the `project-status` command path against that temporary project root and capture console output.
- [ ] Step 3: Assert the output includes the command's friendly heading, total plan counts, and at least one status/category signal.
- [ ] Step 4: Add a small documentation or completion assertion only if required by existing command conventions.

## Verification Plan

- Automated: run `deno test src/cmd/project-status/index.test.js src/cmd/__tests__/getArgumentCompletions.test.js`.
- Manual: run `deno run --allow-read src/cli.js project-status` in a repo with the sample plans and compare output with the documented example.
- Expected results for key scenarios: the smoke test proves saved plan data flows through the command renderer, assertions avoid brittle full-screen snapshots, and command discovery remains consistent if completions/docs are updated.

## Edge Cases & Considerations

- Keep this verification slice minimal; do not build a comprehensive command acceptance-test harness.
- Prefer asserting stable semantic lines over every whitespace detail.
- If documentation or completions are not part of the actual command conventions, skip those changes rather than expanding scope.