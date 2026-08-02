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

export interface UpdateNetworkPort {
    fetch: typeof globalThis.fetch;
}

export interface InstallerProcessPort {
    run(scriptPath: string, releaseTag: string, env: Record<string, string>): Promise<number>;
}

export interface ProcessExitPort {
    exit(code: number): void;
}

type UpdateCommandOptions = import("../registry.js").CommandContext & {
    networkPort?: UpdateNetworkPort;
    installerPort?: InstallerProcessPort;
    exitPort?: ProcessExitPort;
};

const DEFAULT_NETWORK_PORT: UpdateNetworkPort = { fetch: globalThis.fetch };
const DEFAULT_INSTALLER_PORT: InstallerProcessPort = {
    async run(scriptPath, releaseTag, env) {
        const result = await new Deno.Command("bash", {
            args: [scriptPath, releaseTag],
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
            env,
        }).output();
        return result.code;
    },
};
const DEFAULT_EXIT_PORT: ProcessExitPort = { exit: Deno.exit };

function usage(): string {
    return "Usage: wld update\n       wld upgrade";
}

/** */
async function downloadInstaller(url: string, fetchImpl: typeof globalThis.fetch): Promise<string> {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Installer download failed: ${response.status}`);
    return await response.text();
}

/** */
function buildInstallerEnv(installDir: string | undefined, env: Record<string, string>): Record<string, string> {
    if (!installDir || env.WLD_INSTALL_DIR) return { ...env };
    return { ...env, WLD_INSTALL_DIR: installDir };
}

export async function runUpdateCommand(argv: string[] = [], options: UpdateCommandOptions = {}): Promise<void> {
    const network = options.networkPort || DEFAULT_NETWORK_PORT;
    const installerProcess = options.installerPort || DEFAULT_INSTALLER_PORT;
    const processExit = options.exitPort || DEFAULT_EXIT_PORT;

    if (argv.length > 0) {
        console.error(usage());
        processExit.exit(1);
        return;
    }

    let tempDir = "";
    /** @type {number | null} */
    let exitCode = null;
    try {
        const release = await fetchLatestRunWieldRelease({ fetch: network.fetch });
        if (!isNewerRunWieldVersion(release.version, VERSION)) {
            console.log(`RunWield is already up to date (${VERSION}).`);
            return;
        }

        const installerUrl = getTagPinnedInstallerUrl(release.tagName);
        const installer = await downloadInstaller(installerUrl, network.fetch);
        tempDir = await Deno.makeTempDir({ prefix: "runwield-update-" });
        const scriptPath = join(tempDir, "install.sh");
        await Deno.writeTextFile(scriptPath, installer);

        const env = Deno.env.toObject();
        const execPath = Deno.execPath();
        const installDir = getInstalledWldDirectoryFromExecPath(execPath);
        if (!installDir && !env.WLD_INSTALL_DIR) {
            console.log(
                "RunWield appears to be running from source; installer default location will be used unless WLD_INSTALL_DIR is set.",
            );
        }
        const commandEnv = buildInstallerEnv(installDir || undefined, env);
        const installerExitCode = await installerProcess.run(scriptPath, release.tagName, commandEnv);
        if (installerExitCode !== 0) {
            exitCode = installerExitCode;
        }
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`RunWield update failed: ${message}`);
        exitCode = 1;
    } finally {
        if (tempDir) {
            try {
                await Deno.remove(tempDir, { recursive: true });
            } catch (_error) {
                // Best-effort cleanup only.
            }
        }
    }

    if (exitCode !== null) {
        processExit.exit(exitCode);
    }
}
