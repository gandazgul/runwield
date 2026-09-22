# Theme Customization

RunWield allows you to customize the visual appearance of the TUI using themes.

## Themes

A theme is a JSON file that defines the colors and variables used by the RunWield interface.

### Built-in Theme

RunWield comes with an embedded `catppuccin-mocha` theme. This theme serves as the default and acts as a fallback; any
external theme missing specific color tokens will inherit them from the built-in default. In the event of a name
collision, the embedded theme always takes precedence.

## Managing Themes

### Interactive Theme Picker

Inside an interactive session, you can open the theme picker using the slash command: `/theme`

- **Live Preview**: As you navigate the list of available themes, the TUI will update to preview the selection.
- **Confirm**: Press `Enter` to apply and persist the chosen theme.
- **Cancel**: Press `Esc` to revert to the previously active theme.

> **Note**: The theme is applied immediately when selected. On startup, the persisted theme is restored.

### CLI Commands

You can also manage themes directly from the shell:

- `wld theme <name>`: Switch the active theme and persist the choice.
- `wld theme --list`: List all currently discoverable themes.
- `wld install <source>`: Install a theme package.
- `wld remove <source>`: Remove a theme package.

## Installing Themes

RunWield supports installing theme packages from several sources using the `wld install` command.

### Usage

```bash
wld install <source>
```

#### Supported Source Forms:

- **npm**: `wld install npm:<package-spec>` (e.g., `wld install npm:my-cool-themes`)
- **git**: `wld install git:<url>` (e.g., `wld install git:https://github.com/user/themes.git`)
- **local**: `wld install local:<path>` (e.g., `wld install local:./themes/my-theme-pack`)

> [!IMPORTANT]
> **Theme-only constraints**: RunWield only registers `.json` theme files found within these packages. Any other
> resources (logic extensions, skills, prompts) are ignored; `wld install` reports the count so you know what was
> skipped. Skills are handled by the wider skill ecosystem instead. RunWield checks project `.wld/skills`, project
> `.agents/skills`, home `~/.wld/skills`, home `~/.agents/skills`, then bundled `src/skills`. External skills cannot use
> bundled names or aliases.

### Removing Themes

To uninstall a theme package, use the `remove` command:

```bash
wld remove <source>
```

If the removed package contained the currently active theme, RunWield will automatically reset the active theme to
`catppuccin-mocha`.

## Settings

Themes and their source packages are persisted in your global settings file (`~/.wld/settings.json`).

### Key: `theme`

- **Type**: `string`
- **Description**: The name of the currently active theme. Defaults to `"catppuccin-mocha"`.

### Key: `packages`

- **Type**: `string | object`
- **Description**: A list of installed theme packages. This follows the Pi package schema, supporting simple strings for
  npm packages or objects for local/git sources that map specific files.
