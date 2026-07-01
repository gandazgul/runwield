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
import { basename, join, relative, resolve } from "@std/path";
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
 * @typedef {"none"|"ask"|"always"|null} HumanReviewMode
 */

/**
 * @typedef {"not_required"|"skipped"|"approved"|null} HumanReviewDecision
 */

/**
 * @typedef {Object} PlanFrontMatter
 * @property {string} [planId] - Durable project-scoped resource identity for URL/addressable Plan lookup
 * @property {"QUICK_FIX"|"FEATURE"|"PROJECT"} classification
 * @property {"LOW"|"MEDIUM"|"HIGH"} complexity
 * @property {string} summary - Brief description of what the plan addresses
 * @property {string[]} affectedPaths - Files that will be created/modified
 * @property {boolean} [frontend] - Whether this plan includes frontend UI/UX work
 * @property {string|null} [devServerCommand] - Project dev/preview command for browser verification, if known
 * @property {string|null} [devServerUrl] - Local URL expected for browser verification, if known
 * @property {boolean|null} [devServerHmr] - Whether the dev server is expected to support hot module reload
 * @property {string} createdAt - ISO timestamp
 * @property {string} [updatedAt] - ISO timestamp (set on revision)
 * @property {string} [planId] - Durable project-scoped resource identity for Workspace URLs
 * @property {"draft"|"feedback"|"approved"|"ready_for_decomposition"|"ready_for_work"|"in_progress"|"failed"|"implemented"|"verified"|"closed_without_verification"|"on_hold"} status
 * @property {"internal"|"external"} [origin] - "internal" = created by a RunWield agent; "external" = a pre-existing markdown file loaded from an arbitrary path and resumed with RunWield
 * @property {string} [type] - Optional plan subtype, e.g. "epic" for PROJECT Epic containers
 * @property {string} [parentPlan] - Canonical parent plan name for child FEATURE plans
 * @property {number} [order] - Epic child FEATURE execution order.
 * @property {string[]} [dependencies] - Sibling FEATURE plan identifiers that should be completed first
 * @property {string|null} [failureReason] - Concise durable failure detail for failed or unverified implemented plans
 * @property {string|null} [failedAt] - ISO timestamp when execution failed
 * @property {string|null} [implementedAt] - ISO timestamp when execution finished
 * @property {string|null} [verifiedAt] - ISO timestamp when validation passed
 * @property {HumanReviewMode} [humanReviewMode] - Human code review mode used for final validation; cleared when execution restarts or review reopens
 * @property {HumanReviewDecision} [humanReviewDecision] - Human code review outcome included in final validation; cleared when execution restarts or review reopens
 * @property {string|null} [humanReviewedAt] - ISO timestamp when human review approved final validation; cleared when execution restarts or review reopens
 * @property {"done_enough"|null} [epicCompletionMode] - Explicit Epic completion mode when an Epic is marked done enough for now
 * @property {string|null} [epicDoneEnoughAt] - ISO timestamp when an Epic was marked done enough for now
 * @property {string|null} [epicDoneEnoughSummary] - Human-readable summary captured when an Epic was marked done enough for now
 * @property {string|null} [executionBaselineTree] - Git tree captured before execution started
 * @property {string|null} [worktreeId] - Durable execution worktree registry id
 * @property {string|null} [worktreePath] - Filesystem path to the execution worktree
 * @property {string|null} [worktreeBranch] - Git branch checked out in the execution worktree
 * @property {"none"|"active"|"completed"|"execution_failed"|"validation_failed"|"merge_conflict"|"merged"|"abandoned"|null} [worktreeStatus]
 * @property {PlanFrontMatter["status"]|null} [heldFromStatus] - Status captured before the Plan moved to on_hold
 * @property {string|null} [heldAt] - ISO timestamp when the Plan was put on hold
 * @property {string|null} [holdReason] - Optional human reason for the hold
 * @property {string|null} [holdStalenessBaseline] - ISO timestamp or baseline used by caller-owned Resume Check
 * @property {string|null} [archivedAt] - ISO timestamp when the Plan was physically moved to plans/archived/
 * @property {string|null} [archiveReason] - Optional human reason captured when the Plan was archived
 * @property {PlanFrontMatter["status"]|null} [archivedFromStatus] - Durable lifecycle status captured before archival
 * @property {string|null} [archivedFromPath] - Project-relative path the Plan occupied before archival
 * @property {string|null} [restoredAt] - ISO timestamp when the Plan was physically restored to active plans/
 * @property {string|null} [restoredFromPath] - Project-relative archived path restored from
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
 * @property {boolean} [frontend] - Whether this child includes frontend UI/UX work.
 * @property {string|null} [devServerCommand] - Project dev/preview command for browser verification, if known.
 * @property {string|null} [devServerUrl] - Local URL expected for browser verification, if known.
 * @property {boolean|null} [devServerHmr] - Whether the dev server is expected to support hot module reload.
 * @property {string[]} dependencies - Sibling child plan names or identifiers required first.
 * @property {string} content - Planner-format markdown body for the child FEATURE.
 * @property {number} [order] - Optional stable execution order used in front matter and the file name.
 * @property {number} [sequence] - Deprecated alias for order.
 */

