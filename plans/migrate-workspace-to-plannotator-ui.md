---
planId: "544d15a1-8c14-4beb-9475-81e2c538b344"
classification: "FEATURE"
complexity: "HIGH"
summary: "Migrate the Workspace UI toward React/TypeScript and prove direct reuse of upstream Plannotator UI components by rendering Plan detail markdown through Plannotator components."
affectedPaths:
    - "deno.json"
    - ".gitmodules"
    - "docs/adr/007-local-first-workspace-plan-board.md"
    - "docs/design-system.md"
    - "src/cmd/plans/ui.js"
    - "src/shared/workflow/review-launcher.js"
    - "src/shared/workflow/submit-plan.js"
    - "src/shared/workflow/code-review.js"
    - "src/ui/workspace/"
    - "src/ui/design-system/"
    - "third_party/plannotator/"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-06T19:08:48-04:00"
updatedAt: "2026-07-07T03:57:16.338Z"
status: "implemented"
origin: "internal"
failureReason: "Semantic validation did not approve after 3 cycles."
worktreeId: "ac489aab"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-harns--/harns-runwield-migrate-workspace-to-plannotator-ui-ac489aab"
worktreeBranch: "runwield/worktree/migrate-workspace-to-plannotator-ui-ac489aab"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
---

# Migrate Workspace Toward Direct Plannotator UI Reuse

## Context

The current RunWield Workspace is a Fresh 2 + Vite app using Preact islands, UnoCSS, pure JS/JSDoc, and RunWield-owned
design-system CSS. Plan review and code review still use the compiled `@gandazgul/plannotator-pi-extension-compiled`
bridge, which serves bundled Plannotator HTML rather than reusable UI modules.

Upstream Plannotator now has shared React/TypeScript UI under `packages/ui/` in `github.com/backnotprop/plannotator`.
Its monorepo `@plannotator/ui` package exports components such as `RenderedMarkdown`, `Viewer`, `MarkdownEditor`,
`ThemeProvider`, plan-diff components, hooks, utilities, and CSS theme tokens. The package is not currently published on
npm, so direct reuse requires a source-level dependency strategy such as a pinned git submodule/source checkout plus
Vite aliases.

Public npm packages currently include `@plannotator/webtui`, `@plannotator/markdown-editor`,
`@plannotator/atomic-editor`, `@plannotator/web-highlighter`, `@plannotator/workspaces-api`, `@plannotator/opencode`,
and `@plannotator/pi-extension`. These are useful signals and possible lower-risk building blocks, but they do not
replace the direct `packages/ui` reuse proof because the shared Plan/review components remain unpublished. Deno/npm
resolution can lag or refuse very recently published packages as a supply-chain safety control to limit rapid spread of
malicious npm packages, so implementation should not assume same-day Plannotator releases are immediately installable
through Deno. A pinned git submodule/source checkout can avoid that freshness gate for audited upstream source, but the
implementation must treat the checkout as a reviewed third-party dependency rather than an unrestricted live dependency.

This plan intentionally revisits older RunWield decisions that made Workspace Preact/JS/JSDoc-only. The user has
explicitly opened the door to React, TypeScript, Tailwind-compatible styling, and Radix primitives because direct
Plannotator ecosystem alignment may be a better long-term bet than reimplementing Plan/review UI primitives privately.

The initial executable slice should prove the dependency and rendering path without immediately replacing every
Workspace surface or review workflow. The user confirmed this should be a foundation/PoC FEATURE Plan, not an Epic and
not a same-slice replacement of `plan_written` or code review. The user also confirmed the preferred upstream sourcing
strategy is a pinned git submodule/source checkout under `third_party/plannotator/` with Vite aliases.

## Objective

Move Workspace to an architecture that can import upstream Plannotator React/TypeScript components directly, and prove
it with a visible Plan detail read-only rendering path.

The proof of concept should:

- keep canonical Plan markdown files and existing Workspace Plan APIs as the source of truth;
- add a React/TypeScript client surface inside Workspace;
- import at least one real component from upstream `packages/ui/` source, preferably
  `@plannotator/ui/components/RenderedMarkdown` or `@plannotator/ui/components/Viewer`;
