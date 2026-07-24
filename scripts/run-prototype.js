#!/usr/bin/env -S deno run -A
/**
 * Launch local throwaway prototypes from the ignored prototypes/<slug>/ root.
 *
 * @module run-prototype
 */

import { join, normalize, relative, resolve } from "@std/path";

const SAFE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THROWAWAY_MARKER = ["THROWAWAY", "PROTOTYPE"].join(" ");

/** @param {string} slug */
export function isSafePrototypeSlug(slug) {
    return SAFE_SLUG_RE.test(slug);
}

/** @param {string} cwd @param {string} slug */
export function prototypeDir(cwd, slug) {
    return resolve(cwd, "prototypes", slug);
}

/** @param {string} cwd @param {string} path */
function repoRelative(cwd, path) {
    return normalize(relative(cwd, path)).replaceAll("\\", "/");
}

/**
 * @param {string} cwd
 * @param {string} slug
 * @returns {Promise<{ dir: string, configPath: string, relativeConfigPath: string }>}
 */
export async function validatePrototypeSetup(cwd, slug) {
    if (!isSafePrototypeSlug(slug)) {
        throw new Error("Prototype slug must be kebab-case: lowercase letters/numbers separated by single dashes.");
    }
    const dir = prototypeDir(cwd, slug);
    const relativeDir = repoRelative(cwd, dir);
    if (relativeDir.startsWith("..") || relativeDir === "") {
        throw new Error("Prototype slug resolved outside the project prototypes/ root.");
    }
    if (!(await isGitIgnored(cwd, relativeDir))) {
        throw new Error(`Prototype directory must be gitignored before use: ${relativeDir}/`);
    }
    let stat;
    try {
        stat = await Deno.stat(dir);
    } catch {
        throw new Error(`Prototype not found: ${relativeDir}/. Create it with README.md and deno.json first.`);
    }
    if (!stat.isDirectory) throw new Error(`Prototype path is not a directory: ${relativeDir}/`);

    const configPath = join(dir, "deno.json");
    let config;
    try {
        config = JSON.parse(await Deno.readTextFile(configPath));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Prototype ${relativeDir}/deno.json is missing or invalid: ${message}`);
    }
    if (!config || typeof config !== "object" || typeof config.tasks?.dev !== "string") {
        throw new Error(`Prototype ${relativeDir}/deno.json must define a local tasks.dev command.`);
    }
    return { dir, configPath, relativeConfigPath: repoRelative(cwd, configPath) };
}

/** @param {string} cwd @param {string} relativePath */
export async function isGitIgnored(cwd, relativePath) {
    const output = await new Deno.Command("git", {
        args: ["check-ignore", "-q", relativePath],
        cwd,
        stdout: "null",
        stderr: "null",
    }).output();
    return output.success;
}

/**
 * @param {{ cwd?: string, slug: string, spawn?: (command: string, options: Deno.CommandOptions) => { status: Promise<{ code: number }> } }} opts
 * @returns {Promise<number>}
 */
export async function runPrototype(opts) {
    const cwd = opts.cwd || Deno.cwd();
    const setup = await validatePrototypeSetup(cwd, opts.slug);
    const args = ["task", "-c", setup.relativeConfigPath, "dev"];
    const spawn = opts.spawn || ((command, options) => new Deno.Command(command, options).spawn());
    const child = spawn(Deno.execPath(), {
        args,
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    const status = await child.status;
    return status.code;
}

/**
 * @param {{ cwd?: string }} [opts]
 * @returns {Promise<string[]>}
 */
export async function findTrackedPrototypeArtifacts(opts = {}) {
    const cwd = opts.cwd || Deno.cwd();
    const output = await new Deno.Command("git", {
        args: ["ls-files", "-z"],
        cwd,
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (!output.success) throw new Error("Could not inspect tracked files for prototype artifacts.");
    const files = new TextDecoder().decode(output.stdout).split("\0").filter(Boolean);
    const violations = [];
    for (const file of files) {
        if (file.startsWith("prototypes/")) {
            violations.push(file);
            continue;
        }
        if (isAllowedPrototypeConventionFile(file)) continue;
        const basename = file.split("/").at(-1) || file;
        if (isPrototypeArtifactFilename(basename)) {
            violations.push(file);
            continue;
        }
        try {
            const text = await Deno.readTextFile(join(cwd, file));
            if (text.includes(THROWAWAY_MARKER)) violations.push(file);
        } catch {
            // Deleted paths are already leaving the tree; do not block the convention check on them.
        }
    }
    return violations;
}

/** @param {string} basename */
function isPrototypeArtifactFilename(basename) {
    return basename.includes(".prototype.") || /Prototype\./.test(basename);
}

/** @param {string} file */
function isAllowedPrototypeConventionFile(file) {
    const normalized = file.replaceAll("\\", "/");
    const basename = normalized.split("/").at(-1) || normalized;
    if (normalized.startsWith("src/skills/prototype/") && /\.mdx?$/i.test(basename)) return true;
    return /(^|\/)(?:__fixtures__|fixtures|testdata)(\/|$)/.test(normalized);
}

if (import.meta.main) {
    const [slug, ...extra] = Deno.args;
    if (!slug || extra.length > 0) {
        console.error("Usage: deno task prototype <kebab-case-slug>");
        Deno.exit(2);
    }
    try {
        Deno.exit(await runPrototype({ slug }));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        Deno.exit(1);
    }
}