/**
 * @typedef {Object} SavedChildFeaturePlan
 * @property {string} name - Canonical nested plan name, e.g. `epic/01-child`.
 * @property {string} path - Absolute markdown path written.
 * @property {string} title - Human-readable child plan title.
 * @property {"created" | "updated"} action - Whether the derived file existed before this write.
 * @property {string[]} dependencies - Serialized child FEATURE dependencies.
 * @property {Partial<PlanFrontMatter> & { classification: "FEATURE", status: "draft", parentPlan: string, order?: number, affectedPaths: string[] }} metadata - Front matter values owned by child materialization.
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

export const PLAN_FRONT_MATTER_KEYS = Object.freeze({
    planId: "planId",
    classification: "classification",
    complexity: "complexity",
    summary: "summary",
    affectedPaths: "affectedPaths",
    frontend: "frontend",
    devServerCommand: "devServerCommand",
    devServerUrl: "devServerUrl",
    devServerHmr: "devServerHmr",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    status: "status",
    origin: "origin",
    type: "type",
    parentPlan: "parentPlan",
    order: "order",
    dependencies: "dependencies",
    failureReason: "failureReason",
    failedAt: "failedAt",
    implementedAt: "implementedAt",
    verifiedAt: "verifiedAt",
    humanReviewMode: "humanReviewMode",
    humanReviewDecision: "humanReviewDecision",
    humanReviewedAt: "humanReviewedAt",
    epicCompletionMode: "epicCompletionMode",
    epicDoneEnoughAt: "epicDoneEnoughAt",
    epicDoneEnoughSummary: "epicDoneEnoughSummary",
    executionBaselineTree: "executionBaselineTree",
    worktreeId: "worktreeId",
    worktreePath: "worktreePath",
    worktreeBranch: "worktreeBranch",
    worktreeStatus: "worktreeStatus",
    heldFromStatus: "heldFromStatus",
    heldAt: "heldAt",
    holdReason: "holdReason",
    holdStalenessBaseline: "holdStalenessBaseline",
    archivedAt: "archivedAt",
    archiveReason: "archiveReason",
    archivedFromStatus: "archivedFromStatus",
    archivedFromPath: "archivedFromPath",
    restoredAt: "restoredAt",
    restoredFromPath: "restoredFromPath",
});

export const PLAN_FRONT_MATTER_KEY_ORDER = Object.freeze(Object.values(PLAN_FRONT_MATTER_KEYS));

/** @type {Set<string>} */
const KNOWN_FRONT_MATTER_KEYS = new Set(PLAN_FRONT_MATTER_KEY_ORDER);

const HIDDEN_PLAN_DIRS = new Set(["archived"]);

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
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.planId, fm.planId);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.classification, fm.classification);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.complexity, fm.complexity);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.summary, fm.summary);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.affectedPaths, fm.affectedPaths);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.frontend, fm.frontend);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.devServerCommand, fm.devServerCommand);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.devServerUrl, fm.devServerUrl);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.devServerHmr, fm.devServerHmr);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.createdAt, fm.createdAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.updatedAt, fm.updatedAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.status, fm.status);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.origin, fm.origin);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.type, fm.type);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.parentPlan, fm.parentPlan);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.order, fm.order);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.dependencies, fm.dependencies);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.failureReason, fm.failureReason);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.failedAt, fm.failedAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.implementedAt, fm.implementedAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.verifiedAt, fm.verifiedAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.humanReviewMode, fm.humanReviewMode);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.humanReviewDecision, fm.humanReviewDecision);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.humanReviewedAt, fm.humanReviewedAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.epicCompletionMode, fm.epicCompletionMode);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.epicDoneEnoughAt, fm.epicDoneEnoughAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.epicDoneEnoughSummary, fm.epicDoneEnoughSummary);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.executionBaselineTree, fm.executionBaselineTree);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.worktreeId, fm.worktreeId);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.worktreePath, fm.worktreePath);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.worktreeBranch, fm.worktreeBranch);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.worktreeStatus, fm.worktreeStatus);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.heldFromStatus, fm.heldFromStatus);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.heldAt, fm.heldAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.holdReason, fm.holdReason);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.holdStalenessBaseline, fm.holdStalenessBaseline);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.archivedAt, fm.archivedAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.archiveReason, fm.archiveReason);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.archivedFromStatus, fm.archivedFromStatus);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.archivedFromPath, fm.archivedFromPath);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.restoredAt, fm.restoredAt);
    appendYamlField(lines, PLAN_FRONT_MATTER_KEYS.restoredFromPath, fm.restoredFromPath);

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
        "closed_without_verification",
        "on_hold",
    ]);
    if (status && allowed.has(status)) {
        return /** @type {PlanFrontMatter["status"]} */ (status);
    }
    return DEFAULT_FRONT_MATTER.status;
}

/**
 * @param {unknown} value
 * @returns {boolean | undefined}
 */
function normalizeOptionalBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        if (value === "true") return true;
        if (value === "false") return false;
    }
    return undefined;
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
 * @returns {string | undefined}
 */
