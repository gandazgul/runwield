---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add a focused path for materializing Slicer decomposition drafts as child FEATURE plan files."
affectedPaths:
  - "src/plan-store.js"
  - "src/shared/workflow/workflow-slicer.js"
  - "src/shared/workflow/workflow.test.js"
  - "src/plan-store.test.js"
createdAt: "2026-06-16T16:25:04Z"
updatedAt: "2026-06-16T20:36:41.682Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-16T20:36:41.682Z"
---
# Create Child FEATURE Plans from a Draft

## Context

This is an `AFK` slice. The mechanics are deterministic: given an Epic and a decomposition draft, write child FEATURE
plan files in the expected format.

The interactive Slicer needs a safe materialization step. During conversation, the user can ask to "write a draft" and
inspect real child FEATURE plans before finalizing the decomposition. This slice creates the file-writing path without
requiring the full interactive Slicer to exist yet.

## Objective

Provide a reusable function that writes or updates child FEATURE plan files under `plans/<epic-name>/` with correct
front matter, stable names, dependencies, and draft status.

## Approach

Add a child-plan creation helper near the plan store or Slicer module. Keep it small and testable: inputs are an Epic
plan name plus a list of child plan descriptors; outputs are written plan paths and metadata. Use the existing planner
plan format for child content.

## Files to Modify

- `src/plan-store.js` - add a save helper that supports nested child plan names and parent metadata.
- `src/shared/workflow/workflow-slicer.js` - expose or call the materialization helper for Slicer drafts.
- `src/shared/workflow/workflow.test.js` - cover Slicer-facing behavior if the helper lives in workflow code.
- `src/plan-store.test.js` - cover nested child plan creation and update semantics.

## Reuse Opportunities

- `src/plan-store.js` - reuse `savePlan`, `injectFrontMatter`, and `ensurePlansDir`.
- `src/agent-definitions/document-formats/planner-plan-format.md` - use the same plan sections for child FEATURE files.
- Existing slug or plan-name conventions, if present, should be reused instead of inventing a separate naming scheme.

## Implementation Steps

- [ ] Define the child descriptor shape in JSDoc: title, summary, affected paths, dependencies, content, and optional
      sequence number.
- [ ] Add nested save support that creates `plans/<epic-name>/` safely.
- [ ] Write child FEATURE front matter with `classification: "FEATURE"`, `parentPlan`, `dependencies`,
      `status:
      "draft"`, and normal metadata.
- [ ] Make repeated draft writes update existing child plan files without duplicating them.
- [ ] Return enough information for the Slicer to tell the user what changed.
- [ ] Add tests for create, update, dependency serialization, and invalid child names.

## Verification Plan

- Automated: `deno test src/plan-store.test.js src/shared/workflow/workflow.test.js`
- Automated: `deno run ci`
- Manual: call the helper through a temporary test path or command harness and inspect generated markdown files.
- Expected result: draft child FEATURE plans are readable, loadable, and grouped under their Epic directory.

## Edge Cases & Considerations

- Child plan names must not allow path traversal.
- Draft rewrites should not erase user edits unexpectedly; if conflict detection is not implemented, document the
  overwrite rule clearly in tests.
- The helper should not advance the Epic lifecycle. Finalization belongs to the Slicer flow.
