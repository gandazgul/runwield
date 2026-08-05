---
planId: "378500c6-a9b2-44e3-a9a8-a15601ac9fdf"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Reorganize UI source tree by moving `src/shared/ui/` contents into `src/ui/tui/` and `src/ui/theme/`. This involves moving 24 files, updating all imports and JSDoc module paths across the repository, and verifying the changes with `deno run ci`."
affectedPaths:
    - "src/cli.js"
    - "src/ui/tui/tui.js"
    - "src/ui/theme/theme.js"
    - "src/ui/design-system/theme-bridge.js"
    - "src/ui/workspace/workspace.test.js"
    - "src/tools/triage-report.js"
frontend: false
createdAt: "2026-07-05T01:09:07-04:00"
updatedAt: "2026-07-17T04:49:53.582Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-06T20:53:57.779Z"
workRecord:
    status: "generated"
    recordId: "87480129-bfe6-4cb0-8eef-2e02f81f7baa"
    path: "docs/work-records/2026-07-17-reorganized-ui-source-tree.md"
    lastAttemptAt: "2026-07-17T04:49:47.122Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
archivedAt: "2026-07-08T16:34:21.764Z"
archivedFromStatus: "verified"
archivedFromPath: "plans/reorganize-ui-source-tree.md"
---

# Reorganize UI Source Tree

## Context

`src/shared/ui/` currently contains 24 files that mix three responsibilities:

- TUI implementation and TUI-facing interfaces (`tui.js`, `api.js`, `blocks.js`, prompts, terminal title helpers,
  manager/crash guards, typedefs, and related tests).
- Theme resolution/registry/discovery modules plus the bundled `catppuccin-mocha.json` theme.
- Modules consumed by browser UI surfaces such as the RunWield Design System and Workspace theme bridge.

This makes `src/shared/` look like the owner of UI-specific modules even though RunWield already has `src/ui/` seams for
Workspace and Design System code. ADR-007 keeps Workspace under `src/ui/workspace/`, and the current design-system theme
bridge should continue to live under `src/ui/design-system/` while importing shared theme resolution from a UI-owned
theme module.

This is a source-organization refactor only. It should preserve runtime behavior, slash commands, theme behavior,
Workspace/design-system theme CSS behavior, tests, and pure JavaScript/JSDoc style. No TypeScript files or TypeScript
syntax should be introduced. No product clarification is needed because this plan changes module locality, not
user-facing workflow or UI behavior.

## Objective

Move every file currently under `src/shared/ui/` to one of these two UI seams:

- `src/ui/tui/` — terminal UI implementation, prompt helpers, terminal title helpers, TUI lifecycle, TUI-facing
  typedefs, and their tests.
- `src/ui/theme/` — theme singleton integration, theme discovery/registry/JSON helpers, bundled theme JSON, and their
  tests.

After the change:

- `src/shared/ui/` should be deleted and should not be recreated as a compatibility shim, barrel, or redirect layer.
- TUI modules may depend on `src/ui/theme/`.
- `src/ui/design-system/` may depend on `src/ui/theme/`.
- `src/ui/workspace/` may depend on `src/ui/theme/` and/or `src/ui/design-system/`.
- Shared workflow/session/interactive modules may import the concrete `src/ui/tui/` or `src/ui/theme/` modules they
  already use.
- Current source, build scripts, JSDoc `import(...)` paths, and current docs should not refer to `src/shared/ui/`.

## Approach

Use `git mv` so file history follows the reorganization. Move the TUI implementation files into `src/ui/tui/` and theme
files into `src/ui/theme/`, then perform the import-path update in small, reviewable passes:

1. Fix imports inside the moved modules based on their new relative locations.
2. Fix source and test consumers in `src/`, including JSDoc `import(...)` references.
3. Fix build/resource references such as `scripts/compile.js` and Workspace tests that read the bundled JSON.
4. Update module doc comments from `shared/ui/...` or `shared/theme` to `ui/tui/...` or `ui/theme/...`.
5. Update current documentation references that describe the present theme module path.
6. Search for stale `shared/ui` references and old `src/shared/* -> ../ui/*` relative paths until none remain in current
   source/build/docs.

