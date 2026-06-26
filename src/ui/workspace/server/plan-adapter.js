/**
 * Server-only Plan adapter for the read-only Workspace.
 */

import {
    countChildPlanProgress,
    findPlanById,
    groupPlanHierarchy,
    isChildFeaturePlan,
    isEpicPlan,
    listPlanResources,
    resolveSiblingChildPlanDependencyStates,
} from "../../../plan-store.js";
import {
    ACTIVE_PLAN_STATUSES,
    CLOSED_PLAN_STATUSES,
    ON_HOLD_PLAN_STATUSES,
} from "../../../shared/workflow/plan-lifecycle.js";

export const ACTIVE_STATUSES = ACTIVE_PLAN_STATUSES;
export const CLOSED_STATUSES = CLOSED_PLAN_STATUSES;
export const ON_HOLD_STATUSES = ON_HOLD_PLAN_STATUSES;

export const STATUS_META = {
    draft: {
        status: "draft",
        label: "Draft",
        description: "Plans still being shaped.",
    },
    feedback: {
        status: "feedback",
        label: "Feedback",
        description: "Plans waiting on review or revisions.",
    },
    approved: {
        status: "approved",
        label: "Approved",
        description: "Approved work not yet queued for execution.",
    },
    ready_for_decomposition: {
        status: "ready_for_decomposition",
        label: "Ready for Decomposition",
        description: "Epics ready for child FEATURE slicing.",
    },
    ready_for_work: {
        status: "ready_for_work",
        label: "Ready for Work",
        description: "Executable work ready for an agent.",
    },
    in_progress: {
        status: "in_progress",
        label: "In Progress",
        description: "Work currently underway or reserved.",
    },
    failed: {
        status: "failed",
        label: "Failed",
        description: "Work that needs recovery attention.",
    },
    implemented: {
        status: "implemented",
        label: "Implemented",
        description: "Implemented work awaiting validation or closure.",
    },
    verified: {
        status: "verified",
        label: "Verified",
        description: "Work verified by RunWield Workflow Validation.",
    },
    closed_without_verification: {
        status: "closed_without_verification",
        label: "Closed without Verification",
        description: "Work manually accepted or ended without Workflow Validation.",
    },
    on_hold: {
        status: "on_hold",
        label: "On Hold",
        description: "Paused work that should stay out of active planning.",
    },
};

export const BOARD_SCREENS = {
    active: {
        id: "active",
        path: "/",
        title: "Plan Board",
        eyebrow: "Workspace view",
        description: "Active work grouped by RunWield Plan Status.",
        statuses: ACTIVE_STATUSES,
    },
    closed: {
        id: "closed",
        path: "/closed",
        title: "Closed Plans",
        eyebrow: "Plan Board",
        description: "Terminal Plans separated from day-to-day planning.",
        statuses: CLOSED_STATUSES,
    },
    onHold: {
        id: "onHold",
        path: "/on-hold",
        title: "On Hold",
        eyebrow: "Plan Board",
        description: "Paused Plans that are neither active nor complete.",
        statuses: ON_HOLD_STATUSES,
    },
};

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function safeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/**
 * @param {any} resource
 * @returns {any}
 */
