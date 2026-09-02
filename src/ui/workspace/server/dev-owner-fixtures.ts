export const DEV_OWNER_PROJECT = {
    projectId: "dev-project",
    displayName: "RunWield Dev Project",
    rootLabel: "current dev checkout",
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

function devOwnerShowcaseEvents(session: typeof DEV_OWNER_SESSIONS[number]) {
    if (session.runwieldSessionId !== "choose-terraform-folder-name") {
        return [
            {
                type: "user_message",
                messageId: `${session.runwieldSessionId}-user`,
                text: session.displayName,
                timestamp: session.headerTimestamp,
            },
            {
                type: "assistant_text_delta",
                messageId: `${session.runwieldSessionId}-assistant`,
                agentName: "Engineer",
                delta: "This is dev fixture Session content. Use owner Workspace for real Session data.",
                timestamp: session.lastCatalogedAt,
            },
        ];
    }
    return [
        {
            type: "user_message",
            messageId: "showcase-user",
            text: "Show me every Session timeline block.",
            timestamp: "2026-08-29T15:00:00.000Z",
            segmentOrdinal: 0,
            segmentKind: "planning",
        },
        {
            type: "assistant_text_delta",
            messageId: "showcase-assistant-intro",
            agentName: "Engineer",
            delta: "Here is a dev-only fixture with one of each timeline block style.",
            timestamp: "2026-08-29T15:00:03.000Z",
        },
        {
            type: "assistant_thinking_delta",
            messageId: "showcase-thinking-running",
            agentName: "Engineer",
            delta: "Check the Project, then choose the safest next action.",
            timestamp: "2026-08-29T15:00:06.000Z",
        },
        {
            type: "tool_start",
            toolCallId: "showcase-tool-visible-success",
            toolName: "read",
            title: "Visible successful tool",
            timestamp: "2026-08-29T15:00:07.000Z",
        },
        {
            type: "tool_end",
            toolCallId: "showcase-tool-visible-success",
            title: "Visible successful tool",
            output: "Fixture file loaded.",
            isError: false,
            timestamp: "2026-08-29T15:00:07.500Z",
        },
        {
            type: "assistant_text_delta",
            messageId: "showcase-assistant-between-tools",
            agentName: "Engineer",
            delta: "That was a successful tool block.",
            timestamp: "2026-08-29T15:00:08.000Z",
        },
        {
            type: "tool_start",
            toolCallId: "showcase-tool-visible-error",
            toolName: "bash",
            title: "Visible failed tool",
            timestamp: "2026-08-29T15:00:08.300Z",
        },
        {
            type: "tool_end",
            toolCallId: "showcase-tool-visible-error",
            title: "Visible failed tool",
            output: "Fixture command failed.",
            isError: true,
            timestamp: "2026-08-29T15:00:08.700Z",
        },
        {
            type: "assistant_text_delta",
            messageId: "showcase-assistant-before-live",
            agentName: "Engineer",
            delta: "That was a failed tool block.",
            timestamp: "2026-08-29T15:00:08.900Z",
        },
        {
            type: "tool_start",
            toolCallId: "showcase-tool-running",
            toolName: "bash",
            title: "Run fixture command",
            timestamp: "2026-08-29T15:00:09.000Z",
        },
        {
            type: "interaction_requested",
            interactionId: "showcase-approval",
            interactionType: "approval",
            prompt: "Approve the fixture action?",
            options: [
                { value: "accepted", label: "Approve" },
                { value: "canceled", label: "Cancel" },
            ],
            timestamp: "2026-08-29T15:00:12.000Z",
        },
        {
            type: "interaction_requested",
            interactionId: "showcase-text-input",
            interactionType: "text",
            prompt: "Give the agent one more detail.",
            timestamp: "2026-08-29T15:00:15.000Z",
        },
        {
            type: "interaction_requested",
            interactionId: "showcase-plan-review",
            interactionType: "plan_review",
            prompt: "Review the dev fixture Plan.",
            review: {
                planId: "dev-fixture-plan",
                planName: "Dev Fixture Timeline Showcase",
                classification: "PLANNED_CHANGE",
                expectedStatus: "approved",
                expectedRevision: "3",
            },
            timestamp: "2026-08-29T15:00:18.000Z",
        },
        {
            type: "assistant_text_delta",
            messageId: "showcase-assistant-after-live",
            agentName: "Engineer",
            delta:
                "The live blocks above stay visible. Completed technical activity below can compact into an Activity block.",
            timestamp: "2026-08-29T15:00:21.000Z",
        },
        {
            type: "tool_start",
            toolCallId: "showcase-tool-success",
            toolName: "read",
            title: "Read fixture file",
            timestamp: "2026-08-29T15:00:24.000Z",
        },
        {
            type: "tool_end",
            toolCallId: "showcase-tool-success",
            title: "Read fixture file",
            output: "Loaded 42 lines.",
            isError: false,
            timestamp: "2026-08-29T15:00:26.000Z",
        },
        {
            type: "tool_start",
            toolCallId: "showcase-tool-error",
            toolName: "bash",
            title: "Run failing fixture command",
            timestamp: "2026-08-29T15:00:28.000Z",
        },
        {
            type: "tool_end",
            toolCallId: "showcase-tool-error",
            title: "Run failing fixture command",
            output: "Command exited with status 1.",
            isError: true,
            timestamp: "2026-08-29T15:00:30.000Z",
        },
        {
            type: "assistant_thinking_delta",
            messageId: "showcase-thinking-complete",
            agentName: "Engineer",
            delta: "The failed command is expected in this visual fixture.",
            timestamp: "2026-08-29T15:00:32.000Z",
        },
        {
            type: "assistant_thinking_end",
            messageId: "showcase-thinking-complete",
            agentName: "Engineer",
            timestamp: "2026-08-29T15:00:33.000Z",
        },
        {
            type: "usage",
            eventId: "showcase-usage",
            usage: { inputTokens: 1200, outputTokens: 340 },
            timestamp: "2026-08-29T15:00:34.000Z",
        },
        {
            type: "assistant_text_delta",
            messageId: "showcase-assistant-after-activity",
            agentName: "Engineer",
            delta: "That was the compact Activity block with success, error, and thinking rows.",
            timestamp: "2026-08-29T15:00:36.000Z",
        },
        {
            type: "assistant_text_delta",
            messageId: "showcase-execution-segment",
            agentName: "Plan Engineer",
            delta: "Now the stream has moved into implementation.",
            timestamp: "2026-08-29T15:00:37.000Z",
            segmentOrdinal: 1,
            segmentKind: "execution",
        },
        {
            type: "system_status",
            eventId: "showcase-system-info",
            level: "info",
            message: "System info status example.",
            timestamp: "2026-08-29T15:00:38.000Z",
        },
        {
            type: "system_status",
            eventId: "showcase-system-success",
            level: "success",
            message: "System success status example.",
            timestamp: "2026-08-29T15:00:40.000Z",
        },
        {
            type: "system_status",
            eventId: "showcase-system-warning",
            level: "warning",
            message: "System warning status example.",
            timestamp: "2026-08-29T15:00:42.000Z",
        },
        {
            type: "terminal_error",
            eventId: "showcase-terminal-error",
            message: "Terminal error example with a short failure message.",
            timestamp: "2026-08-29T15:00:44.000Z",
        },
        {
            type: "cancellation",
            eventId: "showcase-cancellation",
            level: "warning",
            message: "Cancellation example.",
            timestamp: "2026-08-29T15:00:46.000Z",
        },
        {
            type: "recovery_event",
            eventId: "showcase-recovery",
            level: "success",
            message: "Recovery success example.",
            timestamp: "2026-08-29T15:00:48.000Z",
        },
        {
            type: "interaction_resolved",
            eventId: "showcase-interaction-resolved",
            outcome: "accepted",
            message: "Interaction success example.",
            timestamp: "2026-08-29T15:00:50.000Z",
        },
    ];
}

export function devOwnerTimeline(runwieldSessionId: string) {
    const session = DEV_OWNER_SESSIONS.find((item) => item.runwieldSessionId === runwieldSessionId) ||
        DEV_OWNER_SESSIONS[0];
    return {
        ok: true,
        state: session.state,
        activeSurface: session.activeSurface,
        generation: session.generation,
        complete: true,
        events: devOwnerShowcaseEvents(session),
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