Prefer direct relative imports matching the existing code style. Do not introduce import aliases, new barrels, or
compatibility redirects.

## Files to Modify

- `src/shared/ui/` — source directory to empty via `git mv` and remove; no compatibility shim should remain.
- `src/ui/tui/api.js` — moved from `src/shared/ui/api.js`; update settings import from `../settings.js` to
  `../../shared/settings.js` and keep `UiAPI` JSDoc imports adjacent via `./types.js`.
- `src/ui/tui/api.test.js` — moved test; update theme import to `../theme/theme.js`.
- `src/ui/tui/blocks.js` — moved from `src/shared/ui/blocks.js`; update theme import to `../theme/theme.js`.
- `src/ui/tui/blocks.test.js` — moved test; update theme import to `../theme/theme.js`.
- `src/ui/tui/boot-logo.js` — moved from `src/shared/ui/boot-logo.js`; keep `./tui.js` and update theme import to
  `../theme/theme.js`.
- `src/ui/tui/prompts.js` and `src/ui/tui/prompts.test.js` — moved prompt helpers/tests; update theme import to
  `../theme/theme.js` while preserving TUI imports from `./tui.js`.
- `src/ui/tui/task-completed-message.js` — moved task-completion rendering helper; preserve `./types.js` JSDoc
  reference.
- `src/ui/tui/terminal-title.js` and `src/ui/tui/terminal-title.test.js` — moved terminal-title helper/tests; preserve
  `./tui.js` references.
- `src/ui/tui/tui.js`, `src/ui/tui/tui-crash-guards.js`, `src/ui/tui/tui-crash-guards.test.js`,
  `src/ui/tui/tui-manager.js`, `src/ui/tui/tui-manager.test.js`, `src/ui/tui/types.js` — moved TUI singleton, guards,
  manager, tests, and typedefs.
- `src/ui/theme/catppuccin-mocha.json` — moved bundled default theme JSON.
- `src/ui/theme/theme.js` — moved theme singleton/registry integration; update settings imports to
  `../../shared/settings.js`, keep adjacent JSON loading, and update module doc comment to `@module ui/theme/theme`.
- `src/ui/theme/theme-discovery.js`, `src/ui/theme/theme-discovery.test.js`, `src/ui/theme/theme-json.js`,
  `src/ui/theme/theme-json.test.js`, `src/ui/theme/theme-registry.js`, `src/ui/theme/theme-registry.test.js` — moved
  theme resolution/registry/discovery modules/tests with local `./` imports preserved and module doc comments updated.
- `src/cli.js` — update `stopTUI` import to `./ui/tui/tui.js`.
- `src/cmd/**/*.js` and `src/cmd/**/*.test.js` — update runtime imports and JSDoc imports from `../../shared/ui/...`,
  `../shared/ui/...`, or old `../ui/...` forms to the correct `../../ui/tui/...`, `../../ui/theme/...`, or
  `../ui/tui/...` paths based on file depth.
- `src/tools/*.js` and `src/tools/__tests__/*.js` — update imports/JSDoc imports for prompts, terminal-title,
  task-completed-message, and `UiAPI` types to `../ui/tui/...` or `../../ui/tui/...`.
- `src/shared/interactive/**/*.js` and tests — update TUI imports from `../ui/...` to `../../ui/tui/...` and theme
  imports to `../../ui/theme/theme.js`.
- `src/shared/session/**/*.js` and tests — update `UiAPI` JSDoc imports and dynamic theme imports from `../ui/...` /
  `../../ui/...` to the new `../../ui/tui/...`, `../../../ui/tui/...`, or `../../ui/theme/...` paths by directory depth.
- `src/shared/workflow/**/*.js` — update `UiAPI` JSDoc imports, `createFooterOnlyUiApi`, and terminal-title imports to
  `../../ui/tui/...`.
