---
planId: "aefb50d3-8eae-4e2e-b4ca-436c8abde9a3"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add Epic cards and detail views that summarize child FEATURE progress, dependencies, held/failed children, and orphan-child behavior without flattening children onto the main board by default."
affectedPaths:
    - "src/ui/workspace/"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/cmd/plans/index.js"
createdAt: "2026-06-24T20:14:08.683Z"
updatedAt: "2026-06-26T15:43:07.350Z"
status: "implemented"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "plan-resource-identity-and-hierarchy"
    - "secure-workspace-read-only-board"
    - "lifecycle-board-semantics"
    - "correct-workspace-design-foundation"
implementedAt: "2026-06-26T15:43:07.350Z"
worktreeStatus: "completed"
---

# Epic Detail and Progress

## Context

The verified Workspace foundation now has `wld plans ui`, token-gated SSR board/detail routes, status-column board
screens, `EpicCard.jsx`, `EpicDetail.jsx`, and shared Plan hierarchy helpers. That foundation intentionally shipped a
simple read-only Epic experience: Epics appear as top-level cards, resolved children are hidden from the main board, and
an Epic detail route lists child Plans by status.

This slice turns that foundation into the product-level Epic progress surface promised by the local-first Plan
Management UI PRD. The remaining gaps are richer child progress counts, dependency/blocker summaries, clear held/failed
child handling, done-enough Epic state, and better orphan-child repair visibility. The main board must continue to show
resolved child FEATURE Plans only through their Epic by default; orphaned children remain visible because their parent
relationship is broken and needs repair.

Product intent sources are already explicit enough to proceed without more user questions: the PRD says the main board
defaults to top-level Plan Cards, child FEATURE Plans belong inside Epic detail unless expanded/filtered, and orphaned
children remain visible as an exceptional repair group; `docs/plan-lifecycle.md` defines `on_hold`,
`closed_without_verification`, and Epic `done_enough`; the existing Workspace code preserves read-only, token-gated Plan
inspection.

## Objective

Enhance the Workspace Epic cards and Epic detail pages so users can understand Epic health at a glance and inspect child
FEATURE Plans in context. The implementation should:

- Keep PROJECT Epics as single top-level board cards with child progress/health summaries.
- Keep resolved child FEATURE Plans out of main board status columns by default.
- Show all child FEATURE Plans on the Epic detail view, grouped by Plan Status and linked by stable `planId` URLs.
- Surface child dependencies as verified, blocking/unverified, or missing/unresolved.
- Highlight held and failed child Plans without mutating child statuses when an Epic is held.
- Show Epic done-enough state distinctly from all children being verified.
- Keep orphaned child Plans visible in repair sections and detail metadata instead of silently hiding them.

## Approach

Build on the current read-only Workspace components instead of replacing the board foundation again. Extend the
server-side Plan adapter to produce a richer UI DTO for Epics, then render that DTO in `EpicCard` and `EpicDetail`. Keep
reusable hierarchy/progress/dependency semantics in `src/plan-store.js` where the CLI and Workspace both need them; keep
route/component code focused on presentation.

The main board remains status-column first. For each Epic card, show a concise progress summary and attention badges for
failed, held, blocked, missing-dependency, and done-enough states. The Epic detail view is the fuller inspection
surface: body, metadata, child status columns/table, dependency states, held/failed sections, and child links. Orphaned
children should not become normal top-level cards, but the board repair lane and child detail pages should make the
missing parent obvious enough to repair the `parentPlan` value.

## Files to Modify

- `src/ui/workspace/server/plan-adapter.js` — expand serialized Plan/Epic DTOs with status-count progress, child health,
  child dependency states, done-enough metadata, held-parent/held-child indicators, and orphan repair metadata.
- `src/ui/workspace/components/EpicCard.jsx` — render richer Epic progress and health badges while keeping the card
  compact enough for status columns.
- `src/ui/workspace/components/EpicDetail.jsx` — render the full Epic inspection surface: progress summary, done-enough
  note, held/failed/blocked child summaries, child status groups, dependency state labels, and stable child links.
- `src/ui/workspace/components/PlanCard.jsx` — add optional dependency/blocked/orphan badges for child cards shown in
  Epic detail or repair sections.
