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
updatedAt: "2026-06-17T13:17:32.459Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-17T13:17:32.459Z"
---

# Create Child FEATURE Plans from a Draft

## Context

This is an `AFK` slice in the PROJECT decomposition Epic. The Slicer will eventually become an interactive PM-style
agent that can discuss a proposed decomposition with the user. Before that broader HITL flow exists, Harns needs a small
deterministic persistence boundary for the moment when the user says something like "write a draft".

The output of that step should be ordinary child `FEATURE` plan files under `plans/<epic-name>/`, with front matter that
makes them discoverable by the parent Epic and loadable through the normal FEATURE workflow. This slice should not build
the full interactive Slicer; it only provides the file-writing path and a thin workflow-facing wrapper.

## Objective

Provide a reusable child-plan materialization helper that takes a top-level Epic plan name plus Slicer-produced child
plan descriptors, then creates or updates draft child `FEATURE` plans with stable names, `parentPlan` metadata,
serialized dependencies, and safe nested paths.

## Approach

Keep plan persistence centralized in `src/plan-store.js`. Add an exported
`saveChildFeaturePlans(cwd, epicPlanName,
children)` helper that:

- accepts child descriptors containing title, summary, affected paths, dependencies, content, and optional sequence;
- derives deterministic names such as `project-breakdown-epic/01-preserve-metadata` from sequence plus slugified title;
- rejects unsafe parent/child names rather than writing outside `plans/`;
- calls `savePlan` so front matter injection, defaults, nested directory creation, and markdown writes remain in one
  persistence layer;
- intentionally overwrites the derived draft file path on repeated materialization and returns `created`/`updated`
  metadata for the Slicer UI.

In `src/shared/workflow/workflow-slicer.js`, expose a thin `materializeSlicerDraft(...)` wrapper that delegates to the
plan-store helper with dependency injection for tests. Do not advance the Epic lifecycle or implement finalization in
this slice; that belongs to the interactive Slicer MVP.

## Files to Modify

- `src/plan-store.js` — add the child descriptor JSDoc, child plan name derivation, duplicate/path validation, and
  exported `saveChildFeaturePlans` helper that writes nested draft FEATURE plans through `savePlan`.
- `src/shared/workflow/workflow-slicer.js` — export a small `materializeSlicerDraft` wrapper for Slicer-facing code to
  call without duplicating plan-store details.
- `src/shared/workflow/workflow.js` — re-export `materializeSlicerDraft` through the workflow facade if tests or later
  Slicer code consume workflow helpers from this module.
- `src/plan-store.test.js` — cover child plan creation, update semantics, dependency serialization, parent metadata, and
  invalid names.
- `src/shared/workflow/workflow.test.js` — cover that `materializeSlicerDraft` delegates to the child plan writer and
  returns its result.

## Reuse Opportunities

- `src/plan-store.js` — reuse `savePlan`, `injectFrontMatter`, nested plan-name canonicalization, `ensurePlansDir`, and
  front matter defaults instead of introducing a parallel writer.
- `src/agent-definitions/document-formats/planner-plan-format.md` — child `content` should be normal planner-format
  markdown body content; the helper supplies the required Harns front matter.
- Existing child plan metadata from feature 1 — use `parentPlan` as the loose Epic pointer and `dependencies` as the
  sibling prerequisite list.
- `src/shared/workflow/workflow-slicer.js` — reuse the existing Slicer module as the workflow boundary even though the
  full interactive flow is a later slice.

## Implementation Steps

- [ ] In `src/plan-store.js`, add or refine `ChildFeaturePlanDescriptor` JSDoc with `title`, `summary`, `affectedPaths`,
      `dependencies`, `content`, and optional non-negative integer `sequence`.
- [ ] Add helper logic that slugifies the child title, prefixes a zero-padded sequence when provided, rejects empty
      slugs, and builds the canonical child name as `<epicPlanName>/<child-segment>`.
- [ ] Reuse stored-plan canonicalization so the parent Epic must be a single top-level plan name and the child path must
      remain exactly one level under that parent; reject `..`, absolute paths, empty segments, and duplicate derived
      child names in one materialization batch.
- [ ] Implement `saveChildFeaturePlans(cwd, epicPlanName, children)` so each child is saved with front matter overrides:
      `classification: "FEATURE"`, `status: "draft"`, `origin: "internal"`, `parentPlan: <epicPlanName>`, normalized
      `affectedPaths`, normalized `dependencies`, and the descriptor summary.
- [ ] Detect whether each target file already exists before saving and return an array of
      `{ name, path, title, action,
      dependencies }`, where `action` is `"created"` or `"updated"`.
- [ ] Document in code/tests that draft rewrites intentionally overwrite the stable derived path; stale draft conflict
      detection and finalization are out of scope for this slice.
- [ ] Export `materializeSlicerDraft({ cwd, epicPlanName, children, __deps })` from `workflow-slicer.js`, delegating to
      `saveChildFeaturePlans` and preserving a test-only injection point; re-export it from `workflow.js` if callers use
      the workflow facade.
- [ ] Add `src/plan-store.test.js` cases for creating two child FEATURE plans, front matter/loadability, dependency
      serialization, stable-path update behavior, invalid parent names, invalid child titles, invalid sequence values,
      and duplicate derived names.
- [ ] Add `src/shared/workflow/workflow.test.js` coverage for the Slicer-facing wrapper delegation and returned result.

## Verification Plan

- Automated: `deno test src/plan-store.test.js src/shared/workflow/workflow.test.js`
- Automated: `deno run ci`
- Manual: in a scratch project, call the helper with an Epic name and two descriptors, then inspect that files appear as
  `plans/<epic-name>/01-...md` and `plans/<epic-name>/02-...md` with `classification: "FEATURE"`, `status: "draft"`,
  `parentPlan`, and `dependencies` front matter.
- Expected result: generated child FEATURE drafts are readable by `loadPlan`, discoverable by `findPlansByParent`, safe
  from path traversal, and grouped under the Epic directory without changing the Epic lifecycle.

## Edge Cases & Considerations

- Child plan names must not allow path traversal, absolute paths, empty segments, or nested grandchildren.
- Repeated draft materialization overwrites the deterministic draft path by design; the later interactive Slicer flow
  should decide how to warn about overwriting user-edited drafts.
- Dependencies should be stored as strings without trying to validate completion state in this slice; unmet dependency
  warnings are a later feature.
- The helper should not approve child plans, mark them `ready_for_work`, or advance the Epic. Review/finalization
  remains a separate user-confirmed flow.
- Use pure JavaScript and JSDoc only; do not add TypeScript files or syntax.
