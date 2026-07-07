---
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
updatedAt: "2026-07-07T18:01:43.370Z"
status: "draft"
origin: "internal"
parentPlan: "workspace-astro-react-plannotator-migration"
order: 2
dependencies:
    - "01-astro-react-workspace-platform-and-review-dev-entrypoints"
---

# Core Workspace Astro React Parity and Fresh Retirement

## Context

After the Astro/React platform exists, the main migration can happen as one large branch-level slice because temporary
Workspace breakage is acceptable and there are no active Workspace users. The important merge gate is not incremental
cleanliness; it is proven parity for the current Plan Board, Plan detail, lifecycle actions, Plannotator read-only body
rendering, body editing, local draft recovery, conflict handling, token-protected APIs, and selected theme behavior.

This slice intentionally combines the board/detail/interactions/editor port so the old Fresh/Preact/Uno path can be
retired only after the new Astro/React path is visibly and mechanically equivalent.

## Objective

Make the Astro/React Workspace the functional replacement for the current Fresh/Preact Workspace. `wld plans ui` should
open the Astro-backed Workspace and preserve current core behavior for board browsing, search, lifecycle management,
Plan details, Epic hierarchy/health, dependencies, read-only body rendering through Plannotator where compatible, and
body editing with draft/conflict protections. Fresh/Preact/Uno Workspace runtime code should be removed or made inactive
after parity is verified.

## Approach

Port behavior from existing Preact components and islands into Astro SSR pages plus React islands. Keep server-side data
adapters and API handlers as the behavior source of truth rather than rewriting Plan semantics during the framework
migration. Use visual browser testing heavily while working on the branch, then treat Fresh retirement as a final gate
after automated and headed parity verification pass.

## Files to Modify

- `src/ui/workspace/pages/` — implement Astro SSR routes for `/`, `/closed`, `/on-hold`, and `/plans/:planId`.
- `src/ui/workspace/components/` — port board/detail/card/layout/metadata components to Astro and/or React as
  appropriate.
- `src/ui/workspace/islands/` — replace Preact islands for search, drag/drop, lifecycle actions, and body editing with
  React islands.
- `src/ui/workspace/react/` — house React islands/components for board interactions, detail interactions, Plannotator
  body rendering, and editor behavior.
- `src/ui/workspace/server/plan-adapter.js` — preserve as the board/detail serialization seam; adjust only as needed for
  Astro route consumption.
- `src/ui/workspace/routes/api/handlers.js` — preserve current API behavior for board, plan detail, lifecycle actions,
  and body save.
- `src/ui/workspace/static/workspace.css` — migrate remaining Workspace styling to Tailwind 4-compatible
  global/component CSS while preserving current density and visual identity.
- `src/ui/workspace/client.js` — remove or replace Fresh/Preact client bootstrap once React islands own hydration.
- `src/ui/workspace/workspace.test.js` — update route/API assertions from Fresh output to Astro output while preserving
  behavior coverage.
- `src/ui/design-system/components/` — use the React/Radix-compatible primitives for Workspace controls.
- `deno.json` — remove Fresh/Preact/Uno Workspace tasks/dependencies after parity if no longer needed elsewhere.

## Reuse Opportunities

- `src/ui/workspace/server/plan-adapter.js` — keep canonical Plan summary/detail serialization, hierarchy, dependency,
  Epic child health, and board grouping behavior.
- `src/ui/workspace/routes/api/handlers.js` — reuse existing request/response shapes for workspace metadata, plans,
  board, lifecycle actions, and body saves.
- `src/ui/workspace/components/PlanCard.jsx`, `BoardColumn.jsx`, `EpicCard.jsx`, `Board.jsx`, and `PlanDetail.jsx` — use
  as the parity reference while porting rendering and behavior.
