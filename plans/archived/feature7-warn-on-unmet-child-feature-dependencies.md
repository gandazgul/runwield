---
planId: "c5a1a29f-5752-4b87-9fab-ecdf13a62c23"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Warn users when loading a child FEATURE whose declared sibling dependencies are not verified."
affectedPaths:
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/plan-store.js"
createdAt: "2026-06-16T16:25:04Z"
updatedAt: "2026-07-17T04:43:45.961Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-17T16:20:59.595Z"
workRecord:
    status: "generated"
    recordId: "74e569c7-f37a-47b9-9dc2-23ba701a603f"
    path: "docs/work-records/2026-07-17-warn-on-unmet-child-feature-dependencies.md"
    lastAttemptAt: "2026-07-17T04:43:39.596Z"
---

# Warn on Unmet Child FEATURE Dependencies

## Context

This is an `AFK` slice. The PRD calls for dependency checks when loading a child FEATURE. For v1, the safer product
behavior is a warning, not a hard blocker, because the user may intentionally work out of order.

Child FEATURE plans can declare sibling dependencies in front matter. When a user loads a child whose dependencies are
not verified, Harns should make that visible before execution starts.

## Objective

Add dependency awareness to child FEATURE loading and warn the user when declared dependencies have not reached
`verified`.

## Approach

During `load-plan`, detect FEATURE plans with `parentPlan` and `dependencies`. Resolve dependencies relative to the same
Epic where possible. If any dependency is missing or not verified, show a concise prompt before proceeding.

## Files to Modify

- `src/cmd/load-plan/index.js` - add child dependency checks before proceeding with child FEATURE execution.
- `src/cmd/load-plan/index.test.js` - cover verified, unverified, missing, and canceled dependency warning flows.
- `src/plan-store.js` - add or reuse helper for resolving sibling child plan names.

## Reuse Opportunities

- `src/plan-store.js` - reuse recursive listing and parent-child lookup.
- `src/cmd/load-plan/index.js` - reuse existing confirmation prompt patterns.
- `src/shared/workflow/plan-lifecycle.js` - reuse `verified` as the dependency completion signal.

## Implementation Steps

- [ ] Detect child FEATURE plans by the presence of `parentPlan`.
- [ ] Parse `dependencies` as a list of sibling plan identifiers.
- [ ] Resolve each dependency to a plan under the same parent Epic.
- [ ] Determine whether each dependency is `verified`.
- [ ] Warn the user when dependencies are missing or unverified.
- [ ] Allow the user to cancel or proceed anyway.
- [ ] Add tests for all dependency states.

## Verification Plan

- Automated: `deno test src/cmd/load-plan/index.test.js`
- Automated: `deno run ci`
- Manual: create two child FEATUREs where the second depends on the first, then load the second before and after the
  first is verified.
- Expected result: unmet dependencies are visible before execution starts.

## Edge Cases & Considerations

- Dependency identifiers may be bare names, numbered slugs, or nested child plan names. This slice should define and
  test the supported canonical form.
- A warning avoids blocking legitimate advanced workflows.
- Dependency validation should not run for standalone FEATURE plans.
