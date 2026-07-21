/**
 * Build opaque Workspace assets for the standalone RunWield executable.
 *
 * Astro's server output is collapsed into one self-contained module. Browser
 * JavaScript receives an `.asset` suffix so `deno compile --include` embeds it
 * as passive data instead of treating hundreds of chunks as graph roots.
 */

import { basename, dirname, extname, join } from "@std/path";

const DEFAULT_SERVER_ENTRY = "dist/workspace/server/entry.mjs";
const DEFAULT_CLIENT_DIR = "dist/workspace/client";
const DEFAULT_RUNTIME_DIR = "dist/workspace-runtime";

/**
 * @typedef {Object} WorkspaceRuntimeBuildOptions
 * @property {string} [serverEntry]
 * @property {string} [clientDir]
 * @property {string} [runtimeDir]
 * @property {(command: string, args: string[]) => Promise<void>} [run]
 */

/**
 * Return the stored filename for a passive browser asset.
 *
 * @param {string} name
 * @returns {string}
 */
export function getOpaqueWorkspaceAssetName(name) {
    return [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(extname(name).toLowerCase())
        ? `${name}.asset`
        : name;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function runCommand(command, args) {
    const result = await new Deno.Command(command, {
        args,
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (result.success) return;

    const decoder = new TextDecoder();
    const output = `${decoder.decode(result.stdout)}\n${decoder.decode(result.stderr)}`.trim();
    throw new Error(output || `${command} failed with exit code ${result.code}`);
}

/**
 * @param {string} sourceDir
 * @param {string} destinationDir
 * @returns {Promise<void>}
 */
async function copyOpaqueAssets(sourceDir, destinationDir) {
    await Deno.mkdir(destinationDir, { recursive: true });
    for await (const entry of Deno.readDir(sourceDir)) {
        const sourcePath = join(sourceDir, entry.name);
        const destinationPath = join(destinationDir, getOpaqueWorkspaceAssetName(entry.name));
        if (entry.isDirectory) {
            await copyOpaqueAssets(sourcePath, destinationPath);
            continue;
        }
        if (!entry.isFile) {
            throw new Error(`Unsupported Workspace asset entry: ${sourcePath}`);
        }
        await Deno.copyFile(sourcePath, destinationPath);
    }
}

/**
 * Astro 7 can leave the Deno adapter shim import in entry.mjs. Replace it with
 * direct JSR imports before bundling so Deno does not type-strip node_modules.
 *
 * @param {string} serverEntry
 * @returns {Promise<void>}
 */
async function replaceDenoAdapterShim(serverEntry) {
    const shimImports = [
        'import { fromFileUrl, serveFile } from "@deno/astro-adapter/__deno_imports.ts";',
        'import { serveFile, fromFileUrl } from "@deno/astro-adapter/__deno_imports.ts";',
        "import { fromFileUrl, serveFile } from '@deno/astro-adapter/__deno_imports.ts';",
        "import { serveFile, fromFileUrl } from '@deno/astro-adapter/__deno_imports.ts';",
    ];
    const replacement =
        'import { serveFile } from "jsr:@std/http@1.0/file-server";\nimport { fromFileUrl } from "jsr:@std/path@1.0";';
    const source = await Deno.readTextFile(serverEntry);
    const next = shimImports.reduce((text, shim) => text.replace(shim, replacement), source);
    if (next !== source) await Deno.writeTextFile(serverEntry, next);
}

/**
 * Return static relative imports from an Astro server entrypoint. JSDoc type
 * imports are intentionally ignored because they are erased at runtime.
 *
 * @param {string} source
 * @param {string} entryDir
 * @returns {string[]}
 */
export function getServerEntryImportPaths(source, entryDir) {
    const importPaths = [];
    for (const line of source.split("\n")) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("//")) continue;

        const staticMatch = trimmed.match(/^import(?:\s+[^'";]+?\s+from\s+|\s*)['"](\.\.?\/[^'"]+)['"]/);
        if (staticMatch) {
            importPaths.push(join(entryDir, staticMatch[1]));
            continue;
        }

        const dynamicMatch = trimmed.match(/\bimport\(['"](\.\.?\/[^'"]+)['"]\)/);
        if (dynamicMatch) importPaths.push(join(entryDir, dynamicMatch[1]));
    }
    return importPaths;
}

/**
 * Replace the Deno adapter shim with concrete JSR imports before bundling.
 * @deno/astro-adapter patches server chunks, but recent Astro/Vite output can
 * place the shim in the entrypoint itself.
 *
 * @param {string} source
 * @returns {string}
 */
export function normalizeDenoAdapterShimImport(source) {
    return source.replace(
        /^import\s+\{\s*fromFileUrl\s*,\s*serveFile\s*\}\s+from\s+["']@deno\/astro-adapter\/__deno_imports\.ts["'];$/m,
        'import { serveFile } from "jsr:@std/http@1.0/file-server";\nimport { fromFileUrl } from "jsr:@std/path@1.0";',
    ).replace(
        /^import\s+\{\s*serveFile\s*,\s*fromFileUrl\s*\}\s+from\s+["']@deno\/astro-adapter\/__deno_imports\.ts["'];$/m,
        'import { serveFile } from "jsr:@std/http@1.0/file-server";\nimport { fromFileUrl } from "jsr:@std/path@1.0";',
    );
}

/**
 * Astro can return before all generated server chunks are immediately visible to
 * a follow-up subprocess on every filesystem. Wait for entrypoint imports before
 * invoking `deno bundle`, so release builds do not race the server output.
 */
/** @param {string} serverEntry */
async function patchDenoAdapterShimImport(serverEntry) {
    const source = await Deno.readTextFile(serverEntry);
    const patched = source.replace(
        'import { fromFileUrl, serveFile } from "@deno/astro-adapter/__deno_imports.ts";',
        'import { fromFileUrl } from "@std/path";\nimport { serveFile } from "jsr:@std/http@1.0/file-server";',
    );
    if (patched !== source) await Deno.writeTextFile(serverEntry, patched);
}

/**
 * @param {string} serverEntry
 * @returns {Promise<void>}
 */
async function waitForServerEntryImports(serverEntry) {
    const entryDir = dirname(serverEntry);
    const source = await Deno.readTextFile(serverEntry);
    const importPaths = Array.from(
        source.matchAll(
            /(?:^|[\n;])\s*(?:import\s+[^'";]+?\s+from\s+|export\s+[^'";]+?\s+from\s+|import\s*)['"](\.\.?\/[^'"]+)['"]/g,
        ),
        (match) => join(entryDir, match[1]),
    );
    const deadline = Date.now() + 5000;
    while (true) {
        const source = normalizeDenoAdapterShimImport(await Deno.readTextFile(serverEntry));
        await Deno.writeTextFile(serverEntry, source);
        const missing = [];
        for (const path of getServerEntryImportPaths(source, entryDir)) {
            const stat = await Deno.stat(path).catch((error) => {
                if (error instanceof Deno.errors.NotFound) return null;
                throw error;
            });
            if (!stat?.isFile) missing.push(path);
        }
        if (missing.length === 0) return;
        if (Date.now() >= deadline) {
            throw new Error(`Workspace server imports are missing: ${missing.join(", ")}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

/**
 * @param {string} path
 * @returns {Promise<Deno.FileInfo>}
 */
async function waitForFile(path) {
    const deadline = Date.now() + 5000;
    while (true) {
        const stat = await Deno.stat(path).catch((error) => {
            if (error instanceof Deno.errors.NotFound) return null;
            throw error;
        });
        if (stat?.isFile) return stat;
        if (Date.now() >= deadline) throw new Error(`Workspace runtime server was not created: ${path}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

/**
 * @param {WorkspaceRuntimeBuildOptions} [options]
 * @returns {Promise<void>}
 */
export async function buildWorkspaceRuntime(options = {}) {
    const serverEntry = options.serverEntry || DEFAULT_SERVER_ENTRY;
    const clientDir = options.clientDir || DEFAULT_CLIENT_DIR;
    const runtimeDir = options.runtimeDir || DEFAULT_RUNTIME_DIR;
    const run = options.run || runCommand;
    const serverOutput = join(runtimeDir, "server.mjs");

    await Deno.remove(runtimeDir, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
    await Deno.mkdir(dirname(serverOutput), { recursive: true });

    await replaceDenoAdapterShim(serverEntry);
    await patchDenoAdapterShimImport(serverEntry);
    await waitForServerEntryImports(serverEntry);
    await run("deno", [
        "bundle",
        "--platform",
        "deno",
        "--packages",
        "bundle",
        "--minify",
        "--output",
        serverOutput,
        serverEntry,
    ]);
    await copyOpaqueAssets(clientDir, join(runtimeDir, "client"));

    await waitForFile(serverOutput);
}

if (import.meta.main) {
    await buildWorkspaceRuntime();
    console.log(`Workspace runtime prepared at ${DEFAULT_RUNTIME_DIR} from ${basename(DEFAULT_SERVER_ENTRY)}.`);
}
