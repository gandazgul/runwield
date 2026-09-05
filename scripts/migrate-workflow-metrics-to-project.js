/**
 * @module scripts/migrate-workflow-metrics-to-project
 *
 * Merge old per-worktree workflow metrics files into the primary project file.
 */

import { parseArgs } from "@std/cli/parse-args";
import { basename, dirname, join, relative } from "@std/path";
import { createHash } from "node:crypto";
import { getHomeDir, RUNWIELD_DIR_NAME } from "../src/constants.js";
import { resolvePrimaryCheckoutRoot } from "../src/shared/primary-checkout.ts";
import { getWorkflowMetricsFilePath } from "../src/shared/workflow/metrics.js";

const METRICS_DIR_NAME = "workflow-metrics";

/**
 * Encode roots the same way persisted sessions and workflow metrics do.
 *
 * @param {string} root
 * @returns {string}
 */
function encodeMetricsRoot(root) {
    const encoded = `--${root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    if (encoded.length <= 120) return encoded;
    const digest = createHash("sha256").update(root).digest("hex").slice(0, 32);
    const readableTail = basename(root).replace(/[/\\:]/g, "-").slice(0, 40) || "root";
    return `--${readableTail}-${digest}--`;
}

/**
 * @typedef {Object} WorkflowMetricsMigrationResult
 * @property {string} projectRoot
 * @property {string} outputPath
 * @property {number} sourceFiles
 * @property {number} existingRecords
 * @property {number} addedRecords
 * @property {number} duplicateRecords
 * @property {number} invalidRecords
 * @property {number} movedFilesDeleted
 * @property {number} emptyFoldersDeleted
 * @property {boolean} dryRun
 * @property {boolean} deleteMoved
 */

/**
 * @param {string} root
 * @returns {string}
 */
function getHistoricalMetricsFilePath(root) {
    const homeDir = getHomeDir() || "~";
    return join(homeDir, RUNWIELD_DIR_NAME, METRICS_DIR_NAME, encodeMetricsRoot(root), "metrics.jsonl");
}

/**
 * @param {string} root
 * @returns {string}
 */
function encodedChildRootPrefix(root) {
    return `${encodeMetricsRoot(root).slice(0, -2)}-`;
}

/**
 * @param {string} projectRoot
 * @returns {Promise<string[]>}
 */
async function findHistoricalProjectMetricFiles(projectRoot) {
    const homeDir = getHomeDir() || "~";
    const metricsBaseDir = join(homeDir, RUNWIELD_DIR_NAME, METRICS_DIR_NAME);
    const worktreeBaseRoot = join(homeDir, RUNWIELD_DIR_NAME, "worktrees", encodeMetricsRoot(projectRoot));
    const projectName = basename(projectRoot).replace(/[/\\:]/g, "-");
    const prefixes = [
        encodedChildRootPrefix(worktreeBaseRoot),
        encodedChildRootPrefix(join(projectRoot, RUNWIELD_DIR_NAME)),
        `--${projectName}-`,
    ];
    /** @type {string[]} */
    const files = [];
    try {
        for await (const entry of Deno.readDir(metricsBaseDir)) {
            if (!entry.isDirectory) continue;
            if (!prefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
            files.push(join(metricsBaseDir, entry.name, "metrics.jsonl"));
        }
    } catch (error) {
        if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.NotADirectory) return [];
        throw error;
    }
    return files;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function gitOutput(cwd, args) {
    const command = new Deno.Command("git", {
        cwd,
        args,
        stdout: "piped",
        stderr: "piped",
    });
    const output = await command.output();
    if (!output.success) return "";
    return new TextDecoder().decode(output.stdout);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function parseWorktreeListPorcelain(text) {
    const roots = [];
    for (const line of text.split("\n")) {
        if (line.startsWith("worktree ")) roots.push(line.slice("worktree ".length));
    }
    return roots;
}

/**
 * @param {string} projectRoot
 * @returns {Promise<string[]>}
 */
export async function listGitWorktreeRoots(projectRoot) {
    const output = await gitOutput(projectRoot, ["worktree", "list", "--porcelain"]);
    return parseWorktreeListPorcelain(output);
}

/**
 * @param {string} path
 * @returns {Promise<string[]>}
 */
async function readExistingLines(path) {
    try {
        const text = await Deno.readTextFile(path);
        return text.split("\n").map((line) => line.trim()).filter(Boolean);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.NotADirectory) return [];
        throw error;
    }
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isJsonLine(line) {
    try {
        JSON.parse(line);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function realPathOrNull(path) {
    try {
        return await Deno.realPath(path);
    } catch {
        return null;
    }
}

/**
 * @param {string[]} roots
 * @returns {Promise<string[]>}
 */
async function addRealPathVariants(roots) {
    const result = [];
    for (const root of roots) {
        result.push(root);
        const realRoot = await realPathOrNull(root);
        if (realRoot) result.push(realRoot);
    }
    return [...new Set(result)];
}

/**
 * @param {string} root
 * @param {string} realProjectRoot
 * @param {string} requestedProjectRoot
 * @returns {string | null}
 */
function toRequestedPathAlias(root, realProjectRoot, requestedProjectRoot) {
    const realParent = dirname(realProjectRoot);
    const requestedParent = dirname(requestedProjectRoot);
    const suffix = relative(realParent, root);
    if (suffix.startsWith("..")) return null;
    return join(requestedParent, suffix);
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function deleteFileAndEmptyParent(path) {
    await Deno.remove(path);
    try {
        await Deno.remove(dirname(path));
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {{ projectRoot?: string, dryRun?: boolean, deleteMoved?: boolean }} [options]
 * @returns {Promise<WorkflowMetricsMigrationResult>}
 */
export async function migrateWorkflowMetricsToProject(options = {}) {
    const requestedRoot = options.projectRoot || Deno.cwd();
    const projectRoot = resolvePrimaryCheckoutRoot(requestedRoot);
    const outputPath = getWorkflowMetricsFilePath(projectRoot);
    const worktreeRoots = await listGitWorktreeRoots(projectRoot);
    const realProjectRoot = await realPathOrNull(projectRoot);
    /** @type {string[]} */
    const aliasRoots = [];
    if (realProjectRoot) {
        for (const root of worktreeRoots) {
            const aliasRoot = toRequestedPathAlias(root, realProjectRoot, projectRoot);
            if (aliasRoot) aliasRoots.push(aliasRoot);
        }
    }
    const candidateRoots = await addRealPathVariants([projectRoot, requestedRoot, ...worktreeRoots, ...aliasRoots]);
    const historicalProjectFiles = await findHistoricalProjectMetricFiles(projectRoot);
    const candidateFiles = [
        ...new Set([...candidateRoots.map(getHistoricalMetricsFilePath), ...historicalProjectFiles]),
    ]
        .filter((path) => path !== outputPath);

    const outputLines = await readExistingLines(outputPath);
    const seen = new Set(outputLines);
    const merged = [...outputLines];
    const existingRecords = outputLines.length;
    let addedRecords = 0;
    let duplicateRecords = 0;
    let invalidRecords = 0;
    let sourceFiles = 0;
    /** @type {string[]} */
    const movedSourceFiles = [];

    for (const path of candidateFiles) {
        const lines = await readExistingLines(path);
        if (lines.length === 0) continue;
        sourceFiles++;
        let invalidRecordsInFile = 0;
        for (const line of lines) {
            if (!isJsonLine(line)) {
                invalidRecords++;
                invalidRecordsInFile++;
                continue;
            }
            if (seen.has(line)) {
                duplicateRecords++;
                continue;
            }
            seen.add(line);
            merged.push(line);
            addedRecords++;
        }
        if (invalidRecordsInFile === 0) movedSourceFiles.push(path);
    }

    if (!options.dryRun && addedRecords > 0) {
        await Deno.mkdir(dirname(outputPath), { recursive: true });
        await Deno.writeTextFile(outputPath, `${merged.join("\n")}\n`);
    }

    let movedFilesDeleted = 0;
    let emptyFoldersDeleted = 0;
    if (options.deleteMoved && !options.dryRun) {
        for (const path of movedSourceFiles) {
            const parentRemoved = await deleteFileAndEmptyParent(path);
            movedFilesDeleted++;
            if (parentRemoved) emptyFoldersDeleted++;
        }
    }

    return {
        projectRoot,
        outputPath,
        sourceFiles,
        existingRecords,
        addedRecords,
        duplicateRecords,
        invalidRecords,
        movedFilesDeleted,
        emptyFoldersDeleted,
        dryRun: options.dryRun === true,
        deleteMoved: options.deleteMoved === true,
    };
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
    const args = parseArgs(argv, {
        string: ["project-root"],
        boolean: ["help", "dry-run", "delete-moved"],
        alias: { h: "help" },
    });

    if (args.help) {
        console.log([
            "Usage: deno run -A scripts/migrate-workflow-metrics-to-project.js [options]",
            "",
            "Options:",
            "  --project-root <path>  Project or linked worktree path (default: current directory)",
            "  --dry-run              Count records without writing or deleting",
            "  --delete-moved         Delete source files whose valid records are in the project file",
        ].join("\n"));
        return;
    }

    const result = await migrateWorkflowMetricsToProject({
        projectRoot: args["project-root"] || Deno.cwd(),
        dryRun: args["dry-run"] === true,
        deleteMoved: args["delete-moved"] === true,
    });
    console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
    await main(Deno.args);
}
