/**
 * @module cmd/remove
 * Harns remove command wrapping Pi's PackageManager.
 */

import { DefaultPackageManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSettingsManager } from "../../shared/settings.js";
import { discoverAndRegisterThemes, getAvailableThemes, setTheme } from "../../shared/ui/theme.js";

const DEFAULT_THEME = "catppuccin-mocha";

/**
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} _options
 */
export async function runRemoveCommand(argv, _options = {}) {
    if (argv.length === 0) {
        console.error("Usage: hns remove <source>");
        Deno.exit(1);
    }

    const source = argv[0];
    try {
        const settings = getSettingsManager();
        const packageManager = new DefaultPackageManager({
            cwd: Deno.cwd(),
            agentDir: getAgentDir(),
            settingsManager: settings,
        });

        const success = await packageManager.removeAndPersist(source);
        if (!success) {
            console.log(`Package "${source}" is not currently installed — nothing to remove.`);
            return;
        }

        await discoverAndRegisterThemes();

        // If the active theme came from the package we just removed, reset to embedded.
        const activeTheme = settings.getTheme();
        if (activeTheme && activeTheme !== DEFAULT_THEME && !getAvailableThemes().includes(activeTheme)) {
            settings.setTheme(DEFAULT_THEME);
            setTheme(DEFAULT_THEME);
            console.log(
                `Active theme "${activeTheme}" was provided by the removed package — reset to ${DEFAULT_THEME}.`,
            );
        }

        console.log(`Successfully removed ${source}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Removal failed: ${msg}`);
        Deno.exit(1);
    }
}
