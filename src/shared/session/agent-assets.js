/**
 * @module shared/session/agent-assets
 * Public, session-independent access to bundled agent prompt assets.
 */

import { dirname, join } from "@std/path";
import { AGENT_DEFS_DIR, HOME_DIR, SKILLS_DIR } from "../../constants.js";
import { directoryExists, fileExists } from "../helpers.js";

const BUNDLED_AGENT_DEFS_CACHE_DIR = HOME_DIR ? join(HOME_DIR, ".wld", "bundled-agent-definitions") : null;
const BUNDLED_SKILLS_CACHE_DIR = HOME_DIR ? join(HOME_DIR, ".wld", "bundled-skills") : null;

/** @type {Promise<string | null> | null} */
let extractionPromise = null;

/** @type {Promise<string | null> | null} */
let bundledSkillsExtractionPromise = null;

/** @type {Promise<string> | null} */
let pathPromise = null;

/** @param {string} sourceDir @param {string} destinationDir */
async function copyTreeFromBundle(sourceDir, destinationDir) {
    await Deno.mkdir(destinationDir, { recursive: true });
    const currentEntries = new Set();
    for await (const entry of Deno.readDir(sourceDir)) {
        currentEntries.add(entry.name);
        const sourcePath = join(sourceDir, entry.name);
        const destinationPath = join(destinationDir, entry.name);
        if (entry.isDirectory) {
            try {
                const destinationStat = await Deno.stat(destinationPath);
                if (!destinationStat.isDirectory) await Deno.remove(destinationPath, { recursive: true });
            } catch (error) {
                if (!(error instanceof Deno.errors.NotFound)) throw error;
            }
            await copyTreeFromBundle(sourcePath, destinationPath);
        } else if (entry.isFile) {
            try {
                const destinationStat = await Deno.stat(destinationPath);
                if (destinationStat.isDirectory) await Deno.remove(destinationPath, { recursive: true });
            } catch (error) {
                if (!(error instanceof Deno.errors.NotFound)) throw error;
            }
            await Deno.writeFile(destinationPath, await Deno.readFile(sourcePath));
        }
    }

    for await (const entry of Deno.readDir(destinationDir)) {
        if (currentEntries.has(entry.name)) continue;
        await Deno.remove(join(destinationDir, entry.name), { recursive: true });
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

/** @returns {Promise<string | null>} */
export function extractBundledSkills() {
    if (bundledSkillsExtractionPromise) return bundledSkillsExtractionPromise;
    bundledSkillsExtractionPromise = (async () => {
        if (!BUNDLED_SKILLS_CACHE_DIR || !(await directoryExists(SKILLS_DIR))) return null;
        try {
            await copyTreeFromBundle(SKILLS_DIR, BUNDLED_SKILLS_CACHE_DIR);
            return BUNDLED_SKILLS_CACHE_DIR;
        } catch {
            return null;
        }
    })();
    return bundledSkillsExtractionPromise;
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
