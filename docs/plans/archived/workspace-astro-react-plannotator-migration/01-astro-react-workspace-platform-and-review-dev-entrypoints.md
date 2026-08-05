---
planId: "9c7a227e-342e-475f-a5a1-3621f03d65a1"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Establish the Astro SSR + React + Tailwind + Radix Workspace platform while preserving RunWield launch/security/API boundaries. Add HMR-friendly dev entrypoints for the Workspace, plan review UI, and code review UI so later visual migration work can be tested directly in browser."
affectedPaths:
    - "deno.json"
    - "src/cmd/plans/ui.js"
    - "src/ui/workspace/astro.config.mjs"
    - "src/ui/workspace/vite.config.js"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/react/"
    - "src/ui/design-system/"
    - "src/ui/design-system/theme-bridge.js"
    - "docs/design-system.md"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-07T18:01:43.369Z"
status: "verified"
origin: "internal"
parentPlan: "workspace-astro-react-plannotator-migration"
order: 1
dependencies:
    []
verifiedAt: "2026-07-08T01:32:53.971Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-07-14T12:19:53.757Z"
archivedAt: "2026-07-14T12:19:53.757Z"
archiveReason: "Epic verified and archived"
archivedFromStatus: "verified"
archivedFromPath: "plans/workspace-astro-react-plannotator-migration/01-astro-react-workspace-platform-and-review-dev-entrypoints.md"
---

# Astro React Workspace Platform and Review Dev Entrypoints

## Context

This child plan is the first executable slice of the `workspace-astro-react-plannotator-migration` Epic. The Epic and
`docs/adr/007-local-first-workspace-plan-board.md` are the product-intent sources: Workspace is moving from
Fresh/Preact/UnoCSS/Zag to Astro SSR, React islands, Tailwind 4, Radix-compatible primitives, and selective Plannotator
reuse, while preserving local-first RunWield behavior.

Current source state to preserve or replace carefully:

- `deno.json` already contains React, React DOM, Tailwind 4, Radix packages, the pinned Plannotator import aliases, and
  the current Fresh/Vite `workspace:dev` plus `workspace:react:check` tasks; it does not yet define Astro, the Astro
  React integration, the Deno Astro adapter, `workspace:check`, or review-specific dev commands.
- `src/ui/workspace/server.js` is a programmatic Fresh wrapper that owns token checks, cwd state, public CSS/theme/logo
  routes, local Workspace page routes, local API routes, and remote collaboration API mode.
- `src/cmd/plans/ui.js` is the public `wld plans ui` launcher and should keep generating a per-server token, starting
  the Workspace server for the current cwd, and opening the tokenized localhost URL.
- `src/ui/design-system/theme-bridge.js` currently maps the selected `wld` theme into browser `--rw-*` CSS variables;
  theme propagation is product behavior, not cosmetic polish.
- `src/ui/workspace/react/PlannotatorPlanBody.tsx` proves the pinned Plannotator source alias path by importing
  `@plannotator/ui/components/RenderedMarkdown.tsx`.

This slice creates the new platform seam and direct HMR entrypoints. It should not fully port board/detail parity or
replace real workflow Plan/code review decision transport; those are covered by later child plans.

## Objective

Build the Astro/React Workspace foundation and development entrypoints before porting the full Workspace behavior. The
outcome should be an Astro-backed scaffold with React/Tailwind/Radix infrastructure, preserved Plannotator aliases,
preserved RunWield launch/security/API seams, selected theme CSS propagation, and these HMR-friendly dev commands:

- `deno task workspace:dev`
- `deno task workspace:dev:plan-review`
- `deno task workspace:dev:code-review`

The review dev commands should open or directly serve useful fixture-backed internal review routes for visual iteration.
They are intentionally not the final workflow-backed review surfaces yet.

## Approach

Introduce Astro SSR under `src/ui/workspace/` with `@deno/astro-adapter` configured for `start: false` so RunWield keeps
launch control for production-style serving. Use `@astrojs/react` for React islands and Tailwind 4 through the existing
Workspace styling pipeline. Preserve the pinned Plannotator aliases for `@plannotator/ui`, `@plannotator/shared`, and
`@plannotator/ai`, with React/ReactDOM deduped.

