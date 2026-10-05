/**
 * @module shared/session/agent-assets
 * Public, session-independent access to bundled agent prompt assets.
 */

import { dirname, join } from "@std/path";
import { AGENT_DEFS_DIR, getHomeDir, SKILLS_DIR } from "../../constants.js";
import { directoryExists, fileExists } from "../helpers.ts";

function bundledAgentDefsCacheDir(): string | null {
    const homeDir = getHomeDir();
    return homeDir ? join(homeDir, ".wld", "bundled-agent-definitions") : null;
}

function bundledSkillsCacheDir(): string | null {
    const homeDir = getHomeDir();
    return homeDir ? join(homeDir, ".wld", "bundled-skills") : null;
}

let extractionPromise: Promise<string | null> | null = null;

let bundledSkillsExtractionPromise: Promise<string | null> | null = null;

let pathPromise: Promise<string> | null = null;

async function copyTreeFromBundle(sourceDir: string, destinationDir: string): Promise<void> {
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

export function extractBundledAgentDefs(): Promise<string | null> {
    if (extractionPromise) return extractionPromise;
    extractionPromise = (async () => {
        const cacheDir = bundledAgentDefsCacheDir();
        if (!cacheDir || !(await directoryExists(AGENT_DEFS_DIR))) return null;
        try {
            await copyTreeFromBundle(AGENT_DEFS_DIR, cacheDir);
            return cacheDir;
        } catch {
            return null;
        }
    })();
    return extractionPromise;
}

export function extractBundledSkills(): Promise<string | null> {
    if (bundledSkillsExtractionPromise) return bundledSkillsExtractionPromise;
    bundledSkillsExtractionPromise = (async () => {
        const cacheDir = bundledSkillsCacheDir();
        if (!cacheDir || !(await directoryExists(SKILLS_DIR))) return null;
        try {
            await copyTreeFromBundle(SKILLS_DIR, cacheDir);
            return cacheDir;
        } catch {
            return null;
        }
    })();
    return bundledSkillsExtractionPromise;
}

export function getBundledAgentDefsPath(): Promise<string> {
    if (!pathPromise) {
        pathPromise = extractBundledAgentDefs().then((extracted) => extracted ?? AGENT_DEFS_DIR);
    }
    return pathPromise;
}

function delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function ensureBundledAgentDefFile(relativePath: string): Promise<string> {
    const sourcePath = join(AGENT_DEFS_DIR, relativePath);
    if (await fileExists(sourcePath)) return sourcePath;

    const bundledDir = await getBundledAgentDefsPath();
    const targetPath = join(bundledDir, relativePath);
    if (await fileExists(targetPath)) return targetPath;

    let lastError: Error | string | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const bytes = await Deno.readFile(sourcePath);
            await Deno.mkdir(dirname(targetPath), { recursive: true });
            await Deno.writeFile(targetPath, bytes);
            return targetPath;
        } catch (error) {
            if (await fileExists(targetPath)) return targetPath;
            lastError = error instanceof Error ? error : String(error);
            if (!(error instanceof Deno.errors.NotFound || error instanceof Deno.errors.AlreadyExists)) break;
            await delay(20 * (attempt + 1));
        }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Bundled agent asset is missing: ${relativePath}. ${message}`);
}
