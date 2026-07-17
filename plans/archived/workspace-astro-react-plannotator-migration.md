---
planId: "b4cfe540-2c86-47eb-8963-74788ecb6af0"
classification: "PROJECT"
complexity: "HIGH"
summary: "Large-scale architectural shift of the Workspace UI from Fresh/Preact to React/ReactDOM. This involves porting existing components, integrating Plannotator UI elements, adopting Radix UI, and updating the design system. Requires a PROJECT plan to manage the migration strategy, SSR/client boundaries, and phased rollout."
affectedPaths:
    - "src/ui/workspace/vite.config.js"
    - "src/ui/workspace/client.js"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/"
    - "src/ui/design-system/"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-07T13:30:52-04:00"
updatedAt: "2026-07-17T04:53:03.128Z"
status: "verified"
origin: "internal"
type: "epic"
verifiedAt: "2026-07-14T12:19:57.000Z"
workRecord:
    status: "generated"
    recordId: "6e6b260d-6254-4cbe-bc6d-89ab9131da19"
    path: "docs/work-records/2026-07-17-migrated-workspace-to-astro-react-and-plannotator.md"
    lastAttemptAt: "2026-07-17T04:52:54.858Z"
worktreeBaseBranch: "workspace-astro-react-plannotator-migration"
archivedAt: "2026-07-14T12:20:06.122Z"
archiveReason: "All child FEATURE plans verified"
archivedFromStatus: "verified"
archivedFromPath: "plans/workspace-astro-react-plannotator-migration.md"
routingIntent: "PROJECT"
sessionName: "workspace react migration"
---

# Workspace Astro React Plannotator Migration

## Context

RunWield Workspace currently uses Fresh 2 + Vite with Preact islands, UnoCSS, RunWield-owned CSS tokens/components, and
a small React bridge under `src/ui/workspace/react/` to prove direct Plannotator component reuse. The Plannotator proof
of concept is now accepted: the Plan detail read-only body can render through
`@plannotator/ui/components/RenderedMarkdown` from the pinned `third_party/plannotator/` checkout.

The requested next step is larger than a proof: migrate the entire Workspace toward Astro SSR by default, React islands
where interactivity is needed, Radix-compatible primitives in the Workspace/design-system layer, Tailwind 4 plus
RunWield tokens for styling, and selective Plannotator UI reuse for document/review/editor/diff surfaces. The user is
comfortable doing this on a branch with temporary Workspace breakage because there are no active Workspace users.

This Epic records and executes an architecture pivot captured as a 2026-07 amendment in
`docs/adr/007-local-first-workspace-plan-board.md`:

- Fresh/Preact is superseded for `src/ui/workspace/`.
- Workspace becomes a scoped `.astro`/`.ts`/`.tsx` exception zone.
- The rest of RunWield remains pure JavaScript with JSDoc unless separately decided.
- Canonical Plan markdown files, Plan Lifecycle modules, local token auth, and cwd sandboxing remain the source of
  truth.
- RunWield visual identity remains primary; Plannotator and Radix must be themed through RunWield tokens.

## Objective

Replace the current Fresh/Preact Workspace with an Astro SSR Workspace that preserves current core behavior while
opening a clean path to deeper Plannotator and Radix reuse.

The migrated Workspace must:

- serve board/detail pages through Astro SSR, with React islands only for interactive surfaces;
- keep `wld plans ui` as the local launch entry point with token-protected, cwd-scoped access;
- keep existing Plan store, Plan Lifecycle, body save, hierarchy, dependency, and remote API semantics;
- preserve current core Workspace parity before deleting the old Fresh/Preact implementation:
  - board tabs for active/closed/on-hold Plans;
  - Plan search/filtering;
  - drag-and-drop/manual lifecycle actions;
  - Plan detail metadata, Epic child health, hierarchy, dependencies, and sidebar actions;
  - read-only Plan body rendering through Plannotator where compatible;
  - body editing, local draft recovery, body hash conflict handling, and save behavior;
  - token auth and API route behavior;
- replace Workspace design-system primitives with React/Radix-compatible equivalents while preserving RunWield tokenized
  visual identity;
