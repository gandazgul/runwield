/** @module ui/workspace/server/owner-dashboard */

import { isSequencePlan } from "../../../plan-store.js";
import { findByPlanId, type WorktreeRegistryEntry } from "../../../shared/worktree-registry.js";
import { loadPlanActionEvidence } from "../../../shared/workflow/plan-actions.ts";
import { loadBoard } from "./plan-adapter.js";
import { requireOwnerProjectRoot, serializeOwnerProject } from "./owner-projects.js";
import { readLiveSessionConnection } from "../../../shared/session/live-session-connection.ts";
import { withProjectRuntimeReadScope } from "../../../shared/project-runtime-layout.ts";

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
    updatedAt: string;
};

type DashboardSection = { key: DashboardCategory; label: string; items: DashboardItem[] };

type SessionSummary = {
    runwieldSessionId?: string;
    displayName?: string;
    name?: string;
    href?: string;
    state?: string;
    headerTimestamp?: string;
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
    registryByPlan?: Map<string, WorktreeRegistryEntry | null>;
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
        activation?: {
            state?: string;
            ownerProcessKind?: string;
            activeAgentName?: string;
            operationId?: string | null;
            updatedAt?: string;
        };
    };
};

type InteractionPlanReference = { planId?: string; planName?: string; title?: string };
type DashboardInteractionRequest = {
    prompt?: string;
    type?: string;
    planReview?: InteractionPlanReference;
    codeReview?: InteractionPlanReference;
    _meta?: InteractionPlanReference;
};

type WorkspaceOperation = {
    projectId?: string;
    runwieldSessionId?: string;
    status?: string;
    liveInteraction?: { interactionId?: string; request?: DashboardInteractionRequest };
    error?: string;
    remote?: boolean;
    events?: Array<{ timestamp: string }>;
};

