/**
 * @module cmd/update
 * Install the latest Stable RunWield release through the public installer.
 */

import { join } from "@std/path";
import { VERSION } from "../../shared/version.js";
import { readRunWieldPackageInstallSync, type RunWieldPackageInstall } from "../../shared/package-install.ts";
import {
    compareRunWieldVersions,
    fetchLatestRunWieldRcRelease,
    fetchLatestRunWieldRelease,
    getInstalledWldDirectoryFromExecPath,
    getTagPinnedInstallerUrls,
    isNewerRunWieldVersion,
    normalizeRunWieldVersion,
    parseRunWieldReleaseVersion,
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

export type UpdateCommandOptions = import("../registry.js").CommandContext & {
    networkPort: UpdateNetworkPort;
    installerPort: InstallerProcessPort;
    exitPort: ProcessExitPort;
};

export const SYSTEM_UPDATE_NETWORK_PORT: UpdateNetworkPort = { fetch: globalThis.fetch };
export const SYSTEM_INSTALLER_PROCESS_PORT: InstallerProcessPort = {
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
export const SYSTEM_PROCESS_EXIT_PORT: ProcessExitPort = { exit: Deno.exit };

function usage(): string {
    return "Usage: wld update [--rc | --to <tag>] [--downgrade] [--yes]\n       wld upgrade [--rc | --to <tag>] [--downgrade] [--yes]";
}

interface ParsedUpdateArgs {
    rc: boolean;
    to: string | null;
    downgrade: boolean;
    yes: boolean;
}

function parseUpdateArgs(argv: string[]): ParsedUpdateArgs | null {
    const parsed: ParsedUpdateArgs = { rc: false, to: null, downgrade: false, yes: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--rc") parsed.rc = true;
        else if (arg === "--downgrade") parsed.downgrade = true;
        else if (arg === "--yes" || arg === "-y") parsed.yes = true;
        else if (arg === "--to") {
            const value = argv[index + 1];
            if (!value || value.startsWith("--")) return null;
            parsed.to = value;
            index += 1;
        } else if (arg.startsWith("--to=")) {
            const value = arg.slice("--to=".length);
            if (!value) return null;
            parsed.to = value;
        } else return null;
    }
    if (parsed.rc && parsed.to) return null;
    if (parsed.downgrade && !parsed.to) return null;
    return parsed;
}

function confirmUpgrade(message: string): boolean {
    const answer = globalThis.prompt(`${message}\nType INSTALL to continue:`) || "";
    return answer.trim() === "INSTALL";
}

function packageManagedUpdateMessage(install: RunWieldPackageInstall, parsedArgs: ParsedUpdateArgs): string {
    const lines = [
        `RunWield is managed by ${install.packageIdentifier}.`,
        `Use ${install.updateCommand} to update it.`,
    ];
    if (parsedArgs.rc || parsedArgs.to || parsedArgs.downgrade) {
        lines.push("Package-managed installs only follow the package's Stable channel.");
    }
    return lines.join("\n");
}

/** */
async function downloadInstaller(urls: string[], fetchImpl: typeof globalThis.fetch): Promise<string> {
    let firstFailure = "";
    for (const url of urls) {
        const response = await fetchImpl(url);
        if (response.ok) return await response.text();
        firstFailure ||= `Installer download failed: ${response.status}`;
        if (response.status !== 403) break;
    }
    throw new Error(firstFailure || "Installer download failed.");
}

/** */
function buildInstallerEnv(installDir: string | undefined, env: Record<string, string>): Record<string, string> {
    if (!installDir || env.WLD_INSTALL_DIR) return { ...env };
    return { ...env, WLD_INSTALL_DIR: installDir };
}

export async function runUpdateCommand(argv: string[], options: UpdateCommandOptions): Promise<void> {
    const network = options.networkPort;
    const installerProcess = options.installerPort;
    const processExit = options.exitPort;
    const parsedArgs = parseUpdateArgs(argv);

    if (!parsedArgs) {
        console.error(usage());
        processExit.exit(1);
        return;
    }

    const packageInstall = readRunWieldPackageInstallSync();
    if (packageInstall) {
        console.log(packageManagedUpdateMessage(packageInstall, parsedArgs));
        return;
    }

    let tempDir = "";
    /** @type {number | null} */
    let exitCode = null;
    try {
        if (Deno.build.os === "windows") {
            throw new Error(
                "Native Windows updates are not installed by the Unix shell installer. Reinstall RunWield with your package manager or from the latest GitHub release.",
            );
        }
        const release = parsedArgs.to
            ? { tagName: normalizeRunWieldVersion(parsedArgs.to), version: normalizeRunWieldVersion(parsedArgs.to) }
            : parsedArgs.rc
            ? await fetchLatestRunWieldRcRelease(network)
            : await fetchLatestRunWieldRelease(network);
        const targetVersion = parseRunWieldReleaseVersion(release.version);
        if (!targetVersion) throw new Error(`Invalid RunWield release tag: ${release.version}`);

        const comparison = compareRunWieldVersions(release.version, VERSION);
        const isDowngrade = comparison !== null && comparison < 0;
        if (isDowngrade && !parsedArgs.downgrade) {
            throw new Error(`Refusing to downgrade from ${VERSION} to ${release.version} without --downgrade.`);
        }
        if (comparison === 0) {
            console.log(`RunWield is already at ${VERSION}.`);
            return;
        }
        if (!parsedArgs.to && !parsedArgs.rc && !isNewerRunWieldVersion(release.version, VERSION)) {
            console.log(`RunWield is already up to date (${VERSION}).`);
            return;
        }

        const needsConfirmation = !parsedArgs.yes && (parsedArgs.rc || !targetVersion.stable || isDowngrade);
        if (needsConfirmation) {
            const direction = isDowngrade ? "downgrade" : "install";
            if (!confirmUpgrade(`RunWield will ${direction} from ${VERSION} to ${release.version}.`)) {
                console.log("RunWield update cancelled.");
                return;
            }
        }

        const installerUrls = getTagPinnedInstallerUrls(release.tagName);
        const installer = await downloadInstaller(installerUrls, network.fetch);
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
