/**
 * @module plan-store
 * Manages plan persistence: front matter injection, save/load/list, and
 * resumption of saved or external plans.
 *
 * Plans live in `<project root>/plans/` as markdown files with YAML front matter.
 * The plan "id" is the filename without .md.
 * External plans (missing front matter) get sensible defaults applied.
 */

import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { join, basename, resolve } from "@std/path";
import { PLANS_DIR_NAME } from "./constants.js";

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Get the plans directory path for the current project.
 * @param {string} cwd - Project root
 * @returns {string}
 */
export function getPlansDir(cwd) {
    return join(cwd, PLANS_DIR_NAME);
}

/**
 * Ensure the plans directory exists.
 * @param {string} cwd
 * @returns {Promise<string>} The plans directory path
 */
export async function ensurePlansDir(cwd) {
    const dir = getPlansDir(cwd);
    try {
        await Deno.mkdir(dir, { recursive: true });
    } catch {
        // already exists, fine
    }
    return dir;
}

// ─── Front Matter ─────────────────────────────────────────────────────

/**
 * @typedef {Object} PlanFrontMatter
 * @property {string} classification - QUICK_FIX | FEATURE | PROJECT
 * @property {string} complexity - LOW | MEDIUM | HIGH
 * @property {string} summary - Brief description of what the plan addresses
 * @property {string[]} affectedPaths - Files that will be created/modified
 * @property {string} createdAt - ISO timestamp
 * @property {string} [updatedAt] - ISO timestamp (set on revision)
 * @property {string} status - draft | in_review | approved | denied
 * @property {string} [origin] - Where the plan came from (harness, external, etc.)
 */

/**
 * Default front matter for external plans that lack it.
 * @type {PlanFrontMatter}
 */
const DEFAULT_FRONT_MATTER = {
    classification: "FEATURE",
    complexity: "MEDIUM",
    summary: "",
    affectedPaths: [],
    createdAt: new Date().toISOString(),
    status: "draft",
    origin: "external",
};

/**
 * Build YAML front matter string from a PlanFrontMatter object.
 * @param {PlanFrontMatter} fm
 * @returns {string}
 */
function formatFrontMatter(fm) {
    const lines = ["---"];
    lines.push(`classification: "${fm.classification}"`);
    lines.push(`complexity: "${fm.complexity}"`);
    lines.push(`summary: "${fm.summary.replace(/"/g, '\\"')}"`);
    lines.push(`affectedPaths:`);
    if (fm.affectedPaths.length === 0) {
        lines.push(`  []`);
    } else {
        for (const p of fm.affectedPaths) {
            lines.push(`  - "${p}"`);
        }
    }
    lines.push(`createdAt: "${fm.createdAt}"`);
    if (fm.updatedAt) lines.push(`updatedAt: "${fm.updatedAt}"`);
    lines.push(`status: "${fm.status}"`);
    if (fm.origin) lines.push(`origin: "${fm.origin}"`);
    lines.push("---");
    return lines.join("\n");
}

/**
 * Inject or update front matter on a plan's markdown content.
 * If front matter already exists, merge with existing values.
 *
 * @param {string} markdown - The plan content (may or may not have front matter)
 * @param {Partial<PlanFrontMatter>} overrides - Fields to inject/override
 * @returns {string} The markdown with front matter
 */
export function injectFrontMatter(markdown, overrides = {}) {
    /** @type {Partial<PlanFrontMatter>} */
    let existingFm = {};
    let body = markdown;

    if (hasFrontMatter(markdown)) {
        const { attrs, body: b } = extractYaml(markdown);
        existingFm = (attrs || {});
        body = b;
    }

    const fm = {
        classification: overrides.classification || existingFm.classification || DEFAULT_FRONT_MATTER.classification,
        complexity: overrides.complexity || existingFm.complexity || DEFAULT_FRONT_MATTER.complexity,
        summary: overrides.summary || existingFm.summary || DEFAULT_FRONT_MATTER.summary,
        affectedPaths: overrides.affectedPaths || existingFm.affectedPaths || DEFAULT_FRONT_MATTER.affectedPaths,
        createdAt: overrides.createdAt || existingFm.createdAt || DEFAULT_FRONT_MATTER.createdAt,
        updatedAt: overrides.updatedAt || existingFm.updatedAt || new Date().toISOString(),
        status: overrides.status || existingFm.status || DEFAULT_FRONT_MATTER.status,
        origin: overrides.origin || existingFm.origin || "harness",
    };

    return formatFrontMatter(fm) + "\n" + body.trimStart();
}

/**
 * Parse front matter from a plan file. Returns defaults if missing.
 *
 * @param {string} markdown
 * @returns {{ attrs: PlanFrontMatter, body: string }}
 */
