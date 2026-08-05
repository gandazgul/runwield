---
planId: "2f40548e-05a1-4d7c-9c5f-0a3f8ebd2404"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "The user wants to create a new plan under the 'local-first-plan-management-ui' epic to correct the design of the workspace UI, as the current implementation deviates from their vision. This requires a new FEATURE plan to redefine the foundation before further development."
affectedPaths:
    - "plans/local-first-plan-management-ui/"
    - "src/ui/workspace/"
createdAt: "2026-06-25T10:33:18-04:00"
status: "verified"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "secure-workspace-read-only-board"
implementedAt: "2026-06-25T15:03:13.876Z"
verifiedAt: "2026-06-25T15:56:28.461Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-06-25T15:54:28.639Z"
routingIntent: "FEATURE"
sessionName: "correct workspace ui design"
updatedAt: "2026-07-02T15:19:14.587Z"
archivedAt: "2026-07-02T15:19:14.587Z"
archiveReason: "Parent epic verified"
archivedFromStatus: "verified"
archivedFromPath: "plans/local-first-plan-management-ui/correct-workspace-design-foundation.md"
---

# Correct Workspace Design Foundation

## Context

The first production Workspace slice (`secure-workspace-read-only-board`) successfully introduced `wld plans ui`, a
Fresh/Preact source boundary, token-gated SSR pages, read-only APIs, and durable `planId` routes. However, the current
UI foundation has drifted from the initial vision captured in `docs/prd/local-first-plan-management-ui-PRD.md`:

- The active board is grouped by hierarchy lanes (`Epics`, `Standalone Plans`, orphan repair) rather than Plan Status
  columns.
- Epic cards currently inline child FEATURE cards on the main board, while the PRD says child FEATURE Plans should be
  inspected in an Epic detail view by default.
- The shell is branded as a Plan-only surface (`Plans Workspace`, `Read-only milestone`) instead of a Plan-focused view
  inside a broader Workspace-capable shell.
- The detail page renders raw markdown in a `<pre>` and lacks the read-first detail/action hierarchy expected by later
  body-editor and lifecycle-action slices.
- Component boundaries (`BoardView`, `EpicCard`, `PlanCard`, `PlanDetail`) are adequate for a read-only proof but are
  not the right substrate for status movement, drag/drop, card menus, Epic detail pages, and a replaceable editor
  boundary.

This corrective slice should happen before continuing with `body-only-plan-detail-editor`, `epic-detail-and-progress`,
or `board-actions-and-status-screens`, so those slices build on the intended Workspace foundation instead of reinforcing
an accidental layout.

## Objective

Refactor the existing read-only Workspace UI to match the PRD's foundational design without adding mutation APIs or body
editing yet.

The corrected foundation should provide:

- A Workspace-capable shell whose first concrete view is the Plan Board.
- A RunWield-owned Plan Board grouped by Plan Status columns for active work.
- Separate closed and on-hold screens that also use status-aware grouping appropriate to their lifecycle categories.
- Top-level board cards for standalone FEATURE Plans and PROJECT Epics.
- Epic cards that summarize child progress but do not inline every child FEATURE on the main board by default.
- A dedicated Epic detail route that shows Epic metadata/body plus child FEATURE Plans in context.
- A read-first Plan detail route that renders markdown safely/readably and exposes future Edit/action seams without
  enabling editing in this slice.
- Component and DTO boundaries that later lifecycle actions, card menus, and drag/drop can extend without another board
  rewrite.

## Approach

Keep the working server, security, Fresh route registration, and read-only API foundation from
`secure-workspace-read-only-board`. Replace the accidental UI model with a PRD-aligned model:

1. Treat the board as status columns first, hierarchy second. Build a board view model with columns for the active PRD
   statuses (`draft`, `feedback`, `approved`, `ready_for_decomposition`, `ready_for_work`, `in_progress`, `failed`,
   `implemented`). Closed and on-hold screens should use the same column/component vocabulary where practical, but with
   their own status sets (`verified`, `closed_without_verification`, and `on_hold`).
