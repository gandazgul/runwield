---
planId: "e95c3cc3-53d3-4af8-aa39-46cd951364bb"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Port the current Workspace board, detail, lifecycle interactions, Plannotator body rendering, and body editing behavior to Astro/React. Once parity is proven with automated and headed browser checks, retire the Fresh/Preact/Uno Workspace runtime."
affectedPaths:
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/ui/workspace/routes/api/handlers.js"
    - "src/ui/workspace/static/workspace.css"
    - "src/ui/workspace/client.js"
    - "src/ui/workspace/workspace.test.js"
    - "src/ui/design-system/components/"
    - "deno.json"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-07T18:01:43.370Z"
status: "verified"
origin: "internal"
parentPlan: "workspace-astro-react-plannotator-migration"
order: 2
dependencies:
    - "01-astro-react-workspace-platform-and-review-dev-entrypoints"
verifiedAt: "2026-07-08T13:59:33.606Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-07-14T12:19:54.202Z"
archivedAt: "2026-07-14T12:19:54.202Z"
archiveReason: "Epic verified and archived"
archivedFromStatus: "verified"
archivedFromPath: "plans/workspace-astro-react-plannotator-migration/02-core-workspace-astro-react-parity-and-fresh-retirement.md"
---

# Core Workspace Astro React Parity and Fresh Retirement

## Context

This child plan is the main parity slice for the Workspace Astro/React migration Epic. Product intent is sourced from
`plans/workspace-astro-react-plannotator-migration.md` and `docs/adr/007-local-first-workspace-plan-board.md`,
especially the 2026-07 Astro/React/Radix amendment. No new product behavior is intended here: the new implementation
should preserve the current local-first Workspace behavior while replacing the framework/runtime layer.

Current source facts to preserve while porting:

- `src/ui/workspace/server.js` currently composes a programmatic Fresh app, enforces token/cwd middleware, serves static
  CSS/theme/logo assets, registers local API routes, and still supports remote collaboration API mode.
- `src/ui/workspace/routes/board.jsx` and `routes/detail.jsx` load server adapter data and render Preact components.
- `src/ui/workspace/server/plan-adapter.js` is the canonical board/detail serialization seam for Plan hierarchy,
  dependency health, Epic child health, board screens, lifecycle actions, and body save serialization.
- `src/ui/workspace/routes/api/handlers.js` already defines the JSON API contracts for workspace metadata, plan lists,
  board data, plan detail, lifecycle actions, and body saves.
- `src/ui/workspace/components/Board.jsx`, `BoardColumn.jsx`, `PlanCard.jsx`, `EpicCard.jsx`, and `PlanDetail.jsx` are
  the current SSR parity reference.