export function parsePlanFrontMatter(markdown) {
    if (!hasFrontMatter(markdown)) {
        return {
            attrs: { ...DEFAULT_FRONT_MATTER, createdAt: new Date().toISOString() },
            body: markdown,
        };
    }
    const { attrs, body } = extractYaml(markdown);
    return {
        attrs: {
            classification: attrs.classification || DEFAULT_FRONT_MATTER.classification,
            complexity: attrs.complexity || DEFAULT_FRONT_MATTER.complexity,
            summary: attrs.summary || DEFAULT_FRONT_MATTER.summary,
            affectedPaths: attrs.affectedPaths || DEFAULT_FRONT_MATTER.affectedPaths,
            createdAt: attrs.createdAt || DEFAULT_FRONT_MATTER.createdAt,
            updatedAt: attrs.updatedAt,
            status: attrs.status || DEFAULT_FRONT_MATTER.status,
            origin: attrs.origin || DEFAULT_FRONT_MATTER.origin,
        },
        body,
    };
}

// ─── Save / Load / List ──────────────────────────────────────────────

/**
 * Save a plan to the plans directory with front matter.
 *
 * @param {string} cwd - Project root
 * @param {string} planName - Filename without .md (e.g., "add-dark-mode-toggle")
 * @param {string} content - Plan markdown content
 * @param {Partial<PlanFrontMatter>} [fmOverrides] - Front matter fields
 * @returns {Promise<string>} The full path where the plan was saved
 */
export async function savePlan(cwd, planName, content, fmOverrides = {}) {
    const dir = await ensurePlansDir(cwd);
    const withFm = injectFrontMatter(content, fmOverrides);
    const filePath = join(dir, `${planName}.md`);
    await Deno.writeTextFile(filePath, withFm);
    return filePath;
}

/**
 * Load a plan by name from the plans directory.
 *
 * @param {string} cwd
 * @param {string} planName - Filename without .md
 * @returns {Promise<{ path: string, markdown: string, attrs: PlanFrontMatter, body: string } | null>}
 */
export async function loadPlan(cwd, planName) {
    const filePath = join(getPlansDir(cwd), `${planName}.md`);
    try {
        const markdown = await Deno.readTextFile(filePath);
        const { attrs, body } = parsePlanFrontMatter(markdown);
        return { path: filePath, markdown, attrs, body };
    } catch {
        return null;
    }
}

/**
 * Load an external plan from any path. Applies defaults if front matter is missing.
 *
 * @param {string} absolutePath - Absolute path to the plan file
 * @returns {Promise<{ path: string, markdown: string, attrs: PlanFrontMatter, body: string }>}
 */
export async function loadExternalPlan(absolutePath) {
    const markdown = await Deno.readTextFile(absolutePath);
    const { attrs, body } = parsePlanFrontMatter(markdown);
    // If front matter was missing, rewrite with defaults injected
    if (!hasFrontMatter(markdown)) {
        const withFm = injectFrontMatter(markdown, { origin: "external" });
        return { path: absolutePath, markdown: withFm, attrs, body };
    }
    return { path: absolutePath, markdown, attrs, body };
}

/**
 * Update the status field in a plan's front matter.
 *
 * @param {string} cwd
 * @param {string} planName
 * @param {string} status - draft | in_review | approved | denied
 * @returns {Promise<void>}
 */
export async function updatePlanStatus(cwd, planName, status) {
    const plan = await loadPlan(cwd, planName);
    if (!plan) throw new Error(`Plan not found: ${planName}`);
    const withFm = injectFrontMatter(plan.body, { ...plan.attrs, status });
    await Deno.writeTextFile(plan.path, withFm);
}

/**
 * List all saved plans in the project's plans directory.
 *
 * @param {string} cwd
 * @returns {Promise<Array<{ name: string, path: string, attrs: PlanFrontMatter }>>}
 */
export async function listPlans(cwd) {
    const dir = getPlansDir(cwd);
    const results = [];
    try {
        for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile || !entry.name.endsWith(".md")) continue;
            const name = entry.name.replace(/\.md$/, "");
            const filePath = join(dir, entry.name);
            try {
                const markdown = await Deno.readTextFile(filePath);
                const { attrs } = parsePlanFrontMatter(markdown);
                results.push({ name, path: filePath, attrs });
            } catch {
                // skip unreadable files
            }
        }
    } catch {
        // plans dir doesn't exist yet
    }
    return results;
}

/**
 * Resolve a plan name or path argument to a loadable plan.
 * If the argument looks like an absolute/relative path (contains / or \),
 * treat it as an external plan. Otherwise, look in the project plans dir.
 *
 * @param {string} cwd
 * @param {string} arg - Plan name (e.g., "add-dark-mode") or file path
 * @returns {Promise<{ path: string, markdown: string, attrs: PlanFrontMatter, body: string, planName: string }>}
 */
export async function resolvePlan(cwd, arg) {
    // Check if it's a path (absolute or relative with separators)
    const isPath = arg.includes("/") || arg.includes("\\") || arg.endsWith(".md");

    if (isPath) {
        const absPath = resolve(cwd, arg);
        const plan = await loadExternalPlan(absPath);
        const planName = basename(absPath, ".md");
        return { ...plan, planName };
    }

    const plan = await loadPlan(cwd, arg);
    if (!plan) throw new Error(`Plan not found: ${arg}. Use 'harness' without arguments to list plans.`);
    return { ...plan, planName: arg };
}
