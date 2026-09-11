/**
 * @module shared/package-install
 * Detect package-manager-owned RunWield installs from metadata beside the executable.
 */

import { dirname, join } from "@std/path";

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
        return parsePackageMetadata(Deno.readTextFileSync(metadataPath));
    } catch {
        return null;
    }
}
