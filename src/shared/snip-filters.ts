/**
 * @module shared/snip-filters
 * Installs RunWield-bundled Snip filters into Snip's user filter directory.
 */

import { join } from "@std/path";
import { getCwd, getHomeDir, SNIP_FILTERS_DIR } from "../constants.js";

export interface SnipFilterOptions {
    homeDir?: string;
    bundledDir?: string;
}

export interface SnipFilterPaths {
    userFiltersDir: string;
}

export interface SkippedSnipFilter {
    path: string;
    reason: string;
}

export interface SnipFilterInstallResult {
    filtersDir: string;
    installed: string[];
    removedLegacy: string[];
    skipped: SkippedSnipFilter[];
}

export interface SnipFilterCleanupResult {
    filtersDir: string;
    removed: string[];
    removedLegacy: string[];
    skipped: SkippedSnipFilter[];
}

export interface SnipFilterInstallStatus {
    filtersDir: string;
    installed: string[];
    conflicts: string[];
    missing: string[];
}

const BUNDLED_SNIP_FILTERS_DIR = SNIP_FILTERS_DIR;
const FILTER_FILE_NAMES = ["deno-check.yaml", "deno-fmt.yaml", "deno-lint.yaml", "deno-test.yaml", "deno-task.yaml"];
const RUNWIELD_MANAGED_SNIP_FILTER_MARKER = "# Managed by RunWield. Remove with: wld snip-filters cleanup";
const HARNS_MANAGED_SNIP_FILTER_MARKER = "# Managed by Harns. Remove with: hns snip-filters cleanup";

/** Return true when a write happened. */
async function writeIfChanged(path: string, content: string): Promise<boolean> {
    try {
        if (await Deno.readTextFile(path) === content) return false;
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await Deno.writeTextFile(path, content);
    return true;
}

function withManagedMarker(content: string): string {
    return content.startsWith(`${RUNWIELD_MANAGED_SNIP_FILTER_MARKER}\n`)
        ? content
        : `${RUNWIELD_MANAGED_SNIP_FILTER_MARKER}\n${content}`;
}

function isRunWieldOrHarnsManaged(content: string): boolean {
    return content.startsWith(RUNWIELD_MANAGED_SNIP_FILTER_MARKER) ||
        content.startsWith(HARNS_MANAGED_SNIP_FILTER_MARKER);
}

/**
 * Remove the obsolete Harns-only filter directory by exact file name. The
 * directory removals are non-recursive, so unrelated files cannot be lost.
 */
async function removeLegacyHarnsFilterDirectory(homeDir: string): Promise<string[]> {
    const legacyFiltersDir = join(homeDir, ".config", "snip", "harns", "filters");
    const removed = [];
    for (const fileName of FILTER_FILE_NAMES) {
        const path = join(legacyFiltersDir, fileName);
        try {
            await Deno.remove(path);
            removed.push(path);
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
    }
    for (const path of [legacyFiltersDir, join(homeDir, ".config", "snip", "harns")]) {
        try {
            await Deno.remove(path);
        } catch {
            // Leave a non-empty or unavailable legacy directory intact. Only
            // the exact filter files above are owned by this cleanup.
        }
    }
    return removed;
}

export function getRunWieldSnipPaths(options: SnipFilterOptions = {}): SnipFilterPaths {
    const homeDir = options.homeDir || getHomeDir() || getCwd();
    return {
        userFiltersDir: join(homeDir, ".config", "snip", "filters"),
    };
}

/**
 * Install RunWield' Deno Snip filters into Snip's default user filter directory so
 * plain `snip run -- deno ...` can find them.
 */
export async function installRunWieldSnipFiltersForUser(
    options: SnipFilterOptions = {},
): Promise<SnipFilterInstallResult> {
    const bundledDir = options.bundledDir || BUNDLED_SNIP_FILTERS_DIR;
    const paths = getRunWieldSnipPaths(options);
    const installed = [];
    const skipped = [];

    await Deno.mkdir(paths.userFiltersDir, { recursive: true });

    for (const fileName of FILTER_FILE_NAMES) {
        const sourcePath = join(bundledDir, fileName);
        const targetPath = join(paths.userFiltersDir, fileName);
        const content = withManagedMarker(await Deno.readTextFile(sourcePath));
        try {
            const existing = await Deno.readTextFile(targetPath);
            if (!isRunWieldOrHarnsManaged(existing)) {
                skipped.push({ path: targetPath, reason: "existing non-RunWield filter" });
                continue;
            }
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        }

        if (await writeIfChanged(targetPath, content)) installed.push(targetPath);
    }

    const homeDir = options.homeDir || getHomeDir() || getCwd();
    const removedLegacy = await removeLegacyHarnsFilterDirectory(homeDir);
    return { filtersDir: paths.userFiltersDir, installed, removedLegacy, skipped };
}

/**
 * Remove RunWield-managed Snip filters from Snip's default user filter directory.
 * Non-RunWield files with the same names are left untouched.
 */
export async function cleanupRunWieldSnipFiltersForUser(
    options: SnipFilterOptions = {},
): Promise<SnipFilterCleanupResult> {
    const paths = getRunWieldSnipPaths(options);
    const removed = [];
    const skipped = [];

    for (const fileName of FILTER_FILE_NAMES) {
        const targetPath = join(paths.userFiltersDir, fileName);
        try {
            const existing = await Deno.readTextFile(targetPath);
            if (!isRunWieldOrHarnsManaged(existing)) {
                skipped.push({ path: targetPath, reason: "existing non-RunWield filter" });
                continue;
            }
            await Deno.remove(targetPath);
            removed.push(targetPath);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) continue;
            throw error;
        }
    }

    const homeDir = options.homeDir || getHomeDir() || getCwd();
    const removedLegacy = await removeLegacyHarnsFilterDirectory(homeDir);
    return { filtersDir: paths.userFiltersDir, removed, removedLegacy, skipped };
}

export async function getRunWieldSnipFilterInstallStatus(
    options: SnipFilterOptions = {},
): Promise<SnipFilterInstallStatus> {
    const paths = getRunWieldSnipPaths(options);
    const installed = [];
    const conflicts = [];
    const missing = [];

    for (const fileName of FILTER_FILE_NAMES) {
        const targetPath = join(paths.userFiltersDir, fileName);
        try {
            const existing = await Deno.readTextFile(targetPath);
            if (existing.startsWith(RUNWIELD_MANAGED_SNIP_FILTER_MARKER)) installed.push(targetPath);
            else conflicts.push(targetPath);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                missing.push(targetPath);
                continue;
            }
            throw error;
        }
    }

    return { filtersDir: paths.userFiltersDir, installed, conflicts, missing };
}
