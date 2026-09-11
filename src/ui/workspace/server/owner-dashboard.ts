/** @module ui/workspace/server/owner-dashboard */

import { isSequencePlan } from "../../../plan-store.js";
import { findByPlanId, type WorktreeRegistryEntry } from "../../../shared/worktree-registry.js";
import { loadPlanActionEvidence } from "../../../shared/workflow/plan-actions.ts";
import { loadBoard } from "./plan-adapter.js";
import { requireOwnerProjectRoot, serializeOwnerProject } from "./owner-projects.js";

type DashboardCategory = "needs-you" | "ready" | "in-progress" | "recently-finished";

type PlanAttrs = {
    status?: string;
    classification?: string;
    type?: string;
    summary?: string;
    updatedAt?: string;
    implementedAt?: string;
    validatedAt?: string;
    userVerifiedAt?: string;
    closedWithoutVerificationAt?: string;
    epicDoneEnoughAt?: string;
    verifiedAt?: string;
    executionMode?: string;
    deliveryEvidence?: { mode?: string };
    validationCheckpoint?: { state?: string; nextPhase?: string; updatedAt?: string } | null;
    humanReviewMode?: string;
    humanReviewDecision?: string;
    failedAt?: string;
    failureReason?: string;
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
    currentRoot?: string;
    registeredRoot?: string;
    lifecycle?: string;
    healthStatus?: string;
    healthEvidence?: string[];
    enabled?: boolean;
};

type Diagnostic = { source: string; message: string; repairHref: string; repairLabel: string };