type SessionContinuation = {
    operations?: Map<string, WorkspaceOperation>;
    listSessions(projectId: string, options: { page: number; pageSize: number; includeTotal?: boolean }): Promise<{
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

const READY = new Set(["ready_for_work", "ready_for_decomposition"]);
const UNFINISHED_EXECUTION = new Set([
    "in_progress",
    "implemented",
    "validated_ci",
    "validated_reviewer",
    "failed",
    "ci_failed",
    "review_failed",
    "blocked",
]);
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

type ClassificationEvidence = {
    activeSession?: boolean;
    liveQuestion?: boolean;
    ready?: boolean;
    stopped?: boolean;
    attentionLabel?: string;
    attentionHref?: string;
    updatedAt?: string;
};

function classifyPlan(
    plan: OwnerPlan,
    registry: WorktreeRegistryEntry | null = null,
    evidence: ClassificationEvidence = {},
): DashboardCategory | null {
    if (!isDashboardEligible(plan)) return null;
    const status = planStatus(plan);
    if (evidence.liveQuestion) return "needs-you";
    if (completionTime(plan, registry)) return "recently-finished";
    if (READY.has(status) && evidence.ready) return "ready";
    if (evidence.activeSession) return "in-progress";
    if (evidence.stopped && UNFINISHED_EXECUTION.has(status)) return "needs-you";
    return null;
}

function dashboardItem(
    project: SidebarProject,
    plan: OwnerPlan,
    category: DashboardCategory,
    registry: WorktreeRegistryEntry | null = null,
    evidence: ClassificationEvidence = {},
): DashboardItem {
    return {
        type: "plan",
        category,
        projectId: project.projectId,
        projectName: project.displayName || "Project",
        planId: plan.planId,
        title: plan.title || plan.name || plan.planName || plan.planId,
        statusLabel: category === "needs-you"
            ? evidence.attentionLabel || "Agent stopped before completing the workflow"
            : plan.statusLabel || plan.status || plan.attrs?.status || "unknown",
        summary: plan.summary || plan.attrs?.summary || "",
        href: category === "needs-you" && evidence.attentionHref
            ? evidence.attentionHref
            : planHref(project.projectId, plan.planId),
        recentAt: completionTime(plan, registry),
        updatedAt: latestTimestamp(
            planUpdatedAt(plan),
            evidence.updatedAt,
            registry?.updatedAt,
            completionTime(plan, registry),
        ),
    };
}

function latestTimestamp(...values: Array<string | undefined>): string {
    return values.filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || "";
}

function interactionLabel(operation: WorkspaceOperation): string {
    switch (operation.liveInteraction?.request?.type) {
        case "plan_review":
            return "Plan ready for review";
        case "code_review":
            return "Code ready for review";
        case "artifact_review":
            return "Artifact ready for review";
        default:
            return "Question waiting for you";
    }
}

function interactionPlan(operation: WorkspaceOperation): InteractionPlanReference {
    const request = operation.liveInteraction?.request;
    return request?.planReview || request?.codeReview || request?._meta || {};
}

function operationItem(
    project: SidebarProject,
    operationId: string,
    operation: WorkspaceOperation,
    plan?: OwnerPlan,
    session?: SessionSummary,
): DashboardItem {
    const waiting = Boolean(operation.liveInteraction?.interactionId);
    const sessionId = safeText(operation.runwieldSessionId);
    return {
        type: "session",
        category: waiting ? "needs-you" : "in-progress",
        projectId: project.projectId,
        projectName: project.displayName || "Project",
        planId: plan?.planId || safeText(interactionPlan(operation).planId),
        title: plan?.title || plan?.name || plan?.planName || safeText(interactionPlan(operation).planName) ||
            session?.displayName || session?.name || "Untitled Session",
        statusLabel: waiting ? interactionLabel(operation) : "active Session",
        summary: operation.liveInteraction?.request?.prompt || operation.error || operationId,
        href: sessionId
            ? `${sessionHref(project.projectId, sessionId)}#interaction-${
                operation.liveInteraction?.interactionId || ""
            }`
            : "/",
        recentAt: "",
        updatedAt: latestTimestamp(...(operation.events || []).map((event) => event.timestamp)),
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
    const reference = interactionPlan(operation);
    if (reference.planId) return reference.planId;
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
        const result = await sessionContinuation.listSessions(project.projectId, {
            page: 0,
            pageSize: 100,
            includeTotal: false,
        });
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
    const currentPlanBySession = new Map<string, string>();
    const planIds = new Set(plans.map((plan) => safeText(plan.planId)).filter(Boolean));
    for (const session of sessions) {
        if (!session.runwieldSessionId) continue;
        const associations = store.listSessionPlanAssociations?.(session.runwieldSessionId, project.projectId) || [];
        const currentPlanId = associations.filter((association) => association.committedGeneration !== null).at(-1)
            ?.planId;
        if (currentPlanId) currentPlanBySession.set(session.runwieldSessionId, currentPlanId);
        const committedPlanIds = new Set(
            associations.filter((association) =>
                association.committedGeneration !== null && association.planId && planIds.has(association.planId)
            ).map((association) => association.planId),
        );
        for (const planId of committedPlanIds) {
            if (!planId) continue;
            const matches = associatedSessionsByPlan.get(planId) || [];
            matches.push(session);
            associatedSessionsByPlan.set(planId, matches);
            associatedSessionIds.add(session.runwieldSessionId);
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
    const currentOperations = new Map(
        [...(sessionContinuation.operations?.entries() || [])].filter(([, operation]) =>
            operation.projectId === project.projectId && operation.status === "running" && !operation.remote
        ),
    );
    // Observe active TUI Sessions too; never infer a pending question from transcript history.
    await Promise.all(sessions.map(async (session) => {
        const sessionId = session.runwieldSessionId;
        if (!sessionId) return;
        const activation = store.inspectSessionActivation?.(sessionId).activation;
        const planId = currentPlanBySession.get(sessionId);
        if (planId && activation) {
            const current = activeEvidenceByPlan.get(planId) || {};
            activeEvidenceByPlan.set(planId, {
                ...current,
                activeSession: current.activeSession || activation.state === "active",
                stopped: current.stopped || activation.state === "idle" || activation.state === "interrupted",
                attentionHref: current.attentionHref || sessionHref(project.projectId, sessionId),
                updatedAt: latestTimestamp(current.updatedAt, activation.updatedAt, session.headerTimestamp),
            });
        }
        if (
            activation?.state !== "active" || !activation.operationId || currentOperations.has(activation.operationId)
        ) return;
        try {
            const live = await readLiveSessionConnection(sessionId, activation.operationId);
            currentOperations.set(activation.operationId, {
                projectId: project.projectId,
                runwieldSessionId: sessionId,
                status: "running",
                events: live.events,
                liveInteraction: live.interaction?.id
                    ? { interactionId: live.interaction.id, request: live.interaction }
                    : undefined,
            });
        } catch {
            // A turn can finish while its live socket is being observed. Retry on the next refresh.
        }
    }));
    for (const [operationId, operation] of currentOperations) {
        if (operation.projectId !== project.projectId || operation.status !== "running") continue;
        const reference = interactionPlan(operation);
        const candidateId = operationPlanId(store, project.projectId, operation);
        const plan = plans.find((candidate) => candidate.planId === candidateId) ||
            plans.find((candidate) =>
                reference.planName && [candidate.name, candidate.planName].includes(reference.planName)
            );
        const planId = plan?.planId;
        const session = sessions.find((candidate) => candidate.runwieldSessionId === operation.runwieldSessionId);
        if (planId && plan && isDashboardEligible(plan)) {
            const current = activeEvidenceByPlan.get(planId) || {};
            const waiting = Boolean(operation.liveInteraction?.interactionId);
            const item = operationItem(project, operationId, operation, plan, session);
            activeEvidenceByPlan.set(planId, {
                ...current,
                activeSession: true,
                liveQuestion: current.liveQuestion || waiting,
                attentionLabel: waiting ? interactionLabel(operation) : current.attentionLabel,
                attentionHref: waiting ? item.href : current.attentionHref,
                updatedAt: latestTimestamp(current.updatedAt, item.updatedAt),
            });
            continue;
        }
        dashboardSessions.push(operationItem(project, operationId, operation, plan, session));
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
        for (const plan of plans) {
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
        registryByPlan: registries,
    };
}

type DashboardPayload = { projects: SidebarProject[]; dashboard: { sections: DashboardSection[] } };

// Share only work currently in progress. Each later refresh reads fresh evidence.
const pendingDashboardReads = new WeakMap<OwnerStore, WeakMap<SessionContinuation, Promise<DashboardPayload>>>();

export function loadOwnerDashboard(
    store: OwnerStore,
    sessionContinuation: SessionContinuation,
): Promise<DashboardPayload> {
    let pending = pendingDashboardReads.get(store);
    if (!pending) {
        pending = new WeakMap();
        pendingDashboardReads.set(store, pending);
    }
    const existing = pending.get(sessionContinuation);
    if (existing) return existing;
    const reads = pending;
    const result = withProjectRuntimeReadScope(() => readOwnerDashboard(store, sessionContinuation))
        .finally(() => reads.delete(sessionContinuation));
    reads.set(sessionContinuation, result);
    return result;
}

async function readOwnerDashboard(
    store: OwnerStore,
    sessionContinuation: SessionContinuation,
): Promise<DashboardPayload> {
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
                const registry = project.registryByPlan?.get(plan.planId) || null;
                const evidence = project.activeEvidenceByPlan?.get(plan.planId) || {};
                const category = classifyPlan(plan, registry, evidence);
                if (category) sections[category].items.push(dashboardItem(project, plan, category, registry, evidence));
            }
            for (const item of project.dashboardSessions || []) sections[item.category].items.push(item);
            delete project.dashboardPlans;
            delete project.dashboardSessions;
            delete project.activeEvidenceByPlan;
            delete project.registryByPlan;
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
        }
    }
    sections["recently-finished"].items = sections["recently-finished"].items.filter((item) => isRecent(item));
    for (const section of Object.values(sections)) {
        section.items.sort((left, right) =>
            (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) ||
            left.href.localeCompare(right.href)
        );
    }
    return { projects, dashboard: { sections: CATEGORY_ORDER.map((category) => sections[category]) } };
}