function normalizePlanId(value) {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * @param {unknown} value
 * @returns {string[] | undefined}
 */
function normalizeStringList(value) {
    return Array.isArray(value) ? value.map(String) : undefined;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function normalizeNonNegativeInteger(value) {
    if (typeof value === "number") {
        return Number.isInteger(value) && value >= 0 ? value : undefined;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (/^\d+$/.test(trimmed)) return Number(trimmed);
    }
    return undefined;
}

/**
 * @param {unknown} status
 * @returns {PlanFrontMatter["status"] | null | undefined}
 */
function normalizePlanStatusForOptionalHold(status) {
    if (status === null) return null;
    if (typeof status !== "string") return undefined;
    const normalized = normalizePlanStatus(status);
    return normalized === DEFAULT_FRONT_MATTER.status && status !== DEFAULT_FRONT_MATTER.status
        ? undefined
        : normalized;
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
 * @param {unknown} mode
 * @returns {PlanFrontMatter["humanReviewMode"]}
 */
function normalizeHumanReviewMode(mode) {
    if (mode === null) return null;
    if (mode === "none" || mode === "ask" || mode === "always") return mode;
    return undefined;
}

/**
 * @param {unknown} decision
 * @returns {PlanFrontMatter["humanReviewDecision"]}
 */
function normalizeHumanReviewDecision(decision) {
    if (decision === null) return null;
    if (decision === "not_required" || decision === "skipped" || decision === "approved") return decision;
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
        planId: Object.hasOwn(overrides, "planId")
            ? normalizePlanId(overrides.planId)
            : normalizePlanId(existingFm.planId),
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
        frontend: Object.hasOwn(overrides, "frontend")
            ? normalizeOptionalBoolean(overrides.frontend)
            : normalizeOptionalBoolean(existingFm.frontend),
        devServerCommand: optionalFrontMatterValue(overrides, existingFm, "devServerCommand"),
        devServerUrl: optionalFrontMatterValue(overrides, existingFm, "devServerUrl"),
        devServerHmr: Object.hasOwn(overrides, "devServerHmr")
            ? normalizeOptionalBoolean(overrides.devServerHmr)
            : normalizeOptionalBoolean(existingFm.devServerHmr),
        createdAt: overrides.createdAt ??
            existingFm.createdAt ??
            DEFAULT_FRONT_MATTER.createdAt,
        updatedAt: overrides.updatedAt ?? existingFm.updatedAt ?? new Date().toISOString(),
        status: normalizePlanStatus(overrides.status ?? existingFm.status),
        origin: overrides.origin ?? existingFm.origin ?? "internal",
        type: optionalStringValue(overrides, existingFm, "type"),
        parentPlan: optionalStringValue(overrides, existingFm, "parentPlan"),
        order: Object.hasOwn(overrides, "order")
            ? normalizeNonNegativeInteger(overrides.order)
            : normalizeNonNegativeInteger(existingFm.order),
        dependencies: Object.hasOwn(overrides, "dependencies")
            ? normalizeStringList(overrides.dependencies)
            : normalizeStringList(existingFm.dependencies),
        failureReason: optionalFrontMatterValue(overrides, existingFm, "failureReason"),
        failedAt: optionalFrontMatterValue(overrides, existingFm, "failedAt"),
        implementedAt: optionalFrontMatterValue(overrides, existingFm, "implementedAt"),
        verifiedAt: optionalFrontMatterValue(overrides, existingFm, "verifiedAt"),
        humanReviewMode: normalizeHumanReviewMode(
            Object.hasOwn(overrides, "humanReviewMode") ? overrides.humanReviewMode : existingFm.humanReviewMode,
        ),
        humanReviewDecision: normalizeHumanReviewDecision(
            Object.hasOwn(overrides, "humanReviewDecision")
                ? overrides.humanReviewDecision
                : existingFm.humanReviewDecision,
        ),
        humanReviewedAt: optionalFrontMatterValue(overrides, existingFm, "humanReviewedAt"),
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
        heldFromStatus: Object.hasOwn(overrides, "heldFromStatus")
            ? normalizePlanStatusForOptionalHold(overrides.heldFromStatus)
            : normalizePlanStatusForOptionalHold(existingFm.heldFromStatus),
        heldAt: optionalFrontMatterValue(overrides, existingFm, "heldAt"),
        holdReason: optionalFrontMatterValue(overrides, existingFm, "holdReason"),
        holdStalenessBaseline: optionalFrontMatterValue(overrides, existingFm, "holdStalenessBaseline"),
        archivedAt: optionalFrontMatterValue(overrides, existingFm, "archivedAt"),
        archiveReason: optionalFrontMatterValue(overrides, existingFm, "archiveReason"),
        archivedFromStatus: Object.hasOwn(overrides, "archivedFromStatus")
            ? normalizePlanStatusForOptionalHold(overrides.archivedFromStatus)
            : normalizePlanStatusForOptionalHold(existingFm.archivedFromStatus),
        archivedFromPath: optionalFrontMatterValue(overrides, existingFm, "archivedFromPath"),
        restoredAt: optionalFrontMatterValue(overrides, existingFm, "restoredAt"),
        restoredFromPath: optionalFrontMatterValue(overrides, existingFm, "restoredFromPath"),
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
            planId: normalizePlanId(attrs.planId),
            classification: attrs.classification || DEFAULT_FRONT_MATTER.classification,
            complexity: attrs.complexity || DEFAULT_FRONT_MATTER.complexity,
            summary: attrs.summary || DEFAULT_FRONT_MATTER.summary,
            affectedPaths: normalizeStringList(attrs.affectedPaths) || DEFAULT_FRONT_MATTER.affectedPaths,
            frontend: normalizeOptionalBoolean(attrs.frontend),
            devServerCommand: typeof attrs.devServerCommand === "string"
                ? attrs.devServerCommand
                : attrs.devServerCommand === null
                ? null
                : undefined,
            devServerUrl: typeof attrs.devServerUrl === "string"
                ? attrs.devServerUrl
                : attrs.devServerUrl === null
                ? null
                : undefined,
            devServerHmr: attrs.devServerHmr === null ? null : normalizeOptionalBoolean(attrs.devServerHmr),
            createdAt: attrs.createdAt || DEFAULT_FRONT_MATTER.createdAt,
            updatedAt: attrs.updatedAt,
            status: normalizePlanStatus(attrs.status),
            origin: attrs.origin || missingOrigin,
            type: typeof attrs.type === "string" ? attrs.type : undefined,
            parentPlan: typeof attrs.parentPlan === "string" ? attrs.parentPlan : undefined,
            order: normalizeNonNegativeInteger(attrs.order),
            dependencies: normalizeStringList(attrs.dependencies),
            failureReason: attrs.failureReason,
            failedAt: attrs.failedAt,
            implementedAt: attrs.implementedAt,
            verifiedAt: attrs.verifiedAt,
            humanReviewMode: normalizeHumanReviewMode(attrs.humanReviewMode),
            humanReviewDecision: normalizeHumanReviewDecision(attrs.humanReviewDecision),
            humanReviewedAt: attrs.humanReviewedAt,
            epicCompletionMode: attrs.epicCompletionMode === "done_enough" ? attrs.epicCompletionMode : undefined,
            epicDoneEnoughAt: attrs.epicDoneEnoughAt,
            epicDoneEnoughSummary: attrs.epicDoneEnoughSummary,
            executionBaselineTree: attrs.executionBaselineTree,
            worktreeId: attrs.worktreeId,
            worktreePath: attrs.worktreePath,
            worktreeBranch: attrs.worktreeBranch,
            worktreeStatus: normalizeWorktreeStatus(attrs.worktreeStatus),
            heldFromStatus: normalizePlanStatusForOptionalHold(attrs.heldFromStatus),
            heldAt: attrs.heldAt,
            holdReason: attrs.holdReason,
            holdStalenessBaseline: attrs.holdStalenessBaseline,
            archivedAt: attrs.archivedAt,
            archiveReason: attrs.archiveReason,
            archivedFromStatus: normalizePlanStatusForOptionalHold(attrs.archivedFromStatus),
            archivedFromPath: attrs.archivedFromPath,
            restoredAt: attrs.restoredAt,
            restoredFromPath: attrs.restoredFromPath,
        },
        body,
    };
}

/**
 * @typedef {Object} SplitPlanBody
 * @property {string} frontMatterBlock
 * @property {string} body
 */

/**
 * Split raw markdown into the exact leading front matter block and body.
 * @param {string} markdown
 * @returns {SplitPlanBody}
 */
export function splitPlanMarkdownBody(markdown) {
    if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
        throw new Error("Plan body editing requires a valid leading front matter block.");
    }

    let lineStart = markdown.startsWith("---\r\n") ? 5 : 4;
    while (lineStart <= markdown.length) {
        const nextLf = markdown.indexOf("\n", lineStart);
        const lineEnd = nextLf === -1 ? markdown.length : nextLf;
        const rawLine = markdown.slice(lineStart, lineEnd);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line === "---") {
            const bodyStart = nextLf === -1 ? markdown.length : nextLf + 1;
            return {
                frontMatterBlock: markdown.slice(0, bodyStart),
                body: markdown.slice(bodyStart),
            };
        }
        if (nextLf === -1) break;
        lineStart = nextLf + 1;
    }

    throw new Error("Plan body editing requires a closed leading front matter block.");
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function formatErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} line
 * @param {string} key
 * @returns {boolean}
 */
