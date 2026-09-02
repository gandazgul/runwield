import type { SessionArtifactReference } from "./file-session-store-types.ts";

export const SESSION_SIDEBAR_TABS = ["workflow", "session", "artifacts"] as const;
export type SessionSidebarTab = typeof SESSION_SIDEBAR_TABS[number];

export interface SessionSidebarProjectionInput {
    sessionName?: string | null;
    sessionState?: string | null;
    activeSurface?: string | null;
    activeAgent?: string | null;
    activeModel?: string | null;
    thinkingLevel?: string | null;
    generation?: number | null;
    workflowPlan?: string | null;
    workflowIntent?: string | null;
    artifacts?: SessionArtifactReference[];
}

export interface SessionSidebarProjection {
    defaultTab: SessionSidebarTab;
    session: {
        name: string;
        state: string;
        activeSurface: string | null;
        agent: string;
        model: string;
        thinkingLevel: string;
        generation: string;
    };
    workflow: {
        active: boolean;
        plan: string;
        intent: string;
    };
    artifacts: SessionArtifactReference[];
}

export function defaultSessionSidebarTab(hasWorkflow: boolean): SessionSidebarTab {
    return hasWorkflow ? "workflow" : "session";
}

export function sessionArtifactKindLabel(kind: SessionArtifactReference["kind"]): string {
    switch (kind) {
        case "prd":
            return "PRD";
        case "adr":
            return "ADR";
        case "work-record":
            return "Work Record";
        case "epic-artifact":
            return "Epic Artifact";
        case "plan":
            return "Plan";
        case "report":
            return "Report";
    }
}

export function buildSessionSidebarProjection(input: SessionSidebarProjectionInput): SessionSidebarProjection {
    const workflowPlan = input.workflowPlan?.trim() || "";
    const workflowIntent = input.workflowIntent?.trim() || "";
    const workflowActive = Boolean(workflowPlan || workflowIntent);
    return {
        defaultTab: defaultSessionSidebarTab(workflowActive),
        session: {
            name: input.sessionName?.trim() || "Untitled Session",
            state: input.sessionState?.trim() || "unknown",
            activeSurface: input.activeSurface?.trim() || null,
            agent: input.activeAgent?.trim() || "Not recorded",
            model: input.activeModel?.trim() || "Project default",
            thinkingLevel: input.thinkingLevel?.trim() || "default",
            generation: typeof input.generation === "number" ? String(input.generation) : "Not committed",
        },
        workflow: {
            active: workflowActive,
            plan: workflowPlan || "No active Plan",
            intent: workflowIntent || "No active workflow",
        },
        artifacts: (input.artifacts || []).map((artifact) => ({ ...artifact })),
    };
}
