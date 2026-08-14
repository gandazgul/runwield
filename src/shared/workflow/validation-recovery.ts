/** Typed outcomes for validation operations that did not reach a terminal Plan state. */

export type ValidationRecoveryKind =
    | "reconcile_and_retry"
    | "retry_later"
    | "agent_correction"
    | "user_action"
    | "terminal";

export type ValidationRecoveryAction = "retry_now" | "retry_later" | "correct_agent_output" | "choose" | "none";

export type ValidationRecoveryResult = {
    kind: ValidationRecoveryKind;
    code: string;
    message: string;
    action: ValidationRecoveryAction;
    nextPhase?: "mechanical" | "semantic" | "delivery";
};

export function retryValidationLater(
    code: string,
    message: string,
    nextPhase?: ValidationRecoveryResult["nextPhase"],
): ValidationRecoveryResult {
    return { kind: "retry_later", code, message, action: "retry_later", ...(nextPhase ? { nextPhase } : {}) };
}

export function validationNeedsUserChoice(code: string, message: string): ValidationRecoveryResult {
    return { kind: "user_action", code, message, action: "choose" };
}
