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

    const serverInfo = await Deno.stat(serverOutput);
    if (!serverInfo.isFile) throw new Error(`Workspace runtime server was not created: ${serverOutput}`);
}

if (import.meta.main) {
    await buildWorkspaceRuntime();
    console.log(`Workspace runtime prepared at ${DEFAULT_RUNTIME_DIR} from ${basename(DEFAULT_SERVER_ENTRY)}.`);
}
