/**
 * @module shared/workflow/task-scheduling
 * Legacy PROJECT task table parsing, validation, and safe launch selection.
 *
 * Retained for tests and possible future multi-role FEATURE orchestration. New
 * Epic decomposition uses child FEATURE plans instead of task tables.
 */

// @ts-ignore — quikdown/ast .d.ts uses export= but ESM runtime has default export
import quikdownAst from "quikdown/ast";
import { AGENTS } from "../../constants.js";

/**
 * Flatten a quikdown inline-node array into a plain string. Preserves text and
 * inline code; ignores formatting wrappers we don't care about for tasks.
 *
 * @param {Array<{ type: string, value?: string, children?: any[] }>} nodes
 * @returns {string}
 */
function inlineNodesToText(nodes) {
    if (!Array.isArray(nodes)) return "";
    return nodes.map((n) => {
        if (typeof n?.value === "string") return n.value;
        if (Array.isArray(n?.children)) return inlineNodesToText(n.children);
        return "";
    }).join("").trim();
}

/**
 * Parse the PROJECT Tasks table from a plan's markdown using a forgiving AST
 * parser. The plan must contain a `## Tasks` heading followed by a table with
 * columns: Task | Assignee | Dependencies | Write Scope | Description.
 *
 * @param {string} planContent
 * @returns {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope: string }>}
 * @throws {Error} If a Tasks section + table can't be located or parsed.
 */
export function extractTasks(planContent) {
    /** @type {{ type: string, children?: any[], level?: number, headers?: any[][], rows?: any[][][] }} */
    const ast = quikdownAst(planContent);
    const children = Array.isArray(ast.children) ? ast.children : [];

    let tasksHeadingIdx = -1;
    for (let i = 0; i < children.length; i++) {
        const n = children[i];
        if (n.type === "heading" && /^tasks$/i.test(inlineNodesToText(n.children || []))) {
            tasksHeadingIdx = i;
            break;
        }
    }

    if (tasksHeadingIdx === -1) {
        throw new Error(
            "Tasks section not found. PROJECT plans must include a '## Tasks' heading followed by a markdown table.",
        );
    }

    /** @type {{ type: string, headers?: any[][], rows?: any[][][] } | null} */
    let tableNode = null;
    for (let i = tasksHeadingIdx + 1; i < children.length; i++) {
        const n = children[i];
        if (n.type === "table") {
            tableNode = n;
            break;
        }
        if (n.type === "heading") break;
    }

    if (!tableNode || !Array.isArray(tableNode.rows)) {
        throw new Error("Tasks section found but no markdown table follows the heading.");
    }

    const headers = Array.isArray(tableNode.headers)
        ? tableNode.headers.map((header) => inlineNodesToText(header).toLowerCase().replace(/[^a-z]/g, ""))
        : [];
    const findHeader = (/** @type {string[]} */ names, /** @type {number} */ fallback) => {
        for (const name of names) {
            const idx = headers.indexOf(name);
            if (idx !== -1) return idx;
        }
        return fallback;
    };
    const taskIdx = findHeader(["task", "id"], 0);
    const assigneeIdx = findHeader(["assignee"], 1);
    const dependenciesIdx = findHeader(["dependencies", "deps"], 2);
    const writeScopeIdx = findHeader(["writescope", "writescopepaths", "paths", "files", "scope"], -1);
    const descriptionIdx = findHeader(["description"], writeScopeIdx === -1 ? 3 : 4);

    const tasks = [];
    for (const row of tableNode.rows) {
        if (!Array.isArray(row) || row.length < 4) continue;
        const taskCell = inlineNodesToText(row[taskIdx]);
        const taskId = parseInt(taskCell, 10);
        if (Number.isNaN(taskId)) continue;
        tasks.push({
            task: taskId,
            assignee: inlineNodesToText(row[assigneeIdx]),
            dependencies: inlineNodesToText(row[dependenciesIdx]),
            writeScope: writeScopeIdx === -1 ? "unknown" : inlineNodesToText(row[writeScopeIdx]),
            description: inlineNodesToText(row[descriptionIdx]),
        });
    }

    if (tasks.length === 0) {
        throw new Error("Tasks table found but contains no valid task rows.");
    }

    return tasks;
}

const PROJECT_TASK_ASSIGNEES = new Set([AGENTS.ENGINEER, AGENTS.TESTER, AGENTS.DOC_WRITER]);
const BROAD_WRITE_SCOPES = new Set(["*", "**", "all", "repo", "repository", "unknown", "tbd", "any"]);
const NO_WRITE_SCOPES = new Set(["none", "no", "readonly", "read-only", "n/a", "na"]);

/**
 * @param {string} dependencies
 * @returns {number[]}
 */
export function parseTaskDependencies(dependencies) {
    return (dependencies || "").split(",").map((dependency) => dependency.trim()).filter((dependency) =>
        dependency && dependency.toLowerCase() !== "none"
    ).map((dependency) => {
        const depId = Number.parseInt(dependency, 10);
        if (!/^\d+$/.test(dependency) || Number.isNaN(depId)) {
            throw new Error(`Task dependency "${dependency}" is not a numeric task ID.`);
        }
        return depId;
    });
}

