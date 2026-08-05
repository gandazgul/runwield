---
planId: "af8eb5b4-80ee-4cb6-8a04-22bd152c1f0a"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Unify the Plan and Epic detail screens in the Workspace UI. The EpicDetail component should be replaced by the PlanDetail component, using the plan type (Epic vs Feature) to gate unique Epic-specific behavior (like child progress, health summaries, and the child plan board). This ensures a consistent layout and UI across both detail views."
affectedPaths:
    - "src/ui/workspace/components/PlanDetail.jsx"
    - "src/ui/workspace/components/EpicDetail.jsx"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173"
devServerHmr: true
createdAt: "2026-07-01T00:02:37-04:00"
updatedAt: "2026-07-17T04:52:29.893Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-02T16:15:10.836Z"
workRecord:
    status: "generated"
    recordId: "c734961b-2256-4880-95f3-0ff6a9c983cc"
    path: "docs/work-records/2026-07-17-unified-plan-and-epic-detail-ui.md"
    lastAttemptAt: "2026-07-17T04:52:24.131Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "unify plan and epic details"
---

## Requests outside your scope

If the user requests something that requires writing complex system architecture from scratch, creating a multistep
plan, making architectural decisions, or doing open-ended ideation, escalate up to Router instead of attempting to
fulfill the request. Engineer may perform operational steps when they are required by the assigned implementation scope,
but must not own planning, architecture, or ideation work. In a normal interactive direct conversation, if
`return_to_router` is available, call it with a self-contained handoff explaining why the request needs higher-level
triage. If that tool is not available, ask the user to switch to Router with `/agent router`.

# Unify Plan and Epic Detail UI

## Context

Workspace detail pages currently have two separate render paths: `PlanDetail.jsx` has the preferred current layout with
the back link, title/status row, close icon, body editor/preview, sidebar actions, and grouped metadata;
`EpicDetail.jsx` renders a separate older layout for PROJECT Epics with Epic-specific progress, child health,
dependencies, and child status board sections.

The requested product direction is to stop maintaining separate detail screens. Epics should render through the same
`PlanDetail` component and use the plan type/detail kind only to gate Epic-only behavior. This preserves a coherent
detail page while keeping the Epic inspection features users already have.

Product-intent sources and assumptions:

- From the user request: `PlanDetail` is the canonical/best layout; Epic detail should use that same component.
- From existing code/tests: Epics still need child progress, done-enough state, held/failed/blocked child health,
  dependency summaries, and the child FEATURE Plan status board.
- From existing backend capabilities: Epic body editing is disabled (`capabilities.bodyEditing: false`, and
  `savePlanBodyById` rejects Epics). Preserve that behavior unless separately requested; an Epic detail page should show
  the same body preview surface but not expose the Edit link or honor `?edit=body`.
- From existing lifecycle UI: Epic lifecycle actions need the `epic` flag so the hold prompt explains that child Plan
  statuses are not changed.

## Objective

Render both FEATURE Plan details and PROJECT Epic details with `PlanDetail` as the shared shell. For Epics, `PlanDetail`
should show the same header/sidebar/body/metadata layout as Plans, while inserting Epic-only progress and child
inspection sections behind an `isEpic`/`detailKind === "epic"` gate.

Acceptance criteria:

- `/plans/:planId` imports and renders `PlanDetail` for both Plans and Epics.
- Epics show the Plan detail header pattern: back link, title/status group, close `X`, summary, sidebar lifecycle
  actions, and grouped metadata.
- Epics retain child progress, done-enough, on-hold, failed/held/blocked child health, child dependency summary, and
  child FEATURE Plan status board.
- Non-Epic Plan details remain visually/functionally unchanged.
- Epics do not show the body Edit action and cannot enter edit mode via `?edit=body`.
- Duplicate Epic-only layout code is removed or reduced to a thin compatibility wrapper only if needed.

## Approach

