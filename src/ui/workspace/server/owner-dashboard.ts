/** @module ui/workspace/server/owner-dashboard */

import { loadBoard } from "./plan-adapter.js";
import { requireOwnerProjectRoot, serializeOwnerProject } from "./owner-projects.js";

type DashboardCategory = "needs-you" | "ready" | "in-progress" | "recently-finished";

type PlanAttrs = {
    status?: string;
    userVerifiedAt?: string;
    closedWithoutVerificationAt?: string;
    epicDoneEnoughAt?: string;
    verifiedAt?: string;
};

type OwnerPlan = {
    planId: string;
    title?: string;
    name?: string;
    planName?: string;
    status?: string;
    statusLabel?: string;
    summary?: string;
    attrs?: PlanAttrs;
};

type OwnerProject = {
    projectId: string;
    displayName?: string;
    rootLabel?: string;
    lifecycle?: string;
    healthStatus?: string;
    healthEvidence?: string[];
    enabled?: boolean;
};

type Diagnostic = { source: string; message: string };

type DashboardItem = {
    type: "plan";
    category: DashboardCategory;
    projectId: string;
    projectName: string;
    planId: string;
    title: string;
    statusLabel: string;
    summary: string;
    href: string;
    recentAt: string;
};

type DashboardSection = { key: DashboardCategory; label: string; items: DashboardItem[] };

type SidebarProject = ReturnType<typeof serializeOwnerProject> & {
    plans: ReturnType<typeof sidebarPlan>[];
    sessions: SessionSummary[];
    hasMorePlans: boolean;
    hasMoreSessions: boolean;
    diagnostics: Diagnostic[];
    dashboardPlans?: OwnerPlan[];
};

type SessionSummary = { runwieldSessionId?: string; name?: string; href?: string };

type OwnerStore = {
    listProjects(): OwnerProject[];
    getProjectHealth(projectId: string): ReturnType<typeof serializeOwnerProject> | null;
};

type SessionContinuation = {
    listSessions(projectId: string, options: { page: number; pageSize: number }): Promise<{
        sessions?: SessionSummary[];
        hasNext?: boolean;
    }>;
};

const CATEGORY_ORDER: DashboardCategory[] = ["needs-you", "ready", "in-progress", "recently-finished"];

const CATEGORY_LABELS: Record<DashboardCategory, string> = {
    "needs-you": "Needs You",
    ready: "Ready to Continue",
    "in-progress": "In Progress",
    "recently-finished": "Recently Finished",
};

const NEEDS_YOU = new Set(["feedback", "failed", "ci_failed", "review_failed", "blocked"]);
const READY = new Set(["approved", "ready", "ready_for_work", "ready_for_decomposition"]);
const IN_PROGRESS = new Set(["in_progress", "implemented", "ci_validated", "reviewer_validated", "validating"]);
const FINISHED = new Set(["verified", "user_verified", "closed_without_verification"]);
const TERMINAL = new Set([...FINISHED, "archived"]);

function safeText(value?: string | null): string {
    return String(value || "");
}

