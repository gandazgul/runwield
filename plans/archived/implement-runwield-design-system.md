---
planId: "4972a1eb-202d-4de9-8d85-9d572dc6345b"
classification: "FEATURE"
complexity: "HIGH"
summary: "Extract and implement the RunWield Design System. This involves creating a shared `src/ui/design-system/` module, splitting existing Workspace CSS into tokens, components, and surface-specific styles, moving the TUI-to-browser theme bridge, and implementing the first Zag-backed primitive (Dialog)."
affectedPaths:
    - "src/ui/design-system/tokens.css"
    - "src/ui/design-system/components.css"
    - "src/ui/design-system/theme-bridge.js"
    - "src/ui/workspace/static/styles.css"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/components/PlanCard.jsx"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-04T19:08:58-04:00"
updatedAt: "2026-07-17T04:47:50.991Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-05T01:32:10.000Z"
verifiedAt: "2026-07-05T01:32:10.000Z"
workRecord:
    status: "generated"
    recordId: "73c98bbd-8994-4f7b-b1ac-41408636b450"
    path: "docs/work-records/2026-07-17-implemented-runwield-design-system.md"
    lastAttemptAt: "2026-07-17T04:47:43.012Z"
humanReviewMode: null
humanReviewDecision: null
executionBaselineTree: "017ec44b3bd7cf776d48627bbb9064ae64b66c94"
worktreeId: "5123def0"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-harns--/harns-runwield-implement-runwield-design-system-5123def0"
worktreeBranch: "runwield/worktree/implement-runwield-design-system-5123def0"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
archivedAt: "2026-07-05T04:13:26.531Z"
archivedFromStatus: "verified"
archivedFromPath: "plans/implement-runwield-design-system.md"
routingIntent: "FEATURE"
sessionName: "implement design system"
---

# Implement RunWield Design System

## Context

The current Workspace UI already contains the RunWield browser visual language: dark local-first shell, slate surfaces,
accented cards, pill actions and badges, status colors, markdown/editor surfaces, and a server-generated browser theme
bridge that mirrors the active TUI theme. The design-system direction is now settled in `docs/design-system.md`:
Workspace remains the visual source of truth, the future Plannotator replacement will live inside Workspace, and shared
browser UI primitives should live under `src/ui/design-system/`.

This Plan extracts and stabilizes that source of truth without redesigning Workspace. It should preserve the current
Workspace look and feel while making the shared CSS, theme bridge, and first reusable components available to Workspace
and future browser surfaces.

## Objective

Build the first executable slice of the RunWield Design System:

- Create `src/ui/design-system/` as the shared browser UI module.
- Split the current monolithic Workspace CSS into shared `tokens.css`, shared `components.css`, and Workspace-specific
  surface CSS.
- Move/adapt the browser theme bridge out of Workspace so it belongs to the design-system module and continues to map
  the active TUI theme from `src/shared/ui/theme.js` into `--rw-*` CSS variables.
- Add a dependency-light Preact component layer for core visual primitives.
- Add Dialog as the first Zag-backed general primitive: ephemeral by default, flexible body/footer actions, and visually
  consistent with Workspace.
- Update Workspace to consume the shared design-system files while preserving current UI behavior and appearance.

## Approach

Keep this as an extraction/refinement change, not a redesign. Start by copying/moving behavior from the existing
Workspace implementation, then adjust imports, static serving, and tests so the same UI renders from the new shared
module.

Implementation should prefer a small, stable public interface:

- CSS files under `src/ui/design-system/` for browser-wide tokens and shared component classes.
- A design-system theme bridge module, for example `src/ui/design-system/theme-bridge.js`, exporting renamed versions of
  the current Workspace theme helpers such as `renderRunWieldThemeCss()` and `loadRunWieldThemeCss()`.
- Reusable Preact primitives under `src/ui/design-system/components/` with optional
  `src/ui/design-system/components/index.js` exports.
- Workspace-specific CSS retained separately for shell, board layout, and other patterns that are not yet reusable.

Use Zag only for Dialog. Do not use Zag for simple primitives such as Button, Card, Badge, Notice, Tabs, Input, or
Textarea.

## Files to Modify

- `deno.json` — add the Zag imports needed for the Dialog primitive, expected to include `@zag-js/preact` and
  `@zag-js/dialog`; keep versions explicit and compatible with Deno npm imports.
- `src/ui/design-system/tokens.css` — new shared CSS token/reset/typography file extracted from the top of
  `src/ui/workspace/static/styles.css`.
- `src/ui/design-system/components.css` — new shared component CSS for reusable visual patterns: actions, badges/status
  pills, cards, notices, forms, metadata, markdown/editor surfaces, disabled states, and Dialog classes.
