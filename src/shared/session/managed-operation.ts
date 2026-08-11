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
    error: "refresh_required" | "reconcile_required";
};

const CAPABILITY_SECRET = Symbol("ManagedOperationCapability");

type CapabilitySecret = typeof CAPABILITY_SECRET;

type CapabilityOptions = {
    runtimeSessionId: string;
    runwieldSessionId: string;
    operationId: string;
    proof: ActivationProof;
};

export class ManagedOperationCapability {
    readonly runtimeSessionId: string;
    readonly runwieldSessionId: string;
    readonly operationId: string;
    #proof: ActivationProof;
    #settled = false;
    #heartbeatFailureReason: string | null = null;

    constructor(secret: CapabilitySecret, options: CapabilityOptions) {
        if (secret !== CAPABILITY_SECRET) throw new Error("ManagedOperationCapability cannot be constructed directly");
        this.runtimeSessionId = options.runtimeSessionId;
        this.runwieldSessionId = options.runwieldSessionId;
        this.operationId = options.operationId;
        this.#proof = options.proof;
    }

    static create(options: CapabilityOptions): ManagedOperationCapability {
        return new ManagedOperationCapability(CAPABILITY_SECRET, options);
    }

    get proof(): ActivationProof {
        return this.#proof;
    }

    get settled(): boolean {
        return this.#settled;
    }

    get heartbeatFailureReason(): string | null {
        return this.#heartbeatFailureReason;
    }

    updateProof(proof: ActivationProof): void {
        this.assertLive();
        if (proof.runwieldSessionId !== this.runwieldSessionId || proof.operationId !== this.operationId) {
            throw new Error("Managed operation proof does not match capability");
        }
        this.#proof = proof;
    }

    latchHeartbeatFailure(error: Error | string): void {
        if (this.#heartbeatFailureReason) return;
        this.#heartbeatFailureReason = error instanceof Error ? error.message : error;
    }

    assertLive(): void {
        if (this.#settled) throw new Error("Managed operation capability is settled");
    }

    settle(): void {
        this.#settled = true;
    }
}
