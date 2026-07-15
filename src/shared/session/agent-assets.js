/**
 * @module shared/session/agent-assets
 * Public, session-independent access to bundled agent prompt assets.
 */

import { dirname, join } from "@std/path";
import { AGENT_DEFS_DIR, HOME_DIR } from "../../constants.js";
import { directoryExists, fileExists } from "../helpers.js";

const BUNDLED_AGENT_DEFS_CACHE_DIR = HOME_DIR ? join(HOME_DIR, ".wld", "bundled-agent-definitions") : null;

/** @type {Promise<string | null> | null} */
let extractionPromise = null;

/** @type {Promise<string> | null} */
let pathPromise = null;

/** @param {string} sourceDir @param {string} destinationDir */
async function copyTreeFromBundle(sourceDir, destinationDir) {
    await Deno.mkdir(destinationDir, { recursive: true });
    for await (const entry of Deno.readDir(sourceDir)) {
        const sourcePath = join(sourceDir, entry.name);
        const destinationPath = join(destinationDir, entry.name);
        if (entry.isDirectory) await copyTreeFromBundle(sourcePath, destinationPath);
        else if (entry.isFile) await Deno.writeFile(destinationPath, await Deno.readFile(sourcePath));
    }
}

/** @returns {Promise<string | null>} */
export function extractBundledAgentDefs() {
    if (extractionPromise) return extractionPromise;
    extractionPromise = (async () => {
        if (!BUNDLED_AGENT_DEFS_CACHE_DIR || !(await directoryExists(AGENT_DEFS_DIR))) return null;
        try {
            await Deno.remove(BUNDLED_AGENT_DEFS_CACHE_DIR, { recursive: true });
        } catch {
            // The extraction target does not exist on first use.
        }
        try {
            await copyTreeFromBundle(AGENT_DEFS_DIR, BUNDLED_AGENT_DEFS_CACHE_DIR);
            return BUNDLED_AGENT_DEFS_CACHE_DIR;
        } catch {
            return null;
        }
    })();
    return extractionPromise;
}

/** @returns {Promise<string>} */
export function getBundledAgentDefsPath() {
    if (!pathPromise) {
        pathPromise = extractBundledAgentDefs().then((extracted) => extracted ?? AGENT_DEFS_DIR);
    }
    return pathPromise;
}

/** @param {string} relativePath @returns {Promise<string>} */
export async function ensureBundledAgentDefFile(relativePath) {
    const bundledDir = await getBundledAgentDefsPath();
    const targetPath = join(bundledDir, relativePath);
    if (await fileExists(targetPath)) return targetPath;

    const sourcePath = join(AGENT_DEFS_DIR, relativePath);
    try {
        const bytes = await Deno.readFile(sourcePath);
        await Deno.mkdir(dirname(targetPath), { recursive: true });
        await Deno.writeFile(targetPath, bytes);
        return targetPath;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Bundled agent asset is missing: ${relativePath}. ${message}`);
    }
}