- `src/ui/design-system/theme-bridge.js` — update `resolveSelectedThemeJson` import to `../theme/theme.js`.
- `src/ui/workspace/workspace.test.js` — update the bundled Catppuccin Mocha JSON fixture path to
  `../theme/catppuccin-mocha.json`.
- `scripts/compile.js` — update the `deno compile --include` path to `src/ui/theme/catppuccin-mocha.json` so compiled
  binaries still embed the default theme.
- `docs/prd/done/theme-extensions.md` — update current source-path references from `src/shared/ui/theme.js` to
  `src/ui/theme/theme.js` or annotate them as historical if preserving original implementation wording is intentional.

## Reuse Opportunities

- Existing moved tests from `src/shared/ui/*.test.js` — keep the tests with the modules in their new directories; they
  are the main regression suite for this refactor.
- Existing theme singleton behavior in `theme.js` — preserve `DEFAULT_THEME_NAME`, `DEFAULT_THEME_JSON`, `theme`,
  `initRunWieldTheme()`, `discoverAndRegisterThemes()`, and `resolveSelectedThemeJson()` behavior unchanged except for
  paths/imports/doc comments.
- Existing TUI typedefs in `types.js` — continue using JSDoc `import(...)` references to these typedefs; only update
  paths.
- Existing command/test conventions — use relative imports, JSDoc typedefs, and pure `.js`/`.jsx` files only.
- Existing `deno.json` CI task — `deno task ci` runs check, lint, format-check, and tests and should remain the final
  repository validation command for this refactor.

## Implementation Steps

- [ ] Check `git status --short` before moving files and avoid touching unrelated dirty files.
- [ ] Create `src/ui/tui/` and `src/ui/theme/`.
- [ ] Move TUI files with `git mv`:
  - [ ] `api.js`, `api.test.js`, `blocks.js`, `blocks.test.js`, `boot-logo.js`, `prompts.js`, `prompts.test.js`,
        `task-completed-message.js`, `terminal-title.js`, `terminal-title.test.js`, `tui.js`, `tui-crash-guards.js`,
        `tui-crash-guards.test.js`, `tui-manager.js`, `tui-manager.test.js`, and `types.js` to `src/ui/tui/`.
- [ ] Move theme files with `git mv`:
  - [ ] `catppuccin-mocha.json`, `theme.js`, `theme-discovery.js`, `theme-discovery.test.js`, `theme-json.js`,
        `theme-json.test.js`, `theme-registry.js`, and `theme-registry.test.js` to `src/ui/theme/`.
- [ ] Update moved-module internal imports:
  - [ ] In TUI files, replace old theme imports with `../theme/theme.js`.
  - [ ] In `src/ui/tui/api.js`, import settings from `../../shared/settings.js`.
  - [ ] In `src/ui/theme/theme.js`, import settings from `../../shared/settings.js`.
  - [ ] Preserve adjacent theme JSON loading in `theme.js` as `new URL("./catppuccin-mocha.json", import.meta.url)`.
- [ ] Update module doc comments:
  - [ ] `src/ui/tui/tui.js` → `@module ui/tui/tui`.
  - [ ] `src/ui/tui/api.js` if it gains/has a module comment → `@module ui/tui/api`.
  - [ ] all moved TUI module comments from `shared/ui/<name>` → `ui/tui/<name>`.
  - [ ] `src/ui/theme/theme.js` → `@module ui/theme/theme`.
  - [ ] all moved theme module comments from `shared/ui/<name>` or `shared/theme` → `ui/theme/<name>`.
- [ ] Update runtime imports in `src/`:
  - [ ] `src/cli.js` to import `stopTUI` from `./ui/tui/tui.js`.
  - [ ] `src/cmd/*` modules to import theme APIs from `../../ui/theme/theme.js` and TUI modules/types from
        `../../ui/tui/...`; update one-level command helpers/registry to `../ui/tui/...`.
  - [ ] `src/tools/*` modules to import prompts, terminal-title, task-completed-message, and types from `../ui/tui/...`.
  - [ ] `src/shared/interactive/*` modules to import TUI modules from `../../ui/tui/...` and theme APIs from
        `../../ui/theme/theme.js`.
  - [ ] `src/shared/workflow/*` modules to import TUI modules/types from `../../ui/tui/...`.
  - [ ] `src/shared/session/*` modules to import theme APIs from `../../ui/theme/theme.js` and TUI types from
        `../../ui/tui/types.js`; tests under `src/shared/session/__tests__/` need `../../../ui/tui/types.js`.
