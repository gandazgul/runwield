Reorganize the UI-related source tree to make terminal UI, shared theme logic, and browser/workspace UI responsibilities
clearer.

Current structure includes `src/shared/ui/`, which mixes TUI implementation with shared theme code. Move/rename it into
the following target structure:

- `src/ui/tui/` — terminal UI implementation and TUI-facing APIs
- `src/ui/theme/` — theme resolution/registry/discovery JSON logic shared by TUI and browser UI
- keep existing `src/ui/workspace/`
- keep existing `src/ui/design-system/` unless a file clearly belongs in `src/ui/theme/`

Move these files from `src/shared/ui/` to `src/ui/tui/`:

- `api.js`
- `api.test.js`
- `blocks.js`
- `blocks.test.js`
- `boot-logo.js`
- `prompts.js`
- `prompts.test.js`
- `task-completed-message.js`
- `terminal-title.js`
- `terminal-title.test.js`
- `tui.js`
- `tui-crash-guards.js`
- `tui-crash-guards.test.js`
- `tui-manager.js`
- `tui-manager.test.js`
- `types.js`

Move these files from `src/shared/ui/` to `src/ui/theme/`:

- `catppuccin-mocha.json`
- `theme.js`
- `theme-discovery.js`
- `theme-discovery.test.js`
- `theme-json.js`
- `theme-json.test.js`
- `theme-registry.js`
- `theme-registry.test.js`

Update all imports and JSDoc import paths across the repo from `shared/ui/...` to the new locations.

Also update module doc comments, for example:

- `@module shared/ui/tui` → `@module ui/tui/tui`
- `@module shared/ui/theme-json` → `@module ui/theme/theme-json`

Pay special attention to these known import consumers:

- `src/cli.js`
- `src/tools/*.js`
- `src/tools/__tests__/*.js`
- `src/cmd/**/*.js`
- `src/ui/design-system/theme-bridge.js`
- `src/ui/workspace/workspace.test.js`

Expected dependency direction:

- `src/ui/tui/*` may import from `src/ui/theme/*`
- `src/ui/design-system/*` may import from `src/ui/theme/*`
- `src/ui/workspace/*` may import from `src/ui/theme/*` and/or `src/ui/design-system/*`
- avoid recreating a generic `src/shared/ui/` path

Do not convert anything to TypeScript. Keep all code as pure JavaScript with JSDoc types only.

After the move, run:

```sh
deno fmt                                                                                                                                                                    
deno run ci
```

Fix all formatting, import, test, lint, and type-check failures caused by the rename.
