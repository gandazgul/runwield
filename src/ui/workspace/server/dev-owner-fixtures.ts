export const DEV_OWNER_PROJECT = {
    projectId: "dev-project",
    displayName: "RunWield Dev Project",
    rootLabel: "workspace-dev/fixture-project",
    lifecycle: "enabled",
    healthStatus: "available",
    healthEvidence: [],
    enabled: true,
};

export const DEV_OWNER_SESSIONS = [
    {
        runwieldSessionId: "choose-terraform-folder-name",
        projectId: DEV_OWNER_PROJECT.projectId,
        displayName: "Choose Terraform folder name",
        headerTimestamp: "2026-08-29T15:00:00.000Z",
        lastCatalogedAt: "2026-08-29T15:00:00.000Z",
        state: "idle",
        generation: 3,
        activeSurface: null,
        recoveryCategory: "idle",
        bootstrapRequired: false,
    },
    {
        runwieldSessionId: "monitor-app-tls",
        projectId: DEV_OWNER_PROJECT.projectId,
        displayName: "Monitor app TLS",
        headerTimestamp: "2026-08-29T14:00:00.000Z",
        lastCatalogedAt: "2026-08-29T14:00:00.000Z",
        state: "idle",
        generation: 2,
        activeSurface: null,
        recoveryCategory: "idle",
        bootstrapRequired: false,
    },
    {
        runwieldSessionId: "fix-plan-evidence",
        projectId: DEV_OWNER_PROJECT.projectId,
        displayName: "Fix Plan evidence",
        headerTimestamp: "2026-08-29T13:00:00.000Z",
        lastCatalogedAt: "2026-08-29T13:00:00.000Z",
        state: "idle",
        generation: 5,
        activeSurface: null,
        recoveryCategory: "idle",
        bootstrapRequired: false,
    },
    {
        runwieldSessionId: "migrate-runtime-credentials",
        projectId: DEV_OWNER_PROJECT.projectId,
        displayName: "Migrate runtime credentials",
        headerTimestamp: "2026-08-29T12:00:00.000Z",
        lastCatalogedAt: "2026-08-29T12:00:00.000Z",
        state: "active",
        generation: 8,
        activeSurface: "workspace",
        recoveryCategory: "wait_for_owner",
        bootstrapRequired: false,
    },
    {
        runwieldSessionId: "refresh-pr9-file-split",
        projectId: DEV_OWNER_PROJECT.projectId,
        displayName: "Refresh PR9 file split",
        headerTimestamp: "2026-08-29T11:00:00.000Z",
        lastCatalogedAt: "2026-08-29T11:00:00.000Z",
        state: "idle",
        generation: 1,
        activeSurface: null,
        recoveryCategory: "idle",
        bootstrapRequired: false,
    },
    {
        runwieldSessionId: "review-sidebar-prototype",
        projectId: DEV_OWNER_PROJECT.projectId,
        displayName: "Review sidebar prototype",
        headerTimestamp: "2026-08-29T10:00:00.000Z",
        lastCatalogedAt: "2026-08-29T10:00:00.000Z",
        state: "idle",
        generation: 1,
        activeSurface: null,
        recoveryCategory: "idle",
        bootstrapRequired: false,
    },
];

export const DEV_OWNER_DEVICE = {
    deviceId: "dev-device",
    label: "Dev browser",
    createdAt: "today",
    lastSeenAt: "just now",
    revokedAt: null,
};

export function devOwnerProjects() {
    return [DEV_OWNER_PROJECT];
}

export function devOwnerSessionPage(page = 0, pageSize = 30) {
    const start = page * pageSize;
    const sessions = DEV_OWNER_SESSIONS.slice(start, start + pageSize);
    return {
        sessions,
        diagnostics: [],
        page,
        pageSize,
        total: DEV_OWNER_SESSIONS.length,
        hasNext: start + pageSize < DEV_OWNER_SESSIONS.length,
        hasPrevious: page > 0 && start < DEV_OWNER_SESSIONS.length,
    };
}

export function devOwnerSidebar() {
    return {
        projects: [{
            ...DEV_OWNER_PROJECT,
            sessions: DEV_OWNER_SESSIONS.slice(0, 5),
            hasMoreSessions: DEV_OWNER_SESSIONS.length > 5,
        }],
    };
}

export function devOwnerTimeline(runwieldSessionId: string) {
    const session = DEV_OWNER_SESSIONS.find((item) => item.runwieldSessionId === runwieldSessionId) ||
        DEV_OWNER_SESSIONS[0];
    return {
        ok: true,
        state: session.state,
        generation: session.generation,
        complete: true,
        events: [
            {
                id: `${session.runwieldSessionId}-user`,
                role: "user",
                content: session.displayName,
                timestamp: session.headerTimestamp,
            },
            {
                id: `${session.runwieldSessionId}-assistant`,
                role: "assistant",
                content: "This is dev fixture Session content. Use owner Workspace for real Session data.",
                timestamp: session.lastCatalogedAt,
            },
        ],
        snapshot: {
            name: session.displayName,
            activeAgent: "engineer",
            activeModel: { provider: "fixture", model: "dev-model" },
            thinkingLevel: "medium",
        },
    };
}

export function devOwnerSessionOptions() {
    return {
        defaults: { agentName: "router", provider: "fixture", model: "dev-model", thinkingLevel: "medium" },
        agents: [
            { name: "router", displayName: "Router" },
            { name: "engineer", displayName: "Engineer" },
            { name: "planner", displayName: "Planner" },
        ],
        models: [{ provider: "fixture", id: "dev-model", name: "Dev Model" }],
        thinkingLevels: ["off", "low", "medium", "high"],
    };
}