- `src/ui/design-system/theme-bridge.js` — new shared browser theme bridge moved/adapted from
  `src/ui/workspace/server/theme-css.js`; keep pure JS/JSDoc and preserve current escaping/color-resolution behavior.
- `src/ui/design-system/components/Button.jsx` — new primitive wrapping action class variants while preserving semantic
  `<button>` behavior.
- `src/ui/design-system/components/Card.jsx` — new primitive/compound card helpers for raised cards and optional compact
  variants.
- `src/ui/design-system/components/Badge.jsx` — new primitive for badge/status pill variants.
- `src/ui/design-system/components/Notice.jsx` — new primitive for success/muted/warning/danger notices.
- `src/ui/design-system/components/Dialog.jsx` — new Zag-backed Dialog primitive using Preact hooks and RunWield-owned
  visual structure/classes.
- `src/ui/design-system/components/index.js` — optional barrel file if it improves imports without hiding file-level
  ownership.
- `src/ui/workspace/static/styles.css` — split into shared design-system CSS and Workspace-specific CSS; delete or
  reduce to a compatibility wrapper only if needed.
- `src/ui/workspace/static/workspace.css` — new Workspace-only stylesheet for shell, board columns, tab-search slot,
  plan search, detail layout, lifecycle action placement, and other surface-specific selectors.
- `src/ui/workspace/server/theme-css.js` — remove after imports/tests are migrated, or leave as a thin compatibility
  re-export only if necessary for a low-risk transition.
- `src/ui/workspace/server.js` — serve/link the split stable CSS files and switch `/theme.css` to the shared theme
  bridge; preserve token bypass for CSS/logo assets and `cache-control: no-store` for generated theme CSS.
- `src/ui/workspace/components/AppWrapper.jsx` — link the split CSS files in deterministic order: tokens, components,
  Workspace surface CSS, then generated theme CSS so theme variables can override defaults.
- `src/ui/workspace/components/PlanCard.jsx`, `EpicCard.jsx`, `PlanDetail.jsx`, `MarkdownView.jsx`, and related
  components — optionally adopt shared primitives where this is mechanical and low-risk; do not force a full component
  migration in this first slice if class extraction is enough.
- `src/ui/workspace/workspace.test.js` — update imports and CSS assertions for the new split files and shared theme
  bridge.
- New design-system tests near `src/ui/design-system/` if helpful, especially for theme bridge rendering and Dialog SSR
  or prop shape checks.

## Reuse Opportunities

- `src/ui/workspace/server/theme-css.js` — source implementation for theme JSON resolution, token mapping, CSS escaping,
  color validation, and generated `:root` output.
- `src/shared/ui/theme.js` — keep using `resolveSelectedThemeJson()` as the only browser theme source; browser surfaces
  must not read theme JSON directly.
- `src/ui/workspace/static/styles.css` — source for existing visual rules; split by responsibility rather than
  rewriting.