Refactor `src/ui/workspace/server.js` (or a clearly named successor imported by it) so it remains the RunWield-owned
wrapper for local security and API ownership: token/cwd middleware, public static/theme routes, JSON API handlers, and
remote collaboration API mode must not move into an unchecked Astro-dev-only assumption. For local Workspace page
rendering, delegate SSR pages to the Astro handler/output once available. In development, it is acceptable for
`workspace:dev` and review dev tasks to use Astro's HMR server directly, but the plan must leave an explicit tested path
for `wld plans ui` through the wrapper.

Add fixture-backed internal review pages/routes only for development: one Plan review fixture and one code review/diff
fixture. These pages should use the new shell/theme/design-system primitives and at least one pinned
Plannotator-rendered component where practical, but real approval/feedback/annotation decision transport remains in
child plan 03.

## Files to Modify

- `deno.json` — add Astro, `@astrojs/react`, `@deno/astro-adapter`, any required Astro type/check support, and the exact
  dev/check tasks. Keep existing React/Tailwind/Radix dependencies and Plannotator imports; add or alias
  `workspace:check` so CI can move away from the narrower `workspace:react:check` without breaking useful checks.
- `src/cmd/plans/ui.js` — preserve the public `wld plans ui` launch behavior and tokenized URL generation while pointing
  to the Astro-capable server wrapper once available.
- `src/ui/workspace/astro.config.mjs` — configure Astro SSR (`output: "server"`), the Deno adapter with `start: false`,
  React integration, Tailwind 4/Vite hooks, Plannotator aliases, React/ReactDOM dedupe, and Workspace-specific source
  roots/routes.
- `src/ui/workspace/vite.config.js` — remove, replace, or isolate Fresh-specific dev configuration as Astro becomes the
  Workspace build/dev owner. Preserve Plannotator alias behavior until Astro config fully owns it, and do not leave two
  conflicting HMR owners for the same routes.
- `src/ui/workspace/server.js` — preserve token/cwd middleware, public static/theme routes, local API route ownership,
  remote collaboration API mode, and integrate/delegate to Astro SSR for page requests.
- `src/ui/workspace/pages/` — add initial Astro shell routes for `/` plus internal fixture-backed Plan review and code
  review dev routes.
- `src/ui/workspace/react/` — evolve the proof bridge into React components/islands used by the shell and review dev
  pages; keep pinned Plannotator imports scoped here or in clearly named React components.
- `src/ui/design-system/components/` — add or adjust initial React/Radix-compatible primitives required by the scaffold
  and review fixtures without prematurely deleting Preact/Zag components needed by still-unported code.
- `src/ui/design-system/theme-bridge.js` — ensure selected RunWield theme CSS variables are usable by Astro pages, React
  islands, Radix primitives, and imported Plannotator components; add documented mappings only when a real pattern needs
  them.
- `docs/design-system.md` — update Workspace-specific guidance to reflect the ADR amendment: Astro/React/Radix/Tailwind
  is the Workspace endpoint, RunWield tokens remain source of truth, and Plannotator styling must be bridged through
  `--rw-*` variables.

## Reuse Opportunities

Existing functions, modules, and patterns to reuse:

- `src/ui/workspace/server.js` — reuse the token/cwd/static/API wrapper behavior rather than moving security into the
  Astro dev server.
- `src/ui/workspace/routes/api/handlers.js` — keep existing board/detail/lifecycle/body API semantics intact; route
  wrapper changes should not rewrite API behavior in this slice.
- `src/ui/workspace/routes/remote-api.js` and `src/ui/workspace/server/remote-adapter.js` — preserve remote
  collaboration API mode when restructuring `server.js`.
- `src/ui/design-system/theme-bridge.js` — reuse `loadRunWieldThemeCss()` and `renderRunWieldThemeCss()` as the selected
  theme bridge.
- `src/ui/workspace/react/PlannotatorPlanBody.tsx` — reuse the proven pinned Plannotator import pattern and treat it as
  the direct-source alias smoke test.
- `src/ui/workspace/react/vite.config.js` and `src/ui/workspace/vite.config.js` — reuse existing Plannotator alias,
  React/ReactDOM dedupe, Tailwind, and check/build knowledge when writing Astro config.
- `src/cmd/plans/ui.js` — preserve argument parsing, loopback warnings, token generation, browser open, and shutdown
  behavior.
- `docs/adr/007-local-first-workspace-plan-board.md` — follow the 2026-07 Astro/React/Radix amendment as the
  architectural source of truth.

## Implementation Steps

