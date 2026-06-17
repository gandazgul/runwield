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
import { basename, join, resolve } from "@std/path";
import { CLI_BIN, PLANS_DIR_NAME } from "./constants.js";

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

/**
 * Canonicalize a stored plan name relative to plans/.
 * @param {string} planName
 * @returns {{ name: string, segments: string[] }}
 */
function canonicalizeStoredPlanName(planName) {
    let normalized = String(planName || "").trim().replaceAll("\\", "/");
    if (normalized.toLowerCase().endsWith(".md")) {
        normalized = normalized.slice(0, -3);
    }

    if (!normalized) throw new Error("Plan name cannot be empty");
    if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
        throw new Error(`Plan name must be relative to ${PLANS_DIR_NAME}/: ${planName}`);
    }

    const segments = normalized.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`Plan name cannot escape ${PLANS_DIR_NAME}/: ${planName}`);
    }

    return { name: segments.join("/"), segments };
}

/**
 * @param {string} cwd
 * @param {string} planName
 * @returns {{ name: string, segments: string[], filePath: string }}
 */
function getStoredPlanLocation(cwd, planName) {
    const { name, segments } = canonicalizeStoredPlanName(planName);
    return { name, segments, filePath: join(getPlansDir(cwd), ...segments) + ".md" };
}

// ─── Front Matter ─────────────────────────────────────────────────────

/**
 * @typedef {Object} PlanFrontMatter
 * @property {"QUICK_FIX"|"FEATURE"|"PROJECT"} classification
 * @property {"LOW"|"MEDIUM"|"HIGH"} complexity
 * @property {string} summary - Brief description of what the plan addresses
 * @property {string[]} affectedPaths - Files that will be created/modified
 * @property {string} createdAt - ISO timestamp
 * @property {string} [updatedAt] - ISO timestamp (set on revision)
 * @property {"draft"|"feedback"|"approved"|"ready_for_decomposition"|"ready_for_work"|"in_progress"|"failed"|"implemented"|"verified"} status
 * @property {"internal"|"external"} [origin] - "internal" = created by a Harns agent; "external" = a pre-existing markdown file loaded from an arbitrary path and resumed with Harns
 * @property {string} [type] - Optional plan subtype, e.g. "epic" for PROJECT Epic containers
 * @property {string} [parentPlan] - Canonical parent plan name for child FEATURE plans
 * @property {string[]} [dependencies] - Sibling FEATURE plan identifiers that should be completed first
 * @property {string|null} [failureReason] - Concise durable failure detail for failed or unverified implemented plans
 * @property {string|null} [failedAt] - ISO timestamp when execution failed
 * @property {string|null} [implementedAt] - ISO timestamp when execution finished
 * @property {string|null} [verifiedAt] - ISO timestamp when validation passed
 * @property {"done_enough"|null} [epicCompletionMode] - Explicit Epic completion mode when an Epic is marked done enough for now
 * @property {string|null} [epicDoneEnoughAt] - ISO timestamp when an Epic was marked done enough for now
 * @property {string|null} [epicDoneEnoughSummary] - Human-readable summary captured when an Epic was marked done enough for now
 * @property {string|null} [executionBaselineTree] - Git tree captured before execution started
 * @property {string|null} [worktreeId] - Durable execution worktree registry id
 * @property {string|null} [worktreePath] - Filesystem path to the execution worktree
 * @property {string|null} [worktreeBranch] - Git branch checked out in the execution worktree
 * @property {"none"|"active"|"completed"|"execution_failed"|"validation_failed"|"merge_conflict"|"merged"|"abandoned"|null} [worktreeStatus]
 */

/**
 * Descriptor for a draft child FEATURE plan produced by the Slicer.
 *
 * Repeated writes are deterministic: the child file path is derived from the
 * optional sequence number and title, and existing files at that path are
 * overwritten with the latest draft content.
 *
 * @typedef {Object} ChildFeaturePlanDescriptor
 * @property {string} title - Human-readable child plan title.
 * @property {string} summary - Brief child FEATURE summary.
 * @property {string[]} affectedPaths - Files that the child FEATURE expects to touch.
 * @property {string[]} dependencies - Sibling child plan names or identifiers required first.
 * @property {string} content - Planner-format markdown body for the child FEATURE.
 * @property {number} [sequence] - Optional stable ordering number used in the file name.
 */

