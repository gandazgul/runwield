/**
 * @module shared/package-install
 * Detect package-manager-owned RunWield installs from metadata beside the executable.
 */

import { dirname, isAbsolute, join } from "@std/path";

export type RunWieldPackageManager = "homebrew" | "winget";

export interface RunWieldPackageInstall {
    schemaVersion: 1;
    packageManager: RunWieldPackageManager;
    packageIdentifier: string;
    updateCommand: string;
    repairCommand: string;
    installDirectory: string;
    version?: string;
}

export const RUNWIELD_PACKAGE_METADATA_FILE = "runwield-install.json";

function isRunWieldPackageManager(value: string): value is RunWieldPackageManager {
    return value === "homebrew" || value === "winget";
}

function textProperty(record: Record<string, string | number>, key: string): string | null {
    const value = record[key];
    return typeof value === "string" && value.trim() ? value : null;
}

function normalizePackageInstall(value: Record<string, string | number>): RunWieldPackageInstall | null {
    const schemaVersion = value.schemaVersion;
    const packageManager = textProperty(value, "packageManager");
    const packageIdentifier = textProperty(value, "packageIdentifier");
    const updateCommand = textProperty(value, "updateCommand");
    const repairCommand = textProperty(value, "repairCommand");
    const installDirectory = textProperty(value, "installDirectory");
    const version = textProperty(value, "version");

    if (schemaVersion !== 1 || !packageManager || !isRunWieldPackageManager(packageManager)) return null;
    if (!packageIdentifier || !updateCommand || !repairCommand || !installDirectory) return null;

    return {
        schemaVersion,
        packageManager,
        packageIdentifier,
        updateCommand,
        repairCommand,
        installDirectory,
        ...(version ? { version } : {}),
    };
}

function parsePackageMetadata(text: string): RunWieldPackageInstall | null {
    try {
        const parsed = JSON.parse(text) as Record<string, string | number>;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return normalizePackageInstall(parsed);
    } catch {
        return null;
    }
}

export function packageMetadataPathForExecutablePath(execPath: string): string | null {
    const path = String(execPath || "");
    if (!path) return null;
    try {
        return join(dirname(Deno.realPathSync(path)), RUNWIELD_PACKAGE_METADATA_FILE);
    } catch {
        return join(dirname(path), RUNWIELD_PACKAGE_METADATA_FILE);
    }
}

export function readRunWieldPackageInstallSync(execPath = Deno.execPath()): RunWieldPackageInstall | null {
    const metadataPath = packageMetadataPathForExecutablePath(execPath);
    if (!metadataPath) return null;
    try {
        const install = parsePackageMetadata(Deno.readTextFileSync(metadataPath));
        if (!install) return null;
        return {
            ...install,
            installDirectory: isAbsolute(install.installDirectory)
                ? install.installDirectory
                : join(dirname(metadataPath), install.installDirectory),
        };
    } catch {
        return null;
    }
}

export function bundledHelperDirectoryForInstall(install: RunWieldPackageInstall): string | null {
    const helpers = join(install.installDirectory, "runtime", "helpers");
    const executableSuffix = Deno.build.os === "windows" ? ".exe" : "";
    for (const name of ["mnemoteca", "cymbal", "ketch", "agent-browser"]) {
        try {
            const stat = Deno.statSync(join(helpers, `${name}${executableSuffix}`));
            if (!stat.isFile) return null;
        } catch {
            return null;
        }
    }
    return helpers;
}

function pathEnvironmentKey(env: Record<string, string>): string {
    if (Deno.build.os !== "windows") return "PATH";
    const existing = Object.keys(env).find((key) => key.toLowerCase() === "path");
    return existing || "Path";
}

export function prependToPathEnv(env: Record<string, string>, directory: string): Record<string, string> {
    const key = pathEnvironmentKey(env);
    const current = env[key] || "";
    const separator = Deno.build.os === "windows" ? ";" : ":";
    return { ...env, [key]: current ? `${directory}${separator}${current}` : directory };
}

export function exposeBundledHelpersSync(execPath = Deno.execPath()): string | null {
    const install = readRunWieldPackageInstallSync(execPath);
    if (!install) return null;
    const helpers = bundledHelperDirectoryForInstall(install);
    if (!helpers) return null;
    const env = prependToPathEnv(Deno.env.toObject(), helpers);
    const key = pathEnvironmentKey(env);
    Deno.env.set(key, env[key]);
    return helpers;
}
