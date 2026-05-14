# Theme Customization

Harns allows you to customize the visual appearance of the TUI using themes.

## Themes

A theme is a JSON file that defines the colors and variables used by the Harns interface.

### Built-in Theme

Harns comes with an embedded `catppuccin-mocha` theme. This theme serves as the default and acts as a fallback; any
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

- `hns theme <name>`: Switch the active theme and persist the choice.
- `hns theme --list`: List all currently discoverable themes.
- `hns install <source>`: Install a theme package.
- `hns remove <source>`: Remove a theme package.

## Installing Themes

Harns supports installing theme packages from several sources using the `hns install` command.

### Usage

```bash
hns install <source>
```

#### Supported Source Forms:

- **npm**: `hns install npm:<package-spec>` (e.g., `hns install npm:my-cool-themes`)
- **git**: `hns install git:<url>` (e.g., `hns install git:https://github.com/user/themes.git`)
- **local**: `hns install local:<path>` (e.g., `hns install local:./themes/my-theme-pack`)

> [!IMPORTANT]
> **Theme-only constraints**: Harns only registers `.json` theme files found within these packages. Any other resources
> (logic extensions, skills, prompts) are ignored; `hns install` reports the count so you know what was skipped.

### Removing Themes

To uninstall a theme package, use the `remove` command:

```bash
hns remove <source>
```

If the removed package contained the currently active theme, Harns will automatically reset the active theme to
`catppuccin-mocha`.

## Settings

Themes and their source packages are persisted in your global settings file (`~/.hns/settings.json`).

### Key: `theme`

- **Type**: `string`
- **Description**: The name of the currently active theme. Defaults to `"catppuccin-mocha"`.

### Key: `packages`

- **Type**: `string | object`
- **Description**: A list of installed theme packages. This follows the Pi package schema, supporting simple strings for
  npm packages or objects for local/git sources that map specific files.