/**
 * @typedef {Object} SavedChildFeaturePlan
 * @property {string} name - Canonical nested plan name, e.g. `epic/01-child`.
 * @property {string} path - Absolute markdown path written.
 * @property {string} title - Human-readable child plan title.
 * @property {"created" | "updated"} action - Whether the derived file existed before this write.
 * @property {string[]} dependencies - Serialized child FEATURE dependencies.
 * @property {{ classification: "FEATURE", status: "draft", parentPlan: string, affectedPaths: string[] }} metadata - Front matter values owned by child materialization.
 */

/**
 * Default front matter for plans.
 * @type {PlanFrontMatter}
 */
const DEFAULT_FRONT_MATTER = {
    classification: "FEATURE",
    complexity: "MEDIUM",
    summary: "",
    affectedPaths: [],
    get createdAt() {
        return new Date().toISOString();
    },
    status: "draft",
    origin: "internal",
};

const KNOWN_FRONT_MATTER_KEYS = new Set([
    "classification",
    "complexity",
    "summary",
    "affectedPaths",
    "createdAt",
    "updatedAt",
    "status",
    "origin",
    "type",
    "parentPlan",
    "dependencies",
    "failureReason",
    "failedAt",
    "implementedAt",
    "verifiedAt",
    "epicCompletionMode",
    "epicDoneEnoughAt",
    "epicDoneEnoughSummary",
    "executionBaselineTree",
    "worktreeId",
    "worktreePath",
    "worktreeBranch",
    "worktreeStatus",
]);

/**
 * Escape a scalar for YAML double-quoted style.
 * @param {unknown} value
 * @returns {string}
 */
