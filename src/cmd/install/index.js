/**
 * @module cmd/install
 * Harns install command wrapping Pi's PackageManager.
 */

import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { getSettingsManager } from "../../shared/settings.js";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { discoverAndRegisterThemes } from "../../shared/ui/theme.js";

/**
 * Executes the a package installation.
 *
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
        await discoverAndRegisterThemes();

        console.log(`\nSuccessfully installed ${source}`);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`\nInstallation failed: ${msg}`);
        Deno.exit(1);
    }
}