Move Epic-specific presentation out of `EpicDetail.jsx` and into small helper components/functions inside
`PlanDetail.jsx` (or a local helper module only if `PlanDetail.jsx` becomes unwieldy). Keep `PlanDetail` as the only
route-level detail component. Use an explicit `isEpicDetail(plan)` helper based on existing DTO fields (`plan.isEpic`,
`plan.detailKind`, and/or `plan.type`) so unique Epic UI is gated by plan type, not by a separate route branch.

Teach the body preview/editor island to honor `plan.capabilities.bodyEditing`. That prevents the shared detail shell
from accidentally enabling Epic body edits while still letting the same body display surface render Epic markdown. Pass
the existing `epic` prop through to `PlanLifecycleActions` only when the plan is an Epic.

## Files to Modify

- `src/ui/workspace/routes/detail.jsx` — remove the `EpicDetail` route branch/import and always render `PlanDetail` with
  the loaded detail DTO.
- `src/ui/workspace/components/PlanDetail.jsx` — add Epic type detection and gated Epic-only sections; reuse the
  existing Plan layout for Epic headers, sidebar actions, body rendering, and metadata.
- `src/ui/workspace/components/EpicDetail.jsx` — delete this component if no longer imported, or leave only a temporary
  compatibility wrapper that delegates to `PlanDetail` if deletion is awkward.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` — respect `plan.capabilities.bodyEditing`; render read-only markdown
  when editing is not allowed, ignore `initialEdit`, and avoid draft/save controls for Epics.
- `src/ui/workspace/static/styles.css` — keep/reuse existing Epic section styles; remove or adjust selectors tied only
  to the old `.epic-detail`/header-actions layout if they become unused or conflict.
- `src/ui/workspace/workspace.test.js` — update SSR/detail assertions and add regressions proving shared layout for
  Epics and unchanged Plan detail behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/components/PlanDetail.jsx` — canonical detail shell, `boardHrefForPlanStatus`, `tabForPlanStatus`,
  `holdMetadata`, and `DetailMetadata`.
- `src/ui/workspace/components/EpicDetail.jsx` — move/reuse `dependencyLabel` and the existing child
  health/dependency/status-board markup rather than redesigning the Epic inspection content.
