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
updatedAt: "2026-07-05T05:12:12.281Z"
status: "draft"
origin: "internal"
---

# Reorganize UI Source Tree

## Context

The current `src/shared/ui/` directory mixes terminal UI implementation, TUI-facing API types, and theme JSON
resolution/registry logic. The requested outcome is a clearer source tree with three distinct UI responsibilities:

- `src/ui/tui/` for the terminal UI implementation and TUI-facing APIs.
- `src/ui/theme/` for theme resolution, registry, discovery, and bundled theme JSON shared by TUI and browser UI.
- existing `src/ui/workspace/` and `src/ui/design-system/` kept in place, with design-system/browser theme bridge code
  importing from `src/ui/theme/`.

This is a source-organization refactor only. It should preserve behavior, public command surfaces, tests, and pure
JavaScript/JSDoc style. No TypeScript files or TypeScript syntax should be introduced.

## Objective

Move all files currently in `src/shared/ui/` to either `src/ui/tui/` or `src/ui/theme/`, then update every code import,
dynamic import, JSDoc `import(...)` reference, module doc comment, bundled compile include, and active documentation
reference that points at the old `src/shared/ui/` seam.

After the change:

- `src/shared/ui/` should not remain as a compatibility shim or generic shared UI path.
- TUI modules may depend on `src/ui/theme/`.
- `src/ui/design-system/` may depend on `src/ui/theme/`.
- `src/ui/workspace/` may depend on `src/ui/theme/` and/or `src/ui/design-system/`.
- Shared workflow/session/interactive modules may depend on the concrete `src/ui/tui/` or `src/ui/theme/` modules they
  already use.

## Approach

Use `git mv` so file history follows the reorganization. Move the TUI implementation files into `src/ui/tui/` and theme
files into `src/ui/theme/`, then perform a repository-wide import-path update in small, reviewable passes:

1. Fix imports inside the moved modules based on their new relative location.
2. Fix source and test consumers in `src/`, including JSDoc type imports.
3. Fix build/resource references such as `scripts/compile.js` and Workspace tests that read the bundled JSON.
4. Update module doc comments from `shared/ui/...` or `shared/theme` to `ui/tui/...` or `ui/theme/...`.
5. Update active documentation that describes the current theme module path. Historical archived plans may be left
   intact if they are clearly past records, but the executor should run `rg "shared/ui|\.\./ui/" src scripts docs` and
   eliminate current-code/current-doc references.

Prefer direct relative imports that match existing style rather than introducing an import alias or barrel module. Do
not recreate `src/shared/ui/` as a redirect layer.

## Files to Modify

- `src/shared/ui/` — remove after moving all listed files; no compatibility shim should remain.
- `src/ui/tui/api.js` — moved from `src/shared/ui/api.js`; update its settings import from `../settings.js` to
  `../../shared/settings.js` and preserve `UiAPI` JSDoc imports via `./types.js`.
- `src/ui/tui/api.test.js` — moved test; update theme import to `../theme/theme.js`.
- `src/ui/tui/blocks.js` — moved from `src/shared/ui/blocks.js`; update theme import to `../theme/theme.js`.
- `src/ui/tui/blocks.test.js` — moved test; update theme import to `../theme/theme.js`.
- `src/ui/tui/boot-logo.js` — moved from `src/shared/ui/boot-logo.js`; keep `./tui.js` and update theme import to
  `../theme/theme.js`.
- `src/ui/tui/prompts.js` and `src/ui/tui/prompts.test.js` — moved TUI prompt implementation/tests; update theme import
  to `../theme/theme.js` while keeping `./tui.js`.
- `src/ui/tui/task-completed-message.js` — moved helper; preserve `./types.js` JSDoc reference.
- `src/ui/tui/terminal-title.js` and `src/ui/tui/terminal-title.test.js` — moved terminal-title helper/tests; preserve
  `./tui.js` references.
- `src/ui/tui/tui.js`, `src/ui/tui/tui-crash-guards.js`, `src/ui/tui/tui-crash-guards.test.js`,
  `src/ui/tui/tui-manager.js`, `src/ui/tui/tui-manager.test.js`, `src/ui/tui/types.js` — moved TUI implementation,
  guards, manager, tests, and API typedefs.
- `src/ui/theme/catppuccin-mocha.json` — moved bundled default theme JSON.
- `src/ui/theme/theme.js` — moved theme singleton/registry integration; update settings imports to
  `../../shared/settings.js`, keep adjacent JSON loading, and update module doc comment to `@module ui/theme/theme`.
- `src/ui/theme/theme-discovery.js`, `src/ui/theme/theme-discovery.test.js`, `src/ui/theme/theme-json.js`,
  `src/ui/theme/theme-json.test.js`, `src/ui/theme/theme-registry.js`, `src/ui/theme/theme-registry.test.js` — moved
  theme resolution/registry/discovery modules/tests with local `./` imports preserved and module doc comments updated.
- `src/cli.js` — update `stopTUI` import to `./ui/tui/tui.js`.
- `src/tools/*.js` and `src/tools/__tests__/*.js` — update imports/JSDoc imports for prompts, terminal-title,
  task-completed-message, and `UiAPI` types to `../ui/tui/...` or `../../ui/tui/...`.
- `src/cmd/**/*.js` — update command imports and JSDoc imports from `../../shared/ui/...` or `../shared/ui/...` to
  `../../ui/tui/...`, `../../ui/theme/...`, or `../ui/tui/...` as appropriate.
- `src/shared/interactive/**/*.js` — update TUI imports from `../ui/...` to `../../ui/tui/...` and theme imports to
  `../../ui/theme/theme.js`.