- `src/ui/workspace/islands/PlanBoardSearch.jsx`, `PlanBoardDragDrop.jsx`, `PlanLifecycleActions.jsx`, and
  `PlanBodyEditor.jsx` own the browser interactions to port into React islands.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` owns critical data-safety behavior: CodeMirror mounting, local draft key
  format, draft recovery, stale body hash conflict handling, failed-save messaging, save request shape, and
  `beforeunload` dirty guards.
- `src/ui/workspace/react/PlannotatorPlanBody.tsx` proves the pinned Plannotator read-only body renderer path via
  `@plannotator/ui/components/RenderedMarkdown.tsx`.
- `src/ui/workspace/workspace.test.js` already covers token enforcement, board grouping, search helpers, SSR output,
  detail rendering, body save conflicts, lifecycle APIs, Resume Check warnings, lock-aware API responses, remote mode,
  and theme CSS mapping.

This plan depends on child plan 01. Execute from a worktree/branch that already contains the Astro platform scaffold,
`workspace:dev`, `workspace:check`, review dev entrypoints, and the server-wrapper seam from that plan. If those
platform outputs are missing, stop and repair/execute plan 01 first rather than re-scoping this parity plan silently.

## Objective

Make the Astro/React Workspace the functional replacement for the current Fresh/Preact Workspace. `wld plans ui` should
open the Astro-backed Workspace and preserve current core behavior for:

- active, closed, and on-hold board tabs;
- Plan search/filtering and token-preserving links;
- Plan cards, Epic cards, child health, dependencies, orphan repair lane, empty states, and responsive board layout;
- manual lifecycle actions and drag/drop status movement through the existing lifecycle API;
- Plan detail metadata/sidebar, status-specific back/close navigation, hierarchy, dependencies, and Epic child board;
- read-only Plan body rendering through Plannotator where compatible, with a safe fallback;
- body editing, local draft recovery, stale body hash conflict handling, failed-save handling, and dirty unload guards;
- token-protected local APIs, cwd scoping, remote Workspace API mode, and selected RunWield theme propagation.

After parity is proven through automated and headed browser checks, retire the Fresh/Preact/Uno Workspace runtime code,
dependencies, and tasks that are no longer needed.

## Approach

Port behavior convention-first from existing Fresh/Preact components into Astro SSR pages plus React islands. Keep
server-side data adapters and API handlers as the source of truth; this plan should not rewrite Plan Lifecycle, Plan
store, body hash, dependency, hierarchy, or remote collaboration semantics.

Use Astro SSR for read-mostly page structure and React islands only for interactive surfaces. Keep RunWield-owned visual
language and `--rw-*` theme variables as the design source of truth. Use Plannotator selectively for read-only body
rendering in this slice; deeper Plannotator plan/code review parity belongs to child plan 03.

Fresh retirement is a final gate, not an early cleanup step. The implementation should leave the old runtime in place
until the Astro path passes automated tests plus headed browser verification across board, detail, lifecycle, and body
editor flows.

## Files to Modify

- `src/ui/workspace/pages/` — implement Astro SSR routes for `/`, `/closed`, `/on-hold`, and `/plans/:planId`, plus any
  shared Astro layout needed by those routes.
- `src/ui/workspace/components/` — port board/detail/card/layout/metadata components to Astro/React equivalents while
  preserving semantic markup, data attributes used by tests/browser checks, and token-preserving links.
- `src/ui/workspace/islands/` — replace Preact islands with React islands or retire the directory once migrated; port
  board search, drag/drop, lifecycle actions, and body editing behavior.
- `src/ui/workspace/react/` — house React islands/components for board interactions, detail interactions, Plannotator
  body rendering, and editor behavior; keep Workspace-only TS/TSX scoped here or under Astro pages.
- `src/ui/workspace/server.js` — preserve the RunWield-owned wrapper for token/cwd checks, static/theme/logo routes,
  local API routes, remote API mode, and `wld plans ui`; delegate page rendering to the Astro SSR handler.
- `src/ui/workspace/server/plan-adapter.js` — preserve as the board/detail/body serialization seam; adjust only for
  Astro route consumption if necessary.
- `src/ui/workspace/routes/api/handlers.js` — preserve request/response contracts for workspace metadata, plans, board,
  lifecycle actions, and body save; adapt handler shape only if Astro/server wrapper routing requires it.
- `src/ui/workspace/static/workspace.css` — migrate remaining Workspace styling to the Astro/Tailwind 4-compatible
  endpoint while preserving current density, layout, focus states, and visual identity.
- `src/ui/workspace/client.js` and `src/ui/workspace/vite.config.js` — remove or replace Fresh-specific client/bootstrap
  and Vite plugin usage after Astro/React hydration owns the Workspace.
- `src/ui/workspace/workspace.test.js` — update route/API assertions from Fresh output to Astro output while preserving
  behavioral coverage and adding React island helper coverage where useful.
- `src/ui/design-system/components/` — use or complete React/Radix-compatible primitives required by Workspace controls;
  avoid Preact/Zag dependencies in migrated Workspace code.
- `src/ui/design-system/theme-bridge.js` — preserve and extend selected `wld` theme propagation if Astro/React/Radix or
  Plannotator surfaces need additional token mappings.
- `docs/design-system.md` — update stale Fresh/Preact/Uno/Zag guidance so the documented Workspace endpoint matches the
  accepted Astro/React/Radix/Tailwind direction.
- `deno.json` — remove Fresh/Preact/Uno Workspace tasks/dependencies only after no Workspace code, tests, or docs still
  rely on them; keep root project checks intact.

## Reuse Opportunities

- `src/ui/workspace/server/plan-adapter.js` — keep canonical Plan summary/detail serialization, hierarchy, dependency,
  Epic child health, board grouping, body save, and lifecycle capability behavior.
- `src/ui/workspace/routes/api/handlers.js` — reuse existing JSON API behavior and error/status conventions rather than
  changing browser/server contracts during migration.
- `src/ui/workspace/components/PlanCard.jsx`, `BoardColumn.jsx`, `EpicCard.jsx`, `Board.jsx`, and `PlanDetail.jsx` — use
  as the parity reference for generated markup, visual density, metadata grouping, warnings, and empty states.
- `src/ui/workspace/islands/PlanBoardSearch.jsx` — reuse query parameter semantics, search index fields, no-results
  behavior, and tab search slot behavior.
- `src/ui/workspace/islands/PlanBoardDragDrop.jsx` — reuse allowed-target rules, blocked target messaging, drag/drop
  request shape, visual affordances, and reload/error behavior.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — reuse lifecycle action request contracts, labels, confirmation
  prompts, Resume Check confirmation flow, disabled/pending states, and API error messages.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` — reuse editor invariants: CodeMirror setup, draft key format,
  same-base/changed-on-disk recovery states, stale hash save behavior, local draft preservation, and before-unload
  guard.
