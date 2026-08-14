/**
 * @module shared/workflow/validation-checkpoint
 * Durable continuation facts that Plan status alone cannot express.
 */

export const VALIDATION_CHECKPOINT_VERSION = 1;

export type ValidationCheckpointPhase = "mechanical" | "semantic" | "delivery";
export type ValidationCheckpointState = "ready" | "running" | "awaiting_repair" | "paused";

export type ValidationCheckpoint = {
    version: 1;
    attemptId: string;
    generation: string;
    expectedStatus: string;
    nextPhase: ValidationCheckpointPhase;
    state: ValidationCheckpointState;
    ownerPid?: number;
    ownerHostname?: string;
    repairKind?: string;
    repairGeneration?: string;
    lastSettledOperationId?: string;
    updatedAt: string;
};

export function validationPhaseForStatus(status: string | undefined): ValidationCheckpointPhase | null {
    if (status === "implemented") return "mechanical";
    if (status === "validated_ci") return "semantic";
    if (status === "validated_reviewer") return "delivery";
    return null;
}

export function isValidationCheckpoint(value: Record<string, string | number | undefined>): boolean {
    return value.version === VALIDATION_CHECKPOINT_VERSION &&
        typeof value.attemptId === "string" && value.attemptId.length > 0 &&
        typeof value.generation === "string" && value.generation.length > 0 &&
        typeof value.expectedStatus === "string" &&
        ["mechanical", "semantic", "delivery"].includes(String(value.nextPhase)) &&
        ["ready", "running", "awaiting_repair", "paused"].includes(String(value.state)) &&
        typeof value.updatedAt === "string";
}

export function makeValidationCheckpoint(args: {
    attemptId: string;
    generation: string;
    status: string;
    phase: ValidationCheckpointPhase;
    state: ValidationCheckpointState;
    ownerPid?: number;
    ownerHostname?: string;
    repairKind?: string;
    repairGeneration?: string;
    lastSettledOperationId?: string;
}): ValidationCheckpoint {
    return {
        version: VALIDATION_CHECKPOINT_VERSION,
        attemptId: args.attemptId,
        generation: args.generation,
        expectedStatus: args.status,
        nextPhase: args.phase,
        state: args.state,
        ...(args.ownerPid !== undefined ? { ownerPid: args.ownerPid } : {}),
        ...(args.ownerHostname !== undefined ? { ownerHostname: args.ownerHostname } : {}),
        ...(args.repairKind !== undefined ? { repairKind: args.repairKind } : {}),
        ...(args.repairGeneration !== undefined ? { repairGeneration: args.repairGeneration } : {}),
        ...(args.lastSettledOperationId !== undefined ? { lastSettledOperationId: args.lastSettledOperationId } : {}),
        updatedAt: new Date().toISOString(),
    };
}