- `src/shared/session/**/*.js` — update `UiAPI` JSDoc imports and dynamic theme imports from `../ui/...` /
  `../../ui/...` to the new `../../ui/tui/...`, `../../../ui/tui/...`, or `../../ui/theme/...` paths by directory depth.
- `src/shared/workflow/**/*.js` — update `UiAPI` JSDoc imports, `createFooterOnlyUiApi`, and terminal-title imports to
  `../../ui/tui/...`.
- `src/ui/design-system/theme-bridge.js` — update `resolveSelectedThemeJson` import to `../theme/theme.js`.
- `src/ui/workspace/workspace.test.js` — update the bundled Catppuccin Mocha JSON fixture path to
  `../theme/catppuccin-mocha.json`.
- `scripts/compile.js` — update the `--include` path to `src/ui/theme/catppuccin-mocha.json` so compiled binaries still
  embed the default theme.
- `docs/prd/done/theme-extensions.md`, `docs/themes.md`, `docs/settings.md`, and other active docs found by
  `rg "shared/ui" docs` — update current source-path references when they describe present behavior.

## Reuse Opportunities

- Existing moved tests under `src/shared/ui/*.test.js` — keep the tests with the modules in their new directories; they
  are the main regression suite for this refactor.
- Existing theme singleton behavior in `theme.js` — preserve `DEFAULT_THEME_NAME`, `DEFAULT_THEME_JSON`, `theme`,
  `initRunWieldTheme()`, `discoverAndRegisterThemes()`, and `resolveSelectedThemeJson()` unchanged except for
  paths/imports/doc comments.
- Existing TUI API typedefs in `types.js` — continue using JSDoc `import(...)` references to these typedefs; only update
  paths.
- Existing command/test conventions — use relative imports, JSDoc typedefs, and pure `.js` files only.
- Existing `deno task ci` pipeline — rely on check/lint/fmt/test to catch stale imports, broken JSDoc paths, and JSON
  include mistakes.

## Implementation Steps

- [ ] Create `src/ui/tui/` and `src/ui/theme/`.
- [ ] Move TUI files with `git mv`:
  - [ ] `api.js`, `api.test.js`, `blocks.js`, `blocks.test.js`, `boot-logo.js`, `prompts.js`, `prompts.test.js`,
        `task-completed-message.js`, `terminal-title.js`, `terminal-title.test.js`, `tui.js`, `tui-crash-guards.js`,
        `tui-crash-guards.test.js`, `tui-manager.js`, `tui-manager.test.js`, `types.js` to `src/ui/tui/`.
- [ ] Move theme files with `git mv`:
  - [ ] `catppuccin-mocha.json`, `theme.js`, `theme-discovery.js`, `theme-discovery.test.js`, `theme-json.js`,
        `theme-json.test.js`, `theme-registry.js`, `theme-registry.test.js` to `src/ui/theme/`.
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
  - [ ] all moved theme module comments from `shared/ui/<name>` → `ui/theme/<name>`.
- [ ] Update all runtime imports in `src/`:
  - [ ] `src/cli.js` to import `stopTUI` from `./ui/tui/tui.js`.
  - [ ] commands under `src/cmd/` to import theme APIs from `../../ui/theme/theme.js` and TUI APIs/types from
        `../../ui/tui/...`.
  - [ ] tools under `src/tools/` to import prompts, terminal-title, task-completed-message, and types from
        `../ui/tui/...`.
  - [ ] shared interactive/workflow/session modules to import or JSDoc-reference `../../ui/tui/...` and
        `../../ui/theme/theme.js` instead of `../ui/...`.
- [ ] Update all JSDoc `import(...)` paths in source and tests from `shared/ui/types.js` or `../ui/types.js` to the
      correct relative `ui/tui/types.js` location.
- [ ] Update browser/theme consumers:
  - [ ] `src/ui/design-system/theme-bridge.js` to import from `../theme/theme.js`.
  - [ ] `src/ui/workspace/workspace.test.js` to read `../theme/catppuccin-mocha.json`.
- [ ] Update build/resource references:
  - [ ] `scripts/compile.js` include path to `src/ui/theme/catppuccin-mocha.json`.
- [ ] Update active docs that describe current source paths, especially theme extension docs, theme docs, and settings
      docs if they reference `src/shared/ui/`.
- [ ] Run
      `rg "shared/ui|\.\./ui/(api|blocks|boot-logo|prompts|task-completed-message|terminal-title|theme|tui|tui-crash-guards|tui-manager|types)" src scripts docs`
      and fix remaining current references.
- [ ] Confirm `src/shared/ui/` no longer exists and no replacement shim/barrel was added.
- [ ] Run `deno fmt`.
- [ ] Run targeted tests/checks while iterating if useful:
  - [ ] `deno test -A src/ui/tui src/ui/theme src/ui/design-system src/ui/workspace`
  - [ ] `deno check --doc src/**/*.js src/**/*.jsx`
- [ ] Run `deno run ci` and fix all formatting, import, lint, type-check, and test failures caused by the rename.

## Verification Plan

- Automated:
  - `deno fmt`
  - `deno run ci`
- Targeted optional checks during implementation:
  - `deno test -A src/ui/tui src/ui/theme src/ui/design-system src/ui/workspace`
  - `deno check --doc src/**/*.js src/**/*.jsx`
  - `rg "shared/ui" src scripts docs` should return no current source/build/doc references after active references are
    updated.
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
  current source/build/doc references and do not rewrite large archived history unless explicitly required by validation
  or user review.
- Keep all implementation in `.js`/`.jsx` as already used by the repo; do not add `.ts` files, TypeScript syntax,
  interfaces, or type aliases.