- [ ] Add Astro-related imports and tasks in `deno.json`: `astro`, `@astrojs/react`, `@deno/astro-adapter`,
      `workspace:dev`, `workspace:check`, `workspace:dev:plan-review`, and `workspace:dev:code-review`; keep CI pointed
      at an equivalent Workspace check path.
- [ ] Add `src/ui/workspace/astro.config.mjs` with server output, Deno adapter `start: false`, React integration,
      Tailwind 4/Vite configuration, Plannotator aliases, and React/ReactDOM dedupe.
- [ ] Create the initial Astro page/layout structure for the Workspace shell and internal fixture-backed review dev
      routes. Use route names that make their internal/dev status obvious.
- [ ] Update or replace the Workspace server wrapper so production-style serving still enforces token/cwd checks,
      preserves public CSS/theme/logo routes, preserves remote mode, and routes existing API handlers while delegating
      SSR page rendering to Astro output.
- [ ] Keep `src/cmd/plans/ui.js` behavior stable: `wld plans ui` should still start the local server, print/open a
      tokenized URL, honor `--bind`/`--host`/`--port`/`--no-open`, and shut down on SIGINT.
- [ ] Add minimal React/Radix-compatible design-system primitives and CSS/Tailwind hooks needed by the shell and review
      prototypes, without deleting Preact/Zag primitives before the parity slice.
- [ ] Extend the theme bridge/CSS so RunWield `--rw-*` variables are visible to Astro pages, React islands, Radix
      primitives, and imported Plannotator components.
- [ ] Implement direct fixture-backed Plan review and code review dev pages that can be reached by the exact new dev
      tasks and support HMR. Keep fixtures representative but clearly non-production.
- [ ] Update documentation for the Workspace-specific Astro/React/Radix/Tailwind exception, token/theme bridge
      expectations, and direct review dev workflow.

## Verification Plan

- Automated: `deno task -q check`.
- Automated: `deno task -q workspace:check` (or the exact Astro Workspace check introduced by this slice if it wraps the
  same command).
- Automated: `deno task -q workspace:test` for preserved API/server wrapper behavior where available.
- Automated: targeted `deno test -A src/cmd/plans/ui.test.js src/ui/workspace/workspace.test.js` if `workspace:test` is
  temporarily too broad during the platform migration.
- Manual/frontend: run `deno task workspace:dev`, open `http://localhost:5173/`, and verify an Astro-rendered Workspace
  scaffold appears with no unexplained console errors or failed critical requests.
- Manual/frontend: run `deno task workspace:dev:plan-review` and verify it opens or serves a fixture-backed internal
  Plan review route directly with HMR active.
- Manual/frontend: run `deno task workspace:dev:code-review` and verify it opens or serves a fixture-backed internal
  code review/diff route directly with HMR active.
- Manual/frontend: start `wld plans ui --no-open` (or `deno task cli -- plans ui --no-open`), open the printed tokenized
  URL manually, and verify the wrapper path still requires a token, serves theme/static CSS, and answers existing
  `/api/*` routes.
- Manual/frontend: verify the visible shell/review fixtures receive RunWield theme CSS variables and that a
  representative Radix primitive and Plannotator-rendered component inherit the Workspace theme.
- Expected result: platform scaffolding is in place, dev commands are usable for browser iteration, `wld plans ui` still
  runs through a RunWield-owned security/API wrapper, and fixture review pages are clearly separated from final workflow
  review behavior.

## Edge Cases & Considerations

- Temporary Workspace breakage is acceptable on the migration branch, but token and cwd security must not be removed
  from the production-style server wrapper.
- Astro dev server convenience must not be mistaken for the final `wld plans ui` security model.
- Remote Workspace/collaboration API mode currently shares `server.js`; do not accidentally regress it while migrating
  local page rendering.
- The scoped `.astro`/`.ts`/`.tsx` exception applies to Workspace only; non-Workspace RunWield code remains
  JavaScript/JSDoc.
- Review dev routes can use fixtures in this slice, but they must not falsely claim to preserve real workflow decision
  transport yet.
- Keep pinned `third_party/plannotator/` aliases; do not float to upstream during this platform setup.
- Keep Fresh/Preact/Uno runtime files available until child plan 02 proves parity and explicitly retires them.
- If Astro output paths or dev/build commands differ from the assumptions above, update task names and verification
  instructions in this plan before executing rather than silently changing the public workflow.