2. Keep child FEATURE Plans out of the main board when their Epic resolves. The top-level board should show Epic cards
   and standalone FEATURE cards. Orphan children remain visible in a repair/discoverability section because their parent
   relationship is broken.
3. Add an Epic detail surface now, because moving child lists off the main board requires an obvious destination. The
   detail can remain read-only and simple, but it must become the default place to inspect children, progress, blockers,
   and held/failed child states.
4. Make detail pages read-first. Render Plan markdown as readable HTML (with unsafe HTML disabled/escaped) or a clearly
   styled markdown viewer, not a raw preformatted dump. Keep front matter summarized in structured metadata panels and
   show disabled/placeholder action surfaces only where they clarify future affordances.
5. Rename/reorganize components around durable product concepts (`WorkspaceShell`, `PlanBoard`, `BoardColumn`,
   `PlanCard`, `EpicCard`, `PlanDetail`, `EpicDetail`, `MarkdownView`, action/menu seams) rather than the current
   proof-oriented lane model.
6. Preserve read-only behavior and token security. Do not introduce status mutation, drag/drop gestures, CodeMirror,
   body save APIs, raw front matter editing, databases, BlockSuite, or non-Plan Workspace resources in this slice.

## Files to Modify

- `src/ui/workspace/server/plan-adapter.js` — reshape read-only DTOs around PRD board concepts: status columns,
  top-level cards, Epic summaries, child collections for detail pages, orphan-child repair groups, and safe markdown
  detail data.
- `src/ui/workspace/routes/board.jsx` — render active/closed/on-hold screens through the corrected status-column board
  model instead of hierarchy-first lanes.
- `src/ui/workspace/routes/detail.jsx` — route to Plan or Epic detail rendering based on the resolved resource, keeping
  stable `planId` URLs.
- `src/ui/workspace/components/Layout.jsx` — adjust copy/navigation to represent a Workspace shell with a Plan Board
  view, not a one-off read-only Plan demo.
- `src/ui/workspace/components/Board.jsx` — replace lane-oriented board rendering with status-column components and
  repair/orphan sections.
- `src/ui/workspace/components/PlanCard.jsx` — make cards status-column friendly, distinguish standalone FEATURE vs
  child vs Epic cards, add stable action/menu placeholder seams, and keep card clicks read-first.
- `src/ui/workspace/components/PlanDetail.jsx` — convert to read-first markdown/detail composition and split Epic detail
  behavior out if needed.
- `src/ui/workspace/components/` — add focused components such as `BoardColumn.jsx`, `EpicCard.jsx`, `EpicDetail.jsx`,
  `MarkdownView.jsx`, and small badge/progress components as needed.
- `src/ui/workspace/static/styles.css` — restyle the shell, status board columns, cards, Epic progress, detail pages,
  and responsive behavior around the PRD-aligned UI.
- `src/ui/workspace/routes/api/handlers.js` — keep endpoints read-only but update serialized board/detail payloads if
  the UI model changes API shapes.
- `src/ui/workspace/workspace.test.js` — update/add tests for status-column rendering, child hiding, Epic detail,
  markdown detail rendering, stable routes, and read-only/security regressions.