- `src/ui/workspace/islands/PlanBoardDragDrop.jsx` — reuse drag/drop status rules, blocked target messaging, request
  shape, and visual affordance behavior.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — reuse lifecycle action request contracts and blocked/disabled
  states.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` — reuse CodeMirror lifecycle, draft key format, local draft recovery
  states, save request shape, stale hash conflict handling, and before-unload behavior.
- `src/ui/workspace/react/PlannotatorPlanBody.tsx` — reuse the accepted Plannotator read-only body rendering proof.
- `src/ui/design-system/theme-bridge.js` — preserve selected `wld` theme propagation.

## Implementation Steps

- [ ] Port board SSR routes for active, closed, and on-hold tabs using the existing board adapter data.
- [ ] Port board cards, Epic cards, orphan repair lane, status columns, responsive layout, and empty states to
      Astro/React.
- [ ] Port board search/filter behavior into a React island while preserving query handling and search index semantics.
- [ ] Port manual lifecycle controls and drag/drop status moves into React islands that call the existing lifecycle API.
- [ ] Port Plan detail SSR route, including title, summary, metadata/sidebar, status-specific navigation, Epic child
      health, child board, hierarchy, dependencies, and action areas.
- [ ] Integrate Plannotator read-only body rendering in the detail page while preserving RunWield styling and fallback
      behavior for incompatible content.
- [ ] Port body editing behavior, including CodeMirror or chosen editor mounting, edit/cancel/save controls, dirty
      state, draft recovery, stale body hash conflict handling, failed save handling, and before-unload protection.
- [ ] Update Workspace tests so API semantics and representative SSR output are checked against the Astro path.
- [ ] Run headed browser parity checks across board, lifecycle, detail, and body editor flows.
- [ ] Remove or deactivate Fresh/Preact/Uno Workspace runtime files, dependencies, and tasks only after parity checks
      pass.

## Verification Plan

- Automated: `deno task -q check`.
- Automated: `deno task -q workspace:check`.
- Automated: `deno task -q workspace:test`.
- Automated: `deno task -q lint`.
- Automated: `deno task -q fmt:check`.
- Automated: `deno task -q test` or `deno task -q ci` when the migration is integrated enough for the full suite.
- Manual/frontend: run `deno task workspace:dev`, open `http://localhost:5173/`, and verify active, closed, and on-hold
  board tabs render real Plan data.
- Manual/frontend: verify search/filtering, cards, Epic cards, child health, orphan repair lane, responsive layout, and
  token-preserving links.
- Manual/frontend: verify manual lifecycle actions and drag/drop flows, including blocked states, Resume Check warnings,
  API error handling, and successful status moves.
- Manual/frontend: open a Plan detail page and verify metadata/sidebar, hierarchy, dependencies, Epic child
  board/health, close/back navigation, and Plannotator-rendered read-only body content.
- Manual/frontend: enter edit mode, edit body content, cancel, save, recover a local draft, hit a body hash conflict,
  resolve/discard as supported, and verify before-unload protection while dirty.
- Manual/frontend: verify no unexplained console errors and no failed network requests except documented non-blockers.
- Expected result: `wld plans ui` opens the Astro/React Workspace with current core behavior preserved, and
  Fresh/Preact/Uno Workspace runtime is no longer required.

## Edge Cases & Considerations

- This is intentionally a large slice; temporary branch breakage is acceptable, but final merge readiness requires
  parity and browser verification.
- Do not delete Fresh/Preact/Uno code until the Astro/React path has passed board/detail/lifecycle/body-editor
  verification.
- Preserve existing Plan Lifecycle and Plan store semantics; UI code must not mutate markdown directly outside existing
  API paths.
- Body editing conflict behavior is functional data safety, not polish.
- Theme propagation through `--rw-*` variables is product behavior and must be checked across shell, controls, editor,
  and Plannotator body content.
- Keep non-Workspace code in JavaScript/JSDoc unless separately decided; Workspace-only `.astro`/`.ts`/`.tsx` exception
  must not spread.