- include later slices that replace compiled Plannotator plan/code review launch surfaces with Workspace-hosted
  Astro/React/Plannotator routes behind internal launchers;
- preserve the selected `wld` theme across the Workspace shell, Plan detail, body editor, Plan review, code review,
  Radix primitives, and imported Plannotator components;
- retire Fresh/Preact/UnoCSS from Workspace after Astro/React/Tailwind/Radix parity is proven.

Reference ADR: `docs/adr/007-local-first-workspace-plan-board.md`, especially the 2026-07 Astro/React/Radix amendment.

## Vertical Slice Findings

The current Workspace route and component seam is compact but framework-coupled:

- `src/ui/workspace/server.js` builds a programmatic Fresh `App`, applies token/cwd middleware, registers static
  CSS/logo routes, wraps pages with `AppWrapper` and `WorkspaceLayout`, and exposes board/detail/API routes.
- `src/ui/workspace/routes/board.jsx` and `src/ui/workspace/routes/detail.jsx` call server-side adapters (`loadBoard`,
  `loadWorkspaceDetail`) and render Preact components.
- `src/ui/workspace/components/Board.jsx` renders the board SSR and hydrates Preact islands for search and drag/drop.
- `src/ui/workspace/components/PlanDetail.jsx` renders detail SSR and hydrates Preact islands for lifecycle actions and
  body editing.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` owns body edit mode, CodeMirror mounting, local draft recovery, conflict
  saves, and the current Plannotator read-only bridge.
- `src/ui/workspace/react/PlannotatorPlanBody.tsx` imports the actual upstream proof component:
  `@plannotator/ui/components/RenderedMarkdown.tsx`.
- `src/ui/workspace/vite.config.js` already aliases `@plannotator/ui`, `@plannotator/shared`, and `@plannotator/ai` to
  the pinned checkout under `third_party/plannotator/`.
- `src/ui/design-system/components/Dialog.jsx` and related primitives currently use Preact/Zag; these need React/Radix
  counterparts for the target Workspace.
- `docs/design-system.md` already contains a Plannotator reuse exception and says imported Plannotator components must
  conform to Workspace rather than replacing RunWield visual identity.
- `src/ui/design-system/theme-bridge.js` currently converts the selected RunWield theme JSON into browser CSS variables
  via `loadRunWieldThemeCss()` / `renderRunWieldThemeCss()`. The Astro migration must preserve and expand this seam so
  the selected `wld` theme applies to local Workspace, Plan review, code review, Radix primitives, and imported
  Plannotator components.
- `src/shared/workflow/review-launcher.js` already provides the review-surface adapter seam. It dynamically imports
  `@gandazgul/plannotator-pi-extension-compiled/server`, calls `startPlanReviewServer` / `startReviewServer`, passes
  payloads such as `plan`, `rawPatch`, `gitRef`, `agentCwd`, `htmlContent`, and `origin: "runwield"`, opens the returned
  URL in the system browser, exposes `waitForDecision`, and stops the server. Workspace-hosted review replacement must
  preserve this contract and must first audit whether the compiled Plannotator server does additional decision transport
  or lifecycle work that needs to be ported.

Current documentation and memory previously favored Fresh/Preact, UnoCSS, and Zag. The new ADR supersedes those
Workspace-specific decisions but does not change non-Workspace CLI/TUI conventions.

Current external documentation facts used for this architecture:

- Astro SSR requires an adapter; `output: "server"` makes pages on-demand rendered by default.
- `@deno/astro-adapter` supports Astro SSR on Deno. Its `start: false` mode allows a custom Deno server to import and
  call the generated `handle(req)` function, which is important for preserving RunWield token/cwd launch control.
- `@astrojs/react` renders React components in Astro and hydrates only when explicit `client:*` directives are used.
- Astro React children crossing from `.astro` into React can be plain strings unless configured otherwise, so Radix and
  Plannotator composition should generally live inside React components rather than depending on complex Astro-to-React
  children.
- Radix primitives are React-first and have SSR testing coverage upstream; they are a better target than Zag/Preact for
  a Plannotator-compatible Workspace.

## Files to Modify

- `docs/adr/007-local-first-workspace-plan-board.md` — canonical Workspace ADR; its 2026-07 amendment accepts the
  Fresh/Preact/Zag to Astro SSR/React/Radix/Plannotator pivot for Workspace only.
- `docs/design-system.md` — update Workspace design-system guidance: RunWield tokens remain source of truth; Workspace
  primitives move to React/Radix; Tailwind 4 becomes the Workspace utility/style compilation path; UnoCSS is phased out
  from Workspace; imported Plannotator styling must be bridged through RunWield tokens.
- `deno.json` — add Astro, `@astrojs/react`, `@deno/astro-adapter`, Tailwind 4, Radix packages, and Workspace-specific
  dev/build/check/test tasks while preserving the single root dependency/config file.
- `src/cmd/plans/ui.js` — keep the `wld plans ui` command and launch behavior, but point it at the Astro-backed
  Workspace server/dev workflow once the server wrapper is ready.
- `src/ui/workspace/astro.config.mjs` or equivalent Workspace Astro config — configure `output: "server"`, the Deno
  adapter with `start: false` for production wrapping, the React integration, Tailwind 4, Plannotator aliases, and any
  Astro root/path choices.
- `src/ui/workspace/vite.config.js` — remove Fresh-specific plugin configuration or replace it with Astro-compatible
  Vite configuration as needed. Keep Plannotator aliases until Astro config fully owns them.
- `src/ui/workspace/server.js` or successor server wrapper — preserve token/cwd middleware and static/API ownership;
  integrate the generated Astro Deno adapter handler for SSR page rendering.
- `src/ui/workspace/pages/` or chosen Astro route directory — replace Fresh routes with Astro SSR pages for `/`,
  `/closed`, `/on-hold`, and `/plans/:planId`.
- `src/ui/workspace/routes/api/handlers.js` and `src/ui/workspace/server/*.js` — preserve existing API handler logic and
  Plan adapters; move only the routing wrapper if Astro endpoint files need to call the same handlers.
- `src/ui/workspace/components/` — port current board/detail/card/layout/metadata components to Astro and/or React
  depending on whether they need hydration.
- `src/ui/workspace/islands/` — replace Preact islands with React islands or Astro components. Existing behavior to port
  includes board search, drag/drop, lifecycle actions, body editor, draft recovery, and conflict saves.
- `src/ui/workspace/react/` — evolve from a proof bridge into the Workspace React component area, or relocate to a
  clearer `src/ui/workspace/components/react/`/`src/ui/workspace/islands/` structure under Astro.
- `src/ui/design-system/components/` — add React/Radix-compatible primitives for Button, Dialog, Dropdown/Menu, Popover,
  Tooltip, Tabs, Badge/StatePill, Card, Notice, and form controls used by Workspace. Existing Preact/Zag primitives can
  remain temporarily only for non-migrated code.
- `src/ui/design-system/tokens.css`, `src/ui/design-system/components.css`, `src/ui/design-system/theme-bridge.js` —
  keep RunWield tokens, add Radix/Plannotator variable bridging, ensure the selected `wld` theme flows to Workspace and
  review screens, and remove obsolete Uno/Fresh-only assumptions when no longer needed.
- `src/ui/workspace/static/workspace.css` and related CSS — migrate to Tailwind 4-compatible global/component CSS while
  preserving current visual density, colors, focus states, responsive behavior, and dark theme.
- `src/ui/workspace/workspace.test.js` — update route/API assertions for Astro output while preserving behavior checks.
- `src/ui/design-system/design-system.test.js` — update or add tests for React/Radix design-system primitives.
- `src/shared/workflow/review-launcher.js` — audit the current compiled Plannotator server contract, preserve the
  review-surface adapter seam, and route Plan/code review to Workspace-hosted internal launchers when equivalent.
- `src/shared/workflow/submit-plan.js` and `src/shared/workflow/code-review.js` — later in the Epic, replace compiled
  Plannotator launch surfaces with Workspace-hosted review routes behind the adapter seam without changing workflow
  callers.
- `third_party/plannotator/` and `third_party/plannotator-revision.txt` — keep the pinned, reviewed source checkout as
  the direct Plannotator UI dependency path.

## Reuse Opportunities

Existing modules and seams to preserve:

- `src/ui/workspace/server/plan-adapter.js` — reuse as the canonical board/detail serialization seam. It already hides
  Plan store details from UI components.
- `src/ui/workspace/routes/api/handlers.js` — reuse API behavior for board, Plans, lifecycle actions, body save, and
  workspace metadata rather than rewriting API semantics during the UI migration.
- `src/plan-store.js` and Plan Lifecycle modules — keep canonical Plan metadata, status transitions, body hashes, and
  hierarchy/dependency rules outside the UI framework.
- `src/ui/workspace/components/PlanCard.jsx`, `BoardColumn.jsx`, `EpicCard.jsx`, and `PlanDetail.jsx` — use as behavior
  reference for parity while porting to Astro/React.
- `src/ui/workspace/islands/PlanBodyEditor.jsx` — use as the source of body editing invariants: CodeMirror lifecycle,
  dirty state, draft key format, draft recovery states, save request shape, conflict handling, and before-unload guard.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` and `PlanBoardDragDrop.jsx` — use as the source of lifecycle
  action request contracts and drag/drop affordances.
- `src/ui/design-system/tokens.css` — keep as visual token source; map Radix/Plannotator/Tailwind styling to these
  variables.
- `docs/design-system.md` — keep as the design language contract and update it to describe the React/Radix endpoint.
- `@plannotator/ui/components/RenderedMarkdown` — keep for read-only Plan body/document rendering where it meets visual
  and accessibility requirements.
- `@plannotator/ui/components/Viewer`, `MarkdownEditor`, `plan-diff/*`, and related document/review components — reuse
  selectively for later review/editor/diff slices after their data contracts and styling are validated.
- Radix React primitives — use for accessible interactive primitives instead of porting Preact/Zag machines.

## Verification Plan

Automated verification for the Epic endpoint and relevant child FEATUREs:

- `deno task -q check`
- `deno task -q workspace:check` or the new Astro-specific Workspace type/build check introduced by the migration
- `deno task -q lint`
- `deno task -q fmt:check`
- `deno task -q workspace:test`
- `deno task -q test`
- `deno task -q ci` once the Workspace migration is integrated with the full repository check path

Manual/frontend verification is mandatory for executable child FEATUREs in this Epic. The Slicer should mark those child
FEATURE plans with `frontend: true`. Likely child slices requiring headed browser verification include:

- Astro SSR shell and launch route migration.
- Board view parity: active/closed/on-hold tabs, cards, Epic cards, orphan repair lane, search/filter behavior, and
  responsive layout.
- Lifecycle interactions: manual status moves, drag/drop status moves, put on hold/resume/reset/close flows, disabled or
  blocked action states, and API error handling.
- Plan detail parity: title/sidebar metadata, Epic child health, child board, dependency warnings, body rendering, and
  close/back navigation.
- Body editor parity: edit mode, CodeMirror or chosen editor mount, dirty state, local draft recovery, body hash
  conflict handling, save success/failure, and before-unload behavior.
- React/Radix design-system primitives: Dialog, Dropdown/Menu, Popover/Tooltip, Tabs, buttons, badges/state pills,
  keyboard/focus behavior, and accessibility snapshots.
- Plannotator document/editor/review surfaces: markdown fidelity, tables/code/math/links/images as applicable, empty
  content, long content, and theme compatibility.
- Workspace-hosted plan review and code review routes replacing compiled Plannotator launch surfaces, including approve,
  feedback, annotations, exit/cancel, browser-open fallback, wait-for-decision, and shutdown behavior.
- Theme propagation: change/select a non-default `wld` theme, then verify Workspace shell, board/detail, body editor,
  Plan review screen, code review screen, Radix popovers/dialogs/menus/tooltips, and Plannotator-rendered content all
  receive the expected RunWield CSS variables and visual theme.

Expected browser evidence for frontend child FEATUREs:

- final URL and viewport;
- no unexplained console errors;
- no failed network requests except expected missing favicon or explicitly documented non-blockers;
- visible proof of the migrated surface;
- DOM/state evidence for critical renderer ownership where relevant, such as Plannotator-rendered document roots;
- screenshots for visual/layout changes;
- accessibility snapshots for changed controls or Radix primitives.

Key expected outcomes:

- `wld plans ui` still opens a token-protected local Workspace for the current checkout.
- `/`, `/closed`, `/on-hold`, and `/plans/:planId` render through Astro SSR.
- React only hydrates interactive islands; read-only Astro/React SSR content remains visible without client-side JS
  where practical.
- Current Workspace core behavior is preserved before Fresh/Preact files are deleted.
- Fresh/Preact/UnoCSS dependencies are removed from Workspace only after equivalent Astro/React/Tailwind behavior is
  verified.
- Plan/code review routes eventually open inside Workspace-hosted Astro/React/Plannotator surfaces through internal
  launchers and preserve current approve/feedback/annotation/exit workflow outcomes.
- The active `wld` theme is visible and inspectable in local Workspace and review screens through `--rw-*` CSS variables
  and Plannotator/Radix-compatible token bridges.

## Edge Cases & Considerations

- **Framework replacement risk:** Fresh currently provides routing, SSR, hydration, and tests. Replacing it with Astro
  should be sequenced so server adapters and API behavior stay stable while page rendering changes.
- **Deno adapter integration:** Astro's Deno adapter can auto-start a server, but RunWield needs launch control. Use
  `start: false` and a RunWield wrapper around the generated `handle(req)` for production-style serving.
- **Dev server versus production wrapper:** `deno task workspace:dev` should provide HMR for migration work, while the
  CLI launch path must still enforce token/cwd security. Do not assume Astro dev middleware alone satisfies local
  security behavior.
- **Scoped TypeScript exception:** Workspace may use `.astro`, `.ts`, and `.tsx`; non-Workspace RunWield executable code
  remains JavaScript/JSDoc. Keep the exception documented to avoid repo-wide style drift.
- **Astro/React children boundary:** Avoid complex Radix composition split across `.astro` children passed into React.
  Prefer React wrapper components for Radix/Plannotator composition.
- **Visual identity:** Plannotator and Radix CSS must be token-bridged to RunWield variables. Do not import an upstream
  theme in a way that erases Workspace colors, density, typography, or status language without explicit design review.
- **Tailwind and Uno coexistence:** Tailwind 4 is the endpoint. Temporary coexistence is acceptable on the branch only
  when needed to keep a slice moving; final Workspace should not require UnoCSS unless a later decision keeps it.
- **Core parity deletion gate:** Do not delete Fresh/Preact Workspace files until board/detail/lifecycle/body editing
  parity passes automated and headed browser verification.
- **Review surface sequencing:** Plan/code review replacement belongs in this Epic but should follow stable core
  Workspace migration. Keep compiled Plannotator behavior available until Workspace-hosted review routes can preserve
  approval/feedback/annotation/exit outcomes, browser-open fallback, decision waiting, and server shutdown.
- **Compiled Plannotator server audit:** Do not assume the current Plannotator server is only static asset serving.
  Audit `startPlanReviewServer`, `startReviewServer`, payload formats, decision endpoints/events, wait/stop lifecycle,
  and any origin-specific behavior before replacing it.
- **Theme bridge is product behavior:** The selected `wld` theme must carry through `loadRunWieldThemeCss()` or its
  successor into Workspace and review surfaces. Missing theme propagation is a functional regression, not cosmetic debt.
- **Pinned third-party source:** Continue treating `third_party/plannotator/` as reviewed source, pinned by
  `third_party/plannotator-revision.txt`. Do not float to upstream main during implementation.
- **Current working tree caution:** At plan creation time, the repository also had in-progress Plannotator proof fix
  edits and an unrelated dirty plan file. Execution agents should inspect `git status` before editing and avoid
  overwriting unrelated user changes.
- **Branch tolerance is not merge tolerance:** Temporary Workspace breakage is acceptable on the migration branch, but
  the final branch must pass the verification plan before merge.
