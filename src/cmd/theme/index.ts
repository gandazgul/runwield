/**
 * @module cmd/theme
 * Implementation of the theme selection command.
 */

import { getSettingsManager } from "../../shared/settings.js";
import { DEFAULT_THEME_NAME, discoverAndRegisterThemes, getAvailableThemes, setTheme } from "../../ui/theme/theme.js";
import { printCommandHelp } from "../help/index.js";
import { COMMAND_NAMES } from "../registry.js";

interface ThemeSelectItem {
    value: string;
    label: string;
    description?: string;
}

interface ThemeSelectionHooks {
    onSelectionChange(value: string): void;
}

interface ThemeCommandUi {
    promptSelect(
        title: string,
        items: ThemeSelectItem[],
        hooks: ThemeSelectionHooks,
    ): Promise<string | null>;
}

interface ThemeCommandOptions {
    uiAPI?: ThemeCommandUi;
}

export async function runThemeCommand(argv: string[], options: ThemeCommandOptions = {}): Promise<void> {
    const arg = argv[0];

    if (arg === "help" || arg === "--help" || arg === "-h") {
        printCommandHelp(COMMAND_NAMES.THEME);
        return;
    }

    const settings = getSettingsManager();

    if (arg === "--list") {
        await discoverAndRegisterThemes();
        const available = getAvailableThemes();
        console.log("Available themes:");
        for (const themeName of available) console.log(` - ${themeName}`);
        return;
    }

    if (arg) {
        await discoverAndRegisterThemes();
        const available = getAvailableThemes();
        if (!available.includes(arg)) {
            console.error(`Theme "${arg}" not found. Run 'wld theme --list' to see available themes.`);
            Deno.exitCode = 1;
            return;
        }
        settings.setTheme(arg);
        setTheme(arg);
        console.log(`Theme switched to ${arg}`);
        return;
    }

    if (!options.uiAPI) {
        console.log("Use 'wld theme <name>' or 'wld theme --list'");
        return;
    }

    await discoverAndRegisterThemes();
    const availableThemes = getAvailableThemes();
    const originalTheme = settings.getTheme() || DEFAULT_THEME_NAME;
    const items = availableThemes.map((themeName) => ({
        value: themeName,
        label: themeName,
        description: themeName === originalTheme ? "(current)" : undefined,
    }));

    const selection = await options.uiAPI.promptSelect("Select Theme", items, {
        onSelectionChange: (value) => {
            setTheme(value);
        },
    });

    if (selection) {
        settings.setTheme(selection);
        setTheme(selection);
    } else {
        setTheme(originalTheme);
    }
}
