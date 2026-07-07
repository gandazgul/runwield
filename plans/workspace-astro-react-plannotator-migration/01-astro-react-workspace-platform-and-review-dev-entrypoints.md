---
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
updatedAt: "2026-07-07T18:01:43.369Z"
status: "draft"
origin: "internal"
parentPlan: "workspace-astro-react-plannotator-migration"
order: 1
dependencies:
    []
---

# Astro React Workspace Platform and Review Dev Entrypoints

## Context

RunWield Workspace is moving from Fresh/Preact/UnoCSS/Zag to Astro SSR, React islands, Tailwind 4, Radix-compatible
primitives, and selective Plannotator reuse. This first slice creates the new platform seam so the rest of the migration
can happen on a branch with temporary Workspace breakage while still preserving the important RunWield boundaries:
`wld plans ui`, token-protected local access, cwd scoping, existing API handler ownership, and selected `wld` theme
propagation.

The user specifically wants internal Plan review and code review UIs to have direct dev commands, similar to
`workspace:dev`, that open those review surfaces for HMR-backed testing and tweaking.

## Objective

Build the Astro/React Workspace foundation and development entrypoints before porting the full Workspace behavior. The
outcome should be an Astro-backed shell with React/Tailwind/Radix infrastructure, preserved Plannotator aliases,
preserved local security/API seams, and these HMR-friendly dev commands:

- `deno task workspace:dev`
- `deno task workspace:dev:plan-review`
- `deno task workspace:dev:code-review`

## Approach

Introduce Astro SSR under `src/ui/workspace/` with `@deno/astro-adapter` configured for `start: false` so RunWield can
keep launch control. Keep `src/ui/workspace/server.js` or a clear successor as the wrapper responsible for token checks,
cwd state, public static/theme routes, and existing JSON API handler routing. Add React integration and Tailwind 4
support, preserve the pinned Plannotator source aliases, and establish React/Radix-compatible design-system primitives
needed by the shell and review prototypes.

Create fixture-backed internal review dev routes that can be opened directly by task commands without requiring a real
workflow run. These routes may use representative local payload fixtures at first; the production workflow replacement
belongs to the later review-surface slice.

## Files to Modify

- `deno.json` — add Astro, React integration, Deno adapter, Workspace check/dev tasks, and exact review dev tasks
  `workspace:dev:plan-review` and `workspace:dev:code-review`.
- `src/cmd/plans/ui.js` — keep the public `wld plans ui` launch behavior while pointing to the new server wrapper once
  available.
- `src/ui/workspace/astro.config.mjs` — configure Astro SSR, Deno adapter with `start: false`, React integration,
  Tailwind 4, and Plannotator aliases.
- `src/ui/workspace/vite.config.js` — remove or isolate Fresh-specific configuration as Astro becomes the Workspace
  build/dev owner; preserve Plannotator alias behavior until Astro fully owns it.
- `src/ui/workspace/server.js` — preserve token/cwd middleware, static asset routes, theme CSS route, API route
  ownership, and integrate the Astro handler for SSR pages.
- `src/ui/workspace/pages/` — add initial Astro shell routes for Workspace and internal review dev pages.
- `src/ui/workspace/react/` — evolve the proof bridge into React components/islands used by the shell and review dev
  pages.
- `src/ui/design-system/components/` — add initial React/Radix-compatible primitives required by the shell and review
  prototypes.
- `src/ui/design-system/theme-bridge.js` — ensure selected RunWield theme CSS variables are usable by Astro, React,
  Radix, and Plannotator components.
- `docs/design-system.md` — document the Workspace-specific React/Radix/Tailwind endpoint and token-bridge expectations.

## Reuse Opportunities

- `src/ui/workspace/server.js` — reuse the current token/cwd/static/API wrapper behavior rather than moving security
  into a dev-only Astro server assumption.
- `src/ui/workspace/routes/api/handlers.js` — keep existing board/detail/lifecycle/body API semantics intact.
- `src/ui/design-system/theme-bridge.js` — reuse `loadRunWieldThemeCss()` and `renderRunWieldThemeCss()` as the
  selected-theme bridge.
- `src/ui/workspace/react/PlannotatorPlanBody.tsx` — reuse the proven pinned Plannotator import pattern.
- `src/ui/workspace/react/vite.config.js` — reuse the existing Plannotator alias and React/Tailwind check knowledge when
  building the Astro config.
- `docs/adr/007-local-first-workspace-plan-board.md` — follow the 2026-07 Astro/React/Radix amendment as the
  architectural source of truth.

## Implementation Steps

- [ ] Add Astro-related imports and tasks in `deno.json`, including `workspace:dev`, `workspace:check`,
      `workspace:dev:plan-review`, and `workspace:dev:code-review`.
- [ ] Add `src/ui/workspace/astro.config.mjs` with server output, Deno adapter `start: false`, React integration,
      Tailwind 4, Plannotator aliases, and React/ReactDOM dedupe.
- [ ] Create the initial Astro page/layout structure for the Workspace shell and internal review dev routes.
- [ ] Update or replace the Workspace server wrapper so production-style serving still enforces token/cwd checks and
      routes existing API handlers while delegating SSR page rendering to Astro output.
- [ ] Add minimal React/Radix-compatible design-system primitives and CSS/Tailwind hooks needed by the shell and review
      prototypes.
- [ ] Extend the theme bridge/CSS so RunWield `--rw-*` variables are visible to Astro pages, React islands, Radix
      primitives, and imported Plannotator components.
- [ ] Implement direct fixture-backed plan review and code review dev pages that can be launched by the exact new dev
      tasks and support HMR.
- [ ] Update documentation for the Workspace-specific Astro/React/Radix/Tailwind exception and dev workflow.

## Verification Plan

- Automated: `deno task -q check`.
- Automated: `deno task -q workspace:check` or the equivalent Astro Workspace check introduced by this slice.
- Automated: `deno task -q workspace:test` for preserved API/server wrapper behavior where available.
- Manual/frontend: run `deno task workspace:dev`, open `http://localhost:5173/`, and verify an Astro-rendered Workspace
  shell appears with no unexplained console errors.
- Manual/frontend: run `deno task workspace:dev:plan-review` and verify it opens a fixture-backed internal Plan review
  route directly with HMR active.
- Manual/frontend: run `deno task workspace:dev:code-review` and verify it opens a fixture-backed internal code review
  route directly with HMR active.
- Manual/frontend: verify the visible shell/review fixtures receive RunWield theme CSS variables and that a
  representative Radix primitive and Plannotator-rendered component inherit the Workspace theme.
- Expected result: platform scaffolding is in place, dev commands are usable for browser iteration, and existing
  token/cwd/API responsibilities have not been dropped.

## Edge Cases & Considerations

- Temporary Workspace breakage is acceptable on the migration branch, but token and cwd security should not be
  accidentally removed from the production-style server wrapper.
- Astro dev server convenience must not be mistaken for the final `wld plans ui` security model.
- The scoped `.astro`/`.ts`/`.tsx` exception applies to Workspace only; non-Workspace RunWield code remains
  JavaScript/JSDoc.
- Review dev routes can use fixtures in this slice, but they must not falsely claim to preserve real workflow decision
  transport yet.
- Keep pinned `third_party/plannotator/` aliases; do not float to upstream during this platform setup.
