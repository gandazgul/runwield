import { findPlanEvidenceById } from "../../../plan-store.js";
import { findByPlanId, type WorktreeRegistryEntry } from "../../../shared/worktree-registry.js";
import {
    isValidationCheckpoint,
    readValidationReviewState,
    type ValidationCheckpoint,
    validationCheckpointCanResume,
} from "../../../shared/workflow/validation-checkpoint.ts";
import { getRunWieldSessionDir } from "../../../shared/session/root-session.js";
import { projectAggregateTranscript } from "../../../shared/session/session-transcript-manifest.ts";
import { requireOwnerProjectRoot, sessionBelongsToOwnerProject } from "./owner-projects.js";
import { validationStageLabel } from "../../../shared/workflow/validation-progress-presentation.ts";

export type ProgressOverallState =
    | "waiting"
    | "running"
    | "repairing"
    | "paused"
    | "needs_attention"
    | "delivering"
    | "completed"
    | "degraded";

export type ProgressStageState =
    | "pending"
    | "running"
    | "passed"
    | "needs_attention"
    | "paused"
    | "failed"
    | "not_required"
    | "completed"
    | "unknown";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type PlanAttrs = { [key: string]: JsonValue | undefined };
type PlanEvidence = {
    planName: string;
    planId: string;
    attrs: PlanAttrs;
    body: string;
    markdown: string;
};
type OwnerSession = {
    runwieldSessionId: string;
    projectId: string;
    displayName?: string;
    transcriptCwd: string;
};
type OwnerStore = {
    getProjectById: (projectId: string) => { currentRoot: string } | null;
    requireEnabledProjectRoot: (projectId: string) => string;
    getSessionById: (runwieldSessionId: string) => OwnerSession | null;
    inspectSessionActivation: (runwieldSessionId: string) => {
        activation?: { state?: string; ownerProcessKind?: string; activeAgentName?: string };
        generation?: {
            generation: number;
            byteLength: number;
            terminalEntryId: string | null;
            digestHex: string;
            currentSegmentId: string | null;
        };
    };
    listSessionTranscriptSegments: (runwieldSessionId: string) => Array<{
        segmentId: string;
        runwieldSessionId: string;
        projectId: string;
        piSessionId: string;
        transcriptPath: string;
        transcriptCwd: string;
        ordinal: number;
        kind: string;
        sealedAt: string | null;
        sealedByteLength: number | null;
        sealedDigestHex: string | null;
        sealedTerminalEntryId: string | null;
    }>;
};

type ProgressStage = {
    id: "execution" | "mechanical" | "semantic" | "repair" | "delivery" | "completion";
    label: string;
    state: ProgressStageState;
    detail: string;
    updatedAt: string | null;
};

type SafeSessionSegment = {
    ordinal: number;
    kind: string;
    label: string;
    sealed: boolean;
    current: boolean;
};

export type OwnerPlanProgress = {
    ok: boolean;
    readOnly: true;
    projectId: string;
    plan: {
        planId: string;
        planName: string;
        title: string;
        status: string;
        classification: string;
        executionAgent: string | null;
        updatedAt: string | null;
    };
    overall: {
        state: ProgressOverallState;
        label: string;
        detail: string;
        updatedAt: string | null;
        settled: boolean;
    };
    stages: ProgressStage[];
    session: {
        runwieldSessionId: string;
        displayName: string;
        state: string;
        activeSurface: string | null;
        activeAgent: string | null;
        projectionState: "ok" | "degraded" | "omitted";
        segments: SafeSessionSegment[];
        progressUrl: string;
    } | null;
    degraded: { code: string; message: string } | null;
};

const STATUS_ORDER = [
    "ready_for_work",
    "in_progress",
    "implemented",
    "validated_ci",
    "validated_reviewer",
    "validated",
    "verified",
    "user_verified",
    "closed_without_verification",
];

