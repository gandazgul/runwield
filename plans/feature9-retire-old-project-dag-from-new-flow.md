---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Stop new PROJECT/Epic workflows from using the old task-DAG execution path while keeping legacy modules import-safe."
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/shared/workflow/project-executor.js"
    - "src/shared/workflow/task-scheduling.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/task-scheduling.test.js"
createdAt: "2026-06-16T16:25:04Z"
updatedAt: "2026-06-18T04:15:20.442Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-18T04:15:20.442Z"
---

# Retire Old PROJECT DAG from New Flow

## Context

This is an `AFK` slice. The PRD states that old DAG machinery should remain in the codebase as dead code for possible
future multi-role FEATUREs, but it should no longer drive new PROJECT/Epic execution.

After the Epic path exists, new PROJECT work should never rely on a Slicer-generated task table or
`executeProjectTasks`. Keeping the old modules import-safe preserves test coverage and gives future work a reference
without leaving two competing product paths active.

## Objective

Remove the old task-DAG path from new PROJECT/Epic workflows while keeping the old modules available and tested as
legacy/future code.

## Approach

Move active workflow imports and calls toward Epic decomposition. Do not delete `project-executor.js` or
`task-scheduling.js`. Instead, make it explicit that they are not used for new Epic plans and add tests that catch
accidental regression into DAG execution.

## Files to Modify

- `src/shared/workflow/workflow.js` - remove active calls to task-DAG execution for new Epic plans.
- `src/shared/workflow/workflow-slicer.js` - remove old task-table validation as the new Slicer success condition.
- `src/shared/workflow/project-executor.js` - update comments if needed to mark legacy/future status.
- `src/shared/workflow/task-scheduling.js` - update comments if needed to mark legacy/future status.
- `src/shared/workflow/workflow.test.js` - prove new Epics do not call task-DAG execution.
- `src/shared/workflow/task-scheduling.test.js` - keep legacy parser tests passing.

## Reuse Opportunities

- `src/shared/workflow/project-executor.js` - keep existing tests and exports where compatibility requires them.
- `src/shared/workflow/task-scheduling.js` - keep parsing and validation functions for possible future reuse.
- `src/shared/workflow/workflow.js` - reuse FEATURE execution path for child FEATURE plans.

## Implementation Steps

- [ ] Identify every active call path into `executeProjectTasks`, `extractTasks`, and `validateProjectTasks`.
- [ ] Replace new Epic call paths with Slicer decomposition or child FEATURE selection behavior.
- [ ] Leave legacy task modules importable and tested.
- [ ] Update comments to explain that these modules are retained for future multi-role FEATURE work.
- [ ] Add regression tests proving an Epic with no child FEATUREs opens decomposition instead of DAG execution.
- [ ] Add regression tests proving a child FEATURE uses the normal single-plan execution path.

## Verification Plan

- Automated: `deno test src/shared/workflow/workflow.test.js src/shared/workflow/task-scheduling.test.js`
- Automated: `deno run ci`
- Manual: create an Epic without a task table and verify no readiness failure asks for a parseable Tasks table.
- Expected result: the old DAG path stays present but is not part of the new PROJECT/Epic workflow.

## Edge Cases & Considerations

- Avoid deleting old code unless a separate cleanup plan is approved.
- Existing tests may encode old PROJECT behavior and should be intentionally updated, not blindly removed.
- The dead-code status should be documented enough that a future agent does not revive it accidentally.