- `src/ui/workspace/components/PlanDetail.jsx` — show orphan-child repair metadata and dependency state on non-Epic
  child Plan detail pages when present in the DTO.
- `src/ui/workspace/components/Board.jsx` — keep orphan children in repair sections and update repair copy/counts if the
  DTO gains richer repair hints.
- `src/ui/workspace/static/styles.css` — style Epic progress, health badges, dependency states, child status groups, and
  orphan repair panels consistently with the corrected Workspace foundation.
- `src/ui/workspace/workspace.test.js` — add adapter and SSR assertions for Epic card/detail progress, dependency
  states, held/failed children, done-enough state, hidden resolved children, and orphan repair visibility.
- `src/plan-store.js` — add or refine shared helper(s) only where UI and CLI semantics would otherwise duplicate: richer
  child status counts, dependency resolution from sibling children, and Epic summary data.
- `src/plan-store.test.js` — cover any new/refined helper behavior, especially dependency resolution and status-count
  progress.
- `src/cmd/plans/index.js` — keep terminal `wld plans` output aligned if shared helper output changes; preserve the
  current concise list format unless a helper rename requires mechanical updates.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `groupPlanHierarchy`, `countChildPlanProgress`, `resolveSiblingChildPlanDependencies`,
  `isEpicPlan`, `isChildFeaturePlan`, `findPlansByParent`, and Plan name canonicalization. Prefer extracting a pure
  sibling-dependency helper over duplicating dependency resolution in UI code.
- `src/ui/workspace/server/plan-adapter.js` — reuse `loadPlanSummaries`, `loadWorkspaceDetail`, `buildWorkspaceBoard`,
  `columnsForStatuses`, and current hierarchy annotation as the DTO boundary.
- `src/ui/workspace/components/BoardColumn.jsx` and `PlanCard.jsx` — reuse status-column/card rendering for child groups
  inside Epic detail where practical rather than inventing a separate board model.
- `src/shared/workflow/plan-lifecycle.js` and `docs/plan-lifecycle.md` — use existing meanings for `on_hold`,
  `closed_without_verification`, `verified`, and Epic `done_enough`; do not add lifecycle mutations in this slice.
- `src/cmd/plans/index.js` — preserve current CLI language for verified/active/on-hold/remaining/failed progress as a
  compatibility baseline.

## Implementation Steps

- [ ] Step 1: Define the richer Epic/child DTO shape in `src/ui/workspace/server/plan-adapter.js`.
  - Include `childProgress` with per-status counts, plus existing rollups (`verified`, `active`, `failed`, `onHold`,
    `remaining`, `total`) so current card tests remain easy to preserve.
  - Include `childHealth` arrays for `failed`, `held`, `blocked`, `missingDependencies`, and optionally `implemented`.
  - Include `epicCompletionMode`, `epicDoneEnoughSummary`, `epicDoneEnoughAt`, and a boolean/display field for
    `doneEnough` when `epicCompletionMode === "done_enough"`.
  - Include parent-resolution fields for children: `parentResolved`, `parentPlanId` when known, and `orphanReason` when
    the parent Epic is missing.
- [ ] Step 2: Share dependency resolution semantics instead of duplicating them in UI code.
  - Refactor `resolveSiblingChildPlanDependencies` by extracting a pure helper that accepts the parent Plan name,
    dependency list, and already-loaded sibling summaries; keep the existing async `cwd` wrapper compatible for callers
    that need filesystem loading.
  - For each child, expose dependency entries with `dependency`, `state` (`verified`, `unverified`, `missing`), and the
    resolved sibling `planId`/`planName`/`status` when available.
  - Treat unverified dependencies as blockers for display; missing dependencies should be visually distinct from merely
    not-yet-verified dependencies.
  - Read dependencies from the existing normalized `dependencies`/`dependsOn` summary fields without adding a new front
    matter key.
- [ ] Step 3: Enrich board-level Epic cards without flattening children.
  - Update `buildWorkspaceBoard`/board screen DTOs so Epic cards receive the richer progress/health data.
  - Update `EpicCard.jsx` to show verified/total, active/implemented, remaining, failed, held, and blocked/missing
    dependency badges.
  - Show done-enough Epic state as a distinct badge/note, not as equivalent to all child Plans being verified.
  - Keep resolved child FEATURE Plans out of main board columns; only standalone FEATUREs and PROJECT Epics are normal
    board cards.