function escapeYamlDoubleQuoted(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSupportedYamlValue(value) {
    if (value === null) return true;
    if (["string", "number", "boolean"].includes(typeof value)) return true;
    if (Array.isArray(value)) return value.every(isSupportedYamlValue);
    return false;
}

/**
 * @param {string[]} lines
 * @param {string} key
 * @param {unknown} value
 */
function appendYamlField(lines, key, value) {
    if (value === undefined) return;
    if (!isSupportedYamlValue(value)) return;

    if (Array.isArray(value)) {
        lines.push(`${key}:`);
        if (value.length === 0) {
            lines.push(`  []`);
        } else {
            for (const item of value) {
                if (typeof item === "string") lines.push(`  - "${escapeYamlDoubleQuoted(item)}"`);
                else if (item === null) lines.push("  - null");
                else lines.push(`  - ${String(item)}`);
            }
        }
        return;
    }

    if (typeof value === "string") lines.push(`${key}: "${escapeYamlDoubleQuoted(value)}"`);
    else if (value === null) lines.push(`${key}: null`);
    else lines.push(`${key}: ${String(value)}`);
}

/**
 * Build YAML front matter string from a PlanFrontMatter object.
 * @param {PlanFrontMatter} fm
 * @returns {string}
 */
function formatFrontMatter(fm) {
    const lines = ["---"];
    appendYamlField(lines, "classification", fm.classification);
    appendYamlField(lines, "complexity", fm.complexity);
    appendYamlField(lines, "summary", fm.summary);
    appendYamlField(lines, "affectedPaths", fm.affectedPaths);
    appendYamlField(lines, "createdAt", fm.createdAt);
    appendYamlField(lines, "updatedAt", fm.updatedAt);
    appendYamlField(lines, "status", fm.status);
    appendYamlField(lines, "origin", fm.origin);
    appendYamlField(lines, "type", fm.type);
    appendYamlField(lines, "parentPlan", fm.parentPlan);
    appendYamlField(lines, "dependencies", fm.dependencies);
    appendYamlField(lines, "failureReason", fm.failureReason);
    appendYamlField(lines, "failedAt", fm.failedAt);
    appendYamlField(lines, "implementedAt", fm.implementedAt);
    appendYamlField(lines, "verifiedAt", fm.verifiedAt);
    appendYamlField(lines, "epicCompletionMode", fm.epicCompletionMode);
    appendYamlField(lines, "epicDoneEnoughAt", fm.epicDoneEnoughAt);
    appendYamlField(lines, "epicDoneEnoughSummary", fm.epicDoneEnoughSummary);
    appendYamlField(lines, "executionBaselineTree", fm.executionBaselineTree);
    appendYamlField(lines, "worktreeId", fm.worktreeId);
    appendYamlField(lines, "worktreePath", fm.worktreePath);
    appendYamlField(lines, "worktreeBranch", fm.worktreeBranch);
    appendYamlField(lines, "worktreeStatus", fm.worktreeStatus);

    for (const key of Object.keys(fm).filter((key) => !KNOWN_FRONT_MATTER_KEYS.has(key)).sort()) {
        appendYamlField(lines, key, /** @type {Record<string, unknown>} */ (fm)[key]);
    }

    lines.push("---");
    return lines.join("\n");
}

/**
 * Normalize legacy statuses from older saved plans into the current lifecycle.
 *
 * @param {string | undefined} status
 * @returns {PlanFrontMatter["status"]}
 */
function normalizePlanStatus(status) {
    if (status === "completed") return "verified";
    if (status === "in_review") return "feedback";
    const allowed = new Set([
        "draft",
        "feedback",
        "approved",
        "ready_for_decomposition",
        "ready_for_work",
        "in_progress",
        "failed",
        "implemented",
        "verified",
    ]);
    if (status && allowed.has(status)) {
        return /** @type {PlanFrontMatter["status"]} */ (status);
    }
    return DEFAULT_FRONT_MATTER.status;
}

/**
 * Return an optional front matter value, allowing explicit null to clear it.
 *
 * @param {Partial<PlanFrontMatter>} overrides
 * @param {Partial<PlanFrontMatter>} existingFm
 * @param {keyof PlanFrontMatter} key
 * @returns {string | null | undefined}
 */
function optionalFrontMatterValue(overrides, existingFm, key) {
    if (Object.hasOwn(overrides, key)) {
        return /** @type {string | null | undefined} */ (overrides[key] ?? undefined);
    }
    return /** @type {string | null | undefined} */ (existingFm[key]);
}

/**
 * @param {Partial<PlanFrontMatter>} overrides
 * @param {Partial<PlanFrontMatter>} existingFm
 * @param {keyof PlanFrontMatter} key
 * @returns {string | undefined}
 */
function optionalStringValue(overrides, existingFm, key) {
    if (Object.hasOwn(overrides, key)) {
        const value = overrides[key];
        return typeof value === "string" ? value : undefined;
    }
    const value = existingFm[key];
    return typeof value === "string" ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {string[] | undefined}
 */
function normalizeStringList(value) {
    return Array.isArray(value) ? value.map(String) : undefined;
}

/**
 * @param {unknown} status
 * @returns {PlanFrontMatter["worktreeStatus"]}
 */
function normalizeWorktreeStatus(status) {
    const allowed = new Set([
        "none",
        "active",
        "completed",
        "execution_failed",
        "validation_failed",
        "merge_conflict",
        "merged",
        "abandoned",
    ]);
    if (typeof status === "string" && allowed.has(status)) {
        return /** @type {PlanFrontMatter["worktreeStatus"]} */ (status);
    }
    return undefined;
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
        existingFm = attrs || {};
        body = b;
    }

    const fm = {
        ...existingFm,
        ...overrides,
        classification: overrides.classification ??
            existingFm.classification ??
            DEFAULT_FRONT_MATTER.classification,
        complexity: overrides.complexity ??
            existingFm.complexity ??
            DEFAULT_FRONT_MATTER.complexity,
        summary: overrides.summary ?? existingFm.summary ?? DEFAULT_FRONT_MATTER.summary,
        affectedPaths: overrides.affectedPaths ??
            existingFm.affectedPaths ??
            DEFAULT_FRONT_MATTER.affectedPaths,
        createdAt: overrides.createdAt ??
            existingFm.createdAt ??
            DEFAULT_FRONT_MATTER.createdAt,
        updatedAt: overrides.updatedAt ?? existingFm.updatedAt ?? new Date().toISOString(),
        status: normalizePlanStatus(overrides.status ?? existingFm.status),
        origin: overrides.origin ?? existingFm.origin ?? "internal",
        type: optionalStringValue(overrides, existingFm, "type"),
        parentPlan: optionalStringValue(overrides, existingFm, "parentPlan"),
        dependencies: Object.hasOwn(overrides, "dependencies")
            ? normalizeStringList(overrides.dependencies)
            : normalizeStringList(existingFm.dependencies),
        failureReason: optionalFrontMatterValue(overrides, existingFm, "failureReason"),
        failedAt: optionalFrontMatterValue(overrides, existingFm, "failedAt"),
        implementedAt: optionalFrontMatterValue(overrides, existingFm, "implementedAt"),
        verifiedAt: optionalFrontMatterValue(overrides, existingFm, "verifiedAt"),
        epicCompletionMode: /** @type {"done_enough" | null | undefined} */ (
            optionalFrontMatterValue(overrides, existingFm, "epicCompletionMode") === "done_enough"
                ? "done_enough"
                : undefined
        ),
        epicDoneEnoughAt: optionalFrontMatterValue(overrides, existingFm, "epicDoneEnoughAt"),
        epicDoneEnoughSummary: optionalFrontMatterValue(overrides, existingFm, "epicDoneEnoughSummary"),
        executionBaselineTree: optionalFrontMatterValue(overrides, existingFm, "executionBaselineTree"),
        worktreeId: optionalFrontMatterValue(overrides, existingFm, "worktreeId"),
        worktreePath: optionalFrontMatterValue(overrides, existingFm, "worktreePath"),
        worktreeBranch: optionalFrontMatterValue(overrides, existingFm, "worktreeBranch"),
        worktreeStatus: normalizeWorktreeStatus(
            Object.hasOwn(overrides, "worktreeStatus") ? overrides.worktreeStatus : existingFm.worktreeStatus,
        ),
    };

    return formatFrontMatter(fm) + "\n" + body.trimStart();
}

/**
 * Parse front matter from a plan file. Returns defaults if missing.
 *
 * @param {string} markdown
 * @param {{ missingOrigin?: string }} [opts]
 * @returns {{ attrs: PlanFrontMatter, body: string }}
 */
export function parsePlanFrontMatter(markdown, opts = {}) {
    const missingOrigin = opts.missingOrigin || DEFAULT_FRONT_MATTER.origin;

    if (!hasFrontMatter(markdown)) {
        return {
            attrs: {
                ...DEFAULT_FRONT_MATTER,
                createdAt: new Date().toISOString(),
                origin: /** @type {"internal"|"external"} */ (missingOrigin),
            },
            body: markdown,
        };
    }
    const { attrs, body } = extractYaml(markdown);
    return {
        attrs: {
            ...attrs,
            classification: attrs.classification || DEFAULT_FRONT_MATTER.classification,
            complexity: attrs.complexity || DEFAULT_FRONT_MATTER.complexity,
            summary: attrs.summary || DEFAULT_FRONT_MATTER.summary,
            affectedPaths: normalizeStringList(attrs.affectedPaths) || DEFAULT_FRONT_MATTER.affectedPaths,
            createdAt: attrs.createdAt || DEFAULT_FRONT_MATTER.createdAt,
            updatedAt: attrs.updatedAt,
            status: normalizePlanStatus(attrs.status),
            origin: attrs.origin || missingOrigin,
            type: typeof attrs.type === "string" ? attrs.type : undefined,
            parentPlan: typeof attrs.parentPlan === "string" ? attrs.parentPlan : undefined,
            dependencies: normalizeStringList(attrs.dependencies),
            failureReason: attrs.failureReason,
            failedAt: attrs.failedAt,
            implementedAt: attrs.implementedAt,
            verifiedAt: attrs.verifiedAt,
            epicCompletionMode: attrs.epicCompletionMode === "done_enough" ? attrs.epicCompletionMode : undefined,
            epicDoneEnoughAt: attrs.epicDoneEnoughAt,
            epicDoneEnoughSummary: attrs.epicDoneEnoughSummary,
            executionBaselineTree: attrs.executionBaselineTree,
            worktreeId: attrs.worktreeId,
            worktreePath: attrs.worktreePath,
            worktreeBranch: attrs.worktreeBranch,
            worktreeStatus: normalizeWorktreeStatus(attrs.worktreeStatus),
        },
        body,
    };
}

// ─── Save / Load / List ──────────────────────────────────────────────

/**
 * Convert a title into a filesystem-safe plan-name segment.
 * @param {string} title
 * @returns {string}
 */
function slugifyPlanTitle(title) {
    return String(title || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * @param {number | undefined} sequence
 * @returns {string}
 */
function formatChildSequencePrefix(sequence) {
    if (sequence === undefined) return "";
    if (!Number.isInteger(sequence) || sequence < 0) {
        throw new Error(`Child plan sequence must be a non-negative integer: ${sequence}`);
    }
    return `${String(sequence).padStart(2, "0")}-`;
}

/**
 * @param {unknown} child
 * @returns {ChildFeaturePlanDescriptor}
 */
function validateChildFeaturePlanDescriptor(child) {
    if (!child || typeof child !== "object") {
        throw new Error("Child plan descriptor must be an object");
    }

    const descriptor = /** @type {Partial<ChildFeaturePlanDescriptor>} */ (child);
    if (typeof descriptor.title !== "string") throw new Error("Child plan title must be a string");
    if (typeof descriptor.summary !== "string") throw new Error("Child plan summary must be a string");
    if (!Array.isArray(descriptor.affectedPaths)) throw new Error("Child plan affectedPaths must be an array");
    if (!Array.isArray(descriptor.dependencies)) throw new Error("Child plan dependencies must be an array");
    if (typeof descriptor.content !== "string") throw new Error("Child plan content must be a string");

    return /** @type {ChildFeaturePlanDescriptor} */ (descriptor);
}

/**
 * @param {ChildFeaturePlanDescriptor} child
 * @returns {string}
 */
function buildChildPlanNameSegment(child) {
    const slug = slugifyPlanTitle(child.title);
    if (!slug) throw new Error(`Child plan title must produce a valid plan name: ${child.title}`);
    return `${formatChildSequencePrefix(child.sequence)}${slug}`;
}

/**
 * Save draft child FEATURE plans below `plans/<epicPlanName>/`.
 *
 * This helper intentionally overwrites existing draft files at the derived
 * child path. Conflict detection/finalization belongs to the Slicer flow that
 * promotes the decomposition, not to draft materialization.
 *
 * @param {string} cwd - Project root.
 * @param {string} epicPlanName - Parent Epic plan name.
 * @param {ChildFeaturePlanDescriptor[]} children - Child FEATURE descriptors.
 * @returns {Promise<SavedChildFeaturePlan[]>}
 */
export async function saveChildFeaturePlans(cwd, epicPlanName, children) {
    const { name: parentPlanName, segments: parentSegments } = canonicalizeStoredPlanName(epicPlanName);
    if (parentSegments.length !== 1) {
        throw new Error(`Parent Epic plan name must be a top-level plan: ${epicPlanName}`);
    }
    if (!Array.isArray(children)) throw new Error("Child plans must be an array");

    /** @type {SavedChildFeaturePlan[]} */
    const results = [];
    const seen = new Set();

    for (const rawChild of children) {
        const child = validateChildFeaturePlanDescriptor(rawChild);
        const childSegment = buildChildPlanNameSegment(child);
        const childPlanName = `${parentPlanName}/${childSegment}`;
        const { name, filePath, segments } = getStoredPlanLocation(cwd, childPlanName);
        if (segments.length !== 2 || segments[0] !== parentPlanName) {
            throw new Error(`Invalid child plan name: ${childPlanName}`);
        }
        if (seen.has(name)) throw new Error(`Duplicate child plan name: ${name}`);
        seen.add(name);

        let action = /** @type {"created" | "updated"} */ ("created");
        try {
            const stat = await Deno.stat(filePath);
            if (stat.isFile) action = "updated";
        } catch {
            // File does not exist yet.
        }

        const dependencies = normalizeStringList(child.dependencies) || [];
        const affectedPaths = normalizeStringList(child.affectedPaths) || [];
        const metadata = {
            classification: /** @type {const} */ ("FEATURE"),
            status: /** @type {const} */ ("draft"),
            parentPlan: parentPlanName,
            affectedPaths,
        };
        const path = await savePlan(cwd, name, child.content, {
            ...metadata,
            summary: child.summary,
            dependencies,
            origin: "internal",
        });
        results.push({ name, path, title: child.title, action, dependencies, metadata });
    }

    return results;
}

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
    const { filePath, segments } = getStoredPlanLocation(cwd, planName);
    if (segments.length > 1) {
        await Deno.mkdir(join(dir, ...segments.slice(0, -1)), { recursive: true });
    }
    const withFm = injectFrontMatter(content, fmOverrides);
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
    const { filePath } = getStoredPlanLocation(cwd, planName);
    try {
        const markdown = await Deno.readTextFile(filePath);
        const { attrs, body } = parsePlanFrontMatter(markdown);
        return { path: filePath, markdown, attrs, body };
    } catch {
        return null;
    }
}

/**
 * Load an external plan (a pre-existing markdown file not created by Harns)
 * from any path. Applies defaults if front matter is missing.
 *
 * @param {string} absolutePath - Absolute path to the plan file
 * @returns {Promise<{ path: string, markdown: string, attrs: PlanFrontMatter, body: string }>}
 */
export async function loadExternalPlan(absolutePath) {
    const markdown = await Deno.readTextFile(absolutePath);
    const { attrs, body } = parsePlanFrontMatter(markdown, {
        missingOrigin: "external",
    });
    // If front matter was missing, rewrite with defaults injected
    if (!hasFrontMatter(markdown)) {
        const withFm = injectFrontMatter(markdown, { origin: "external" });
        return { path: absolutePath, markdown: withFm, attrs, body };
    }
    return { path: absolutePath, markdown, attrs, body };
}

/**
 * Remove a leading front matter block if present, even if malformed.
 * @param {string} markdown
 * @returns {string}
 */
function stripLeadingFrontMatterBlock(markdown) {
    if (!markdown.startsWith("---")) return markdown;
    const close = markdown.indexOf("\n---", 3);
    if (close === -1) return markdown;
    const afterClose = markdown.slice(close + 4);
    return afterClose.startsWith("\n") ? afterClose.slice(1) : afterClose;
}

/**
 * Update the status field in a plan's front matter.
 *
 * If the plan file exists but has malformed front matter,
 * this function self-heals by rewriting front matter using
 * provided recovery metadata and then applying the target status.
 *
 * @param {string} cwd
 * @param {string} planName
 * @param {PlanFrontMatter["status"]} status
 * @param {Partial<PlanFrontMatter>} [recoveryAttrs]
 * @returns {Promise<void>}
 */
export async function updatePlanStatus(
    cwd,
    planName,
    status,
    recoveryAttrs = {},
) {
    const plan = await loadPlan(cwd, planName);
    if (plan) {
        const withFm = injectFrontMatter(plan.body, { ...plan.attrs, status });
        await Deno.writeTextFile(plan.path, withFm);

        return;
    }

    const { filePath } = getStoredPlanLocation(cwd, planName);
    let markdown;
    try {
        markdown = await Deno.readTextFile(filePath);
    } catch {
        throw new Error(`Plan not found: ${planName}`);
    }

    const body = stripLeadingFrontMatterBlock(markdown);
    const healed = injectFrontMatter(body, {
        ...recoveryAttrs,
        status,
        updatedAt: new Date().toISOString(),
    });
    await Deno.writeTextFile(filePath, healed);
}

/**
 * Update arbitrary plan front matter fields while preserving the body.
 * Passing null for optional fields clears them.
 *
 * @param {string} cwd
 * @param {string} planName
 * @param {Partial<PlanFrontMatter>} updates
 * @param {Partial<PlanFrontMatter>} [recoveryAttrs]
 * @returns {Promise<PlanFrontMatter>}
 */
export async function updatePlanFrontMatter(
    cwd,
    planName,
    updates,
    recoveryAttrs = {},
) {
    const plan = await loadPlan(cwd, planName);
    if (plan) {
        const attrs = { ...plan.attrs, ...updates, updatedAt: updates.updatedAt ?? new Date().toISOString() };
        const withFm = injectFrontMatter(plan.body, attrs);
        await Deno.writeTextFile(plan.path, withFm);
        return parsePlanFrontMatter(withFm).attrs;
    }

    const { filePath } = getStoredPlanLocation(cwd, planName);
    let markdown;
    try {
        markdown = await Deno.readTextFile(filePath);
    } catch {
        throw new Error(`Plan not found: ${planName}`);
    }

    const body = stripLeadingFrontMatterBlock(markdown);
    const attrs = { ...recoveryAttrs, ...updates, updatedAt: updates.updatedAt ?? new Date().toISOString() };
    const healed = injectFrontMatter(body, attrs);
    await Deno.writeTextFile(filePath, healed);
    return parsePlanFrontMatter(healed).attrs;
}

/**
 * @param {string} dir
 * @param {string[]} prefix
 * @param {Array<{ name: string, path: string, attrs: PlanFrontMatter }>} results
 * @returns {Promise<void>}
 */
async function collectPlans(dir, prefix, results) {
    for await (const entry of Deno.readDir(dir)) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory) {
            await collectPlans(entryPath, [...prefix, entry.name], results);
            continue;
        }
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const name = [...prefix, entry.name.replace(/\.md$/, "")].join("/");
        try {
            const markdown = await Deno.readTextFile(entryPath);
            const { attrs } = parsePlanFrontMatter(markdown);
            results.push({ name, path: entryPath, attrs });
        } catch {
            // skip unreadable or malformed files
        }
    }
}