- `plans/local-first-plan-management-ui/*.md` — only if needed, update dependent draft plan notes/dependencies so future
  editor/action/Epic slices explicitly build on this corrective foundation.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server.js` — keep the existing programmatic Fresh app, middleware, token gate, app wrapper/layout
  registration, and route registration style.
- `src/ui/workspace/server/plan-adapter.js` — reuse `loadPlanSummaries`, `loadPlanDetail`, `serializePlanSummary`,
  `serializePlanDetail`, `serializePlanError`, and existing status-set constants as the starting point for corrected
  DTOs.
- `src/plan-store.js` — continue reusing `listPlanResources`, `findPlanById`, `groupPlanHierarchy`,
  `countChildPlanProgress`, `isEpicPlan`, and `isChildFeaturePlan`; do not duplicate hierarchy semantics in UI code.
- `src/shared/workflow/plan-lifecycle.js` — use existing status vocabulary/meaning indirectly via Plan-store data and
  the lifecycle decisions already implemented; do not add mutation paths here.
- `docs/prd/local-first-plan-management-ui-PRD.md` — use as the product contract for board grouping, child visibility,
  Epic/detail behavior, read-first detail, and Workspace-vs-Plan boundaries.
- Existing tests in `src/ui/workspace/workspace.test.js` — preserve token rejection, SSR route rendering, API read-only
  behavior, and no absolute path leakage while changing UI assertions to the corrected design.

## Implementation Steps

- [ ] Step 1: Define the corrected read-only Workspace view model in `src/ui/workspace/server/plan-adapter.js`.
  - Add status metadata objects for active, closed, and on-hold screens with labels/descriptions/order.
  - Build board columns by status first, using top-level Epics and standalone FEATURE Plans as column cards.
  - Keep child FEATURE Plans with resolved Epics out of board columns by default.
  - Keep orphan children visible in a repair group for the relevant screen/status.
  - Add an Epic detail DTO that includes the Epic summary, body/front matter metadata, child FEATURE summaries grouped
    by status, child progress counts, failed/held child indicators, dependencies, and orphan/repair hints where useful.
- [ ] Step 2: Replace hierarchy-lane board components with status-column board components.
  - Introduce `PlanBoard` and `BoardColumn` components that render columns from DTO status metadata.
  - Render standalone FEATURE cards and Epic cards inside the appropriate status column.
  - Render an orphan-child repair section outside the normal columns so broken parent relationships stay visible but do
    not define the primary board layout.
  - Ensure initial SSR HTML contains the column headings and cards; no client fetch should be required for first paint.
- [ ] Step 3: Correct Epic behavior on the main board.
  - Extract an `EpicCard` component that shows Epic labeling, status, summary, child progress, and held/failed child
    badges.
  - Make the Epic card's primary link open the Epic detail route by `planId`.
  - Remove inline child FEATURE card lists from the main board for resolved Epics.
  - Preserve enough visual indication that children exist and need attention without flooding the board.
- [ ] Step 4: Add a read-only Epic detail route/view.
  - Reuse the existing `/plans/:planId` stable route and render `EpicDetail` when the resolved Plan is a PROJECT Epic.
  - Show Epic summary/body metadata plus child FEATURE Plans grouped by status.
  - Link each child Plan to its own detail route by `planId`.
  - Surface failed and held children clearly.
  - Keep Epic detail read-only; do not add child creation, lifecycle mutation, or drag/drop in this slice.
- [ ] Step 5: Make non-Epic Plan detail read-first and editor-ready.
  - Replace raw `<pre>` body rendering with a `MarkdownView` that renders markdown readably and safely. If adding a
    markdown dependency is too large for this corrective slice, implement a minimal safe renderer for headings,
    paragraphs, lists, code fences, and links, and leave a clear follow-up seam for richer rendering.
  - Keep front matter in structured summary panels; do not expose raw YAML editing.
  - Add a disabled or informational Edit affordance only if it helps preserve the PRD hierarchy
    (`read first, edit
    deliberately`), but do not implement editing or save APIs.
  - Keep lifecycle/action controls absent or visibly unavailable until `board-actions-and-status-screens` lands.
- [ ] Step 6: Reframe the shell/navigation as Workspace-first, Plan-focused.
  - Update layout copy from proof/milestone language to stable Workspace language, while still indicating local
    token-protected/read-only behavior where useful.
  - Keep navigation to Plan Board, Closed, and On Hold screens.
  - Avoid hard-coding component names/copy in a way that would make future docs/wiki/notes resources feel bolted on.
- [ ] Step 7: Preserve API/security behavior while updating payload shape.
  - Keep `/api/workspace`, `/api/plans`, `/api/board`, and `/api/plans/:planId` read-only and token-gated.
  - If `/api/board` payload changes to status columns, include enough compatibility or clear tests so future slices can
    consume the new shape deliberately.
  - Continue avoiding absolute path leakage and permissive CORS.
  - Preserve lazy `planId` backfill behavior from Plan-store as the only write that may happen during read-only
    browsing.
- [ ] Step 8: Update tests around the corrected foundation.
  - Add/adjust adapter tests proving active board groups by status columns, not hierarchy lanes.
  - Add tests proving child FEATURE Plans with valid Epics do not render as main board cards, while orphan children stay
    visible for repair.
  - Add tests for Epic card summaries and Epic detail child grouping.
  - Add SSR tests proving status column headings and cards appear in initial HTML.
  - Add detail tests proving non-Epic details render markdown readably and remain read-only.
  - Keep token/security tests and read-only API tests passing.
- [ ] Step 9: Reconcile dependent draft plans under the Epic if necessary.
  - Check `body-only-plan-detail-editor.md`, `epic-detail-and-progress.md`, and `board-actions-and-status-screens.md`
    after the refactor.
  - If they now describe already-corrected or superseded groundwork, update only their assumptions/dependencies so they
    continue from this new foundation rather than duplicating it.

## Verification Plan

- Automated: exact command(s) to run
  - `deno task ci`
- Manual: precise user flows / checks
  - Run `wld plans ui --no-open`, open the printed tokenized URL, and verify the active Plan Board is organized as
    status columns (`Draft`, `Feedback`, `Approved`, `Ready for Decomposition`, `Ready for Work`, `In Progress`,
    `Failed`, `Implemented`) rather than `Epics`/`Standalone` lanes.
  - Use a checkout with at least one Epic and multiple child FEATURE Plans. Verify the main board shows one Epic card
    with child progress, not a long inline list of child cards.
  - Click the Epic card and verify the Epic detail view lists child FEATURE Plans by status and links to child details.
  - Open a standalone Plan detail and verify the body is readable as rendered/safe markdown, front matter is summarized,
    and no edit/save/lifecycle mutation control is active.
  - Open Closed and On Hold screens and verify they use the corrected board/screen model and only show their respective
    lifecycle statuses.
  - Remove the token from a Workspace or API URL and verify access is rejected.
- Expected results for key scenarios
  - The Workspace visually matches the PRD's core foundation: Workspace shell → Plan Board view → status columns →
    top-level cards → read-first detail/Epic detail.
  - Resolved child FEATURE Plans are discoverable through Epic detail, not flattened onto the main board by default.
  - Orphan children remain visible for repair.
  - No mutation APIs, status movement, drag/drop, or body editing are introduced in this corrective slice.
  - Future editor/action/Epic slices can extend the component/DTO model without another design reset.

## Edge Cases & Considerations

- This plan intentionally corrects foundations rather than completing all PRD behavior. Body editing, lifecycle actions,
  drag/drop gestures, and full structured front matter controls remain in their own child FEATURE plans.
- `failed` stays visible on the active board because the PRD treats it as attention/recovery work, but this slice must
  not add casual movement into or out of `failed`.
- `ready_for_decomposition` should be visually available for Epics; if non-Epic Plans somehow carry that status, render
  them safely and consider surfacing a repair hint rather than hiding them.
- Markdown rendering must not execute unsafe HTML or scripts from Plan bodies.
- Stable `planId` URLs must continue to work after component/route refactors.
- The UI may keep a concise local/read-only notice, but avoid copy that makes the whole Workspace feel like a temporary
  proof instead of the product shell.
- Keep source JavaScript/JSDoc/JSX only. Do not add `.ts` or `.tsx` files and do not use TypeScript syntax.
- Do not add BlockSuite, CodeMirror, a local database, remote collaboration, or non-Plan resource adapters in this
  corrective slice.
