/**
 * @module cmd/theme
 * Implementation of the theme selection command.
 */

import { discoverAndRegisterThemes, getAvailableThemes, setTheme } from "../../ui/theme/theme.js";
import { getSettingsManager } from "../../shared/settings.js";
import { COMMAND_NAMES } from "../registry.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";

const DEFAULT_THEME = "catppuccin-mocha";

/**
 * Executed when /theme or `wld theme` is called.
 * @param {string[]} argv
 * @param {import('../../cmd/registry.js').CommandContext} options
 */
export async function runThemeCommand(argv, options = {}) {
    const deps = /** @type {{ printCommandHelp?: typeof printCommandHelpFn }} */ (
        /** @type {import('../registry.js').CommandContext} */ (options).__testDeps || {}
    );
    const printCommandHelp = deps.printCommandHelp || printCommandHelpFn;
    const arg = argv[0];

    if (arg === "help" || arg === "--help" || arg === "-h") {
        printCommandHelp(COMMAND_NAMES.THEME);
        return;
    }

    const settings = getSettingsManager();

    // --list: print available themes.
    if (arg === "--list") {
        await discoverAndRegisterThemes();
        const available = getAvailableThemes();
        console.log("Available themes:");
        for (const t of available) console.log(` - ${t}`);
        return;
    }

    // wld theme <name>: non-interactive switch + persist.
    if (arg) {
        await discoverAndRegisterThemes();
        const available = getAvailableThemes();
        if (!available.includes(arg)) {
            console.error(`Theme "${arg}" not found. Run 'wld theme --list' to see available themes.`);
            Deno.exit(1);
        }
        settings.setTheme(arg);
        setTheme(arg);
        console.log(`Theme switched to ${arg}`);
        return;
    }

    // Interactive picker (slash command).
    if (!options.uiAPI) {
        console.log("Use 'wld theme <name>' or 'wld theme --list'");
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
