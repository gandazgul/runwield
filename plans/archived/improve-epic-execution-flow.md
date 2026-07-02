---
planId: "c31f62a7-aec3-4830-94c6-6bc7b65f9aeb"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Improve the Epic execution experience in `load-plan`. 1. Hide child FEATURE plans from the main `load-plan` menu. 2. Implement a nested menu for child plans when an Epic is selected. 3. Add an 'order' field to child plan front-matter (via Slicer) and sort the child menu by this order. 4. Add a 'Next non-verified plan' shortcut in the child menu. 5. Improve child plan labels in the menu to show more than just the filename."
affectedPaths:
    - "src/cmd/load-plan/index.js"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/plan-store.js"
createdAt: "2026-06-25T11:11:20-04:00"
updatedAt: "2026-06-30T18:36:24.659Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-30T18:36:24.659Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "improve epic execution flow"
---

# Improve Epic Execution Flow

## Context

`/load-plan` currently lists every plan returned by `listPlans()`, including child FEATURE plans under Epics. That
flattens Epic execution and makes users pick from nested filenames rather than from the decomposition sequence the
Slicer already agreed with them. The existing Epic-aware path in `src/cmd/load-plan/index.js` can open a child FEATURE
picker, but the main menu still exposes children directly, child ordering is mostly filename/lexicographic, and
dependency context is only warned about after a child is selected.

The repo already has most of the building blocks: `handleEpicPlan()` owns Epic child selection,
`confirmChildFeatureDependencies()` handles unmet dependency warnings, `saveChildFeaturePlans()` already accepts a
legacy `sequence` descriptor for filename prefixes, and Slicer child descriptors include dependencies. The missing
pieces are persisting an explicit front-matter `order`, sorting and labelling from that metadata, and keeping the
top-level load menu focused on top-level plans.

## Objective

Build a smoother Epic execution flow for `/load-plan`:

- Hide child FEATURE plans (`attrs.parentPlan`) from the initial interactive load-plan menu.
- Make top-level plan labels more useful than raw plan paths by including summary/status context.
- When an Epic is selected, use the existing nested child FEATURE picker as the place where children appear.
- Persist Slicer child execution order as front matter (`order`) and sort child menus/lists by that order.
- Show dependency context in child FEATURE labels/descriptions so sequencing is visible before selection.
- Add a top child-menu shortcut to load the next non-verified child FEATURE in order.

## Approach

Use `order` as the new persisted front-matter field because that is the user-facing concept requested. Keep the existing
`sequence` descriptor support as a compatibility alias for existing tests/callers, but have Slicer emit `order` going
forward. `saveChildFeaturePlans()` should write `order` into child plan front matter and continue using the same number
as the filename prefix so older lexicographic behavior remains stable.

Centralize child ordering in `plan-store` (via `findPlansByParent()` or a small shared comparator) so both Epic
summaries and the load-plan child menu see the same order. In `load-plan`, filter the initial prompt to top-level plans
and enrich labels. In `handleEpicPlan()`, build a child menu that starts with a synthetic "next non-verified" option
when applicable, then ordered child FEATURE options with status, summary, and dependencies. Selecting either a child or
the shortcut should call the existing `loadChildPlan()` path so dependency confirmation, hold checks, recovery,
approval, execution, and validation behavior remains unchanged.

## Files to Modify

- `src/plan-store.js` — add `order` to `PlanFrontMatter`, known front-matter serialization/parsing, child descriptor
  validation/materialization, and child-plan ordering.
- `src/plan-store.test.js` — cover `order` round-tripping, Slicer child materialization writing order, compatibility
  with legacy `sequence`, and parent-child sorting by order.
- `src/shared/workflow/workflow-slicer.js` — add `order` to Slicer child descriptor schema and child summaries passed
  into Slicer sessions.
- `src/shared/workflow/workflow-prompts.js` — include child `order` in existing child summaries so Slicer sees current
  sequence on resume.