/**
 * List all saved plans in the project's plans directory.
 *
 * @param {string} cwd
 * @returns {Promise<Array<{ name: string, path: string, attrs: PlanFrontMatter }>>}
 */
export async function listPlans(cwd) {
    const dir = getPlansDir(cwd);
    /** @type {Array<{ name: string, path: string, attrs: PlanFrontMatter }>} */
    const results = [];
    try {
        await collectPlans(dir, [], results);
    } catch {
        // plans dir doesn't exist yet
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find child plans by their loose parentPlan pointer.
 *
 * @param {string} cwd
 * @param {string} parentPlan
 * @returns {Promise<Array<{ name: string, path: string, attrs: PlanFrontMatter }>>}
 */
export async function findPlansByParent(cwd, parentPlan) {
    const { name } = canonicalizeStoredPlanName(parentPlan);
    const plans = await listPlans(cwd);
    return plans.filter((plan) => plan.attrs.parentPlan === name).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve child FEATURE dependencies relative to a shared parent Epic.
 *
 * Supported dependency identifiers are either the canonical child plan name
 * (`epic/01-first`) or the sibling child segment (`01-first`). Title-only
 * aliases are intentionally not inferred because child plan slugs are the
 * durable identifiers stored on disk.
 *
 * @param {string} cwd
 * @param {string} parentPlan
 * @param {unknown} dependencies
 * @returns {Promise<Array<{ dependency: string, planName?: string, path?: string, status?: string, state: "verified" | "unverified" | "missing" }>>}
 */
export async function resolveSiblingChildPlanDependencies(cwd, parentPlan, dependencies) {
    const { name: parentPlanName } = canonicalizeStoredPlanName(parentPlan);
    const dependencyNames = normalizeStringList(dependencies) || [];
    if (dependencyNames.length === 0) return [];

    const siblings = await findPlansByParent(cwd, parentPlanName);
    const byName = new Map(siblings.map((plan) => [plan.name, plan]));

    return dependencyNames.map((rawDependency) => {
        const dependency = String(rawDependency).trim();
        if (!dependency) return { dependency, state: /** @type {const} */ ("missing") };

        let candidateName;
        try {
            const canonical = canonicalizeStoredPlanName(dependency).name;
            candidateName = canonical.includes("/") ? canonical : `${parentPlanName}/${canonical}`;
        } catch {
            return { dependency, state: /** @type {const} */ ("missing") };
        }

        const sibling = byName.get(candidateName);
        if (!sibling) return { dependency, state: /** @type {const} */ ("missing") };
        if (sibling.attrs.status === "verified") {
            return {
                dependency,
                planName: sibling.name,
                path: sibling.path,
                status: sibling.attrs.status,
                state: /** @type {const} */ ("verified"),
            };
        }
        return {
            dependency,
            planName: sibling.name,
            path: sibling.path,
            status: sibling.attrs.status,
            state: /** @type {const} */ ("unverified"),
        };
    });
}

/**
 * Resolve a plan name or path argument to a loadable plan.
 * Stored plans are tried first, including nested names such as
 * `project-breakdown-epic/feature1`. If no stored plan matches and the
 * argument looks like a path (contains / or \, or ends with .md), load it as
 * an external markdown file.
 *
 * @param {string} cwd
 * @param {string} arg - Plan name (e.g., "add-dark-mode" or "epic/feature1") or file path
 * @returns {Promise<{ path: string, markdown: string, attrs: PlanFrontMatter, body: string, planName: string }>}
 */
export async function resolvePlan(cwd, arg) {
    try {
        const plan = await loadPlan(cwd, arg);
        if (plan) {
            const { name } = canonicalizeStoredPlanName(arg);
            return { ...plan, planName: name };
        }
    } catch {
        // Not a valid stored plan name. Fall through to external path handling.
    }

    const isPath = arg.includes("/") || arg.includes("\\") || arg.endsWith(".md");

    if (isPath) {
        const absPath = resolve(cwd, arg);
        const plan = await loadExternalPlan(absPath);
        const planName = basename(absPath, ".md");
        return { ...plan, planName };
    }

    throw new Error(
        `Plan not found: ${arg}. Use '${CLI_BIN} plans' to list available plans.`,
    );
}
