/**
 * The set of first-party source files, for tools that need to see all of them.
 *
 * Shared so the type checker and any future whole-tree tool agree on what "all our
 * source" means, rather than each carrying its own glob that can drift.
 */

const SOURCE_ROOTS = ["src", "scripts"];

/**
 * Directories that are not ours to check: vendored code, build output, and caches.
 *
 * `src/ui/workspace` is excluded because it is an Astro project with its own
 * `deno task workspace:check`, which understands `.astro` files and its own tsconfig.
 */
const SKIP_DIRS = new Set([
    ".astro",
    ".vite",
    "_fresh",
    "coverage",
    "dist",
    "node_modules",
]);

const SKIP_PATHS = new Set(["src/ui/workspace"]);

const SOURCE_FILE_PATTERN = /\.(?:jsx?|tsx?|mjs|mts)$/;

/**
 * Every first-party source file, sorted for stable output.
 *
 * @param {string[]} [roots]
 * @returns {Promise<string[]>}
 */
export async function walkSourceFiles(roots = SOURCE_ROOTS) {
    /** @type {string[]} */
    const files = [];

    /** @param {string} directory */
    async function walk(directory) {
        for await (const entry of Deno.readDir(directory)) {
            const path = `${directory}/${entry.name}`;
            if (entry.isDirectory) {
                if (SKIP_DIRS.has(entry.name) || SKIP_PATHS.has(path)) continue;
                await walk(path);
                continue;
            }
            if (!entry.isFile) continue;
            if (SOURCE_FILE_PATTERN.test(entry.name)) files.push(path);
        }
    }

    for (const root of roots) await walk(root);
    return files.sort();
}