export function serializePlanSummary(resource) {
    const attrs = safeObject(resource.attrs);
    return {
        planId: resource.planId,
        planName: resource.planName || resource.name,
        name: resource.planName || resource.name,
        attrs,
        relativePath: resource.relativePath,
        status: attrs.status || "draft",
        classification: attrs.classification || "FEATURE",
        type: attrs.type || "",
        title: attrs.title || resource.planName || resource.name,
        summary: attrs.summary || "",
        complexity: attrs.complexity || "",
        createdAt: attrs.createdAt || "",
        parentPlan: attrs.parentPlan || "",
        dependsOn: stringArray(attrs.dependencies).length
            ? stringArray(attrs.dependencies)
            : stringArray(attrs.dependsOn),
        dependencies: stringArray(attrs.dependencies),
        worktreeStatus: attrs.worktreeStatus || "",
        worktreeBranch: attrs.worktreeBranch || "",
        humanReviewMode: attrs.humanReviewMode || "",
        heldFromStatus: attrs.heldFromStatus || "",
        heldAt: attrs.heldAt || "",
        holdReason: attrs.holdReason || "",
        failureReason: attrs.failureReason || "",
        failedAt: attrs.failedAt || "",
        epicCompletionMode: attrs.epicCompletionMode || "",
        epicDoneEnoughSummary: attrs.epicDoneEnoughSummary || "",
        epicDoneEnoughAt: attrs.epicDoneEnoughAt || "",
        doneEnough: attrs.epicCompletionMode === "done_enough",
        isEpic: isEpicPlan(attrs),
        isChild: isChildFeaturePlan(resource),
        hierarchyRole: isEpicPlan(attrs) ? "epic" : isChildFeaturePlan(resource) ? "child" : "top-level",
        parentResolved: !isChildFeaturePlan(resource),
        parentPlanId: "",
        orphanReason: "",
        dependencyStates: [],
        blockedByDependencies: false,
        missingDependencyCount: 0,
        unverifiedDependencyCount: 0,
    };
}

/**
 * @param {any[]} plans
 */
function annotatePlanHierarchy(plans) {
    const epicsByName = new Map(plans.filter((plan) => plan.isEpic).map((plan) => [plan.name, plan]));
    return plans.map((plan) => {
        const parentEpic = plan.isChild ? epicsByName.get(plan.parentPlan) : undefined;
        const hierarchyRole = plan.isEpic
            ? "epic"
            : plan.isChild && !parentEpic
            ? "orphan-child"
            : plan.isChild
            ? "child"
            : "top-level";
        return {
            ...plan,
            hierarchyRole,
            parentResolved: plan.isChild ? Boolean(parentEpic) : true,
            parentPlanId: parentEpic?.planId || "",
            orphanReason: plan.isChild && !parentEpic
                ? `parentPlan \"${plan.parentPlan}\" does not match a loaded PROJECT Epic.`
                : "",
        };
    });
}

/**
 * @param {any[]} plans
 */
function enrichPlanSetDependencies(plans) {
    const byParent = new Map();
    for (const plan of plans.filter((item) => item.isChild)) {
        const siblings = byParent.get(plan.parentPlan) || [];
        siblings.push(plan);
        byParent.set(plan.parentPlan, siblings);
    }
    return plans.map((plan) => {
        if (!plan.isChild) return plan;
        const dependencySource = plan.parentResolved ? byParent.get(plan.parentPlan) || [] : [];
        return enrichChildrenWithDependencies([plan], plan.parentPlan, dependencySource)[0];
    });
}

/**
 * @param {any[]} children
 * @param {string} parentPlanName
 * @param {any[]} [dependencySource]
 */
function enrichChildrenWithDependencies(children, parentPlanName, dependencySource = children) {
    return children.map((child) => {
        const dependencyStates = resolveSiblingChildPlanDependencyStates(
            parentPlanName,
            child.dependsOn,
            dependencySource,
        );
        const missingDependencyCount = dependencyStates.filter((entry) => entry.state === "missing").length;
        const unverifiedDependencyCount = dependencyStates.filter((entry) => entry.state === "unverified").length;
        return {
            ...child,
            dependencyStates,
            blockedByDependencies: missingDependencyCount + unverifiedDependencyCount > 0,
            missingDependencyCount,
            unverifiedDependencyCount,
        };
    });
}

/**
 * @param {any[]} plans
 * @param {string} status
 */
function topLevelCardsForStatus(plans, status) {
    return plans.filter((plan) =>
        String(plan.status) === status && (plan.isEpic || plan.hierarchyRole === "top-level")
    );
}

/**
 * @param {any[]} plans
 * @param {string} status
 */
function orphanCardsForStatus(plans, status) {
    return plans.filter((plan) => String(plan.status) === status && plan.hierarchyRole === "orphan-child");
}