- render the Plan body in Plan detail through the imported Plannotator component in read-only mode;
- preserve existing lifecycle actions, metadata, token auth, and body editing safety;
- establish seams so future work can migrate `plan_written` and human code review from the compiled Plannotator bridge
  to a built-in Workspace/Plannotator route.

## Approach

Use a staged migration rather than a flag-day rewrite.

1. **Record the architecture pivot.** Add or update documentation/ADR text saying Workspace may use React, TypeScript,
   Tailwind-compatible utilities, and Radix-compatible Plannotator primitives specifically to enable direct Plannotator
   component reuse. This supersedes the previous Preact/JS-only Workspace guidance for `src/ui/workspace/` while keeping
   the rest of RunWield pure JS/JSDoc unless separately decided.
2. **Add a pinned upstream source dependency.** Because `@plannotator/ui` is not published to npm, add a pinned source
   checkout under `third_party/plannotator/` as a git submodule/source checkout. Configure Vite aliases so imports use
   upstream package names (`@plannotator/ui`, `@plannotator/shared`, and any required workspace packages) rather than
   deep relative paths. The submodule should pin a reviewed commit and document the update process, preserving the
   security intent of Deno's npm freshness delay instead of silently bypassing supply-chain review.
3. **Introduce React/TypeScript in Workspace only.** Add React, ReactDOM, TypeScript, Tailwind 4-compatible CSS support,
   and the Plannotator component dependencies required by the proof path. Keep existing Deno Workspace APIs and Plan
   store adapters.
4. **Bridge before replacing.** Mount a React Plan detail renderer from the existing Plan detail route or migrate only
   the detail route to React first. Do not rewrite the whole board until the Plannotator dependency, CSS, and runtime
   compatibility are proven.
5. **Render read-only Plan detail body with Plannotator UI.** Prefer `RenderedMarkdown` for the first proof because it
   is read-only by design and uses the shared parser/BlockRenderer stack. If its dependency graph is too large, fall
   back to `Viewer` with inert annotation callbacks. Do not use `MarkdownEditor` as the proof unless upstream adds a
   real read-only prop; its current public props describe an editable live-preview editor.
6. **Create a review-surface seam.** Add a small internal adapter/interface for launching review surfaces so
   `submitPlanForReview` and `runPlannotatorCodeReview` can later switch from compiled Plannotator servers to
   Workspace-hosted routes without changing workflow callers again.

## Files to Modify

- `docs/adr/007-local-first-workspace-plan-board.md` — append an amendment or supersession note for the
  React/TypeScript/Plannotator reuse pivot.
- `docs/design-system.md` — update source-of-truth language so RunWield design tokens can coexist with imported
  Plannotator components, Tailwind-compatible classes, and Radix primitives.
- `deno.json` — add React/ReactDOM, TypeScript-aware Workspace check/build tasks, Vite/Tailwind dependencies, and any
  Plannotator component dependencies needed by the proof path.
- `src/ui/workspace/vite.config.js` — configure React support, Tailwind-compatible CSS handling, and aliases into the
  pinned Plannotator source packages.
- `src/ui/workspace/server.js` — keep API/token/static responsibilities, but add the route/static hooks needed to serve
  the React detail proof and future review routes.
- `src/ui/workspace/routes/detail.jsx` or replacement `.tsx` route — pass Plan detail data to the React proof renderer
  while preserving the existing metadata/lifecycle layout.
- `src/ui/workspace/components/PlanDetail.jsx` and `src/ui/workspace/islands/PlanBodyEditor.jsx` — split read-only body
  rendering from editing so the proof can swap only the read-only renderer first.
- `src/ui/workspace/react/` or similar new folder — add React/TypeScript Workspace entry points and a
  `PlannotatorPlanBody` proof component.
- `src/ui/workspace/static/` and/or `src/ui/design-system/` — add CSS bridge rules that map RunWield tokens to
  Plannotator/Tailwind token expectations without globally breaking Workspace styling.
- `src/shared/workflow/submit-plan.js` — introduce a review launcher seam and keep the compiled bridge as the current
  default until the built-in route is complete.
- `src/shared/workflow/code-review.js` — use the same review launcher seam for future built-in code review migration.
- `src/ui/workspace/workspace.test.js` and related tests — cover Plan detail serialization and route behavior after the
  renderer split.
