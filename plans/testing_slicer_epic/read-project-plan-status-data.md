---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add the minimal structured data-reading path needed for a project status summary, reusing existing saved-plan metadata without introducing command output formatting."
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/workflow/plan-lifecycle.js"
createdAt: "2026-06-18T15:10:19.755Z"
updatedAt: "2026-06-18T15:10:19.755Z"
status: "draft"
origin: "internal"
parentPlan: "testing_slicer_epic"
dependencies:
    []
---

# Read Project Plan Status Data

## Context

The pretend `project-status` command needs a small, reliable way to summarize existing plan data before any friendly
terminal output is added. This slice keeps the work focused on reading and shaping saved plan metadata so later command
rendering can stay thin.

## Objective

Build a minimal project-status data reader that returns structured summary information from existing plans. The summary
should be suitable for a command to render later, including basic counts by plan classification/status and enough
Epic/child FEATURE information to produce a friendly project health summary.

## Approach

Reuse the existing plan-store listing/parsing path instead of introducing a new persistence layer. Add a small helper
near the existing plan-related modules that accepts a project root and optional test dependencies, calls the existing
plan listing behavior, and returns plain JavaScript objects with stable fields for command rendering. Keep all
formatting and console output out of this slice.

## Files to Modify

- `src/plan-store.js` — expose or reuse saved-plan metadata needed by the summary reader.
- `src/plan-store.test.js` — cover summary-relevant plan metadata such as Epics, child FEATURE plans, statuses, and
  empty plan sets.
- `src/shared/workflow/plan-lifecycle.js` — reuse existing status/classification vocabulary if needed rather than
  duplicating lifecycle constants.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `listPlans()`, child-plan metadata, parent-plan metadata, and status normalization
  behavior.
- `src/cmd/plans/index.js` — reuse the grouping concepts already used to present Epics, standalone plans, child plans,
  and orphan children.
- `src/plan-store.test.js` — reuse filesystem-backed test helpers and representative saved-plan fixtures.

## Implementation Steps

- [ ] Step 1: Identify the smallest summary shape needed by `project-status`, such as total plans, Epic count, child
      FEATURE count, standalone count, and counts by status.
- [ ] Step 2: Add a pure helper for deriving that summary from the existing `listPlans()` result, keeping console
      rendering out of the helper.
- [ ] Step 3: Add tests that exercise empty projects, a project with one Epic and child FEATUREs, and mixed plan
      statuses.

## Verification Plan

- Automated: run `deno test src/plan-store.test.js` or the targeted test file that contains the new summary-reader
  tests.
- Manual: inspect returned summary objects in tests to confirm they are rendering-ready and do not contain
  terminal-specific strings.
- Expected results for key scenarios: empty projects return zero counts, Epics and children are counted separately, and
  plan statuses match existing plan-store normalization.

## Edge Cases & Considerations

- Avoid inventing a second plan lifecycle model; use existing status/classification values.
- Keep this slice independent of command registration so it can ship and be tested before UI output exists.
- If the existing `plans` command grouping already provides enough structure, prefer extracting a reusable pure helper
  over duplicating grouping logic.
