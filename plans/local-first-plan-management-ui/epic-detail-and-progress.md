---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add Epic cards and detail views that summarize child FEATURE progress, dependencies, held/failed children, and orphan-child behavior without flattening children onto the main board by default."
affectedPaths:
    - "src/ui/workspace/"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/cmd/plans/index.js"
createdAt: "2026-06-24T20:14:08.683Z"
updatedAt: "2026-06-24T20:14:08.683Z"
status: "draft"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "plan-resource-identity-and-hierarchy"
    - "secure-workspace-read-only-board"
    - "lifecycle-board-semantics"
---

# Epic Detail and Progress

## Context

PROJECT Plans are Epics: containers that hold independently shippable child FEATURE Plans. The Workspace should make
Epic progress understandable without flooding the main board with every child Plan by default, and it should match the
semantics already used by `wld plans`.

## Objective

Add Epic cards and Epic detail pages that show child progress, child list, dependencies, held children, failed children,
and orphan-child behavior. Keep Epic visibility and child aggregation consistent with shared Plan hierarchy helpers and
lifecycle semantics.

## Approach

Use the shared Plan hierarchy/progress helpers as the source of truth. On the main board, show Epics as single cards
with progress and status badges. Add an Epic detail route that lists child FEATURE Plans, dependency relationships,
blocked/failed/held states, and links to each child detail page. Do not flatten child FEATURE Plans onto the main board
by default, but allow the detail view to provide enough navigation and status context to manage decomposition progress.

## Files to Modify

- `src/ui/workspace/` — add Epic card metadata, Epic detail route, child list components, progress summaries, dependency
  summaries, and held/failed/orphan indicators.
- `src/plan-store.js` — extend hierarchy/progress helpers if needed to expose UI-ready Epic summaries without
  duplicating logic.
- `src/plan-store.test.js` — cover Epic progress counts, dependency summaries, held/failed child detection, and
  orphan-child grouping if helper behavior changes.
- `src/cmd/plans/index.js` — keep CLI output aligned with any shared helper refinements.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse shared Epic/child/standalone/orphan grouping and progress helpers.
- `src/cmd/plans/index.js` — preserve current child progress language and done-enough display as a compatibility
  baseline.
- `src/shared/workflow/plan-lifecycle.js` — reuse Epic detection and lifecycle status meanings, especially on-hold and
  verified/closed distinctions.
- `src/ui/workspace/` Plan detail/card components — reuse card layout, badges, front matter summaries, and stable
  `planId` links.

## Implementation Steps

- [ ] Step 1: Define an Epic summary shape for the Workspace API that includes Epic metadata, child counts by status,
      child progress, failed children, held children, dependencies, and done-enough state.
- [ ] Step 2: Extend Plan-store hierarchy helpers only where needed so the UI and CLI continue sharing grouping
      semantics.
- [ ] Step 3: Update board cards so Epics render as top-level cards with Epic labeling, progress counts, child health
      badges, and a link to the Epic detail route.
- [ ] Step 4: Add an Epic detail route that renders the Epic body/summary plus child FEATURE table/cards grouped by
      status and dependency state.
- [ ] Step 5: Add orphan-child visibility so child Plans whose `parentPlan` does not resolve are discoverable and
      repairable instead of silently hidden.
- [ ] Step 6: Add UI handling for held Epics and held children: holding an Epic changes Epic visibility/blocking
      behavior without mutating child statuses; held children are shown as child-specific state.
- [ ] Step 7: Add tests or fixture-driven checks for Epic progress and update manual verification docs/README notes if
      user-facing behavior needs explanation.

## Verification Plan

- Automated: run `deno task ci`, `deno task -c src/ui/workspace/deno.json check`, and
  `deno task -c src/ui/workspace/deno.json test` if available.
- Manual: open a Workspace with at least one Epic and multiple child FEATURE Plans; verify the main board shows one Epic
  card, the Epic detail page shows all children, and child links resolve by `planId`.
- Expected results for key scenarios: child progress matches `wld plans`; failed and held children are visible; orphaned
  children are discoverable; Epic hold behavior does not mutate children.

## Edge Cases & Considerations

- Child FEATURE Plans should not be flattened onto the main board by default, or the board will stop representing
  top-level work.
- Dependencies may refer to sibling slugs, canonical child plan names, or stale identifiers; surface unresolved
  references clearly.
- Epic completion mode `done_enough` must remain distinct from all children being verified.
- On-hold Epics and on-hold child Plans have different implications and must be displayed separately.
- Keep all helper changes backward-compatible with terminal `wld plans` output.