- [ ] Update all JSDoc `import(...)` paths in source and tests from `shared/ui/types.js` or `../ui/types.js` to the
      correct relative `ui/tui/types.js` location.
- [ ] Update browser/theme consumers:
  - [ ] `src/ui/design-system/theme-bridge.js` to import from `../theme/theme.js`.
  - [ ] `src/ui/workspace/workspace.test.js` to read `../theme/catppuccin-mocha.json`.
- [ ] Update build/resource references:
  - [ ] `scripts/compile.js` include path to `src/ui/theme/catppuccin-mocha.json`.
- [ ] Update current docs that describe current source paths, especially `docs/prd/done/theme-extensions.md` references
      to the theme module path.
- [ ] Run this stale-reference search and fix all current source/build/doc hits:
      `rg "src/shared/ui|shared/ui|shared/theme|\.\./ui/(api|blocks|boot-logo|prompts|task-completed-message|terminal-title|theme|tui|tui-crash-guards|tui-manager|types)" src scripts docs`
- [ ] Confirm `src/shared/ui/` no longer exists and no replacement shim/barrel was added.
- [ ] Run `deno fmt`.
- [ ] Run targeted checks while iterating if useful:
  - [ ] `deno test -A src/ui/tui src/ui/theme src/ui/design-system src/ui/workspace`
  - [ ] `deno check --doc src/**/*.js src/**/*.jsx`
- [ ] Run `deno task ci` from the repository root and fix all formatting, import, lint, type-check, and test failures
      caused by the rename.

## Verification Plan

- Automated:
  - `deno fmt`
  - `deno task ci`
- Targeted optional checks during implementation:
  - `deno test -A src/ui/tui src/ui/theme src/ui/design-system src/ui/workspace`
  - `deno check --doc src/**/*.js src/**/*.jsx`
  - `rg "src/shared/ui|shared/ui|shared/theme" src scripts docs` should return no current source/build/doc references.
  - `test ! -d src/shared/ui` should pass.
- Manual:
  - No browser or TUI behavioral flow is required because this is a source-tree refactor with no intended UI behavior
    change.
  - If the executor wants an extra smoke check, run `deno task cli -- --help` or another non-interactive CLI command to
    ensure the entry point resolves after import moves.
- Expected results:
  - All moved tests pass from `src/ui/tui/` and `src/ui/theme/`.
  - `scripts/compile.js` still includes the bundled theme JSON from its new location.
  - Workspace/design-system theme bridge still resolves the same bundled/default theme colors.
  - No code imports from `src/shared/ui/`, and `src/shared/ui/` is gone.

## Edge Cases & Considerations

- Relative path depth is the main risk. Use `deno check --doc` and targeted tests to catch stale runtime and JSDoc
  import paths.
- `src/shared/interactive/*`, `src/shared/session/*`, and `src/shared/workflow/*` currently use `../ui/...` paths that
  resolve only because `ui` lives under `src/shared/`; these must become `../../ui/tui/...` or `../../ui/theme/...`
  depending on target module.
- `scripts/compile.js` must be updated or compiled binaries will miss `catppuccin-mocha.json`.
- Do not move files out of `src/ui/design-system/` unless a file clearly belongs in `src/ui/theme/`; currently
  `theme-bridge.js` should remain in design-system and import shared theme logic from `src/ui/theme/`.
- Historical archived Plan files may mention old paths as past implementation records. Treat them separately from
  current source/build/doc references and do not rewrite archived plan history unless explicitly required by validation
  or user review.
- Keep all implementation in `.js`/`.jsx` as already used by the repo; do not add `.ts` files, TypeScript syntax,
  interfaces, or type aliases.
