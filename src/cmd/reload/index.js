/**
 * @module cmd/reload
 * Implementation of the reload command.
 */

import { discoverAndRegisterThemes, setTheme } from "../../ui/theme/theme.js";
import { getSettingsManager } from "../../shared/settings.js";

/**
 * Executed when /reload is called.
 * @param {string[]} _argv
 * @param {import('../../cmd/registry.js').CommandContext} options
 */
export async function runReloadCommand(_argv, options = {}) {
    if (!options.uiAPI) {
        console.log("The /reload command is only available in the interactive session.");
        return;
    }
    if (!options.sessionRuntime || !options.sessionId) throw new Error("/reload requires an active runtime session.");

    try {
        const result = await options.sessionRuntime.reloadSession(options.sessionId);
        if (result.ok) {
            const settings = getSettingsManager(options.sessionRuntime.getSessionSnapshot(options.sessionId)?.cwd);
            await discoverAndRegisterThemes();
            const persistedTheme = settings.getTheme();
            if (persistedTheme) setTheme(persistedTheme);
            options.uiAPI.appendSystemMessage("Successfully reloaded configs, themes, and agent context.");
        } else {
            options.uiAPI.appendSystemMessage("Reload skipped (no active root session found).");
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        options.uiAPI.appendSystemMessage(`Failed to reload: ${msg}`);
    }
}
