/**
 * @module cmd/update
 * Install the latest Stable RunWield release through the public installer.
 */

import { join } from "@std/path";
import { VERSION } from "../../shared/version.js";
import {
    fetchLatestRunWieldRelease,
    getInstalledWldDirectoryFromExecPath,
    getTagPinnedInstallerUrl,
    isNewerRunWieldVersion,
} from "../../shared/update-check.js";

/**
 * @typedef {Object} UpdateCommandDeps
 * @property {typeof globalThis.fetch} [fetch]
 * @property {() => string} [execPath]
 * @property {() => Promise<string>} [makeTempDir]
 * @property {(path: string, data: string) => Promise<void>} [writeTextFile]
 * @property {(path: string, options?: { recursive?: boolean }) => Promise<void>} [remove]
 * @property {(command: string, options: { args: string[], stdin: "inherit", stdout: "inherit", stderr: "inherit", env: Record<string, string> }) => { output: () => Promise<{ code: number }> }} [command]
 * @property {Record<string, string>} [env]
 * @property {(message: string) => void} [log]
 * @property {(message: string) => void} [error]
 * @property {(code: number) => void} [exit]
 * @property {string} [currentVersion]
 */

function usage() {
    return "Usage: wld update\n       wld upgrade";
}

/**
 * @param {string} url
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function downloadInstaller(url, fetchImpl) {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Installer download failed: ${response.status}`);
    return await response.text();
}

/**
 * @param {string | undefined} installDir
 * @param {Record<string, string>} env
 */
function buildInstallerEnv(installDir, env) {
    if (!installDir || env.WLD_INSTALL_DIR) return { ...env };
    return { ...env, WLD_INSTALL_DIR: installDir };
}

/**
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: UpdateCommandDeps }} [options]
 */
export async function runUpdateCommand(argv = [], options = {}) {
    const deps = /** @type {UpdateCommandDeps} */ (options.__testDeps || {});
    const log = deps.log || console.log;
    const error = deps.error || console.error;
    const exit = deps.exit || Deno.exit;
    const currentVersion = deps.currentVersion || VERSION;

    if (argv.length > 0) {
        error(usage());
        exit(1);
        return;
    }

    let tempDir = "";
    /** @type {number | null} */
    let exitCode = null;
    try {
        const fetchImpl = deps.fetch || globalThis.fetch;
        const release = await fetchLatestRunWieldRelease({ fetch: fetchImpl });
        if (!isNewerRunWieldVersion(release.version, currentVersion)) {
            log(`RunWield is already up to date (${currentVersion}).`);
            return;
        }

        const installerUrl = getTagPinnedInstallerUrl(release.tagName);
        const installer = await downloadInstaller(installerUrl, fetchImpl);
        tempDir = await (deps.makeTempDir || (() => Deno.makeTempDir({ prefix: "runwield-update-" })))();
        const scriptPath = join(tempDir, "install.sh");
        await (deps.writeTextFile || Deno.writeTextFile)(scriptPath, installer);

        const env = deps.env || Deno.env.toObject();
        const execPath = (deps.execPath || Deno.execPath)();
        const installDir = getInstalledWldDirectoryFromExecPath(execPath);
        if (!installDir && !env.WLD_INSTALL_DIR) {
            log("RunWield appears to be running from source; installer default location will be used unless WLD_INSTALL_DIR is set.");
        }
        const commandEnv = buildInstallerEnv(installDir || undefined, env);
        const commandFactory = deps.command || ((command, commandOptions) => new Deno.Command(command, commandOptions));
        const result = await commandFactory("bash", {
            args: [scriptPath, release.tagName],
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
            env: commandEnv,
        }).output();
        if (result.code !== 0) {
            exitCode = result.code;
        }
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        error(`RunWield update failed: ${message}`);
        exitCode = 1;
    } finally {
        if (tempDir) {
            try {
                await (deps.remove || Deno.remove)(tempDir, { recursive: true });
            } catch (_error) {
                // Best-effort cleanup only.
            }
        }
    }

    if (exitCode !== null) {
        exit(exitCode);
    }
}
