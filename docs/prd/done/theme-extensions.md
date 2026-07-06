# PRD: Theme Extension Support for RunWield

## Objective

Enable RunWield to discover, install, list, and switch themes from external packages (ending in `.json`), while
restricting the installation and loading of logic-based extensions. The system will transition from a hardcoded theme to
a dynamic one, leveraging the `@earendil-works/pi-coding-agent` theme infrastructure.

## Problem Statement

RunWield currently inlines a single "catppuccin-mocha" theme, making it impossible to change the UI color scheme at
runtime. While the upstream `pi-coding-agent` has a robust theme system (discovery, real-time previews, and
registration), RunWield does not currently utilize these features.

## Resolved Assumptions

1. **Permissive for Themes, Restrictive for Logic:** Packages containing at least one valid theme `.json` will be
   installed. However, any accompanying logic extensions (`.ts`/`.js` files) will be ignored—they will not be registered
   or loaded into the RunWield runtime.
2. **Pi Infrastructure Integration:** RunWield will delegate theme loading and management to
   `@earendil-works/pi-coding-agent` (`loadThemeFromPath`, `setRegisteredThemes`, `getAvailableThemes`, etc.).
3. **Built-in Reliability:** The default "catppuccin-mocha" theme will be embedded within the RunWield binary. It serves
   as the primary fallback and is discoverable alongside external themes, but it cannot be edited or deleted by the
   user.
4. **TUI Experience:** The theme selector must support **real-time re-skinning**. As the user navigates the list, the
   TUI will immediately render with the previewed theme.
5. **Settings Compatibility:** Persistence will be handled via `~/.wld/settings.json`. The `packages` array will
   precisely match Pi's schema to ensure future compatibility when non-theme extensions are eventually supported.

## Technical Approach

### 1. Theme Lifecycle & Discovery

- **Boot:** On startup, RunWield reads the active theme from settings. If missing or invalid, it falls back to the
  embedded `catppuccin-mocha.json`.
- **Discovery:** Theme discovery is deferred until the `/theme` command is invoked to optimize startup time.
- **Loading:** `src/ui/theme/theme.js` will be refactored into a thin proxy that delegates to Pi's `initTheme` and
  `setTheme` functions.

### 2. The `/theme` Slash Command

- **Interactive Selector:** A slash command that opens a `SelectList` of all available themes (builtin + custom).
- **Live Preview:** Using the `onSelectionChange` event, RunWield will call `setTheme(name)` to update the global theme
  singleton and trigger a TUI re-render.
- **Persistence:** Only when the user presses "Enter" (confirm selection) will the choice be persisted to
  `~/.wld/settings.json`.

### 3. Package Management (`wld install`/`remove`)

- **Source Support:** Support for `npm:`, `git:`, and `local:` sources.
- **Filtered Installation:** Use Pi's `PackageManager` logic to fetch packages, but explicitly filter the resource
  collection to **only** include `themes`. All other resource types (skills, extensions, prompts) are ignored.
- **Schema:**
  ```json
  {
      "theme": "catppuccin-mocha",
      "packages": [
          {
              "source": "git:github.com/user/repo",
              "themes": ["theme-a.json", "theme-b.json"]
          },
          "npm:@scope/theme-pack"
      ]
  }
  ```

## Files to Modify

| File                          | Change                                                           |
| :---------------------------- | :--------------------------------------------------------------- |
| `src/constants.js`            | Add `THEME` command name                                         |
| `src/cmd/registry.js`         | Register `/theme` slash command                                  |
| `src/cmd/theme/index.js`      | New: Handle theme selection, switching, and installation/removal |
| `src/ui/theme/theme.js`       | Refactor to use Pi's theme system + global singleton proxy       |
| `src/shared/settings.js`      | Update `SettingsManager` to support `theme` and `packages` keys  |
| `theme/catppuccin-mocha.json` | New: Extracted theme data for binary embedding                   |

## Out of Scope

- Installation of non-theme extensions (logic/skills).
- Manual editing of theme JSON files within the TUI.

## Success Metrics

- Users can install a theme package via CLI and see it appear in the `/theme` list.
- The TUI re-skins instantly as the user scrolls through themes in the `/theme` selector.
- The selected theme persists across sessions.
- The default embedded theme is always available as a safe fallback.