- `src/ui/workspace/react/PlannotatorPlanBody.tsx` — reuse the accepted Plannotator read-only body rendering proof and
  the pinned source import path.
- `src/ui/design-system/theme-bridge.js`, `tokens.css`, and `components.css` — preserve RunWield tokenized theme and
  reusable component styling.

## Implementation Steps

- [ ] Confirm the execution worktree includes child plan 01 outputs: Astro config, React integration, Deno
      adapter/server wrapper seam, `workspace:dev`, `workspace:check`, and direct review dev tasks. If not, stop and
      repair that dependency first.
- [ ] Add/finish Astro SSR routes for `/`, `/closed`, `/on-hold`, and `/plans/[planId]` using existing
      `loadBoard()`/`loadWorkspaceDetail()` adapter data. Preserve token/query handling for links and board search.
- [ ] Port the Workspace shell/layout to Astro while preserving CSS order (`tokens.css`, `components.css`,
      `workspace.css`, `theme.css`), logo route, topbar, tabs, search slot, and main landmark structure.
- [ ] Port board cards, Epic cards, orphan repair lane, status columns, counts, badges, empty states, and responsive
      board layout to Astro/React with the current components as the visual/markup parity reference.
- [ ] Port board search/filter behavior into a React island, including initial `q` query, search index contents,
      filtered card visibility, no-result messaging, and URL/search state behavior.
- [ ] Port drag/drop status moves into a React island that calls the existing lifecycle API and preserves allowed target
      checks, blocked messaging, token header/query behavior, pending state, and successful reload behavior.
- [ ] Port manual lifecycle controls into React, including status moves, put-on-hold prompt, resume-from-hold, reset to
      draft, close without verification, Resume Check warning confirmation, pending/disabled state, and API error
      display.
- [ ] Port Plan detail SSR route, including title row, status badge, summary fallback, back/close URL selection, warning
      badges, metadata groups, hierarchy/dependency values, Epic summary, child health, child dependency lists, and
      child board.
- [ ] Integrate Plannotator read-only body rendering in the detail page using the pinned `RenderedMarkdown` path where
      compatible. Preserve a safe SSR/fallback markdown rendering path and a visible empty-body state.
- [ ] Port body editing behavior into React, including CodeMirror mounting, edit/cancel/save controls, dirty indicator,
      draft recovery/discard controls, same-base vs changed-on-disk messaging, stale body hash conflict handling,
      failed-save handling, local draft storage, and before-unload protection while dirty.
- [ ] Preserve `src/ui/workspace/server.js` token/cwd/static/API/remote responsibilities while delegating page requests
      to Astro SSR. Ensure `wld plans ui` still starts a tokenized local Workspace for the current cwd.
- [ ] Update Workspace tests to target the Astro server/output: rename Fresh-specific assertions, keep token rejection,
      CSS/theme routes, board/detail SSR substrings, API responses, lifecycle transitions, body save conflict tests,
      Resume Check tests, lock-aware 409s, and remote mode isolation.
