/**
 * @module cmd/compact
 * Command to manually compact the session context.
 */

import { estimateTokens, findCutPoint } from "@earendil-works/pi-coding-agent";
import { theme } from "../../shared/ui/theme.js";

// Minimum tokens that must fall outside the keep-recent window for compaction to
// produce a useful summary. Below this, the LLM is handed too little context and
// returns boilerplate like "No active goal identified due to empty conversation
// history" — worse than leaving the session uncompacted.
const MIN_SUMMARIZABLE_TOKENS = 1500;

/**
 * Estimate how many tokens of conversation would be sent to the summarizer if
 * we ran compaction now. Mirrors prepareCompaction()'s slicing in pi-mono so we
 * can short-circuit before generating a misleading summary.
 *
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @returns {{ summarizable: number, keepRecent: number, alreadyCompacted: boolean }}
 */
function estimateSummarizableTokens(session) {
    const branch = session.sessionManager.getBranch();
    const settings = session.settingsManager.getCompactionSettings();

    if (branch.length === 0) {
        return { summarizable: 0, keepRecent: settings.keepRecentTokens, alreadyCompacted: false };
    }

    if (branch[branch.length - 1].type === "compaction") {
        return { summarizable: 0, keepRecent: settings.keepRecentTokens, alreadyCompacted: true };
    }

    // Boundary starts after the most recent compaction (if any), matching
    // prepareCompaction()'s behavior in pi-mono's compaction.ts.
    let boundaryStart = 0;
    for (let i = branch.length - 1; i >= 0; i--) {
        const entry = branch[i];
        if (entry.type === "compaction") {
            const firstKeptIdx = branch.findIndex((e) => e.id === entry.firstKeptEntryId);
            boundaryStart = firstKeptIdx >= 0 ? firstKeptIdx : i + 1;
            break;
        }
    }

    const cutPoint = findCutPoint(branch, boundaryStart, branch.length, settings.keepRecentTokens);
    const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

    let summarizable = 0;
    for (let i = boundaryStart; i < historyEnd; i++) {
        const entry = branch[i];
        if (entry.type === "message") {
            summarizable += estimateTokens(entry.message);
        }
    }

    return { summarizable, keepRecent: settings.keepRecentTokens, alreadyCompacted: false };
}

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

    const { uiAPI, registerOperationCancel, hostedSession } = options;
    const session = /** @type {any} */ (hostedSession?.getRootAgentSession?.());
    if (!session) {
        uiAPI.appendSystemMessage("Error: No active agent session.");
        return;
    }

    if (session.isCompacting) {
        uiAPI.appendSystemMessage("Compaction is already in progress. Press Escape to cancel.");
        return;
    }

    const { summarizable, keepRecent, alreadyCompacted } = estimateSummarizableTokens(session);
    if (alreadyCompacted) {
        uiAPI.appendSystemMessage("Already compacted — no new messages since the last compaction.");
        return;
    }
    if (summarizable < MIN_SUMMARIZABLE_TOKENS) {
        uiAPI.appendSystemMessage(
            `Nothing meaningful to compact — only ~${summarizable.toLocaleString()} tokens fall outside the ` +
                `keep-recent window (${keepRecent.toLocaleString()} tokens). Skipping to avoid writing an empty summary.`,
        );
        return;
    }

    const customInstructions = argv.join(" ").trim() || undefined;
    const instructionsNote = customInstructions ? `\n${theme.fg("dim", `Instructions: ${customInstructions}`)}` : "";

    uiAPI.appendSystemMessage(`Compacting context... ${theme.fg("dim", "(Esc to cancel)")}${instructionsNote}`);

    // Replace the default operation-cancel handler (which calls abortActiveSession) with one
    // that cancels just the compaction. Restored automatically when this command returns.
    if (registerOperationCancel) {
        registerOperationCancel(() => {
            try {
                session.abortCompaction();
            } catch (_e) { /* ignore */ }
        });
    }

    try {
        const result = await session.compact(customInstructions);

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
