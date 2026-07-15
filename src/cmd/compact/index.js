/**
 * @module cmd/compact
 * Command to manually compact the session context.
 */

import { theme } from "../../ui/theme/theme.js";

/**
 * Handle compact command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runCompactCommand(argv, options = {}) {
    if (!options?.uiAPI) {
        console.error("The /compact command is only available inside an interactive session.");
        return;
    }

    const { uiAPI, sessionRuntime, sessionId } = options;
    if (!sessionRuntime || !sessionId) {
        uiAPI.appendSystemMessage("Error: No active agent session.");
        return;
    }

    const customInstructions = argv.join(" ").trim() || undefined;
    const instructionsNote = customInstructions ? `\n${theme.fg("dim", `Instructions: ${customInstructions}`)}` : "";

    uiAPI.appendSystemMessage(`Compacting context... ${theme.fg("dim", "(Esc to cancel)")}${instructionsNote}`);

    try {
        const result = await sessionRuntime.compactSession(sessionId, customInstructions);

        // Pi-style report: print the generated summary plus the pre-compaction token count.
        const headerLines = [
            theme.fg("accent", "Session compacted."),
            `${theme.fg("dim", "Tokens before:")} ${result.tokensBefore.toLocaleString()}`,
            "",
        ];
        uiAPI.appendSystemMessage(headerLines.join("\n"));
        if (result.summary) {
            uiAPI.appendSystemMessage(result.summary);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isCancelled = message === "Compaction cancelled" || message.includes("cancelled");

        if (isCancelled) {
            uiAPI.appendSystemMessage("Compaction cancelled.");
        } else if (message.includes("Nothing to compact")) {
            uiAPI.appendSystemMessage("Nothing to compact — the session doesn't have enough messages yet.");
        } else {
            uiAPI.appendSystemMessage(`Compaction failed: ${message}`);
        }
    }
}