- `src/shared/workflow/workflow-prompts.test.js` — add/extend tests for Slicer request child order/dependency context.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md` — instruct Slicer to provide stable `order` values in child
  descriptors and to preserve them on updates.
- `src/cmd/load-plan/index.js` — filter top-level menu, improve labels, sort children by order, show dependency context,
  and add next non-verified child shortcut.
- `src/cmd/load-plan/index.test.js` — cover hidden children in the main menu, improved labels, ordered child menu,
  visible dependencies, and next non-verified shortcut behavior.

## Reuse Opportunities

- `src/cmd/load-plan/index.js` — reuse `handleEpicPlan()`, `formatChildPlanLabel()`, `formatEpicChildFeatureList()`, and
  `loadChildPlan()` instead of creating a separate execution path.
- `src/cmd/load-plan/index.js` — reuse `confirmChildFeatureDependencies()` by loading the chosen child through the
  existing `runLoadPlanCommand()` recursion.
- `src/plan-store.js` — reuse existing front-matter unknown-key preservation and the current `sequence`/filename-prefix
  helpers, adding `order` rather than inventing a parallel storage path.
- `src/shared/workflow/workflow-slicer.js` — reuse `CHILD_DESCRIPTOR_SCHEMA`, `summarizeChild()`, and
  `slicer_write_feature_drafts` as the single materialization path.

## Implementation Steps

- [ ] Step 1: Add persisted child order metadata in `src/plan-store.js`.
  - Extend the `PlanFrontMatter` JSDoc with `@property {number} [order]` for Epic child execution order.
  - Add `order` to `KNOWN_FRONT_MATTER_KEYS` and `formatFrontMatter()` in a stable location near
    `parentPlan`/`dependencies`.
  - Add a small normalizer for non-negative integer order values; parse numeric YAML values and optionally numeric
    strings defensively.
  - Have `injectFrontMatter()` and `parsePlanFrontMatter()` preserve normalized `order`.
  - Extend `ChildFeaturePlanDescriptor` to accept `order`, keep `sequence` as a deprecated alias, and validate
    `order ?? sequence` with the existing non-negative integer rules.
  - In `saveChildFeaturePlans()`, write `order` into child front matter and include it in returned metadata.

- [ ] Step 2: Make child-plan ordering deterministic and metadata-driven.
  - Add a comparator/helper in `src/plan-store.js` that sorts plans by `attrs.order` when both/one children have it,
    then by `name` as the fallback for legacy files.
  - Use that comparator in `findPlansByParent()` so Epic consumers get ordered children by default.
  - Keep `listPlans()` itself lexicographic to avoid surprising non-Epic list behavior.

- [ ] Step 3: Update Slicer contract to emit and preserve order.
  - Add `order` to `CHILD_DESCRIPTOR_SCHEMA` in `src/shared/workflow/workflow-slicer.js` with a description like
    "1-based integer execution order from the agreed slice sequence".
  - Include `order` in `summarizeChild()` and the `SlicerChildSummary` shape in `workflow-prompts.js`.
  - In `buildSlicerRequest()`, display existing child order before status/summary/dependencies.
  - Update `slicer-prompt.md` so every child descriptor includes `order`; tell Slicer to keep stable order values when
    updating drafts and only renumber when the user changes the sequence.

- [ ] Step 4: Improve the top-level `/load-plan` interactive menu.
  - In the no-argument TUI branch of `runLoadPlanCommand()`, filter `plans` to entries without `attrs.parentPlan` before
    building `planOptions`.
  - If all plans are child FEATUREs after filtering, show a clear message such as "No top-level plans available. Load
    the parent Epic directly or create a plan." rather than an empty prompt.
  - Add a small formatter for top-level plan menu labels/descriptions that includes plan name, classification, status,
    and summary; increase the prompt layout width if needed so Epic names/summaries are easier to distinguish.
  - Do not remove support for directly loading a child plan by explicit CLI argument; hiding applies only to the
    interactive main menu.

- [ ] Step 5: Improve Epic child selection UX in `handleEpicPlan()`.
  - Work with the ordered `children` returned by `findPlansByParent()`.
  - Update `formatChildPlanLabel()` to show order (when present), status, summary, and dependency names. Keep labels
    readable; use option `description` for overflow dependency text if the TUI supports it, but make dependency presence
    visible in the primary label too.
  - Update `formatEpicChildFeatureList()`/Epic detail output so the same ordered labels and dependency context appear in
    "View Epic details".
  - In the child list prompt, prepend a synthetic option when there is at least one actionable child whose status is not
    `verified` or `closed_without_verification`, e.g.
    `Execute next non-verified child FEATURE: 03. <summary> [ready_for_work]`.
  - When the shortcut is selected, load the first ordered child whose status is not `verified` or
    `closed_without_verification` through `loadChildPlan(child.name)` and return handled.
  - If all children are verified/closed, omit the shortcut or show a disabled-equivalent message before returning to the
    Epic menu; prefer omission because `promptSelect` options are active.
  - Preserve the existing per-child action submenu (`Load this FEATURE`, `View FEATURE details`, `Back`) for manual
    child selection.

- [ ] Step 6: Add focused automated tests.
  - In `src/plan-store.test.js`, assert `order` front matter round-trips, `saveChildFeaturePlans()` writes `order`,
    legacy `sequence` still works, and `findPlansByParent()` sorts by order before name.
  - In `src/shared/workflow/workflow-prompts.test.js`, add a `buildSlicerRequest()` test showing existing child order
    and dependencies in the Slicer resume prompt.
  - In `src/cmd/load-plan/index.test.js`, add tests that:
    - the no-arg TUI main menu excludes child FEATUREs and includes top-level summaries;
    - an Epic child menu is sorted by `order`, not input order/name;
    - dependency context is visible in child labels/descriptions;
    - selecting the next non-verified shortcut loads the first ordered child that is not `verified`;
    - direct CLI loading of a child plan still works and still runs dependency confirmation.

- [ ] Step 7: Run validation and fix issues.
  - Run targeted tests while iterating:
    `deno test src/plan-store.test.js src/shared/workflow/workflow-prompts.test.js src/cmd/load-plan/index.test.js`.
  - Run full project validation before completion: `deno run ci`.

## Verification Plan

- Automated:
  - `deno test src/plan-store.test.js src/shared/workflow/workflow-prompts.test.js src/cmd/load-plan/index.test.js`
  - `deno run ci`
- Manual:
  - Start an interactive session and run `/load-plan` with an Epic that has child FEATUREs.
  - Confirm the first menu shows only top-level plans/Epics, with summaries/statuses visible enough to choose the parent
    Epic.
  - Select an Epic and choose child selection; confirm children are sorted by `order`, dependencies are visible, and the
    first option loads the next non-verified child.
  - Confirm typing `/load-plan epic-name/child-name` still directly loads that child and warns for unmet dependencies as
    before.
- Expected results:
  - Users no longer have to guess from a flattened child list where Epic execution should start.
  - The shortcut selects the same next slice the Slicer sequencing implies.
  - Existing plans without `order` still appear in stable filename order.

## Edge Cases & Considerations

- Existing child plans may only have numeric filename prefixes, not `order`; fallback sorting by `name` preserves
  current behavior.
- Existing callers/tests may still pass `sequence`; support it as an alias while Slicer moves to `order`.
- The shortcut should not bypass hold, recovery, approval, dependency, or validation logic; it must load the child
  through the existing child plan path.
- Treat `closed_without_verification` as closed, not as the "next" execution target; the shortcut should skip both
  `verified` and `closed_without_verification`, while manual child loading remains available if the user explicitly
  chooses a child.
- The working tree currently has an unrelated dirty plan file
  (`plans/local-first-plan-management-ui/correct-workspace-design-foundation.md`); this implementation should not touch
  it.