type DashboardItem = {
    type: "plan" | "session" | "project";
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

type SessionSummary = {
    runwieldSessionId?: string;
    displayName?: string;
    name?: string;
    href?: string;
    state?: string;
};

type SidebarPlan = {
    planId: string;
    title: string;
    status: string;
    statusLabel: string;
    href: string;
    muted: boolean;
    sessions: SessionSummary[];
    hasMoreSessions: boolean;
};

type SidebarProject = ReturnType<typeof serializeOwnerProject> & {
    plans: SidebarPlan[];
    sessions: SessionSummary[];
    hasMorePlans: boolean;
    hasMoreSessions: boolean;
    diagnostics: Diagnostic[];
    dashboardPlans?: OwnerPlan[];
    dashboardSessions?: DashboardItem[];
    activeEvidenceByPlan?: Map<string, ClassificationEvidence>;
    root?: string;
};

type OwnerStore = {
    listProjects(): OwnerProject[];
    getProjectHealth(projectId: string): ReturnType<typeof serializeOwnerProject> | null;
    requireEnabledProjectRoot(projectId: string): string;
    listSessionPlanAssociations?: (runwieldSessionId: string, projectId?: string) => Array<{
        planId?: string;
        committedGeneration?: number | null;
    }>;
    inspectSessionActivation?: (runwieldSessionId: string) => {
        activation?: { state?: string; ownerProcessKind?: string; activeAgentName?: string };
    };
};

type WorkspaceOperation = {
    projectId?: string;
    runwieldSessionId?: string;
    status?: string;
    liveInteraction?: { interactionId?: string; request?: { prompt?: string; type?: string } };
    error?: string;
};

type SessionContinuation = {
    operations?: Map<string, WorkspaceOperation>;
    listSessions(projectId: string, options: { page: number; pageSize: number }): Promise<{
        sessions?: SessionSummary[];
        hasNext?: boolean;
        diagnostics?: Array<{ code?: string; message?: string; source?: string }>;
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
const READY = new Set(["ready_for_work", "ready_for_decomposition"]);
const FINISHED = new Set(["verified", "user_verified", "closed_without_verification"]);
const TERMINAL = new Set([...FINISHED, "archived"]);
const STATUS_PRIORITY: Record<DashboardCategory, number> = {
    "needs-you": 0,
    ready: 1,
    "in-progress": 2,
    "recently-finished": 3,
};
const PUBLICATION_PHASE_ORDER = [
    "candidate_sealed",
    "artifacts_committed",
    "target_integrated",
    "target_published",
    "publication_verified",
    "cleanup_complete",
];

function safeText(value?: string | null): string {
    return String(value || "");
}

function scrubLocalPaths(value: string): string {
    return value
        .replace(/\b[A-Za-z]:[\\/][^\s"'`<>),;]*/g, "[local path]")
        .replace(/(^|[\s("'`=:])\/[A-Za-z0-9._~+\-/]+/g, "$1[local path]");
}

function diagnosticMessage(error: Error): string {
    const message = scrubLocalPaths(error.message || "Project reader failed.");
    return message === error.message ? message : "Project reader failed. Open Project settings to repair it.";
}

function planHref(projectId: string, planId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}?from=dashboard`;
}

function sessionHref(projectId: string, runwieldSessionId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(runwieldSessionId)}`;
}

function settingsHref(projectId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/settings`;
}

function section(category: DashboardCategory): DashboardSection {
    return { key: category, label: CATEGORY_LABELS[category], items: [] };
}

function planStatus(plan: OwnerPlan): string {
    return safeText(plan.status || plan.attrs?.status).toLowerCase();
}

function planUpdatedAt(plan: OwnerPlan): string {
    const attrs = plan.attrs || {};
    return safeText(
        attrs.updatedAt || attrs.failedAt || attrs.implementedAt || attrs.validatedAt || attrs.verifiedAt ||
            attrs.userVerifiedAt || attrs.closedWithoutVerificationAt || attrs.epicDoneEnoughAt,
    );
}

function isDashboardEligible(plan: OwnerPlan): boolean {
    if (!safeText(plan.planId).trim()) return false;
    if (planStatus(plan) === "on_hold") return false;
    if (isSequencePlan(plan.attrs || {})) return false;
    return true;
}

function publicationPhaseAtLeast(entry: WorktreeRegistryEntry | null, phase: string): boolean {
    const current = safeText(entry?.publication?.phase);
    return PUBLICATION_PHASE_ORDER.indexOf(current) >= PUBLICATION_PHASE_ORDER.indexOf(phase);
}

function registryMatchesPlan(plan: OwnerPlan, registry: WorktreeRegistryEntry | null): boolean {
    return Boolean(
        registry?.publication && registry.publication.planId === plan.planId &&
            registry.publication.attemptId === registry.id,
    );
}

function completionTime(plan: OwnerPlan, registry: WorktreeRegistryEntry | null = null): string {
    const attrs = plan.attrs || {};
    const status = planStatus(plan);
    if (status === "user_verified") return safeText(attrs.userVerifiedAt);
    if (status === "closed_without_verification") return safeText(attrs.closedWithoutVerificationAt);
    if (attrs.classification === "PROJECT" && status === "validated") {
        return safeText(attrs.epicDoneEnoughAt || attrs.validatedAt);
    }
    if (status === "verified") {
        return safeText(registryMatchesPlan(plan, registry) ? registry?.publication?.verifiedAt : attrs.verifiedAt);
    }
    if (status === "validated" && attrs.verifiedAt) return safeText(attrs.verifiedAt);
    if (status === "validated" && attrs.deliveryEvidence?.mode === "non_git_in_place") {
        return safeText(attrs.verifiedAt || attrs.validatedAt);
    }
    if (
        status === "validated" && registryMatchesPlan(plan, registry) &&
        publicationPhaseAtLeast(registry, "publication_verified")
    ) {
        return safeText(registry?.publication?.verifiedAt || attrs.verifiedAt || attrs.validatedAt);
    }
    return "";
}

type ClassificationEvidence = { activeSession?: boolean; liveQuestion?: boolean; ready?: boolean };

function classifyPlan(
    plan: OwnerPlan,
    registry: WorktreeRegistryEntry | null = null,
    evidence: ClassificationEvidence = {},
): DashboardCategory | null {
    if (!isDashboardEligible(plan)) return null;
    const attrs = plan.attrs || {};
    const status = planStatus(plan);
    if (completionTime(plan, registry)) return "recently-finished";
    if (evidence.liveQuestion) return "needs-you";
    if (
        registry?.publication?.failure || registry?.status === "execution_failed" ||
        registry?.status === "validation_failed"
    ) {
        return "needs-you";
    }
    if (attrs.validationCheckpoint?.state === "awaiting_repair" || attrs.validationCheckpoint?.state === "paused") {
        return "needs-you";
    }
    if (attrs.humanReviewMode && attrs.humanReviewMode !== "none" && attrs.humanReviewDecision !== "approved") {
        return "needs-you";
    }
    if (NEEDS_YOU.has(status) || status === "approved") return "needs-you";
    if (READY.has(status) && evidence.ready) return "ready";
    if (
        evidence.activeSession || registry?.status === "active" || publicationPhaseAtLeast(registry, "target_published")
    ) {
        return "in-progress";
    }
    return null;
}

function dashboardItem(
    project: SidebarProject,
    plan: OwnerPlan,
    category: DashboardCategory,
    registry: WorktreeRegistryEntry | null = null,
): DashboardItem {
    return {
        type: "plan",
        category,
        projectId: project.projectId,
        projectName: project.displayName || "Project",
        planId: plan.planId,
        title: plan.title || plan.name || plan.planName || plan.planId,
        statusLabel: plan.statusLabel || plan.status || plan.attrs?.status || "unknown",
        summary: plan.summary || plan.attrs?.summary || "",
        href: planHref(project.projectId, plan.planId),
        recentAt: completionTime(plan, registry),
    };
}

function diagnosticItem(project: SidebarProject, diagnostic: Diagnostic): DashboardItem {
    return {
        type: "project",
        category: "needs-you",
        projectId: project.projectId,
        projectName: project.displayName || "Project",
        planId: "",
        title: `${project.displayName || "Project"} needs repair`,
        statusLabel: diagnostic.source,
        summary: diagnostic.message,
        href: diagnostic.repairHref,
        recentAt: "",
    };
}

function operationItem(project: SidebarProject, operationId: string, operation: WorkspaceOperation): DashboardItem {
    const waiting = Boolean(operation.liveInteraction?.interactionId);
    const sessionId = safeText(operation.runwieldSessionId);
    return {
        type: "session",
        category: waiting ? "needs-you" : "in-progress",
        projectId: project.projectId,
        projectName: project.displayName || "Project",
        planId: "",
        title: waiting ? "Session is waiting for you" : "Session is working",
        statusLabel: waiting ? "question waiting" : "active Session",
        summary: operation.liveInteraction?.request?.prompt || operation.error || operationId,
        href: sessionId
            ? `${sessionHref(project.projectId, sessionId)}#interaction-${
                operation.liveInteraction?.interactionId || ""
            }`
            : "/",
        recentAt: "",
    };
}

function sidebarPlan(project: SidebarProject, plan: OwnerPlan, sessions: SessionSummary[]): SidebarPlan {
    const status = planStatus(plan);
    return {
        planId: plan.planId,
        title: plan.title || plan.name || plan.planName || plan.planId,
        status: plan.status || plan.attrs?.status || "unknown",
        statusLabel: plan.statusLabel || plan.status || plan.attrs?.status || "unknown",
        href: planHref(project.projectId, plan.planId),
        muted: status === "on_hold",
        sessions,
        hasMoreSessions: sessions.length > 2,
    };
}

function recentTime(item: DashboardItem): number {
    return Date.parse(item.recentAt || "") || 0;
}

function isRecent(item: DashboardItem, now = Date.now()): boolean {
    if (item.type !== "plan") return true;
    const time = recentTime(item);
    return time > 0 && now - time <= 7 * 24 * 60 * 60 * 1000;
}

function hasCommittedPlanAssociation(store: OwnerStore, projectId: string, sessionId: string, planId: string): boolean {
    const associations = store.listSessionPlanAssociations?.(sessionId, projectId) || [];
    return associations.some((association) =>
        association.planId === planId && association.committedGeneration !== null
    );
}

function sessionSummary(projectId: string, session: SessionSummary): SessionSummary {
    const runwieldSessionId = safeText(session.runwieldSessionId);
    return {
        ...session,
        displayName: session.displayName || session.name || "Untitled Session",
        href: runwieldSessionId ? sessionHref(projectId, runwieldSessionId) : session.href,
        state: session.state || "idle",
    };
}

function operationPlanId(store: OwnerStore, projectId: string, operation: WorkspaceOperation): string {
    const sessionId = safeText(operation.runwieldSessionId);
    if (!sessionId) return "";
    const associations = store.listSessionPlanAssociations?.(sessionId, projectId) || [];
    return safeText(associations.filter((association) => association.committedGeneration !== null).at(-1)?.planId);
}

async function registryFor(
    root: string,
    plan: OwnerPlan,
    diagnostics: Diagnostic[] = [],
    projectId = "",
): Promise<WorktreeRegistryEntry | null> {
    if (!safeText(plan.planId)) return null;
    try {
        return await findByPlanId(root, plan.planId);
    } catch (error) {
        diagnostics.push({
            source: "registry-reader",
            message: diagnosticMessage(error instanceof Error ? error : new Error(String(error))),
            repairHref: projectId ? settingsHref(projectId) : "/",
            repairLabel: "Open Project settings",
        });
        return null;
    }
}

async function projectPayload(
    store: OwnerStore,
    sessionContinuation: SessionContinuation,
    projectRecord: OwnerProject,
): Promise<SidebarProject> {
    const health = store.getProjectHealth(projectRecord.projectId);
    const project = serializeOwnerProject(projectRecord, health) as SidebarProject;
    const diagnostics: Diagnostic[] = [];
    let root = "";
    try {
        root = requireOwnerProjectRoot(store, project.projectId);
    } catch (error) {
        if (projectRecord.lifecycle === "enabled") {
            diagnostics.push({
                source: "project-reader",
                message: diagnosticMessage(error instanceof Error ? error : new Error(String(error))),
                repairHref: settingsHref(project.projectId),
                repairLabel: "Open Project settings",
            });
        }
    }

    let plans: OwnerPlan[] = [];
    if (root) {
        try {
            plans = ((await loadBoard(root)).plans || []) as OwnerPlan[];
        } catch (error) {
            diagnostics.push({
                source: "plans-reader",
                message: diagnosticMessage(error instanceof Error ? error : new Error(String(error))),
                repairHref: settingsHref(project.projectId),
                repairLabel: "Open Project settings",
            });
        }
    }

    let sessions: SessionSummary[] = [];
    let hasMoreSessions = false;
    try {
        const result = await sessionContinuation.listSessions(project.projectId, { page: 0, pageSize: 100 });
        sessions = (result.sessions || []).filter((session) => session.runwieldSessionId).map((session) =>
            sessionSummary(project.projectId, session)
        );
        for (const diagnostic of result.diagnostics || []) {
            diagnostics.push({
                source: safeText(diagnostic.source || diagnostic.code || "sessions-reader"),
                message: scrubLocalPaths(safeText(diagnostic.message || diagnostic.code || "Session reader failed.")),
                repairHref: settingsHref(project.projectId),
                repairLabel: "Open Project settings",
            });
        }
        hasMoreSessions = result.hasNext === true;
    } catch (error) {
        diagnostics.push({
            source: "sessions-reader",
            message: diagnosticMessage(error instanceof Error ? error : new Error(String(error))),
            repairHref: settingsHref(project.projectId),
            repairLabel: "Open Project settings",
        });
    }

    const associatedSessionIds = new Set<string>();
    const associatedSessionsByPlan = new Map<string, SessionSummary[]>();
    for (const plan of plans.filter((candidate) => safeText(candidate.planId))) {
        const matches = sessions.filter((session) =>
            session.runwieldSessionId &&
            hasCommittedPlanAssociation(store, project.projectId, session.runwieldSessionId, plan.planId)
        );
        associatedSessionsByPlan.set(plan.planId, matches);
        for (const session of matches) {
            if (session.runwieldSessionId) associatedSessionIds.add(session.runwieldSessionId);
        }
    }

    const activeEvidenceByPlan = new Map<string, ClassificationEvidence>();
    if (root) {
        for (const plan of plans) {
            if (!READY.has(planStatus(plan))) continue;
            const readiness = await loadPlanActionEvidence(root, plan.planId);
            if (readiness.kind === "success" && READY.has(readiness.evidence.status)) {
                activeEvidenceByPlan.set(plan.planId, { ready: true });
            }
        }
    }
    const dashboardSessions: DashboardItem[] = [];
    for (const [operationId, operation] of sessionContinuation.operations?.entries() || []) {
        if (operation.projectId !== project.projectId || operation.status !== "running") continue;
        const planId = operationPlanId(store, project.projectId, operation);
        if (planId) {
            const current = activeEvidenceByPlan.get(planId) || {};
            activeEvidenceByPlan.set(planId, {
                ...current,
                activeSession: true,
                liveQuestion: current.liveQuestion || Boolean(operation.liveInteraction?.interactionId),
            });
            continue;
        }
        dashboardSessions.push(operationItem(project, operationId, operation));
    }
    for (const plan of plans) {
        for (const session of associatedSessionsByPlan.get(plan.planId) || []) {
            if (!session.runwieldSessionId) continue;
            const activation = store.inspectSessionActivation?.(session.runwieldSessionId).activation;
            if (activation?.state === "active") {
                activeEvidenceByPlan.set(plan.planId, {
                    ...(activeEvidenceByPlan.get(plan.planId) || {}),
                    activeSession: true,
                });
            }
        }
    }

    const plansForSidebar = plans.filter((plan) => {
        if (!safeText(plan.planId)) return false;
        if (TERMINAL.has(planStatus(plan))) return false;
        if (isSequencePlan(plan.attrs || {})) return false;
        return true;
    });
    associatedSessionIds.clear();
    for (const plan of plansForSidebar) {
        for (const session of associatedSessionsByPlan.get(plan.planId) || []) {
            if (session.runwieldSessionId) associatedSessionIds.add(session.runwieldSessionId);
        }
    }
    const standaloneSessions = sessions.filter((session) =>
        session.runwieldSessionId && !associatedSessionIds.has(session.runwieldSessionId)
    );
    const registries = new Map<string, WorktreeRegistryEntry | null>();
    if (root) {
        for (const plan of plansForSidebar) {
            registries.set(plan.planId, await registryFor(root, plan, diagnostics, project.projectId));
        }
    }
    plansForSidebar.sort((left, right) => {
        const leftHold = planStatus(left) === "on_hold" ? 1 : 0;
        const rightHold = planStatus(right) === "on_hold" ? 1 : 0;
        if (leftHold !== rightHold) return leftHold - rightHold;
        const leftCategory =
            classifyPlan(left, registries.get(left.planId) || null, activeEvidenceByPlan.get(left.planId) || {}) ||
            "recently-finished";
        const rightCategory =
            classifyPlan(right, registries.get(right.planId) || null, activeEvidenceByPlan.get(right.planId) || {}) ||
            "recently-finished";
        return STATUS_PRIORITY[leftCategory] - STATUS_PRIORITY[rightCategory] ||
            (Date.parse(planUpdatedAt(right)) || 0) - (Date.parse(planUpdatedAt(left)) || 0) ||
            left.planId.localeCompare(right.planId);
    });
    return {
        ...project,
        root,
        plans: plansForSidebar.map((plan) =>
            sidebarPlan(project, plan, associatedSessionsByPlan.get(plan.planId) || [])
        ),
        hasMorePlans: plansForSidebar.length > 5,
        sessions: standaloneSessions.slice(0, 5),
        hasMoreSessions: hasMoreSessions || standaloneSessions.length > 5,
        diagnostics,
        dashboardPlans: plans,
        dashboardSessions,
        activeEvidenceByPlan,
    };
}

function capRecentlyFinished(items: DashboardItem[]): DashboardItem[] {
    const perProject = new Map<string, number>();
    const capped: DashboardItem[] = [];
    for (const item of items) {
        const count = perProject.get(item.projectId) || 0;
        if (count >= 5) continue;
        perProject.set(item.projectId, count + 1);
        capped.push(item);
        if (capped.length >= 10) break;
    }
    return capped;
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
                const registry = project.root
                    ? await registryFor(project.root, plan, project.diagnostics, project.projectId)
                    : null;
                const category = classifyPlan(plan, registry, project.activeEvidenceByPlan?.get(plan.planId) || {});
                if (category) sections[category].items.push(dashboardItem(project, plan, category, registry));
            }
            for (const diagnostic of project.diagnostics || []) {
                sections["needs-you"].items.push(diagnosticItem(project, diagnostic));
            }
            for (const item of project.dashboardSessions || []) sections[item.category].items.push(item);
            delete project.dashboardPlans;
            delete project.dashboardSessions;
            delete project.activeEvidenceByPlan;
            delete project.root;
        } catch (error) {
            const project = {
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
                diagnostics: [{
                    source: "project-reader",
                    message: diagnosticMessage(error instanceof Error ? error : new Error(String(error))),
                    repairHref: settingsHref(record.projectId),
                    repairLabel: "Open Project settings",
                }],
            } as SidebarProject;
            projects.push(project);
            sections["needs-you"].items.push(diagnosticItem(project, project.diagnostics[0]));
        }
    }
    sections["recently-finished"].items = capRecentlyFinished(
        sections["recently-finished"].items
            .filter((item) => isRecent(item))
            .sort((left, right) => recentTime(right) - recentTime(left) || left.planId.localeCompare(right.planId)),
    );
    return { projects, dashboard: { sections: CATEGORY_ORDER.map((category) => sections[category]) } };
}
