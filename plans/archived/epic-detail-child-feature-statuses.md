---
planId: "eac387df-4631-4524-a159-34c0a475538a"
classification: "FEATURE"
complexity: "LOW"
summary: "Improve the Epic detailed view in `load-plan` by listing child features and their statuses. Additionally, improve the navigation flow to allow users to view details of a specific child feature before loading it, or simply refine the \"Pick a child FEATURE plan\" flow to provide more context."
affectedPaths:
    - "src/cmd/load-plan/index.js"
createdAt: "2026-06-18T00:00:00.000Z"
updatedAt: "2026-07-17T04:42:18.260Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-18T17:11:42.526Z"
workRecord:
    status: "generated"
    recordId: "41b3510d-798e-479d-b62a-ca1c1f7002e1"
    path: "docs/work-records/2026-07-17-improved-epic-details-and-child-feature-navigation.md"
    lastAttemptAt: "2026-07-17T04:42:13.433Z"
---

# Improve Epic Details with Child FEATURE Statuses

## Context

`hns load-plan <epic>` currently shows a short Epic summary and offers `View Epic details`, but that detail view only
uses the generic plan summary. For PROJECT/Epic plans, the most useful detail is the decomposition state: which child
FEATURE plans exist and each child status. The existing Epic menu can already load a child FEATURE, and once loaded the
normal FEATURE flow can show plan details, but that path is not discoverable from the Epic detail view.

## Objective

Enhance the Epic load-plan experience so users can:

- View Epic details that include a list of child FEATURE plans and their current statuses.
- Select a child FEATURE from the Epic flow, inspect its details, then either load it or go back to the Epic menu.

## Approach

Keep this as a focused `load-plan` UI improvement. Reuse the existing child discovery and summary formatting helpers,
and add small Epic-specific formatting/helpers rather than changing plan storage. The recommended interaction is:

1. `load-plan <epic>` opens the existing Epic menu.
2. `View Epic details` prints the generic Epic summary plus a child FEATURE list using existing labels like
   `epic/01-feature [ready_for_work] — Summary`.
3. `Pick a child FEATURE plan` prompts for a child, then shows a second action prompt for that selected child:
   `Load this FEATURE`, `View FEATURE details`, or `Back to child list`.
4. `View FEATURE details` resolves the full child plan and prints `buildPlanSummary(childPlan)` without leaving the Epic
   flow.
5. `Load this FEATURE` delegates to the existing recursive `loadChildPlan(childPlanName)` path.

This preserves the existing direct FEATURE path (`load-plan epic/01-feature -> View plan details`) while making the
Epic-first discovery path self-explanatory. The user confirmed this nested-after-pick interaction is preferred over
adding a separate top-level `View child FEATURE details` option.

## Files to Modify

- `src/cmd/load-plan/index.js` — add Epic child list formatting, include it in `View Epic details`, and add a child
  inspect/load submenu in `handleEpicPlan`.
- `src/cmd/load-plan/index.test.js` — add/update load-plan tests for Epic detail rendering and child FEATURE detail
  inspection.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cmd/load-plan/index.js` — `formatChildPlanLabel(child)` already formats child name/status/summary for select
  labels.
- `src/cmd/load-plan/index.js` — `formatEpicProgressSummary(children)` already provides a compact status count summary.
- `src/cmd/load-plan/index.js` — `buildPlanSummary(plan)` already renders generic plan metadata plus Context/Objective
  sections.
- `src/plan-store.js` — `findPlansByParent(cwd, parentPlan)` already finds child FEATURE plans for an Epic.
- `src/plan-store.js` — `resolvePlan(cwd, planName)` can load a selected child plan body when the user asks to view
  child details.

## Implementation Steps

- [ ] Add an Epic child list helper near the existing Epic helpers in `src/cmd/load-plan/index.js`, for example
      `formatEpicChildFeatureList(children)`, returning a readable block with `Child FEATURE plans:` and one
      `- ${formatChildPlanLabel(child)}` line per child, or an empty-state line when there are no children.
- [ ] Add an Epic detail helper, for example `buildEpicPlanSummary(plan, children)`, that combines
      `buildPlanSummary(plan)`, `formatEpicProgressSummary(children)` when children exist, and the child list helper.
      Include enough labeling that the output clearly distinguishes Epic metadata from the child FEATURE list.
- [ ] Update the `answer === "view"` branch in `handleEpicPlan` to append `buildEpicPlanSummary(plan, children)` instead
      of `buildPlanSummary(plan)`.
- [ ] Extend `handleEpicPlan` dependencies to include a `resolvePlan` callback used only for child detail viewing; pass
      the existing `resolvePlan` from `runLoadPlanCommand`.
- [ ] Replace the current one-step `pick_child` behavior with a small loop:
  - Prompt `Load child FEATURE plan:` using existing `formatChildPlanLabel` labels.
  - If canceled, return to the Epic action menu rather than executing anything.
  - For the selected child, prompt `What would you like to do with this FEATURE?` with `Load this FEATURE`,
    `View FEATURE details`, and `Back to child list`.
  - `View FEATURE details` resolves the child plan, appends a clearly labeled child detail block such as
    `FEATURE: ${childPlan.planName}\n\n${buildPlanSummary(childPlan)}`, and returns to the selected-child action prompt.
  - `Load this FEATURE` calls the existing `loadChildPlan(childPlanName)` path and returns `handled`.
- [ ] Preserve existing behavior for Epics with no children, non-decomposed Epics, done-enough Epics, and direct child
      FEATURE loading.
- [ ] Add/update tests in `src/cmd/load-plan/index.test.js`:
  - `View Epic details` for an Epic with children includes the Epic summary plus both child labels and statuses.
  - Child selection can view a child FEATURE detail by resolving the child plan and printing its Context/Objective,
    without executing it.
  - Existing child-load delegation still resolves and executes the selected child when `Load this FEATURE` is chosen;
    update prompt selections in existing tests to account for the new intermediate child action prompt.
  - Cancel/back behavior does not execute a plan and returns to the appropriate previous menu.

## Verification Plan

- Automated: run `deno test src/cmd/load-plan/index.test.js`.
- Automated: run `deno run ci` after implementation, per project convention.
- Manual: create or use an Epic with multiple child FEATURE plans in different statuses, run `hns load-plan <epic>`,
  choose `View Epic details`, and confirm child FEATURE names/statuses/summaries are shown.
- Manual: from the same Epic menu choose `Pick a child FEATURE plan`, select one child, choose `View FEATURE details`,
  and confirm the child detail summary appears while staying in the Epic flow.
- Manual: choose `Load this FEATURE` and confirm normal FEATURE load behavior continues.

## Edge Cases & Considerations

- Keep output compact; the Epic detail view should list child summaries/statuses but not inline every child plan body.
- If resolving a child plan for details fails, show a helpful system message and return to the child selection flow
  instead of crashing the Epic flow.
- Be careful with loop exits: canceling the child picker should return to the Epic action menu, while canceling the Epic
  action menu should exit `load-plan`.
- Do not change plan front matter, status semantics, or child discovery rules.
- Use pure JavaScript and JSDoc only; do not introduce TypeScript syntax.
