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
    userMessages?: number | null;
    assistantMessages?: number | null;
    toolCalls?: number | null;
    compactionCount?: number | null;
    queuedMessages?: number | null;
    contextUsedTokens?: number | null;
    contextWindowTokens?: number | null;
    contextPercent?: number | null;
    systemContextTokens?: number | null;
    workflowPlan?: string | null;
    workflowEpic?: string | null;
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
        stats: {
            totalMessages: number;
            userMessages: number;
            assistantMessages: number;
            toolCalls: number;
            compactionCount: number;
            queuedMessages: number;
        } | null;
        context: {
            usedTokens: number | null;
            contextWindow: number;
            percent: number | null;
            systemTokens: number | null;
            conversationTokens: number | null;
        } | null;
    };
    workflow: {
        active: boolean;
        epic: string | null;
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
    const workflowEpic = input.workflowEpic?.trim() || "";
    const workflowIntent = input.workflowIntent?.trim() || "";
    const workflowActive = Boolean(workflowPlan || workflowEpic || workflowIntent);
    const displayPlan = workflowEpic && workflowPlan.startsWith(`${workflowEpic}/`)
        ? workflowPlan.slice(workflowEpic.length + 1)
        : workflowPlan;
    const hasSessionStats = typeof input.userMessages === "number" || typeof input.assistantMessages === "number" ||
        typeof input.toolCalls === "number" || typeof input.compactionCount === "number";
    const userMessages = Math.max(0, input.userMessages || 0);
    const assistantMessages = Math.max(0, input.assistantMessages || 0);
    const contextWindow = Math.max(0, input.contextWindowTokens || 0);
    const usedTokens = typeof input.contextUsedTokens === "number" ? Math.max(0, input.contextUsedTokens) : null;
    const systemTokens = typeof input.systemContextTokens === "number" ? Math.max(0, input.systemContextTokens) : null;
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
            stats: hasSessionStats
                ? {
                    totalMessages: userMessages + assistantMessages,
                    userMessages,
                    assistantMessages,
                    toolCalls: Math.max(0, input.toolCalls || 0),
                    compactionCount: Math.max(0, input.compactionCount || 0),
                    queuedMessages: Math.max(0, input.queuedMessages || 0),
                }
                : null,
            context: contextWindow > 0
                ? {
                    usedTokens,
                    contextWindow,
                    percent: typeof input.contextPercent === "number" ? input.contextPercent : null,
                    systemTokens,
                    conversationTokens: usedTokens === null || systemTokens === null
                        ? null
                        : Math.max(0, usedTokens - systemTokens),
                }
                : null,
        },
        workflow: {
            active: workflowActive,
            epic: workflowEpic || null,
            plan: displayPlan || "No active Plan",
            intent: workflowIntent || "No active workflow",
        },
        artifacts: (input.artifacts || []).map((artifact) => ({ ...artifact })),
    };
}
