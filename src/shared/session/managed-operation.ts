type ActivationProof = import("../owner-coordination/session-activations.js").ActivationProof;

export type ManagedOperationName =
    | "prompt"
    | "rename"
    | "switch_agent"
    | "set_model"
    | "set_thinking_level"
    | "reload"
    | "compact"
    | "local_shell"
    | "submit_user_turn"
    | "initialize"
    | "workflow_operation";

export type ManagedOperationDescriptor = {
    name: ManagedOperationName;
    options?: {
        expectedGeneration?: number;
        initialRequest?: string;
        initialImages?: import("./types.js").ImageAttachment[];
        turnId?: string;
        agentName?: string;
        toolNames?: string[];
        customTools?: import("@earendil-works/pi-coding-agent").ToolDefinition[];
        allowReturnToRouter?: boolean;
        includeEditFallback?: boolean;
    };
    hydrate?: boolean;
    activateAgent?: boolean;
    emitPromptEvents?: boolean;
};

export type ManagedOperationInternalFacade = {
    readonly capability: ManagedOperationCapability;
    getRootSessionManager(): import("@earendil-works/pi-coding-agent").SessionManager | null;
    getRootAgentSession(): import("@earendil-works/pi-coding-agent").AgentSession | null;
};

export type ManagedOperationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: "refresh_required" | "reconcile_required" | "managed_operation_in_progress";
};

export type ManagedOperationCapability = {
    readonly runtimeSessionId: string;
    readonly runwieldSessionId: string;
    readonly operationId: string;
    readonly proof: ActivationProof;
    readonly settled: boolean;
    readonly heartbeatFailureReason: string | null;
    readonly signal?: AbortSignal;
    cancel?(): void;
    updateProof(proof: ActivationProof): void;
    latchHeartbeatFailure(error: Error | string): void;
    assertLive(): void;
    settle(): void;
};
