/**
 * @module cmd/install
 * Harns install command wrapping Pi's PackageManager.
 */

import { DefaultPackageManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSettingsManager } from "../../shared/settings.js";
import { discoverAndRegisterThemes } from "../../shared/ui/theme.js";

/**
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} _options
 */
export async function runInstallCommand(argv, _options = {}) {
    if (argv.length === 0) {
        console.error("Usage: hns install <source>");
        console.error("Sources: npm:<spec>, git:<url>, local:<path>");
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

        await packageManager.installAndPersist(source);

        // Inspect what this specific package contributed. Themes are
        // registered; everything else is ignored.
        const resolved = await packageManager.resolve();
        const fromSource = (/** @type {{ metadata: { source: string } }} */ r) => r.metadata.source === source;
        const themeCount = resolved.themes.filter(fromSource).length;
        const ignoredCount = resolved.extensions.filter(fromSource).length +
            resolved.skills.filter(fromSource).length +
            resolved.prompts.filter(fromSource).length;

        await discoverAndRegisterThemes();

        console.log(`Installed ${source}`);
        console.log(`  Themes registered: ${themeCount}`);
        if (ignoredCount > 0) {
            console.log(`  Non-theme resources ignored: ${ignoredCount} (Harns only loads themes)`);
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Installation failed: ${msg}`);
        Deno.exit(1);
    }
}
