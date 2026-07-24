/**
 * @module shared/snip-filters
 * Installs RunWield-bundled Snip filters into Snip's user filter directory.
 */

import { join } from "@std/path";
import { HOME_DIR, SNIP_FILTERS_DIR } from "../constants.js";

const BUNDLED_SNIP_FILTERS_DIR = SNIP_FILTERS_DIR;
const FILTER_FILE_NAMES = ["deno-check.yaml", "deno-fmt.yaml", "deno-lint.yaml", "deno-test.yaml"];
const RUNWIELD_MANAGED_SNIP_FILTER_MARKER = "# Managed by RunWield. Remove with: wld snip-filters cleanup";

/**
 * @param {string} path
 * @param {string} content
 * @returns {Promise<boolean>} true when a write happened
 */
async function writeIfChanged(path, content) {
    try {
        if (await Deno.readTextFile(path) === content) return false;
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await Deno.writeTextFile(path, content);
    return true;
}

/**
 * @param {string} content
 * @returns {string}
 */
function withManagedMarker(content) {
    return content.startsWith(`${RUNWIELD_MANAGED_SNIP_FILTER_MARKER}\n`)
        ? content
        : `${RUNWIELD_MANAGED_SNIP_FILTER_MARKER}\n${content}`;
}

/**
 * @param {{ homeDir?: string, bundledDir?: string }} [options]
 * @returns {{ userFiltersDir: string }}
 */
export function getRunWieldSnipPaths(options = {}) {
    const homeDir = options.homeDir || HOME_DIR || Deno.env.get("HOME") || Deno.cwd();
    return {
        userFiltersDir: join(homeDir, ".config", "snip", "filters"),
    };
}

/**
 * Install RunWield' Deno Snip filters into Snip's default user filter directory so
 * plain `snip run -- deno ...` can find them.
 *
 * @param {{ homeDir?: string, bundledDir?: string }} [options]
 * @returns {Promise<{ filtersDir: string, installed: string[], skipped: Array<{ path: string, reason: string }> }>}
 */
export async function installRunWieldSnipFiltersForUser(options = {}) {
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
            if (!existing.startsWith(RUNWIELD_MANAGED_SNIP_FILTER_MARKER)) {
                skipped.push({ path: targetPath, reason: "existing non-RunWield filter" });
                continue;
            }
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        }

        if (await writeIfChanged(targetPath, content)) installed.push(targetPath);
    }

    return { filtersDir: paths.userFiltersDir, installed, skipped };
}

/**
 * Remove RunWield-managed Snip filters from Snip's default user filter directory.
 * Non-RunWield files with the same names are left untouched.
 *
 * @param {{ homeDir?: string }} [options]
 * @returns {Promise<{ filtersDir: string, removed: string[], skipped: Array<{ path: string, reason: string }> }>}
 */
export async function cleanupRunWieldSnipFiltersForUser(options = {}) {
    const paths = getRunWieldSnipPaths(options);
    const removed = [];
    const skipped = [];

    for (const fileName of FILTER_FILE_NAMES) {
        const targetPath = join(paths.userFiltersDir, fileName);
        try {
            const existing = await Deno.readTextFile(targetPath);
            if (!existing.startsWith(RUNWIELD_MANAGED_SNIP_FILTER_MARKER)) {
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

    return { filtersDir: paths.userFiltersDir, removed, skipped };
}

/**
 * @param {{ homeDir?: string }} [options]
 * @returns {Promise<{ filtersDir: string, installed: string[], conflicts: string[], missing: string[] }>}
 */
export async function getRunWieldSnipFilterInstallStatus(options = {}) {
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