function isTopLevelYamlKeyLine(line, key) {
    return line.startsWith(`${key}:`) || line.startsWith(`${key} :`);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isAnyTopLevelYamlKeyLine(line) {
    return /^[^\s#][^:]*\s*:/.test(line);
}

/**
 * Remove a top-level YAML key and any indented/list continuation lines from a front matter body.
 * @param {string[]} lines
 * @param {string} key
 * @returns {string[]}
 */
function removeTopLevelYamlKey(lines, key) {
    /** @type {string[]} */
    const kept = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!isTopLevelYamlKeyLine(line, key)) {
            kept.push(line);
            continue;
        }

        index++;
        while (index < lines.length && !isAnyTopLevelYamlKeyLine(lines[index])) index++;
        index--;
    }
    return kept;
}

/**
 * Build YAML lines for only the provided override fields.
 * @param {Partial<PlanFrontMatter>} overrides
 * @returns {string[]}
 */
function formatFrontMatterOverrideLines(overrides) {
    /** @type {string[]} */
    const lines = [];
    for (const key of PLAN_FRONT_MATTER_KEY_ORDER) {
        if (Object.hasOwn(overrides, key)) {
            appendYamlField(lines, key, /** @type {Record<string, unknown>} */ (overrides)[key]);
        }
    }
    return lines;
}

/**
 * Update only selected front matter fields while preserving untouched YAML text and body bytes.
 * @param {string} markdown
 * @param {Partial<PlanFrontMatter>} overrides
 * @returns {string}
 */
function mergeFrontMatterText(markdown, overrides) {
    if (!hasFrontMatter(markdown)) return injectFrontMatter(markdown, overrides);

    const { frontMatterBlock, body } = splitPlanMarkdownBody(markdown);
    const eol = frontMatterBlock.includes("\r\n") ? "\r\n" : "\n";
    const lines = frontMatterBlock.replace(/\r?\n$/, "").split(/\r?\n/);
    const closingIndex = lines.length - 1;
    let innerLines = lines.slice(1, closingIndex);
    for (const key of PLAN_FRONT_MATTER_KEY_ORDER) {
        if (Object.hasOwn(overrides, key)) innerLines = removeTopLevelYamlKey(innerLines, key);
    }

    const overrideLines = formatFrontMatterOverrideLines(overrides);
    const mergedLines = ["---", ...innerLines, ...overrideLines, "---"];
    return `${mergedLines.join(eol)}${eol}${body}`;
}

/**
 * @param {string} body
 * @returns {Promise<string>}
 */
export async function hashPlanBody(body) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class StalePlanBodyError extends Error {
    /**
     * @param {string} expectedBodyHash
     * @param {string} currentBodyHash
     */
    constructor(expectedBodyHash, currentBodyHash) {
        super("Plan body changed on disk after this editor loaded.");
        this.name = "StalePlanBodyError";
        this.expectedBodyHash = expectedBodyHash;
        this.currentBodyHash = currentBodyHash;
    }
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

    const rawOrder = Object.hasOwn(descriptor, "order") ? descriptor.order : descriptor.sequence;
    const order = normalizeNonNegativeInteger(rawOrder);
    if (rawOrder !== undefined && order === undefined) {
        throw new Error(`Child plan order must be a non-negative integer: ${rawOrder}`);
    }
    descriptor.order = order;

    return /** @type {ChildFeaturePlanDescriptor} */ (descriptor);
}

/**
 * @param {ChildFeaturePlanDescriptor} child
 * @returns {string}
 */