- [ ] Add or adjust component/island tests for migrated React helper functions where the old Preact helpers were covered
      directly by `workspace.test.js`.
- [ ] Run headed browser parity checks across board, lifecycle, detail, and body editor flows before deleting old
      runtime code.
- [ ] Remove or deactivate Fresh/Preact/Uno Workspace runtime files, dependencies, plugins, and tasks only after parity
      checks pass and no Workspace imports/tests still reference them. Keep non-Workspace project conventions unchanged.
- [ ] Update `docs/design-system.md` to remove stale Workspace endpoint guidance that still names UnoCSS/Preact/Zag as
      the target stack, while keeping the current Workspace aesthetic as the visual source of truth.

## Verification Plan

- Automated: `deno task -q check`.
- Automated: `deno task -q workspace:check`.
- Automated: `deno task -q workspace:test`.
- Automated: `deno task -q lint`.
- Automated: `deno task -q fmt:check`.
- Automated: `deno task -q test` or `deno task -q ci` once the migration is integrated enough for the full suite.
- Targeted automated fallback if full Workspace checks are temporarily too broad during migration:
  `deno test -A src/ui/workspace/workspace.test.js src/cmd/plans/ui.test.js`.
- Manual/frontend: run `deno task workspace:dev`, open `http://localhost:5173/`, and verify active, closed, and on-hold
  board tabs render real Plan data via Astro with HMR active.
- Manual/frontend: verify search/filtering, card links, Epic cards, child health, orphan repair lane, empty states,
  responsive layout, and token-preserving navigation.
- Manual/frontend: verify manual lifecycle actions and drag/drop flows, including blocked targets, Resume Check warning
  confirmation, API error handling, pending/disabled states, and successful status moves.
- Manual/frontend: open a Plan detail page and verify metadata/sidebar, hierarchy, dependencies, Epic child
  board/health, close/back navigation, and Plannotator-rendered read-only body content.
- Manual/frontend: enter edit mode, edit body content, cancel, save, recover a local draft, encounter a body hash
  conflict, preserve/discard the draft as supported, and verify before-unload protection while dirty.
- Manual/frontend: start `wld plans ui --no-open` or `deno task cli -- plans ui --no-open`, open the printed tokenized
  URL, and verify missing-token rejection, accepted token access, CSS/theme/logo routes, and local API routes.
- Manual/frontend: verify the selected RunWield theme reaches the shell, board, detail, lifecycle controls, editor,
  Radix-compatible controls, and Plannotator body content through `--rw-*` variables.
- Manual/frontend: verify no unexplained console errors and no failed `fetch`/XHR requests except explicitly documented
  non-blockers. Capture desktop screenshot, relevant mobile/narrow screenshot if layout changed, and accessibility
  snapshot evidence for migrated controls.
- Expected result: `wld plans ui` opens the Astro/React Workspace with current core behavior preserved, and the
  Fresh/Preact/Uno Workspace runtime is no longer required.

## Edge Cases & Considerations

- This is intentionally a large slice; temporary branch breakage is acceptable, but final merge readiness requires
  parity and browser verification.
- Do not delete Fresh/Preact/Uno code until the Astro/React path has passed board/detail/lifecycle/body-editor
  verification.
- Preserve existing Plan Lifecycle and Plan store semantics; UI code must not mutate markdown directly outside existing
  API paths.
- Body editing conflict behavior is functional data safety, not polish.
- Keep remote Workspace API mode working when refactoring `server.js`; remote routes should not accidentally inherit
  local Plan Board/API behavior.
- Theme propagation through `--rw-*` variables is product behavior and must be checked across shell, controls, editor,
  and Plannotator body content.
- Preserve token/cwd security in the production-style wrapper; Astro dev server convenience is not a replacement for
  `wld plans ui` launch security.
- Keep non-Workspace code in JavaScript/JSDoc unless separately decided; Workspace-only `.astro`/`.ts`/`.tsx` exception
  must not spread.
- Product assumption: this slice optimizes for parity over redesign. Any visual changes should be incidental to the
  framework migration and should preserve the current dense, dark, local-first Workspace aesthetic.