- `src/shared/workflow/submit-plan.test.js` and `src/shared/workflow/code-review.test.js` — cover the new launcher seam
  while preserving current compiled-bridge behavior.
- `third_party/plannotator/` and `.gitmodules` if using a submodule — pin the upstream Plannotator source revision used
  for direct imports.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server/plan-adapter.js` — keep `loadWorkspaceDetail`, `serializePlanDetail`, and Plan body hashes as
  the Workspace data contract.
- `src/ui/workspace/routes/api/handlers.js` — keep existing Plan detail, lifecycle action, and body save APIs.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — preserve current lifecycle controls during the proof instead of
  reimplementing them in React immediately.
- `src/ui/design-system/tokens.css`, `src/ui/design-system/components.css`, and `src/ui/design-system/theme-bridge.js` —
  bridge RunWield tokens into imported Plannotator CSS rather than hard-resetting Workspace visual language.
- `@plannotator/ui/components/RenderedMarkdown` — preferred proof component for read-only markdown rendering.
- `@plannotator/ui/components/Viewer` and `@plannotator/ui/utils/parser` — candidate richer proof if annotation/block
  rendering is needed.
- `@plannotator/ui/components/ThemeProvider` and `@plannotator/ui/theme` — candidate theme bridge once the read-only
  renderer works.
- `@plannotator/markdown-editor` and `@plannotator/atomic-editor` — published React packages that can validate the
  React/CodeMirror dependency pipeline and may become the future editable Plan body surface after read-only rendering
  works and an intentional read-only/editable adapter is designed.
- `@plannotator/webtui` — published React WebTUI package relevant to the future built-in chat/agent-terminal surface,
  but out of scope for this Plan detail proof.
- `@plannotator/workspaces-api` — published generated API contract worth inspecting before future Workspace
  collaboration/review route work, but not required for the first component reuse proof.

## Implementation Steps

- [ ] Step 1: Capture current upstream compatibility facts in a short source note or ADR amendment: `@plannotator/ui`
      exists in Plannotator `packages/ui`, is React/TypeScript source, exports individual `.tsx` modules, and is not
      currently published on npm. Also note which Plannotator packages are published (`webtui`, `markdown-editor`,
      `atomic-editor`, `web-highlighter`, `workspaces-api`, plugins) so future agents do not assume every monorepo
      workspace is installable from npm.
- [ ] Step 2: Add a pinned Plannotator source dependency under `third_party/plannotator/` using a git submodule or
      documented pinned checkout. Pin an exact reviewed commit, record how to update it, and document that this is an
      audited-source dependency path rather than a way to bypass npm supply-chain protections.
- [ ] Step 3: Add Vite aliases in `src/ui/workspace/vite.config.js` for `@plannotator/ui`, `@plannotator/shared`, and
      any other upstream workspace packages needed by the selected proof component.
- [ ] Step 4: Add React/ReactDOM and required Plannotator UI dependency imports to `deno.json`. Keep existing
      Preact/Fresh imports until the old routes are removed. Prefer versions already resolvable by Deno; if a newly
      published Plannotator package is rejected, pin the latest resolvable version or use the source checkout for the
      proof instead of blocking on registry freshness.
- [ ] Step 5: Add a minimal React/TypeScript entry under `src/ui/workspace/react/` that can be mounted from the current
      Plan detail page without rewriting the whole Workspace.
- [ ] Step 6: Split `PlanBodyEditor` into separate read-only and edit responsibilities, or add a wrapper that lets Plan
      detail choose the existing renderer vs the React Plannotator proof renderer.
- [ ] Step 7: Implement `PlannotatorPlanBody.tsx` using `@plannotator/ui/components/RenderedMarkdown` with the Plan body
      markdown from `loadWorkspaceDetail`. Include empty-state behavior matching the current Workspace.
- [ ] Step 8: Import Plannotator theme/CSS only as narrowly as needed. Add token bridge CSS so common variables such as
      background, foreground, muted, border, primary, success, warning, and destructive map to RunWield `--rw-*` tokens
      where possible.
- [ ] Step 9: Render Plan detail with the Plannotator proof renderer behind a temporary capability flag or route query
      during development, then make it the default read-only body renderer once visual and browser checks pass.
- [ ] Step 10: Preserve body editing with the existing CodeMirror editor for this slice. Do not replace the edit path
      with Plannotator `MarkdownEditor` until save semantics, draft recovery, and conflict behavior have dedicated
      tests.
- [ ] Step 11: Add a review surface adapter module, for example `src/shared/workflow/review-launcher.js`, with methods
      for plan review and code review. Initially delegate to the compiled Plannotator bridge so behavior is unchanged.
- [ ] Step 12: Refactor `submitPlanForReview` and `runPlannotatorCodeReview` to call the review launcher seam. Document
      that a later Plan will add Workspace-hosted `/review/plans/:id` and `/review/code/:id` routes and then switch the
      default.
- [ ] Step 13: Update tests for Plan detail rendering contracts, token-protected API behavior, and review launcher
      delegation.
- [ ] Step 14: Run formatting/checks and fix any dependency, Deno, Vite, or CSS module resolution issues caused by
      importing upstream TypeScript/TSX.

## Verification Plan

- Automated: `deno task -q check`
- Automated: `deno task -q lint`
- Automated: `deno task -q fmt:check`
- Automated: `deno task -q workspace:test`
- Automated: if a Vite build task is added, run it explicitly, for example `deno task -q workspace:build`.
- Manual/frontend: start `deno task workspace:dev`, open `http://localhost:5173/`, navigate to a Plan detail page, and
  verify the body is rendered by the imported Plannotator component with no console errors.
