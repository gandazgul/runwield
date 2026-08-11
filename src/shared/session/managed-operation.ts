type ActivationProof = import("../owner-coordination/session-activations.js").ActivationProof;

export type ManagedOperationName = "prompt";

export type ManagedOperationDescriptor = {
    name: ManagedOperationName;
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
    updateProof(proof: ActivationProof): void;
    latchHeartbeatFailure(error: Error | string): void;
    assertLive(): void;
    settle(): void;
};
