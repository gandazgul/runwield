/**
 * @module cmd/remove
 * RunWield remove command wrapping Pi's PackageManager.
 */

import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { getSettingsDir, getSettingsManager } from "../../shared/settings.js";
import { discoverAndRegisterThemes, getAvailableThemes, setTheme } from "../../ui/theme/theme.js";

const DEFAULT_THEME = "catppuccin-mocha";

/**
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} _options
 */
export async function runRemoveCommand(argv, _options = {}) {
    const deps = /** @type {{
        PackageManager?: typeof DefaultPackageManager,
        getSettingsManager?: typeof getSettingsManager,
        getSettingsDir?: typeof getSettingsDir,
        discoverAndRegisterThemes?: typeof discoverAndRegisterThemes,
        getAvailableThemes?: typeof getAvailableThemes,
        setTheme?: typeof setTheme,
        cwd?: () => string,
        log?: typeof console.log,
        error?: typeof console.error,
        exit?: typeof Deno.exit,
    }} */
        (_options.__testDeps || {});
    const error = deps.error || console.error;
    const exit = deps.exit || Deno.exit;

    if (argv.length === 0) {
        error("Usage: wld remove <source>");
        exit(1);
        return;
    }

    const source = argv[0];
    try {
        const SettingsPackageManager = deps.PackageManager || DefaultPackageManager;
        const settings = (deps.getSettingsManager || getSettingsManager)();
        const packageManager = new SettingsPackageManager({
            cwd: (deps.cwd || Deno.cwd)(),
            agentDir: (deps.getSettingsDir || getSettingsDir)("global"),
            settingsManager: settings,
        });

        const success = await packageManager.removeAndPersist(source);
        const log = deps.log || console.log;
        if (!success) {
            log(`Package "${source}" is not currently installed — nothing to remove.`);
            return;
        }

        await (deps.discoverAndRegisterThemes || discoverAndRegisterThemes)();

        // If the active theme came from the package we just removed, reset to embedded.
        const activeTheme = settings.getTheme();
        if (
            activeTheme && activeTheme !== DEFAULT_THEME &&
            !(deps.getAvailableThemes || getAvailableThemes)().includes(activeTheme)
        ) {
            settings.setTheme(DEFAULT_THEME);
            (deps.setTheme || setTheme)(DEFAULT_THEME);
            log(
                `Active theme "${activeTheme}" was provided by the removed package — reset to ${DEFAULT_THEME}.`,
            );
        }

        log(`Successfully removed ${source}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        error(`Removal failed: ${msg}`);
        exit(1);
    }
}
