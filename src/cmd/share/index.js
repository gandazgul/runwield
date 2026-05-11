/**
 * @module cmd/share
 * Share current session as a secret GitHub Gist.
 */

import { join } from "@std/path";
import { exportRootSessionToHtml } from "../../shared/session/root-session.js";
import { theme } from "../../shared/ui/theme.js";

/**
 * @typedef {import('../registry.js').CommandContext} CommandContext
 */

/**
 * Run a command and return success + stdout.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string }>}
 */
async function runCmd(cmd, args) {
    const command = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" });
    const { success, stdout, stderr } = await command.output();
    return {
        success,
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
    };
}

/**
 * Run the share command.
 *
 * @param {string[]} _argv
 * @param {CommandContext} [options]
 */
export async function runShareCommand(_argv, options = {}) {
    const { uiAPI, sessionManager } = options || {};

    if (!uiAPI) {
        throw new Error("UI API is required for the share command.");
    }

    if (!sessionManager) {
        uiAPI.appendSystemMessage("Error: No active session found.", true);
        return;
    }

    try {
        // 1. Check if gh is installed
        const ghVersion = await runCmd("gh", ["--version"]);
        if (!ghVersion.success) {
            uiAPI.appendSystemMessage("Error: GitHub CLI ('gh') is not installed. Please install it first.", true);
            return;
        }

        // 2. Check if gh is authenticated
        const ghAuth = await runCmd("gh", ["auth", "status"]);
        if (!ghAuth.success) {
            uiAPI.appendSystemMessage("Error: GitHub CLI is not authenticated. Please run 'gh auth login'.", true);
            return;
        }

        // 3. Export session to temporary HTML file
        const tmpDir = Deno.env.get("TMPDIR") || "/tmp";
        const sessionId = /** @type {{ getSessionId?: () => string }} */ (sessionManager).getSessionId?.() ||
            String(Date.now());
        const tmpFile = join(tmpDir, `harns-session-${sessionId}.html`);
        await exportRootSessionToHtml(sessionManager, tmpFile);

        // 4. Upload to secret Gist
        const ghGist = await runCmd("gh", ["gist", "create", "--public=false", tmpFile]);
        if (!ghGist.success) {
            throw new Error(`gh gist create failed: ${ghGist.stderr}`);
        }
        const url = ghGist.stdout.trim();

        if (!url) {
            throw new Error("Failed to get Gist URL from gh output.");
        }

        uiAPI.appendSystemMessage(`${theme.fg("success", `Session shared successfully!`)}\n${url}`);

        // 5. Cleanup
        try {
            await Deno.remove(tmpFile);
        } catch (_e) {
            // Ignore cleanup errors
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        uiAPI.appendSystemMessage(`Unexpected error while sharing session: ${msg}`, true);
    }
}
