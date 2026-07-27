#!/usr/bin/env -S deno run --allow-read --allow-write=scripts/language-policy-baseline.json

const BASELINE_PATH = new URL("./language-policy-baseline.json", import.meta.url);
const SOURCE_ROOT = new URL("../src/", import.meta.url);
const GENERATED_AND_DEPENDENCY_DIRS = new Set([
    ".astro",
    ".vite",
    "_fresh",
    "coverage",
    "dist",
    "node_modules",
]);
const TEST_DIRS = new Set(["__fixtures__", "__tests__", "fixtures", "test-fixtures", "tests"]);
const TEST_FILE_PATTERN = /(?:^|[._-])(?:test|spec)(?:\.|$)|_test\./;
const PRODUCTION_JS_PATTERN = /\.[jm]?jsx?$/;
const EXCLUDED_PRODUCTION_PATHS = new Set(["src/shared/version.js"]);

/** @param {string} path */
function toPosixPath(path) {
    return path.replaceAll("\\", "/");
}

/** @param {string} path */
function isProductionJavaScriptPath(path) {
    const normalized = toPosixPath(path);
    if (!normalized.startsWith("src/")) return false;
    if (!PRODUCTION_JS_PATTERN.test(normalized)) return false;
    if (EXCLUDED_PRODUCTION_PATHS.has(normalized)) return false;

    const parts = normalized.split("/");
    const fileName = parts.at(-1) || "";
    if (TEST_FILE_PATTERN.test(fileName)) return false;
    return !parts.some((part) => TEST_DIRS.has(part) || GENERATED_AND_DEPENDENCY_DIRS.has(part));
}

/** @param {URL} [rootUrl] */
async function collectProductionJavaScriptFiles(rootUrl = SOURCE_ROOT) {
    /** @type {string[]} */
    const files = [];

    /**
     * @param {URL} directoryUrl
     * @param {string} relativeDirectory
     */
    async function walk(directoryUrl, relativeDirectory) {
        for await (const entry of Deno.readDir(directoryUrl)) {
            const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            if (entry.isDirectory) {
                if (GENERATED_AND_DEPENDENCY_DIRS.has(entry.name)) continue;
                await walk(new URL(`${entry.name}/`, directoryUrl), relativePath);
                continue;
            }
            if (!entry.isFile) continue;
            const policyPath = `src/${relativePath}`;
            if (isProductionJavaScriptPath(policyPath)) files.push(policyPath);
        }
    }

    await walk(rootUrl, "");
    files.sort();
    return files;
}

/** @returns {Promise<string[]>} */
async function readBaseline() {
    const parsed = JSON.parse(await Deno.readTextFile(BASELINE_PATH));
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
        throw new Error("language-policy-baseline.json must contain a JSON array of path strings");
    }
    return [...parsed].sort();
}

/**
 * @param {string[]} left
 * @param {string[]} right
 */
function difference(left, right) {
    const rightSet = new Set(right);
    return left.filter((entry) => !rightSet.has(entry));
}

/** @param {string[]} entries */
function formatList(entries) {
    return entries.map((entry) => `  - ${entry}`).join("\n");
}

if (import.meta.main) {
    const update = Deno.args.includes("--update");
    const currentFiles = await collectProductionJavaScriptFiles();
    if (update) {
        await Deno.writeTextFile(BASELINE_PATH, `${JSON.stringify(currentFiles, null, 4)}\n`);
        console.log("Updated scripts/language-policy-baseline.json.");
        Deno.exit(0);
    }
    const baselineFiles = await readBaseline();
    const newFiles = difference(currentFiles, baselineFiles);
    const staleFiles = difference(baselineFiles, currentFiles);

    if (newFiles.length || staleFiles.length) {
        const sections = [];
        if (newFiles.length) {
            sections.push(
                `New production JS files (use .ts/.tsx or intentionally update the policy):\n${formatList(newFiles)}`,
            );
        }
        if (staleFiles.length) {
            sections.push(
                `Stale baseline entries (remove migrated/deleted paths from the baseline):\n${formatList(staleFiles)}`,
            );
        }
        console.error(sections.join("\n\n"));
        Deno.exit(1);
    }

    console.log("Language policy baseline matches current production JS/JSX files.");
}

export { collectProductionJavaScriptFiles, isProductionJavaScriptPath };