- Manual/frontend: compare a Plan body containing headings, lists, fenced code, tables, links, and empty content against
  the previous Workspace renderer for acceptable fidelity.
- Manual/frontend: verify lifecycle controls and metadata still work on the Plan detail page.
- Manual/frontend: verify Edit still opens the existing body editor, preserves draft recovery behavior, and saves
  through `/api/plans/:planId/body`.
- Manual/frontend: verify narrow and desktop viewports do not clip or overlap imported Plannotator-rendered content.
- Manual/workflow: use `plan_written` on a small dummy Plan and confirm current compiled Plannotator review still opens
  and returns approve/feedback decisions through the new adapter seam.
- Manual/workflow: trigger human code review path or its tests and confirm compiled code review still opens through the
  new adapter seam.

## Edge Cases & Considerations

- **Existing dirty files:** current working tree has unrelated modifications under `src/ui/workspace/server.js` and
  existing Plans. Execution agents must inspect and avoid overwriting user changes before editing overlapping files.
- **Unpublished and newly published package availability:** `@plannotator/ui` is not currently available on npm even
  though related packages such as `@plannotator/webtui`, `@plannotator/markdown-editor`, and
  `@plannotator/atomic-editor` are published. Deno may also refuse packages that were published too recently, creating a
  delay before latest versions are usable; this is intentional supply-chain risk reduction. The first implementation
  must use a pinned, reviewed source checkout/alias for `packages/ui`; for published helper packages, pin versions Deno
  can resolve or fall back to the reviewed source checkout rather than waiting on registry freshness or disabling safety
  controls.
- **Workspace package dependencies:** upstream `@plannotator/ui` imports `@plannotator/shared`, `@plannotator/ai`, CSS,
  and many browser dependencies. Keep the proof component narrow to avoid pulling the full Plan editor/review app before
  necessary.
- **React plus Fresh/Preact coexistence:** the first proof may temporarily run React inside the Fresh/Preact Workspace.
  Avoid shared ownership of the same DOM node and make cleanup explicit. A later cleanup should remove Fresh/Preact once
  React owns the Workspace shell.
- **TypeScript policy change:** this Plan intentionally makes `src/ui/workspace/` an exception to the previous
  JS/JSDoc-only project rule. Keep the exception documented and scoped.
- **Design-system tension:** Plannotator’s visual theme should not accidentally erase RunWield’s Workspace identity. The
  first proof should prioritize functional component reuse; visual convergence can follow after collaboration with
  upstream is clearer.
- **Review workflow migration:** replacing `plan_written` and code review with built-in Workspace routes is a follow-up
  slice after direct component reuse is proven. This Plan creates the seam but keeps current behavior as the default.
