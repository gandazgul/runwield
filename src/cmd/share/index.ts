/**
 * @module cmd/share
 * Share current session JSONL as a secret GitHub Gist.
 */

import { theme } from "../../ui/theme/theme.js";
import type { SessionRuntime } from "../../shared/session/session-runtime.js";

interface CommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
}

export interface GitHubCliPort {
    run(args: string[]): Promise<CommandResult>;
}

export interface ShareCommandOptions {
    uiAPI?: Pick<import("../../ui/tui/types.js").UiAPI, "appendSystemMessage">;
    sessionRuntime?: SessionRuntime;
    sessionId?: string;
    githubCli: GitHubCliPort;
}

/**
 * Run a command and return success + stdout.
 */
async function runGitHubCli(args: string[]): Promise<CommandResult> {
    const command = new Deno.Command("gh", { args, stdout: "piped", stderr: "piped" });
    const { success, stdout, stderr } = await command.output();
    return {
        success,
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
    };
}

export const SYSTEM_GITHUB_CLI_PORT: GitHubCliPort = { run: runGitHubCli };

/**
 * Run the share command.
 */
export async function runShareCommand(_argv: string[], options: ShareCommandOptions): Promise<void> {
    const { uiAPI, sessionRuntime, sessionId: runtimeSessionId } = options;

    if (!uiAPI) {
        throw new Error("UI API is required for the share command.");
    }

    if (!sessionRuntime || !runtimeSessionId || !sessionRuntime.getSessionSnapshot(runtimeSessionId)) {
        uiAPI.appendSystemMessage("Error: No active session found.", true);
        return;
    }

    let tmpFile = "";
    try {
        // 1. Check if gh is installed
        const githubCli = options.githubCli;
        const ghVersion = await githubCli.run(["--version"]);
        if (!ghVersion.success) {
            uiAPI.appendSystemMessage("Error: GitHub CLI ('gh') is not installed. Please install it first.", true);
            return;
        }

        // 2. Check if gh is authenticated
        const ghAuth = await githubCli.run(["auth", "status"]);
        if (!ghAuth.success) {
            uiAPI.appendSystemMessage("Error: GitHub CLI is not authenticated. Please run 'gh auth login'.", true);
            return;
        }

        // 3. Export the currently persisted session shape to a temporary JSONL file.
        tmpFile = await Deno.makeTempFile({ prefix: "runwield-session-", suffix: ".jsonl" });
        await sessionRuntime.exportSession(runtimeSessionId, tmpFile);

        // 4. Upload to secret Gist
        const ghGist = await githubCli.run(["gist", "create", "--public=false", tmpFile]);
        if (!ghGist.success) {
            throw new Error(`gh gist create failed: ${ghGist.stderr}`);
        }
        const url = ghGist.stdout.trim();

        if (!url) {
            throw new Error("Failed to get Gist URL from gh output.");
        }

        uiAPI.appendSystemMessage(`${theme.fg("success", "Session shared successfully!")}\n${url}`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        uiAPI.appendSystemMessage(`Unexpected error while sharing session: ${msg}`, true);
    } finally {
        if (tmpFile) await Deno.remove(tmpFile).catch(() => {});
    }
}
