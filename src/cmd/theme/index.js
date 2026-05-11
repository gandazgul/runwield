/**
 * @module cmd/theme
 * Implementation of the theme selection command.
 */

import { discoverAndRegisterThemes, getAvailableThemes, setTheme } from "../../shared/ui/theme.js";
import { getSettingsManager } from "../../shared/settings.js";

const DEFAULT_THEME = "catppuccin-mocha";

/**
 * Executed when /theme or `hns theme` is called.
 * @param {string[]} argv
 * @param {import('../../cmd/registry.js').CommandContext} options
 */
export async function runThemeCommand(argv, options = {}) {
    const settings = getSettingsManager();
    const arg = argv[0];

    // --list: print available themes.
    if (arg === "--list") {
        await discoverAndRegisterThemes();
        const available = getAvailableThemes();
        console.log("Available themes:");
        for (const t of available) console.log(` - ${t}`);
        return;
    }

    // hns theme <name>: non-interactive switch + persist.
    if (arg) {
        await discoverAndRegisterThemes();
        const available = getAvailableThemes();
        if (!available.includes(arg)) {
            console.error(`Theme "${arg}" not found. Run 'hns theme --list' to see available themes.`);
            Deno.exit(1);
        }
        settings.setTheme(arg);
        setTheme(arg);
        console.log(`Theme switched to ${arg}`);
        return;
    }

    // Interactive picker (slash command).
    if (!options.uiAPI) {
        console.log("Use 'hns theme <name>' or 'hns theme --list'");
        return;
    }

    await discoverAndRegisterThemes();
    const availableThemes = getAvailableThemes();
    const originalTheme = settings.getTheme() || DEFAULT_THEME;

    const items = availableThemes.map((t) => ({
        value: t,
        label: t,
        description: t === originalTheme ? "(current)" : undefined,
    }));

    const selection = await options.uiAPI.promptSelect("Select Theme", items, {
        onSelectionChange: (value) => {
            // Live preview — every arrow-key swap repaints the TUI in the new theme.
            setTheme(value);
        },
    });

    if (selection) {
        settings.setTheme(selection);
        setTheme(selection);
    } else {
        // Esc / cancel — revert to the persisted theme.
        setTheme(originalTheme);
    }
}
