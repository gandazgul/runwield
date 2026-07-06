/**
 * @module cmd/copy
 * Command to copy the last assistant message to the clipboard.
 */

import { theme } from "../../ui/theme/theme.js";

/**
 * Copy text to the system clipboard using the platform-appropriate command.
 *
 * @param {string} text
 * @returns {Promise<boolean>} True when the text was copied successfully.
 */
async function copyToClipboard(text) {
    const platform = Deno.build.os;

    /** @type {string | undefined} */
    let command;
    /** @type {string[]} */
    let args = [];

    switch (platform) {
        case "darwin":
            command = "pbcopy";
            args = [];
            break;
        case "linux": {
            // Try xclip first, fall back to xsel
            try {
                const xclipCheck = new Deno.Command("which", { args: ["xclip"], stdout: "null", stderr: "null" });
                const { success: hasXclip } = await xclipCheck.output();
                if (hasXclip) {
                    command = "xclip";
                    args = ["-selection", "clipboard"];
                    break;
                }
            } catch {
                // fall through
            }
            try {
                const xselCheck = new Deno.Command("which", { args: ["xsel"], stdout: "null", stderr: "null" });
                const { success: hasXsel } = await xselCheck.output();
                if (hasXsel) {
                    command = "xsel";
                    args = ["--clipboard", "--input"];
                    break;
                }
            } catch {
                // fall through
            }
            return false;
        }
        case "windows":
            command = "clip";
            args = [];
            break;
        default:
            return false;
    }

    try {
        const proc = new Deno.Command(command, {
            args,
            stdin: "piped",
            stdout: "null",
            stderr: "null",
        });
        const child = proc.spawn();
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(text));
        writer.releaseLock();
        await child.stdin.close();
        const { success } = await child.output();
        return success;
    } catch {
        return false;
    }
}

/**
 * Extract the display text from the last assistant message in the session.
 *
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @returns {string | null} The extracted text, or null if no assistant message was found.
 */
function extractLastAssistantText(session) {
    const messages = session.agent.state.messages;
    if (!Array.isArray(messages) || messages.length === 0) return null;

    // Walk backwards to find the last assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg || msg.role !== "assistant") continue;

        const content = msg.content;
        if (!Array.isArray(content)) continue;

        /** @type {string[]} */
        const textParts = [];
        for (const block of content) {
            if (block && block.type === "text" && typeof block.text === "string") {
                textParts.push(block.text);
            }
        }

        if (textParts.length === 0) continue;

        return textParts.join("\n").trim();
    }

    return null;
}

/**
 * Handle the /copy command.
 *
 * @param {string[]} _argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runCopyCommand(_argv, options = {}) {
    if (!options?.uiAPI) {
        console.error("The /copy command is only available inside an interactive session.");
        return;
    }

    const { uiAPI, hostedSession } = options;
    const session = /** @type {any} */ (hostedSession?.getRootAgentSession?.());
    if (!session) {
        uiAPI.appendSystemMessage("Error: No active agent session.");
        return;
    }

    const text = extractLastAssistantText(session);
    if (!text) {
        uiAPI.appendSystemMessage("Nothing to copy — no assistant message found.");
        return;
    }

    const copied = await copyToClipboard(text);
    if (copied) {
        const charCount = text.length.toLocaleString();
        uiAPI.appendSystemMessage(theme.fg("dim", `Copied last assistant message (${charCount} chars) to clipboard.`));
    } else {
        uiAPI.appendSystemMessage(
            theme.fg("dim", "Could not copy to clipboard. No clipboard utility found (pbcopy/xclip/xsel/clip)."),
        );
    }
}