function buildChildPlanNameSegment(child) {
    const slug = slugifyPlanTitle(child.title);
    if (!slug) throw new Error(`Child plan title must produce a valid plan name: ${child.title}`);
    return `${formatChildSequencePrefix(child.order)}${slug}`;
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
        /** @type {Partial<PlanFrontMatter> & { classification: "FEATURE", status: "draft", parentPlan: string, order?: number, affectedPaths: string[] }} */
        const metadata = {
            classification: /** @type {const} */ ("FEATURE"),
            status: /** @type {const} */ ("draft"),
            parentPlan: parentPlanName,
            order: child.order,
            affectedPaths,
        };
        const frontend = normalizeOptionalBoolean(child.frontend);
        const devServerCommand = typeof child.devServerCommand === "string"
            ? child.devServerCommand
            : child.devServerCommand === null
            ? null
            : undefined;
        const devServerUrl = typeof child.devServerUrl === "string"
            ? child.devServerUrl
            : child.devServerUrl === null
            ? null
            : undefined;
        const devServerHmr = child.devServerHmr === null ? null : normalizeOptionalBoolean(child.devServerHmr);
        if (frontend !== undefined) metadata.frontend = frontend;
        if (devServerCommand !== undefined) metadata.devServerCommand = devServerCommand;
        if (devServerUrl !== undefined) metadata.devServerUrl = devServerUrl;
        if (devServerHmr !== undefined) metadata.devServerHmr = devServerHmr;
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
 * Load an external plan (a pre-existing markdown file not created by RunWield)
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
 * @typedef {Object} PlanResourceEntry
 * @property {string} name - Canonical plan name relative to plans/ without .md.
 * @property {string} planName - Alias for name used by resource consumers.
 * @property {string} relativePath - Project-relative markdown path, e.g. plans/name.md.
 * @property {string} path - Absolute markdown path.
 * @property {string} planId - Durable resource identity.
 * @property {PlanFrontMatter} attrs - Parsed front matter including planId.
 * @property {string} [body] - Parsed markdown body when loaded by identity helpers.
 * @property {string} [markdown] - Full markdown when loaded by identity helpers.
 */

/**
 * @typedef {Object} PlanParseIssue
 * @property {string} name
 * @property {string} path
 * @property {string} message
 */

/**
 * @param {string} dir
 * @param {string[]} prefix
 * @param {Array<{ name: string, path: string, attrs: PlanFrontMatter }>} results
 * @param {PlanParseIssue[]} [parseIssues]
 * @returns {Promise<void>}
 */
async function collectPlans(dir, prefix, results, parseIssues) {
    for await (const entry of Deno.readDir(dir)) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory) {
            if (prefix.length === 0 && HIDDEN_PLAN_DIRS.has(entry.name)) continue;
            await collectPlans(entryPath, [...prefix, entry.name], results, parseIssues);
            continue;
        }
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const name = [...prefix, entry.name.replace(/\.md$/, "")].join("/");
        try {
            const markdown = await Deno.readTextFile(entryPath);
            const { attrs } = parsePlanFrontMatter(markdown);
            results.push({ name, path: entryPath, attrs });
        } catch (error) {
            parseIssues?.push({ name, path: entryPath, message: formatErrorMessage(error) });
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

const ARCHIVED_DIR_NAME = "archived";
const TERMINAL_ARCHIVABLE_STATUSES = new Set(["verified", "closed_without_verification"]);
const RECOVERABLE_WORKTREE_STATUSES = new Set(["active", "execution_failed", "validation_failed", "merge_conflict"]);

/**
 * @typedef {Object} ArchivePlanOptions
 * @property {string} [reason]
 * @property {boolean} [force]
 * @property {string} [now]
 */

/**
 * @typedef {Object} ArchivedPlanEntry
 * @property {string} name
 * @property {string} planName
 * @property {string} relativePath
 * @property {string} path
 * @property {PlanFrontMatter} attrs
 * @property {string} status
 * @property {string} summary
 * @property {string} [planId]
 */

/**
 * @param {string} cwd
 * @returns {string}
 */
function getArchivedPlansDir(cwd) {
    return join(getPlansDir(cwd), ARCHIVED_DIR_NAME);
}

/**
 * @param {string} cwd
 * @param {string} absolutePath
 * @returns {string}
 */
function projectRelativePath(cwd, absolutePath) {
    return relative(cwd, absolutePath).replaceAll("\\", "/");
}

/**
 * @param {string} cwd
 * @param {string} planName
 * @returns {{ name: string, segments: string[], filePath: string }}
 */
function getArchivedPlanLocation(cwd, planName) {
    const { segments } = canonicalizeStoredPlanName(planName);
    const archiveSegments = segments[0] === ARCHIVED_DIR_NAME ? segments.slice(1) : segments;
    if (archiveSegments.length === 0) throw new Error("Archived plan name cannot be empty");
    return {
        name: archiveSegments.join("/"),
        segments: archiveSegments,
        filePath: join(getArchivedPlansDir(cwd), ...archiveSegments) + ".md",
    };
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function fileExists(path) {
    try {
        const stat = await Deno.stat(path);
        return stat.isFile;
    } catch {
        return false;
    }
}

/**
 * @param {string} cwd
 * @param {string} planNameOrId
 * @returns {Promise<{ name: string, path: string, attrs: PlanFrontMatter, body: string, markdown: string }>}
 */
async function resolveActivePlanNameOrId(cwd, planNameOrId) {
    const byName = await loadPlan(cwd, planNameOrId).catch(() => null);
    if (byName) {
        const { name } = canonicalizeStoredPlanName(planNameOrId);
        if (isHiddenPlanName(name)) {
            throw new Error(`Use an active Plan name, not ${ARCHIVED_DIR_NAME}/...: ${planNameOrId}`);
        }
        return { name, ...byName };
    }

    const planId = normalizePlanId(planNameOrId);
    if (planId) {
        const matches = (await listPlans(cwd)).filter((plan) => plan.attrs.planId === planId);
        if (matches.length > 1) {
            throw new Error(`Duplicate planId values found for ${planId}; repair plan front matter before continuing.`);
        }
        if (matches.length === 1) {
            const loaded = await loadPlan(cwd, matches[0].name);
            if (loaded) return { name: matches[0].name, ...loaded };
        }
    }

    throw new Error(`Active Plan not found: ${planNameOrId}`);
}

/**
 * @param {string} cwd
 * @param {string} archivedPlanNameOrId
 * @returns {Promise<{ name: string, path: string, attrs: PlanFrontMatter, body: string, markdown: string }>}
 */
async function resolveArchivedPlanNameOrId(cwd, archivedPlanNameOrId) {
    const archived = await loadArchivedPlan(cwd, archivedPlanNameOrId);
    if (archived) return archived;
    throw new Error(`Archived Plan not found: ${archivedPlanNameOrId}`);
}

/**
 * Archive an active Plan by name or planId into plans/archived/.
 * @param {string} cwd
 * @param {string} planNameOrId
 * @param {ArchivePlanOptions} [options]
 * @returns {Promise<{ name: string, fromPath: string, toPath: string, relativePath: string, attrs: PlanFrontMatter }>}
 */
export async function archivePlan(cwd, planNameOrId, options = {}) {
    const source = await resolveActivePlanNameOrId(cwd, planNameOrId);
    if (source.name.split("/")[0] === ARCHIVED_DIR_NAME) {
        throw new Error(`Cannot archive from ${ARCHIVED_DIR_NAME}/...; choose an active Plan name.`);
    }

    const worktreeStatus = source.attrs.worktreeStatus;
    if (worktreeStatus && RECOVERABLE_WORKTREE_STATUSES.has(worktreeStatus)) {
        throw new Error(
            `Cannot archive ${source.name}: worktreeStatus ${worktreeStatus} is recoverable. Resolve or abandon the worktree first.`,
        );
    }

    const status = source.attrs.status;
    if (!TERMINAL_ARCHIVABLE_STATUSES.has(status) && !options.force) {
        throw new Error(
            `Cannot archive ${source.name} with status ${status} without --force. Only verified and closed_without_verification archive by default.`,
        );
    }

    const destination = getArchivedPlanLocation(cwd, source.name);
    if (await fileExists(destination.filePath)) {
        throw new Error(`Archived Plan already exists: ${projectRelativePath(cwd, destination.filePath)}`);
    }

    const now = options.now || new Date().toISOString();
    /** @type {Partial<PlanFrontMatter>} */
    const archiveMetadata = {
        archivedAt: now,
        archivedFromStatus: status,
        archivedFromPath: projectRelativePath(cwd, source.path),
        updatedAt: now,
    };
    if (options.reason !== undefined) archiveMetadata.archiveReason = options.reason;
    const markdown = mergeFrontMatterText(source.markdown, archiveMetadata);
    await Deno.mkdir(join(getArchivedPlansDir(cwd), ...destination.segments.slice(0, -1)), { recursive: true });
    await Deno.writeTextFile(source.path, markdown);
    await Deno.rename(source.path, destination.filePath);

    return {
        name: source.name,
        fromPath: source.path,
        toPath: destination.filePath,
        relativePath: projectRelativePath(cwd, destination.filePath),
        attrs: parsePlanFrontMatter(markdown).attrs,
    };
}

/**
 * List archived Plans under plans/archived/.
 * @param {string} cwd
 * @returns {Promise<ArchivedPlanEntry[]>}
 */
export async function listArchivedPlans(cwd) {
    const dir = getArchivedPlansDir(cwd);
    /** @type {Array<{ name: string, path: string, attrs: PlanFrontMatter }>} */
    const results = [];
    /** @type {PlanParseIssue[]} */
    const parseIssues = [];
    try {
        await collectPlans(dir, [], results, parseIssues);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
    }
    for (const issue of parseIssues) {
        console.warn(`Skipping malformed archived Plan ${projectRelativePath(cwd, issue.path)}: ${issue.message}`);
    }
    return results.sort((a, b) => a.name.localeCompare(b.name)).map((plan) => ({
        name: plan.name,
        planName: plan.name,
        relativePath: projectRelativePath(cwd, plan.path),
        path: plan.path,
        attrs: plan.attrs,
        status: plan.attrs.status,
        summary: plan.attrs.summary || "",
        planId: plan.attrs.planId,
    }));
}

/**
 * @param {string} cwd
 * @param {string} archivedPlanName
 * @returns {Promise<{ name: string, path: string, markdown: string, attrs: PlanFrontMatter, body: string } | null>}
 */
async function loadArchivedPlanByName(cwd, archivedPlanName) {
    const { name, filePath } = getArchivedPlanLocation(cwd, archivedPlanName);
    let markdown;
    try {
        markdown = await Deno.readTextFile(filePath);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }

    try {
        const { attrs, body } = parsePlanFrontMatter(markdown);
        return { name, path: filePath, markdown, attrs, body };
    } catch (error) {
        throw new Error(
            `Malformed archived Plan ${projectRelativePath(cwd, filePath)}: ${formatErrorMessage(error)}`,
        );
    }
}

/**
 * Load an archived Plan by archived name/path or durable planId.
 * @param {string} cwd
 * @param {string} archivedPlanNameOrId
 * @returns {Promise<{ name: string, path: string, markdown: string, attrs: PlanFrontMatter, body: string } | null>}
 */
export async function loadArchivedPlan(cwd, archivedPlanNameOrId) {
    const byName = await loadArchivedPlanByName(cwd, archivedPlanNameOrId);
    if (byName) return byName;

    const planId = normalizePlanId(archivedPlanNameOrId);
    if (!planId) return null;

    const matches = (await listArchivedPlans(cwd)).filter((plan) => plan.planId === planId);
    if (matches.length > 1) {
        throw new Error(`Duplicate archived planId values found for ${planId}; use an archived Plan name instead.`);
    }
    if (matches.length === 0) return null;
    return await loadArchivedPlanByName(cwd, matches[0].name);
}

/**
 * Restore an archived Plan back under plans/.
 * @param {string} cwd
 * @param {string} archivedPlanNameOrId
 * @param {{ to?: string, now?: string }} [options]
 * @returns {Promise<{ name: string, fromPath: string, toPath: string, relativePath: string, attrs: PlanFrontMatter }>}
 */
export async function restoreArchivedPlan(cwd, archivedPlanNameOrId, options = {}) {
    const archived = await resolveArchivedPlanNameOrId(cwd, archivedPlanNameOrId);
    const destination = getStoredPlanLocation(cwd, options.to || archived.name);
    if (destination.segments[0] === ARCHIVED_DIR_NAME) {
        throw new Error("Restore destination must be an active Plan name, not archived/...");
    }
    if (await fileExists(destination.filePath)) {
        throw new Error(`Active Plan already exists: ${projectRelativePath(cwd, destination.filePath)}`);
    }

    const now = options.now || new Date().toISOString();
    const markdown = mergeFrontMatterText(archived.markdown, {
        restoredAt: now,
        restoredFromPath: projectRelativePath(cwd, archived.path),
        updatedAt: now,
    });
    await Deno.mkdir(join(getPlansDir(cwd), ...destination.segments.slice(0, -1)), { recursive: true });
    await Deno.writeTextFile(archived.path, markdown);
    await Deno.rename(archived.path, destination.filePath);

    return {
        name: destination.name,
        fromPath: archived.path,
        toPath: destination.filePath,
        relativePath: projectRelativePath(cwd, destination.filePath),
        attrs: parsePlanFrontMatter(markdown).attrs,
    };
}

/**
 * Compare Epic child plans by explicit order first, then canonical name.
 *
 * @template {{ name: string, attrs: PlanFrontMatter }} T
 * @param {T} a
 * @param {T} b
 * @returns {number}
 */
export function compareChildPlansByOrder(a, b) {
    const aOrder = a.attrs.order;
    const bOrder = b.attrs.order;
    if (aOrder !== undefined && bOrder !== undefined && aOrder !== bOrder) return aOrder - bOrder;
    if (aOrder !== undefined && bOrder === undefined) return -1;
    if (aOrder === undefined && bOrder !== undefined) return 1;
    return a.name.localeCompare(b.name);
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isHiddenPlanName(name) {
    return HIDDEN_PLAN_DIRS.has(name.split("/")[0] || "");
}

/**
 * Rewrite only formatted front matter and concatenate the original parsed body exactly.
 *
 * @param {PlanFrontMatter} attrs
 * @param {string} body
 * @returns {string}
 */
function rewritePlanMetadata(attrs, body) {
    return `${formatFrontMatter(attrs)}\n${body}`;
}

/**
 * @param {Array<{ name: string, path: string, attrs: PlanFrontMatter }>} plans
 * @returns {Map<string, Array<{ name: string, path: string, attrs: PlanFrontMatter }>>}
 */
function groupExistingPlanIds(plans) {
    /** @type {Map<string, Array<{ name: string, path: string, attrs: PlanFrontMatter }>>} */
    const byId = new Map();
    for (const plan of plans) {
        if (!plan.attrs.planId) continue;
        const entries = byId.get(plan.attrs.planId) || [];
        entries.push(plan);
        byId.set(plan.attrs.planId, entries);
    }
    return byId;
}

/**
 * @param {Map<string, Array<{ name: string }>>} byId
 */
function assertNoDuplicatePlanIds(byId) {
    const duplicates = [...byId.entries()].filter(([, plans]) => plans.length > 1);
    if (duplicates.length === 0) return;
    const details = duplicates.map(([planId, plans]) => `${planId}: ${plans.map((plan) => plan.name).join(", ")}`).join(
        "; ",
    );
    throw new Error(`Duplicate planId values found; repair plan front matter before continuing: ${details}`);
}

/**
 * @typedef {Object} PlanResource
 * @property {string} planName
 * @property {string} name
 * @property {string} relativePath
 * @property {string} path
 * @property {string} planId
 * @property {PlanFrontMatter} attrs
 * @property {string} body
 * @property {string} markdown
 */

/**
 * Ensure a single saved Plan has a durable planId.
 *
 * @param {string} cwd
 * @param {string} planName
 * @param {{ idGenerator?: () => string, __testGenerateId?: () => string, reservedPlanIds?: Set<string> }} [options]
 * @returns {Promise<PlanResource>}
 */
export async function ensurePlanIdentity(cwd, planName, options = {}) {
    const { name } = canonicalizeStoredPlanName(planName);
    const plan = await loadPlan(cwd, name);
    if (!plan) throw new Error(`Plan not found: ${planName}`);
    if (isHiddenPlanName(name)) {
        throw new Error(`Plan is archived or hidden and cannot be assigned a planId: ${name}`);
    }

    let reservedPlanIds = options.reservedPlanIds;
    if (!reservedPlanIds) {
        const plans = await listPlans(cwd);
        const byId = groupExistingPlanIds(plans);
        assertNoDuplicatePlanIds(byId);
        reservedPlanIds = new Set(byId.keys());
    }
    const idGenerator = options.idGenerator || options.__testGenerateId || (() => crypto.randomUUID());
    let planId = normalizePlanId(plan.attrs.planId);
    let markdown = plan.markdown;
    let attrs = { ...plan.attrs, planId };

    if (!planId) {
        do {
            planId = normalizePlanId(idGenerator());
        } while (!planId || reservedPlanIds.has(planId));
        attrs = { ...plan.attrs, planId };
        markdown = rewritePlanMetadata(attrs, plan.body);
        await Deno.writeTextFile(plan.path, markdown);
    }

    return {
        planName: name,
        name,
        relativePath: `${PLANS_DIR_NAME}/${name}.md`,
        path: plan.path,
        planId,
        attrs: /** @type {PlanFrontMatter} */ (attrs),
        body: plan.body,
        markdown,
    };
}

/**
 * List non-archived Plans as durable resources, optionally backfilling missing IDs.
 *
 * @param {string} cwd
 * @param {{ backfillMissing?: boolean, idGenerator?: () => string, __testGenerateId?: () => string }} [options]
 * @returns {Promise<PlanResource[]>}
 */
export async function listPlanResources(cwd, options = {}) {
    const backfillMissing = options.backfillMissing !== false;
    const plans = await listPlans(cwd);
    const byId = groupExistingPlanIds(plans);
    assertNoDuplicatePlanIds(byId);
    const reservedPlanIds = new Set(byId.keys());

    /** @type {PlanResource[]} */
    const resources = [];
    for (const plan of plans) {
        if (!plan.attrs.planId && !backfillMissing) {
            const loaded = await loadPlan(cwd, plan.name);
            if (!loaded) continue;
            resources.push({
                planName: plan.name,
                name: plan.name,
                relativePath: `${PLANS_DIR_NAME}/${plan.name}.md`,
                path: loaded.path,
                planId: "",
                attrs: loaded.attrs,
                body: loaded.body,
                markdown: loaded.markdown,
            });
            continue;
        }

        const resource = await ensurePlanIdentity(cwd, plan.name, {
            idGenerator: options.idGenerator || options.__testGenerateId,
            reservedPlanIds,
        });
        reservedPlanIds.add(resource.planId);
        resources.push(resource);
    }

    return resources.sort((a, b) => a.planName.localeCompare(b.planName));
}

/**
 * Find a non-archived Plan resource by durable planId.
 *
 * @param {string} cwd
 * @param {string} planId
 * @returns {Promise<PlanResource>}
 */
export async function findPlanById(cwd, planId) {
    const normalized = normalizePlanId(planId);
    if (!normalized) throw new Error("Plan ID cannot be empty");
    const resources = await listPlanResources(cwd);
    const matches = resources.filter((resource) => resource.planId === normalized);
    if (matches.length > 1) {
        throw new Error(`Duplicate planId values found for ${normalized}; repair plan front matter before continuing.`);
    }
    if (matches.length === 0) throw new Error(`Plan not found for planId: ${normalized}`);
    return matches[0];
}

/**
 * @typedef {PlanResource & { bodyHash: string }} PlanBodyResource
 */

/**
 * Load editable body metadata for a non-archived Plan by durable planId.
 * @param {string} cwd
 * @param {string} planId
 * @returns {Promise<PlanBodyResource>}
 */
export async function loadPlanBodyById(cwd, planId) {
    const resource = await findPlanById(cwd, planId);
    if (isEpicPlan(resource.attrs)) throw new Error("Epic Plan bodies are not editable in the workspace body editor.");
    const markdown = await Deno.readTextFile(resource.path);
    parsePlanFrontMatter(markdown);
    const { body } = splitPlanMarkdownBody(markdown);
    return {
        ...resource,
        body,
        markdown,
        bodyHash: await hashPlanBody(body),
    };
}

/**
 * Save only the markdown body while preserving the exact raw front matter block.
 * @param {string} cwd
 * @param {string} planId
 * @param {string} newBody
 * @param {string} expectedBodyHash
 * @returns {Promise<PlanBodyResource>}
 */
export async function savePlanBodyById(cwd, planId, newBody, expectedBodyHash) {
    const resource = await findPlanById(cwd, planId);
    if (isEpicPlan(resource.attrs)) throw new Error("Epic Plan bodies are not editable in the workspace body editor.");
    const markdown = await Deno.readTextFile(resource.path);
    const { attrs } = parsePlanFrontMatter(markdown);
    const { frontMatterBlock, body } = splitPlanMarkdownBody(markdown);
    const currentBodyHash = await hashPlanBody(body);
    if (currentBodyHash !== expectedBodyHash) {
        throw new StalePlanBodyError(expectedBodyHash, currentBodyHash);
    }

    const nextMarkdown = `${frontMatterBlock}${newBody}`;
    await Deno.writeTextFile(resource.path, nextMarkdown);
    return {
        ...resource,
        attrs,
        body: newBody,
        markdown: nextMarkdown,
        bodyHash: await hashPlanBody(newBody),
    };
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
    return plans.filter((plan) => plan.attrs.parentPlan === name).sort(compareChildPlansByOrder);
}

/**
 * Resolve child FEATURE dependencies against already-loaded sibling summaries.
 *
 * Supported dependency identifiers are either the canonical child plan name
 * (`epic/01-first`) or the sibling child segment (`01-first`). Title-only
 * aliases are intentionally not inferred because child plan slugs are the
 * durable identifiers stored on disk.
 *
 * @param {string} parentPlan
 * @param {unknown} dependencies
 * @param {Array<{ name: string, planName?: string, planId?: string, path?: string, attrs?: any, status?: string }>} siblings
 * @returns {Array<{ dependency: string, planId?: string, planName?: string, path?: string, status?: string, state: "verified" | "unverified" | "missing" }>}
 */
export function resolveSiblingChildPlanDependencyStates(parentPlan, dependencies, siblings) {
    const { name: parentPlanName } = canonicalizeStoredPlanName(parentPlan);
    const dependencyNames = normalizeStringList(dependencies) || [];
    if (dependencyNames.length === 0) return [];

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
        const status = sibling.status || sibling.attrs?.status;
        const resolved = {
            dependency,
            planId: sibling.planId,
            planName: sibling.planName || sibling.name,
            path: sibling.path,
            status,
        };
        return {
            ...resolved,
            state: status === "verified" ? /** @type {const} */ ("verified") : /** @type {const} */ ("unverified"),
        };
    });
}

/**
 * Resolve child FEATURE dependencies relative to a shared parent Epic.
 *
 * @param {string} cwd
 * @param {string} parentPlan
 * @param {unknown} dependencies
 * @returns {Promise<Array<{ dependency: string, planId?: string, planName?: string, path?: string, status?: string, state: "verified" | "unverified" | "missing" }>>}
 */
export async function resolveSiblingChildPlanDependencies(cwd, parentPlan, dependencies) {
    const { name: parentPlanName } = canonicalizeStoredPlanName(parentPlan);
    const siblings = await findPlansByParent(cwd, parentPlanName);
    return resolveSiblingChildPlanDependencyStates(parentPlanName, dependencies, siblings);
}

/**
 * @param {{ attrs: PlanFrontMatter }} plan
 * @returns {boolean}
 */
export function isChildFeaturePlan(plan) {
    return plan.attrs.classification === "FEATURE" && typeof plan.attrs.parentPlan === "string" &&
        plan.attrs.parentPlan.trim().length > 0;
}

/**
 * Same Epic rule used by the Plan Lifecycle module, kept here cycle-free.
 *
 * @param {Partial<PlanFrontMatter> | undefined} attrs
 * @returns {boolean}
 */
export function isEpicPlan(attrs) {
    return attrs?.classification === "PROJECT" && attrs?.type === "epic";
}

/**
 * @template {{ name: string, attrs: PlanFrontMatter }} T
 * @param {T[]} plans
 * @returns {{ epics: T[], childrenByParent: Map<string, T[]>, standalone: T[], orphanChildren: T[] }}
 */
export function groupPlanHierarchy(plans) {
    const epics = plans.filter((plan) => isEpicPlan(plan.attrs));
    const epicNames = new Set(epics.map((plan) => plan.name));
    /** @type {Map<string, T[]>} */
    const childrenByParent = new Map();
    /** @type {T[]} */
    const standalone = [];
    /** @type {T[]} */
    const orphanChildren = [];

    for (const plan of plans) {
        if (isEpicPlan(plan.attrs)) continue;

        if (isChildFeaturePlan(plan)) {
            const parentPlan = plan.attrs.parentPlan || "";
            if (epicNames.has(parentPlan)) {
                const children = childrenByParent.get(parentPlan) || [];
                children.push(plan);
                childrenByParent.set(parentPlan, children);
            } else {
                orphanChildren.push(plan);
            }
            continue;
        }

        standalone.push(plan);
    }

    for (const children of childrenByParent.values()) children.sort(compareChildPlansByOrder);
    orphanChildren.sort(compareChildPlansByOrder);

    return { epics, childrenByParent, standalone, orphanChildren };
}

/**
 * @param {Array<{ attrs?: any, status?: string }>} children
 * @returns {{ verified: number, active: number, failed: number, onHold: number, remaining: number, total: number, byStatus: Record<string, number> }}
 */
export function countChildPlanProgress(children) {
    /** @type {Record<string, number>} */
    const byStatus = {};
    for (const child of children) {
        const status = child.status || child.attrs?.status || "draft";
        byStatus[status] = (byStatus[status] || 0) + 1;
    }
    const verified = byStatus.verified || 0;
    const active = (byStatus.in_progress || 0) + (byStatus.implemented || 0);
    const failed = byStatus.failed || 0;
    const onHold = byStatus.on_hold || 0;
    const total = children.length;
    const remaining = total - verified - active - failed - onHold;
    return { verified, active, failed, onHold, remaining, total, byStatus };
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