- [ ] Step 4: Upgrade Epic detail into the full child inspection surface.
  - Keep `/plans/:planId` as the stable route and render `EpicDetail` for PROJECT Epics.
  - Show Epic body/metadata plus a top progress summary and health summary.
  - Render child FEATURE Plans grouped by status using existing status-column/card components or a compact child table.
  - Link every child to its own `planId` detail URL.
  - For each child, show status, summary, dependencies, dependency state, worktree state, and held/failed indicators.
- [ ] Step 5: Make held Epic and held child semantics explicit.
  - If the Epic itself is `on_hold`, show a held-Epic banner with `heldFromStatus`, `heldAt`, and `holdReason` when
    present.
  - Do not mutate or imply mutation of child statuses when an Epic is held; present child Plans as blocked by parent
    hold only in UI copy/metadata.
  - If individual children are `on_hold`, show them as child-specific held state with their own hold metadata.
- [ ] Step 6: Improve orphan-child discoverability and repair context.
  - Keep orphaned child Plans out of normal main board columns and in the repair lane for their status screen.
  - Add DTO fields and card/detail copy explaining which `parentPlan` value failed to resolve.
  - Ensure orphan detail pages still render normally and expose enough metadata for a user or future structured control
    to repair `parentPlan`.
- [ ] Step 7: Preserve API compatibility where practical and add regression coverage.
  - Keep `/api/board` and `/api/plans/:planId` read-only and token-gated.
  - Add tests for board JSON and SSR HTML proving resolved children are hidden from main board cards but visible in Epic
    detail.
  - Add tests for failed children, held children, unverified dependencies, missing dependencies, done-enough Epics, and
    orphan repair sections/detail pages.
  - If helper behavior changes in `src/plan-store.js`, update `src/plan-store.test.js` and ensure `wld plans` remains
    compatible.

## Verification Plan

- Automated: exact command(s) to run
  - `deno task ci`
  - `deno task workspace:check`
  - `deno task workspace:test`
- Manual: precise user flows / checks
  - Run `wld plans ui --no-open` in a checkout with an Epic that has verified, draft, implemented, failed, on-hold, and
    dependency-blocked child FEATURE Plans.
  - Verify the active board shows one Epic card for the Epic and does not show resolved child FEATURE Plans as normal
    top-level board cards.
  - Open the Epic card and verify the detail view lists every child by status with stable child detail links.
  - Verify failed, held, unverified dependency, and missing dependency states are visible on the Epic detail page.
  - Mark or fixture an Epic with `epicCompletionMode: done_enough`; verify the UI distinguishes done-enough from all
    children verified.
  - Fixture a child with `parentPlan` pointing at a missing Epic; verify it appears in the orphan repair section and its
    detail page explains the missing parent.
- Expected results for key scenarios
  - Epic progress and child health match shared Plan-store/CLI semantics.
  - On-hold Epics do not mutate or hide child status information; held children remain child-specific.
  - Orphaned children are discoverable and repairable, but resolved children do not flatten onto the main board.

## Edge Cases & Considerations

- Dependencies may be stored as full child plan names (`epic/01-child`) or sibling child segments (`01-child`); preserve
  the existing Plan-store dependency rules and avoid guessing title-only aliases.
- `src/plan-store.js` should stay cycle-free; do not import `src/shared/workflow/plan-lifecycle.js` there just to label
  statuses.
- `implemented` is active work awaiting validation, not verified. Display it as active/implemented, not complete.
- `closed_without_verification` is terminal manual closure and distinct from `verified`; child progress should not imply
  Workflow Validation passed for those Plans.
- Epic `done_enough` can coexist with unverified/held/failed children. Show it as a user decision, not mathematical
  completion.
- The Workspace remains read-only for this slice. Do not add drag/drop, hold/resume actions, child creation, dependency
  editing, or body editing here.
- Keep JavaScript/JSDoc-only source; do not introduce `.ts`, `.tsx`, interfaces, or TypeScript syntax.