/**
 * @param {any[]} children
 */
function childHealth(children) {
    return {
        failed: children.filter((child) => child.status === "failed"),
        held: children.filter((child) => child.status === "on_hold"),
        blocked: children.filter((child) => child.blockedByDependencies),
        missingDependencies: children.filter((child) => child.missingDependencyCount > 0),
        implemented: children.filter((child) => child.status === "implemented"),
    };
}

/**
 * @param {any[]} plans
 * @param {string[]} statuses
 * @param {{ topLevelOnly?: boolean }} [options]
 */
function columnsForStatuses(plans, statuses, options = {}) {
    return statuses.map((status) => {
        const cards = options.topLevelOnly
            ? topLevelCardsForStatus(plans, status)
            : plans.filter((plan) => String(plan.status) === status && plan.hierarchyRole !== "orphan-child");
        const orphanChildren = orphanCardsForStatus(plans, status);
        const meta = /** @type {any} */ (STATUS_META)[status];
        return {
            ...meta,
            cards,
            orphanChildren,
            count: cards.length,
            repairCount: orphanChildren.length,
        };
    });
}

/**
 * @param {any[]} plans
 * @param {keyof typeof BOARD_SCREENS} screenId
 */
export function buildBoardScreen(plans, screenId) {
    const screen = BOARD_SCREENS[screenId];
    const hierarchy = /** @type {any} */ (groupPlanHierarchy(/** @type {any} */ (plans)));
    const childrenByParent = hierarchy.childrenByParent;
    const enrichedPlans = plans.map((plan) => {
        if (!plan.isEpic) return plan;
        const children = enrichChildrenWithDependencies(childrenByParent.get(plan.name) || [], plan.name);
        return {
            ...plan,
            childProgress: countChildPlanProgress(children),
            childHealth: childHealth(children),
            childCount: children.length,
        };
    });
    return {
        ...screen,
        columns: columnsForStatuses(enrichedPlans, screen.statuses, { topLevelOnly: true }),
        orphanChildren: screen.statuses.flatMap((status) => orphanCardsForStatus(enrichedPlans, status)),
    };
}

/**
 * @param {any[]} plans
 */
export function buildWorkspaceBoard(plans) {
    return {
        active: buildBoardScreen(plans, "active"),
        closed: buildBoardScreen(plans, "closed"),
        onHold: buildBoardScreen(plans, "onHold"),
    };
}

/**
 * @param {any} resource
 * @param {any[]} [plans]
 */
export function serializePlanDetail(resource, plans) {
    const summary = plans?.find((plan) => plan.planId === resource.planId) || serializePlanSummary(resource);
    return {
        ...summary,
        frontMatter: safeObject(resource.attrs),
        body: resource.body || "",
        markdown: resource.markdown || "",
        readOnly: true,
    };
}

/**
 * @param {any} epic
 * @param {any[]} plans
 */
function serializeEpicDetail(epic, plans) {
    const hierarchy = /** @type {any} */ (groupPlanHierarchy(/** @type {any} */ (plans)));
    const children = enrichChildrenWithDependencies(hierarchy.childrenByParent.get(epic.name) || [], epic.name);
    return {
        ...epic,
        detailKind: "epic",
        childProgress: countChildPlanProgress(children),
        childHealth: childHealth(children),
        childColumns: columnsForStatuses(children, [...ACTIVE_STATUSES, ...CLOSED_STATUSES, ...ON_HOLD_STATUSES]),
        children,
    };
}

/**
 * @param {any} plan
 * @param {any[]} plans
 */
function serializeNonEpicDetail(plan, plans) {
    if (!plan.isChild) return { ...plan, detailKind: "plan" };
    const siblings = plans.filter((candidate) => candidate.parentPlan === plan.parentPlan && candidate.isChild);
    const dependencySource = plan.parentResolved ? siblings : [];
    const dependencyStates = resolveSiblingChildPlanDependencyStates(plan.parentPlan, plan.dependsOn, dependencySource);
    const missingDependencyCount = dependencyStates.filter((entry) => entry.state === "missing").length;
    const unverifiedDependencyCount = dependencyStates.filter((entry) => entry.state === "unverified").length;
    return {
        ...plan,
        dependencyStates,
        blockedByDependencies: missingDependencyCount + unverifiedDependencyCount > 0,
        missingDependencyCount,
        unverifiedDependencyCount,
        detailKind: "plan",
    };
}

