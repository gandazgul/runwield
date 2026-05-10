# PRD: Theme Extension Support for Harns

## Objective

Enable Harns to discover, install, list, and switch themes from external packages (ending in `.json`), while allowing
only curated extensions. Convert the hardcoded catppuccin-mocha theme into a standard discoverable theme file so it
participates in the same theme-selection flow as user-installed themes.

## Problem Statement

Today Harns:

- Inlines a single "catppuccin-mocha" theme in `src/shared/ui/theme.js` with no mechanism to change it at runtime other
  than editing source code.
- Has no CLI commands for package/theme management.
- Has no theme discovery or registration infrastructure.

The upstream `pi-coding-agent` already has robust theme support (discovery, registration, selector UI, file-watcher
reload) that Harns does not use.

## Resolved Assumptions

1. **Themes only, not full extensions.** We accept theme `.json` files and optionally curated extension `.ts`/`.js`
   files, but the primary UX is theme management. Non-theme extensions require explicit allow-listing.
2. **Use pi's existing theme infrastructure.** Rather than re-implementing theme loading, we delegate to
   `@earendil-works/pi-coding-agent`'s theme system (`loadThemeFromPath`, `setRegisteredThemes`, `getAvailableThemes`,
   `getAvailableThemesWithPaths`).
3. **Settings are stored in `~/.hns/settings.json`** via the existing `SettingsManager` wrapper in
   `src/shared/settings.js`.
4. **Theme files live in `~/.hns/themes/`** (custom themes directory), mirroring pi's `getCustomThemesDir()` convention.
5. **Built-in themes ship as `.json` files** inside the binary but is treated as the default and fallback option. Users
   can switch away to an intalled extension theme, but it will always be available as a fallback if the user deletes
   their custom themes or if a configured theme fails to load.

## Technical Approach

### 1. Convert catppuccin-mocha to a bundled theme file

- Keep `src/shared/ui/theme.js` as a thin compatibility layer that falls back to this file if no custom theme is
  configured.
- Ensure catpucchin-mocha, even though is built-in is just nother theme in the selector.

### 2. Add a `theme` slash command

- Add `THEME` to `COMMAND_NAMES` in `src/constants.js`.
- Register it in `commandRegistry` as a slash command (`/theme`).
- `/theme` with no args opens an interactive selector listing all available themes (built-in + custom).
- `/theme <name>` switches to the specified theme if it exists, otherwise shows an error message, persist in settings.

### 3. Theme discovery pipeline

on startup load the theme in settings, if it fails to load or is missing, log a warning and fall back to
catppuccin-mocha.

When /theme is invoked only, discover installed themes and offer them in a selector along with the built-in theme. Just
like Pi as the user navigates the selector, load that theme and update the TUI. If selected persist to settings and keep
it as the new default until changed again.

### 4. Settings persistence

Just like pi Add two new keys to `~/.hns/settings.json`:

```json
{
    "theme": "catppuccin-mocha",
    "packages": [
        {
            "source": "git:github.com/otahontas/pi-coding-agent-catppuccin",
            "themes": [
                "-catppuccin-frappe.json",
                "-catppuccin-latte.json",
                "-catppuccin-macchiato.json"
            ]
        },
        "npm:@ifi/oh-pi-themes"
    ]
}
```

- `theme`: the active theme name (string).
- `packages`: list of packages installed, github links include the theme list, all the same way pi does it.

### 5. Package install/remove commands (themes-focused)

Add `install` and `remove` (uninstall as an alias to remove) commands (e.g. `hns install`):

- `hns install <source>` installs the package
- `hns remove <source>` removes the package
- **Non-theme extensions** if the extension does not provide any themes, error out and do not install, tell the user
  only themes are supported for now.

### 6. Wiring into Harns' theme.js

Refactor `src/shared/ui/theme.js` to:

- Export `initHarnsTheme(themeName)` which delegates to pi's theme loading (`loadThemeFromPath` or `getThemeByName`) and
  sets the global singleton.
- Keep the `theme` proxy, `getMarkdownTheme()`, `getSelectListTheme()`, `getEditorTheme()`, `imageTheme` exports
  unchanged — they already read from the global singleton and will pick up the new theme automatically.

Defer theme discovery until /theme is invoked to save startup time.

## Files to Modify

| File                          | Change                                                                   |
| ----------------------------- | ------------------------------------------------------------------------ |
| `src/constants.js`            | Add `THEME` command name                                                 |
| `src/cmd/registry.js`         | Register theme command                                                   |
| `src/cmd/theme/index.js`      | New — theme command handler (list/select/switch)                         |
| `src/shared/ui/theme.js`      | Refactor to use pi theme system + add `initHarnsTheme(themeName)`        |
| `src/shared/settings.js`      | Add `getDefaultTheme()` / `setDefaultTheme()` to SettingsManager wrapper |
| `theme/catppuccin-mocha.json` | New — extracted from inline data in current theme.js                     |

## Files to Create

| File                       | Purpose                           |
| -------------------------- | --------------------------------- |
| `src/cmd/theme/index.js`   | Theme list/select/switch handler  |
| `src/cmd/theme/helpers.js` | Theme discovery + install helpers |

## Out of Scope (Future Iterations)

- Non-theme extension installation and allow-listing

## Success Metrics

- `/theme` shows interactive selector listing all installed themes (including catppuccin-mocha) with names and previews
- selected theme persists across sessions and is loaded on startup
- Catppuccin-mocha appears as a selectable theme (not hardcoded)
- Existing UI (messages, editor, footer) renders with the new theme immediately