function text(value: JsonValue | undefined, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function planTitle(evidence: PlanEvidence) {
    const heading = evidence.body.split("\n").find((line) => line.startsWith("# "));
    return heading ? heading.replace(/^#\s+/, "").trim() : evidence.planName;
}

function statusAtLeast(status: string, required: string) {
    const statusIndex = STATUS_ORDER.indexOf(status);
    const requiredIndex = STATUS_ORDER.indexOf(required);
    return statusIndex >= 0 && requiredIndex >= 0 && statusIndex >= requiredIndex;
}

function normalizeSegmentKind(kind: string) {
    if (kind === "planning" || kind === "execution" || kind === "semantic_repair") return kind;
    return "session";
}

function segmentLabel(kind: string, ordinal: number) {
    if (kind === "planning") return `Planning segment ${ordinal + 1}`;
    if (kind === "execution") return `Execution segment ${ordinal + 1}`;
    if (kind === "semantic_repair") return `AI review repair segment ${ordinal + 1}`;
    return `Session segment ${ordinal + 1}`;
}

function checkpointFrom(attrs: PlanAttrs) {
    const value = attrs.validationCheckpoint;
    if (!value || Array.isArray(value) || typeof value !== "object") return null;
    const partial = value as Partial<ValidationCheckpoint>;
    return isValidationCheckpoint(partial) ? partial : null;
}

function stage(
    id: ProgressStage["id"],
    label: string,
    state: ProgressStageState,
    detail: string,
    updatedAt: string | null,
): ProgressStage {
    return { id, label, state, detail, updatedAt };
}

function failureMessage(status: string, registry: WorktreeRegistryEntry | null) {
    if (status === "failed") return "Execution failed and needs attention.";
    if (registry?.publication?.failure?.kind === "content_conflict") {
        return "Delivery needs attention because the commits could not be combined cleanly.";
    }
    if (registry?.publication?.failure) return "Delivery stopped before the commits reached the target branch.";
    if (registry?.status === "execution_failed") return "Execution failed in the worktree attempt.";
    if (registry?.status === "validation_failed") return "Workflow Validation failed in the worktree attempt.";
    return "Progress needs attention.";
}

function deriveStages(evidence: PlanEvidence, registry: WorktreeRegistryEntry | null) {
    const status = text(evidence.attrs.status, "draft");
    const updatedAt = text(evidence.attrs.updatedAt) || text(evidence.attrs.verifiedAt) || registry?.updatedAt || null;
    const checkpoint = checkpointFrom(evidence.attrs);
    const checkpointActive = registry && checkpoint
        ? validationCheckpointCanResume(checkpoint, registry.id, status)
        : false;
    const reviewState = readValidationReviewState(checkpointActive ? checkpoint : null);
    const testsAndCiLabel = validationStageLabel("ci");
    const aiReviewLabel = validationStageLabel("semantic_review");
    const stages: ProgressStage[] = [
        stage("execution", "Execution", "pending", "Waiting for an execution agent.", updatedAt),
        stage("mechanical", testsAndCiLabel, "pending", "Waiting for implementation to finish.", updatedAt),
        stage("semantic", aiReviewLabel, "pending", "Waiting for tests and CI.", updatedAt),
        stage("repair", "Repair", "not_required", "No repair is active.", updatedAt),
        stage("delivery", "Delivery", "pending", "Waiting for AI code review.", updatedAt),
        stage("completion", "Completion", "pending", "Waiting for delivery to finish.", updatedAt),
    ];

    if (status === "ready_for_work") {
        stages[0] = stage("execution", "Execution", "pending", "Ready for work.", updatedAt);
    }
    if (status === "in_progress" || registry?.status === "active") {
        stages[0] = stage("execution", "Execution", "running", "The execution attempt is active.", updatedAt);
    }
    if (status === "failed" || registry?.status === "execution_failed") {
        stages[0] = stage("execution", "Execution", "failed", failureMessage(status, registry), updatedAt);
    }
    if (statusAtLeast(status, "implemented")) {
        stages[0] = stage("execution", "Execution", "passed", "Implementation is ready for validation.", updatedAt);
        stages[1] = stage(
            "mechanical",
            testsAndCiLabel,
            "running",
            "Tests and CI are running.",
            updatedAt,
        );
    }
    if (statusAtLeast(status, "validated_ci")) {
        stages[1] = stage("mechanical", testsAndCiLabel, "passed", "Tests and CI passed.", updatedAt);
        stages[2] = stage("semantic", aiReviewLabel, "running", "AI code review is running.", updatedAt);
    }
    if (statusAtLeast(status, "validated_reviewer")) {
        stages[2] = stage("semantic", aiReviewLabel, "passed", "AI code review passed.", updatedAt);
        stages[4] = stage("delivery", "Delivery", "running", "Delivery is active.", updatedAt);
    }
    if (statusAtLeast(status, "validated")) {
        stages[4] = stage(
            "delivery",
            "Delivery",
            registry?.status === "validated" ? "running" : "passed",
            "Delivery evidence exists.",
            updatedAt,
        );
    }
    if (status === "verified") {
        stages[4] = stage("delivery", "Delivery", "completed", "Delivery is complete.", updatedAt);
        stages[5] = stage("completion", "Completion", "completed", "The Plan is complete.", updatedAt);
    }
    if (status === "user_verified" || status === "closed_without_verification") {
        stages[3] = stage("repair", "Repair", "not_required", "No repair is required.", updatedAt);
        stages[4] = stage("delivery", "Delivery", "not_required", "RunWield delivery was not required.", updatedAt);
        stages[5] = stage("completion", "Completion", "completed", "The Plan is closed.", updatedAt);
    }
    if (registry?.publication?.failure) {
        stages[4] = stage(
            "delivery",
            "Delivery",
            "needs_attention",
            failureMessage(status, registry),
            registry.updatedAt,
        );
    }
    if (registry?.status === "validation_failed") {
        const failedStage = status === "implemented" ? 1 : status === "validated_ci" ? 2 : 3;
        stages[failedStage] = {
            ...stages[failedStage],
            state: "needs_attention",
            detail: failureMessage(status, registry),
            updatedAt: registry.updatedAt,
        };
    }
    const activeCheckpoint = checkpointActive ? checkpoint : null;
    if (activeCheckpoint) {
        const next = activeCheckpoint.nextPhase;
        const state = activeCheckpoint.state === "paused"
            ? "paused"
            : activeCheckpoint.state === "awaiting_repair"
            ? "needs_attention"
            : "running";
        if (next === "mechanical") {
            stages[1] = stage(
                "mechanical",
                testsAndCiLabel,
                state,
                "Tests and CI can continue.",
                activeCheckpoint.updatedAt,
            );
        }
        if (next === "semantic") {
            stages[2] = stage(
                "semantic",
                aiReviewLabel,
                state,
                reviewState
                    ? `AI code review round ${reviewState.semanticRound} needs attention.`
                    : "AI code review can continue.",
                activeCheckpoint.updatedAt,
            );
            if (activeCheckpoint.state === "awaiting_repair" || activeCheckpoint.repairKind === "semantic") {
                stages[3] = stage(
                    "repair",
                    "Repair",
                    state === "paused" ? "paused" : "running",
                    "AI code review repair is active.",
                    activeCheckpoint.updatedAt,
                );
            }
        }
        if (next === "delivery") {
            stages[4] = stage("delivery", "Delivery", state, "Delivery can continue.", activeCheckpoint.updatedAt);
        }
    }
    const priority = stages.find((item) => ["failed", "needs_attention", "paused", "running"].includes(item.state)) ||
        stages[5];
    const overallState: ProgressOverallState = priority.state === "failed" || priority.state === "needs_attention"
        ? "needs_attention"
        : priority.state === "paused"
        ? "paused"
        : priority.id === "repair" && priority.state === "running"
        ? "repairing"
        : priority.id === "delivery" && priority.state === "running"
        ? "delivering"
        : stages[5].state === "completed"
        ? "completed"
        : priority.state === "running"
        ? "running"
        : "waiting";
    return { stages, overallState, updatedAt };
}

function degraded(projectId: string, plan: PlanEvidence, code: string, message: string): OwnerPlanProgress {
    const updatedAt = text(plan.attrs.updatedAt) || null;
    return {
        ok: false,
        readOnly: true,
        projectId,
        plan: {
            planId: plan.planId,
            planName: plan.planName,
            title: planTitle(plan),
            status: text(plan.attrs.status, "draft"),
            classification: text(plan.attrs.classification, "PLANNED_CHANGE"),
            executionAgent: text(plan.attrs.executionAgent) || null,
            updatedAt,
        },
        overall: { state: "degraded", label: "Progress needs attention", detail: message, updatedAt, settled: true },
        stages: [stage("execution", "Execution", "unknown", "Evidence is degraded.", updatedAt)],
        session: null,
        degraded: { code, message },
    };
}

async function sessionProjection(store: OwnerStore, projectId: string, planId: string, runwieldSessionId: string) {
    if (!runwieldSessionId) return null;
    const session = store.getSessionById(runwieldSessionId);
    if (!session || !sessionBelongsToOwnerProject(store, session, projectId)) throw new Error("Session not found.");
    const inspected = store.inspectSessionActivation(runwieldSessionId);
    const generation = inspected.generation;
    let segments: SafeSessionSegment[] = [];
    let projectionState: "ok" | "degraded" | "omitted" = "omitted";
    if (generation) {
        const projection = await projectAggregateTranscript({
            cwd: session.transcriptCwd,
            sessionDir: getRunWieldSessionDir(session.transcriptCwd),
            runwieldSessionId,
            generation,
            segments: store.listSessionTranscriptSegments(runwieldSessionId),
        });
        projectionState = projection.ok ? "ok" : "degraded";
        if (projection.ok) {
            const currentOrdinal = projection.segments.find((segment) => segment.current)?.ordinal;
            segments = projection.segments.map((segment) => {
                const kind = normalizeSegmentKind(segment.kind);
                return {
                    ordinal: segment.ordinal,
                    kind,
                    label: segmentLabel(kind, segment.ordinal),
                    sealed: segment.sealed,
                    current: segment.ordinal === currentOrdinal,
                };
            });
            const workflowContext = projection.snapshot.workflowContext;
            if (workflowContext && !JSON.stringify(workflowContext).includes(planId)) {
                throw new Error("Session is not associated with this Plan.");
            }
        }
    }
    const activation = inspected.activation;
    return {
        runwieldSessionId,
        displayName: session.displayName || "Session",
        state: activation?.state || "idle",
        activeSurface: activation?.state === "active" ? activation.ownerProcessKind || null : null,
        activeAgent: activation?.activeAgentName || null,
        projectionState,
        segments,
        progressUrl: `/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/progress?session=${
            encodeURIComponent(runwieldSessionId)
        }`,
    };
}

export async function loadOwnerPlanProgress(
    store: OwnerStore,
    options: { projectId: string; planId: string; runwieldSessionId?: string | null },
): Promise<OwnerPlanProgress> {
    const projectRoot = requireOwnerProjectRoot(store, options.projectId);
    const primary = await findPlanEvidenceById(projectRoot, options.planId) as PlanEvidence;
    if (text(primary.attrs.classification) === "PROJECT") throw new Error("Epic progress is not available.");
    let registry: WorktreeRegistryEntry | null = null;
    let authoritative = primary;
    try {
        registry = await findByPlanId(projectRoot, primary.planId);
        if (registry?.path) authoritative = await findPlanEvidenceById(registry.path, primary.planId) as PlanEvidence;
    } catch (error) {
        return degraded(
            options.projectId,
            primary,
            "progress_evidence_degraded",
            error instanceof Error ? error.message : String(error),
        );
    }
    const derived = deriveStages(authoritative, registry);
    const session = await sessionProjection(store, options.projectId, primary.planId, options.runwieldSessionId || "");
    const settled = derived.overallState === "completed" || derived.overallState === "needs_attention" ||
        derived.overallState === "paused";
    return {
        ok: true,
        readOnly: true,
        projectId: options.projectId,
        plan: {
            planId: primary.planId,
            planName: primary.planName,
            title: planTitle(authoritative),
            status: text(authoritative.attrs.status, "draft"),
            classification: text(primary.attrs.classification, "PLANNED_CHANGE"),
            executionAgent: text(primary.attrs.executionAgent) || null,
            updatedAt: derived.updatedAt,
        },
        overall: {
            state: derived.overallState,
            label: derived.overallState.replaceAll("_", " "),
            detail:
                derived.stages.find((item) => ["running", "needs_attention", "paused", "failed"].includes(item.state))
                    ?.detail || "Progress is available.",
            updatedAt: derived.updatedAt,
            settled,
        },
        stages: derived.stages,
        session,
        degraded: null,
    };
}