/**
 * @param {unknown} error
 * @returns {{ error: string, repair: string }}
 */
export function serializePlanError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const repair = message.includes("Duplicate planId") || message.includes("duplicate")
        ? "Repair duplicate planId values in Plan front matter so each non-archived Plan has a unique planId."
        : "Check Plan front matter and ensure the requested planId belongs to a non-archived Plan in this checkout.";
    return { error: message, repair };
}

/**
 * @param {string} cwd
 */
export async function loadPlanSummaries(cwd) {
    const resources = await listPlanResources(cwd);
    return enrichPlanSetDependencies(annotatePlanHierarchy(resources.map(serializePlanSummary)));
}

/**
 * @param {string} cwd
 * @param {string} planId
 */
export async function loadPlanDetail(cwd, planId) {
    const resource = await findPlanById(cwd, planId);
    const summaries = await loadPlanSummaries(cwd);
    return serializePlanDetail(resource, summaries);
}

/**
 * @param {string} cwd
 * @param {string} planId
 */
export async function loadWorkspaceDetail(cwd, planId) {
    const resource = await findPlanById(cwd, planId);
    const summaries = await loadPlanSummaries(cwd);
    const detail = serializePlanDetail(resource, summaries);
    return detail.isEpic ? serializeEpicDetail(detail, summaries) : serializeNonEpicDetail(detail, summaries);
}

/**
 * @param {any[]} plans
 * @param {string[]} statuses
 */
function hierarchyForPlans(plans, statuses) {
    const hierarchy = /** @type {any} */ (groupPlanHierarchy(/** @type {any} */ (plans)));
    const allowed = new Set(statuses);
    const hasAllowedStatus = (/** @type {any} */ plan) => allowed.has(String(plan.status));
    return {
        epics: hierarchy.epics
            .map((/** @type {any} */ epic) => {
                const allChildren = enrichChildrenWithDependencies(
                    hierarchy.childrenByParent.get(epic.name) || [],
                    epic.name,
                );
                const children = allChildren.filter(hasAllowedStatus);
                return {
                    ...epic,
                    childProgress: countChildPlanProgress(allChildren),
                    childHealth: childHealth(allChildren),
                    children,
                };
            })
            .filter((/** @type {any} */ epic) => hasAllowedStatus(epic) || epic.children.length > 0),
        standalone: hierarchy.standalone.filter(hasAllowedStatus),
        orphanChildren: hierarchy.orphanChildren.filter(hasAllowedStatus),
    };
}

/**
 * @param {any[]} plans
 */
export function buildBoardGroups(plans) {
    return {
        active: hierarchyForPlans(plans, ACTIVE_STATUSES),
        closed: hierarchyForPlans(plans, CLOSED_STATUSES),
        onHold: hierarchyForPlans(plans, ON_HOLD_STATUSES),
    };
}

/**
 * @param {string} cwd
 */
export async function loadBoard(cwd) {
    const plans = await loadPlanSummaries(cwd);
    return { plans, groups: buildBoardGroups(plans), screens: buildWorkspaceBoard(plans) };
}

/**
 * @param {string} cwd
 */
export function workspaceMetadata(cwd) {
    return {
        projectName: cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd,
        readOnly: true,
        supportedViews: ["active", "closed", "on-hold"],
        statuses: {
            active: ACTIVE_STATUSES,
            closed: CLOSED_STATUSES,
            onHold: ON_HOLD_STATUSES,
        },
        capabilities: {
            board: true,
            detail: true,
            epicDetail: true,
            markdownView: true,
            mutations: false,
            dragDrop: false,
            bodyEditing: false,
        },
    };
}