- `src/ui/workspace/components/PlanCard.jsx` — source for card, complexity, badge, and clickable-card patterns.
- `src/ui/workspace/components/PlanDetail.jsx` — source for detail panel, metadata, action, and markdown/editor surface
  patterns.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` and `PlanBodyEditor.jsx` — source for current action/button and
  form-state behavior.
- Zag Dialog docs/current examples — use `@zag-js/dialog` machine/connect and `@zag-js/preact` `useMachine` /
  `normalizeProps`; adapt only the behavior contract while keeping RunWield visuals.

## Implementation Steps

- [ ] Step 1: Add design-system dependency imports in `deno.json` for `@zag-js/preact` and `@zag-js/dialog`, then run a
      targeted `deno check` or `deno info` command to verify Deno can resolve them.
- [ ] Step 2: Create `src/ui/design-system/theme-bridge.js` by moving/adapting the current Workspace theme bridge.
      Rename exported functions to design-system names, preserve the token map, and update JSDoc typedef names away from
      Workspace-specific naming.
- [ ] Step 3: Move theme bridge tests out of Workspace-specific import paths or update
      `src/ui/workspace/workspace.test.js` to import the shared bridge. Keep assertions for escaped theme names, nested
      token resolution, bundled Catppuccin Mocha colors, Complexity color mappings, and `--rw-theme-name` output.
- [ ] Step 4: Split `src/ui/workspace/static/styles.css` into three responsibility groups while preserving current
      declarations and cascade order as much as possible: - shared token/base rules in
      `src/ui/design-system/tokens.css`; - shared primitive/component rules in `src/ui/design-system/components.css`; -
      Workspace-only layout/search/board/detail placement rules in `src/ui/workspace/static/workspace.css`.
- [ ] Step 5: Update `AppWrapper.jsx`, `server.js`, and Vite/static configuration as needed so Workspace loads the split
      CSS in stable order and continues to load generated `/theme.css`. The generated theme route should use
      `loadRunWieldThemeCss()` from the shared bridge and retain `cache-control: no-store`.
- [ ] Step 6: Add visual primitives under `src/ui/design-system/components/`: `Button`, `Card`, `Badge`, and `Notice`.
      These may initially be thin semantic wrappers around existing class names and variants; preserve native element
      semantics and allow `class`/`className` extension in Preact-compatible JS.
- [ ] Step 7: Add `Dialog.jsx` under `src/ui/design-system/components/` using `@zag-js/dialog` and `@zag-js/preact`.
      Support controlled or default-open usage as appropriate for Zag, title/description/body/footer composition,
      flexible footer actions, Escape/dismiss behavior from Zag, and no URL changes. Keep all styling in
      `components.css` using existing surface/action tokens.
- [ ] Step 8: Optionally migrate low-risk Workspace call sites to the new primitives where doing so reduces duplication
      without changing rendered markup materially. Prefer deferring broad migrations over increasing blast radius.
- [ ] Step 9: Update tests for CSS loading and theme serving: - `/theme.css` remains public under token protection
      bypass and returns no-store CSS; - split stable CSS assets are available to the app; - SSR HTML links CSS in the
      expected order; - existing Workspace card/detail/search/lifecycle assertions still pass.
- [ ] Step 10: Add or update tests for Dialog enough to prove importability and accessible markup/properties. If browser
      interaction tests require a consumer route, avoid adding a public route solely for the test; instead use unit/SSR
      tests or a small test-only Fresh app harness.
- [ ] Step 11: Run formatter/checks/tests and fix all issues without introducing TypeScript syntax.

## Verification Plan

- Automated:
  - `deno fmt --check`
  - `deno check --doc src/**/*.js src/**/*.jsx`
  - `deno test -A src/ui/workspace src/cmd/plans/ui.test.js`
  - `deno task ci`
- Manual/headed browser:
  - Start the dev server with `deno task workspace:dev` and open `http://localhost:5173/` with headed `agent-browser`.
  - Verify the Plan Board still renders with the current dark Workspace look, RunWield brand, tabs, search, board
    columns, Plan Cards, Epic Cards when available, badges, and empty states.
  - Open a Plan detail route and verify detail panel layout, action buttons, metadata groups, markdown body, and editor
    surfaces still match the current look.
  - Check desktop and a narrow/mobile viewport for tab/search wrapping, board overflow/collapse, detail two-column to
    one-column behavior, and no clipped actions.
  - Inspect browser console/errors and failed network requests; no new CSS/theme asset failures should appear.
  - Confirm `/theme.css` still loads with `cache-control: no-store` and that changing the active RunWield theme
    continues to affect Workspace browser variables when feasible to test locally.
- Expected results:
  - Workspace appearance is materially unchanged except for any tiny CSS-order differences justified in the final
    report.
  - Shared CSS files and generated theme CSS are loaded in deterministic order.
  - The design-system module can be imported by future Workspace/Plannotator code.
  - Dialog compiles and has a clear accessible behavior seam through Zag, even if no production Workspace route consumes
    it yet.

## Edge Cases & Considerations

- CSS split risk: moving declarations can change cascade order. Mitigate by preserving selector specificity and loading
  order; use visual browser checks on board and detail screens.
- Theme override risk: default values in `tokens.css` must be overridden by generated `/theme.css`. Keep generated theme
  CSS linked after stable token/component CSS.
- Fresh/Vite static asset risk: Workspace currently serves `/styles.css` manually. If CSS import bundling causes SSR or
  FOUC issues, prefer explicit linked CSS assets served by the Workspace app for this slice and document the trade-off.
- Zag/Deno/Preact compatibility risk: `@zag-js/preact` is the intended adapter. If it cannot resolve or fails under Deno
  in a minimal Dialog, do not switch to another UI stack inside this Plan; report the blocker with evidence.
- Dialog consumer risk: Workspace has no current Dialog use. Keep Dialog generic and tested for import/markup/behavior
  where practical without adding a visible route only for demonstration.
- Scope control: this Plan establishes the shared system and migrates only low-risk call sites. Broadly rewriting every
  Workspace component to use primitives can be a follow-up once the shared layer is stable.
- Documentation: `docs/design-system.md` already records the decisions. Only update it if implementation discovers a
  necessary correction to the architecture.