- `src/ui/workspace/components/BoardColumn.jsx` — reuse for the child FEATURE Plan status board inside Epic detail.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — keep using `compact`; pass `epic` when `isEpicDetail(plan)` so
  the hold prompt remains Epic-aware.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` — reuse markdown preview and editor island; add capability gating
  instead of adding a second markdown rendering path.
- `src/ui/workspace/server/plan-adapter.js` — existing DTO already provides `detailKind: "epic"`, `isEpic`,
  `childProgress`, `childHealth`, `childColumns`, and `children`; no server-side shape change is expected.

## Implementation Steps

- [ ] Step 1: Route all detail pages through `PlanDetail`.
  - In `src/ui/workspace/routes/detail.jsx`, remove the `EpicDetail` import.
  - Replace the conditional render with
    `<PlanDetail plan={plan} url={ctx.url} editIntent={ctx.url.searchParams.get("edit") === "body"} />`.
  - Keep error handling unchanged.

- [ ] Step 2: Add Epic detection and shared-action gating to `PlanDetail.jsx`.
  - Add `isEpicDetail(plan)` using existing DTO fields
    (`plan.isEpic || plan.detailKind === "epic" || plan.type === "epic"`).
  - Compute `canEditBody` from `plan.capabilities?.bodyEditing !== false && !isEpic` (or stricter equivalent matching
    current DTO behavior).
  - Only show the sidebar Edit link when `canEditBody` is true.
  - Pass `initialEdit={canEditBody && editIntent}` into `PlanBodyEditor`.
  - Pass `epic={isEpic}` into `PlanLifecycleActions`.

- [ ] Step 3: Move Epic header summaries into the shared Plan detail header.
  - Reuse the existing Plan title row/back/close/status markup for Epics.
  - Under the summary, render Epic-only progress chips from `childProgress` when `isEpic`.
  - Render Epic-only badges/notices for done-enough, failed children, held children, blocked children, missing
    dependencies, and Epic on-hold metadata.
  - Preserve existing non-Epic warnings for orphan children and dependency-blocked child Plans.

- [ ] Step 4: Move Epic child inspection sections into the main `PlanDetail` content column.
  - After `PlanBodyEditor`, render an `EpicDetailSections` helper only when `isEpic`.
  - Preserve sections for child health, child dependencies, and child FEATURE Plans.
  - Continue filtering `childColumns` to columns with cards/orphans before rendering the child status board.
  - Reuse `BoardColumn` for child status columns and `dependencyLabel` for dependency rows.
  - Keep existing empty states: no failed/held/blocked children, no child dependencies, and no attached child FEATURE
    Plans.

- [ ] Step 5: Retire the separate `EpicDetail` component.
  - If no imports remain, delete `src/ui/workspace/components/EpicDetail.jsx`.
  - If keeping a compatibility wrapper, make it delegate immediately to `<PlanDetail plan={epic} url={url} />` and do
    not keep duplicate layout markup.
  - Remove stale imports made unnecessary by the deletion/wrapper.

- [ ] Step 6: Make `PlanBodyEditor` enforce read-only capability.
  - Add `canEdit = plan.capabilities?.bodyEditing !== false` (or equivalent) near the top of `PlanBodyEditor`.
  - If `canEdit` is false, ignore `initialEdit`, skip local draft discovery/recovery UI, skip dirty-beforeunload and
    localStorage writes, and render only the markdown preview/empty state.
  - Ensure the existing non-Epic editor behavior remains unchanged.

- [ ] Step 7: Update tests for shared Epic layout and guard regressions.
  - Update the existing Epic detail SSR test to expect PlanDetail layout strings (`detail-title-row`, `< Back`,
    `detail-close-link`, metadata sidebar heading) instead of old `Epic detail`/`Epic metadata` markers.
  - Keep assertions for done-enough, child status labels, child summaries, held child metadata, dependency state labels,
    missing dependencies, grouped metadata, and additional metadata.
  - Add/adjust assertions that Epic detail does not include the sidebar Edit link or `edit=body`, while normal Plan
    detail still does.
  - Add/keep an API-level assertion that Epic body saves are rejected, and rely on headed browser verification for the
    hydrated `/plans/<epic-id>?edit=body` no-editor behavior.

## Verification Plan

- Automated: exact command(s) to run
  - `deno task workspace:test`
  - `deno task ci`

- Manual/headed browser verification:
  - Start the dev server with `deno task workspace:dev` and open `http://localhost:5173` with headed `agent-browser` (or
    start the real tokenized app with `wld plans ui --no-open` if fixture data is easier there).
  - Open a normal FEATURE Plan detail page and confirm it still uses the current layout, shows Edit, and enters body
    edit mode with `?edit=body`.
  - Open a PROJECT Epic detail page and confirm it uses the same title/back/close/sidebar/metadata layout as the Plan
    detail page.
  - On the Epic page, confirm the child progress chips, done-enough/hold/health notices, child health list, child
    dependency list, and child FEATURE Plan status board are still visible.
  - Open the Epic page with `?edit=body` and confirm it remains read-only and does not show Save/Cancel editor controls.
  - Check browser console/errors and failed network requests after navigating both detail pages.

- Expected results for key scenarios:
  - One route-level detail component (`PlanDetail`) handles both Plan and Epic detail pages.
  - Epic-only UI appears only for Epic DTOs.
  - Non-Epic Plan detail markup and editor behavior remain unchanged.
  - Epic lifecycle hold action still uses Epic-specific prompt copy.

## Edge Cases & Considerations

- Preserve existing API/adapter behavior unless implementation discovers a missing DTO field; this change should be
  primarily component composition, not data-model work.
- Do not enable Epic body editing as a side effect of sharing the layout; backend rejects it and current product
  behavior treats Epic body editing as out of scope.
- Keep `PlanDetail.jsx` readable: small local helper components are preferable to one large JSX block, but avoid
  creating a second top-level Epic detail screen.
- Existing CSS may include old `.epic-detail`/`.header-actions` rules; remove only if unused and safe, otherwise leave
  harmless shared styles in place.
- Keep all source as JavaScript/JSDoc/JSX; do not introduce TypeScript syntax or `.ts` files.
