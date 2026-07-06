/**
 * @module cmd/reload
 * Implementation of the reload command.
 */

import { reloadRootAgentSession } from "../../shared/session/session.js";

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

    try {
        const success = await reloadRootAgentSession(options.hostedSession, options.uiAPI);
        if (success) {
            options.uiAPI.appendSystemMessage("Successfully reloaded configs, themes, and agent context.");
        } else {
            options.uiAPI.appendSystemMessage("Reload skipped (no active root session found).");
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        options.uiAPI.appendSystemMessage(`Failed to reload: ${msg}`);
    }
}