function planHref(projectId: string, planId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}?from=dashboard`;
}

function section(category: DashboardCategory): DashboardSection {
    return { key: category, label: CATEGORY_LABELS[category], items: [] };
}

function classifyPlan(plan: OwnerPlan): DashboardCategory {
    const status = safeText(plan.status || plan.attrs?.status).toLowerCase();
    if (NEEDS_YOU.has(status)) return "needs-you";
    if (READY.has(status)) return "ready";
    if (IN_PROGRESS.has(status)) return "in-progress";
    if (FINISHED.has(status)) return "recently-finished";
    return "ready";
}

function completionTime(plan: OwnerPlan): string {
    const attrs = plan.attrs || {};
    return safeText(
        attrs.userVerifiedAt || attrs.closedWithoutVerificationAt || attrs.epicDoneEnoughAt || attrs.verifiedAt,
    );
}

function dashboardItem(project: SidebarProject, plan: OwnerPlan, category: DashboardCategory): DashboardItem {
    return {
        type: "plan",
        category,
        projectId: project.projectId,
        projectName: project.displayName || "Project",
        planId: plan.planId,
        title: plan.title || plan.name || plan.planName || plan.planId,
        statusLabel: plan.statusLabel || plan.status || "unknown",
        summary: plan.summary || "",
        href: planHref(project.projectId, plan.planId),
        recentAt: completionTime(plan),
    };
}

function sidebarPlan(project: SidebarProject, plan: OwnerPlan) {
    return {
        planId: plan.planId,
        title: plan.title || plan.name || plan.planName || plan.planId,
        status: plan.status || "unknown",
        statusLabel: plan.statusLabel || plan.status || "unknown",
        href: planHref(project.projectId, plan.planId),
        sessions: [],
        hasMoreSessions: false,
    };
}

function recentTime(item: DashboardItem): number {
    return Date.parse(item.recentAt || "") || 0;
}

function isRecent(item: DashboardItem, now = Date.now()): boolean {
    const time = recentTime(item);
    return time > 0 && now - time <= 7 * 24 * 60 * 60 * 1000;
}

async function projectPayload(
    store: OwnerStore,
    sessionContinuation: SessionContinuation,
    projectRecord: OwnerProject,
): Promise<SidebarProject> {
    const health = store.getProjectHealth(projectRecord.projectId);
    const project = serializeOwnerProject(projectRecord, health) as SidebarProject;
    const diagnostics: Diagnostic[] = [];
    if (!project.enabled) {
        return { ...project, plans: [], sessions: [], hasMorePlans: false, hasMoreSessions: false, diagnostics };
    }

    let plans: OwnerPlan[] = [];
    try {
        const root = requireOwnerProjectRoot(store, project.projectId);
        plans = ((await loadBoard(root)).plans || []) as OwnerPlan[];
    } catch (error) {
        diagnostics.push({
            source: "plans",
            message: error instanceof Error ? error.message : String(error),
        });
    }

    let sessions: SessionSummary[] = [];
    let hasMoreSessions = false;
    try {
        const result = await sessionContinuation.listSessions(project.projectId, { page: 0, pageSize: 5 });
        sessions = result.sessions || [];
        hasMoreSessions = result.hasNext === true;
    } catch (error) {
        diagnostics.push({
            source: "sessions",
            message: error instanceof Error ? error.message : String(error),
        });
    }

    const activePlans = plans.filter((plan) => !TERMINAL.has(safeText(plan.status).toLowerCase()));
    return {
        ...project,
        plans: activePlans.slice(0, 5).map((plan) => sidebarPlan(project, plan)),
        hasMorePlans: activePlans.length > 5,
        sessions,
        hasMoreSessions,
        diagnostics,
        dashboardPlans: plans,
    };
}

export async function loadOwnerDashboard(store: OwnerStore, sessionContinuation: SessionContinuation) {
    const sections = Object.fromEntries(
        CATEGORY_ORDER.map((category) => [category, section(category)]),
    ) as Record<DashboardCategory, DashboardSection>;
    const projects: SidebarProject[] = [];
    const records = store.listProjects();
    for (const record of records) {
        try {
            const project = await projectPayload(store, sessionContinuation, record);
            projects.push(project);
            for (const plan of project.dashboardPlans || []) {
                const category = classifyPlan(plan);
                sections[category].items.push(dashboardItem(project, plan, category));
            }
            delete project.dashboardPlans;
        } catch (error) {
            projects.push({
                projectId: record.projectId,
                displayName: record.displayName || "Project",
                rootLabel: "registered Project",
                lifecycle: record.lifecycle || "enabled",
                healthStatus: "unavailable",
                healthEvidence: [],
                enabled: false,
                plans: [],
                sessions: [],
                hasMorePlans: false,
                hasMoreSessions: false,
                diagnostics: [{ source: "project", message: error instanceof Error ? error.message : String(error) }],
            } as SidebarProject);
        }
    }
    sections["recently-finished"].items = sections["recently-finished"].items
        .filter((item) => isRecent(item))
        .sort((left, right) => recentTime(right) - recentTime(left) || left.planId.localeCompare(right.planId))
        .slice(0, 10);
    return { projects, dashboard: { sections: CATEGORY_ORDER.map((category) => sections[category]) } };
}