/**
 * Parse a task write scope into normalized path-ish tokens. Missing or unknown
 * scope is intentionally broad so the scheduler serializes it conservatively.
 *
 * @param {string | undefined} writeScope
 * @returns {{ broad: boolean, paths: string[] }}
 */
export function parseTaskWriteScope(writeScope) {
    const raw = String(writeScope || "").trim();
    if (!raw) return { broad: true, paths: [] };

    const parts = raw.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return { broad: true, paths: [] };

    /** @type {string[]} */
    const paths = [];
    for (const part of parts) {
        const normalized = part.replace(/^`|`$/g, "").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
        if (!normalized) continue;
        if (NO_WRITE_SCOPES.has(normalized)) continue;
        if (BROAD_WRITE_SCOPES.has(normalized) || normalized.includes("*")) {
            return { broad: true, paths: [] };
        }
        paths.push(normalized);
    }

    return { broad: false, paths };
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function pathsOverlap(a, b) {
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * @param {{ writeScope?: string }} a
 * @param {{ writeScope?: string }} b
 * @returns {boolean}
 */
export function taskWriteScopesOverlap(a, b) {
    const aScope = parseTaskWriteScope(a.writeScope);
    const bScope = parseTaskWriteScope(b.writeScope);
    if (aScope.paths.length === 0 && !aScope.broad) return false;
    if (bScope.paths.length === 0 && !bScope.broad) return false;
    if (aScope.broad || bScope.broad) return true;

    return aScope.paths.some((aPath) => bScope.paths.some((bPath) => pathsOverlap(aPath, bPath)));
}

/**
 * Select tasks that are dependency-ready and safe to launch together in the
 * shared worktree. The DAG controls semantic readiness; write scope controls
 * concurrent launch safety.
 *
 * @template {{ task: number, writeScope?: string }} T
 * @param {T[]} readyTasks
 * @param {T[]} runningTasks
 * @param {number} maxToLaunch
 * @returns {T[]}
 */
export function selectNonConflictingTasks(readyTasks, runningTasks, maxToLaunch) {
    /** @type {T[]} */
    const selected = [];
    for (const task of readyTasks) {
        if (selected.length >= maxToLaunch) break;
        const conflictsWithRunning = runningTasks.some((runningTask) => taskWriteScopesOverlap(task, runningTask));
        const conflictsWithSelected = selected.some((selectedTask) => taskWriteScopesOverlap(task, selectedTask));
        if (conflictsWithRunning || conflictsWithSelected) continue;
        selected.push(task);
    }
    return selected;
}

/**
 * Validate the PROJECT task graph contract before showing or executing tasks.
 *
 * @param {Array<{ task: number, assignee: string, dependencies: string, description: string, writeScope?: string }>} tasks
 * @returns {void}
 */
export function validateProjectTasks(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
        throw new Error("PROJECT plans must include at least one task.");
    }

    const ids = new Set();
    for (const task of tasks) {
        if (!Number.isInteger(task.task) || task.task <= 0) {
            throw new Error(`Task ID "${task.task}" must be a positive integer.`);
        }
        if (ids.has(task.task)) {
            throw new Error(`Duplicate task ID ${task.task}.`);
        }
        ids.add(task.task);

        if (!PROJECT_TASK_ASSIGNEES.has(task.assignee)) {
            throw new Error(
                `Task ${task.task} has invalid assignee "${task.assignee}". ` +
                    "Allowed assignees are engineer, tester, and doc-writer.",
            );
        }
    }

    /** @type {Map<number, number[]>} */
    const dependencyMap = new Map();
    for (const task of tasks) {
        const dependencies = parseTaskDependencies(task.dependencies);
        dependencyMap.set(task.task, dependencies);
        for (const depId of dependencies) {
            if (!ids.has(depId)) {
                throw new Error(`Task ${task.task} depends on unknown task ${depId}.`);
            }
            if (depId === task.task) {
                throw new Error(`Task ${task.task} cannot depend on itself.`);
            }
        }
    }

    /** @type {Set<number>} */
    const visiting = new Set();
    /** @type {Set<number>} */
    const visited = new Set();
    /**
     * @param {number} taskId
     */
    function visit(taskId) {
        if (visited.has(taskId)) return;
        if (visiting.has(taskId)) {
            throw new Error(`Task dependency graph contains a cycle at task ${taskId}.`);
        }
        visiting.add(taskId);
        for (const depId of dependencyMap.get(taskId) || []) visit(depId);
        visiting.delete(taskId);
        visited.add(taskId);
    }
    for (const task of tasks) visit(task.task);

    const finalTask = tasks[tasks.length - 1];
    if (finalTask.assignee !== AGENTS.TESTER) {
        throw new Error("The final PROJECT task must be assigned to tester as the Integration Point.");
    }
    if (!/integration\s+point/i.test(finalTask.description || "")) {
        throw new Error("The final tester task description must identify the task as the Integration Point.");
    }

    const finalDependencies = new Set(dependencyMap.get(finalTask.task) || []);
    const priorTaskIds = tasks.slice(0, -1).map((task) => task.task);
    for (const taskId of priorTaskIds) {
        if (!finalDependencies.has(taskId)) {
            throw new Error(`The Integration Point must depend on prior task ${taskId}.`);
        }
    }
}
