/**
 * @module shared/workflow/validation-position
 * Where a validation run is, while it is running.
 *
 * Plan status is durable and it is the right answer on a cold start, but it has
 * three values and the loop has more places than that to be. `implemented` cannot
 * distinguish "about to run CI" from "waiting on a dispatched CI repair", and a
 * stray `task_completed` landing in the root transcript can advance the status
 * underneath a phase that has not finished. Re-deriving the phase from status each
 * time turns both of those into a silent jump forward.
 *
 * So the loop remembers. Every point that knows where it is going next says so
 * here, dispatch trusts that over status, and status is consulted only when there
 * is nothing to trust — a genuinely fresh run.
 */

import type { HostedSession } from "../session/hosted-session.js";

/** The phase that should run next for a Plan. */
export type ValidationPhaseName = "mechanical" | "semantic" | "delivery";

export type ValidationPosition = {
    phase: ValidationPhaseName;
    /**
     * What the loop handed out and is waiting to come back, when it is waiting for
     * something a status cannot express.
     */
    awaiting?: "ci_repair" | "semantic_repair" | null;
};

/**
 * Positions per session, per Plan.
 *
 * Keyed weakly on the session: this is per-run state and must not keep a finished
 * session alive. Keyed by Plan name inside, because a Project drives several Plans
 * through the same session and one child's position is not another's.
 */
const POSITIONS = new WeakMap<object, Map<string, ValidationPosition>>();

export function rememberValidationPosition(
    hostedSession: HostedSession | undefined,
    planName: string,
    position: ValidationPosition,
): void {
    if (!hostedSession || !planName) return;
    const byPlan = POSITIONS.get(hostedSession) || new Map<string, ValidationPosition>();
    byPlan.set(planName, position);
    POSITIONS.set(hostedSession, byPlan);
}

export function getValidationPosition(
    hostedSession: HostedSession | undefined,
    planName: string,
): ValidationPosition | undefined {
    if (!hostedSession || !planName) return undefined;
    return POSITIONS.get(hostedSession)?.get(planName);
}

/**
 * Forget a Plan's position.
 *
 * Called when a run reaches a terminal outcome. Leaving a stale position behind
 * would make the *next* run resume in the middle of the last one, which is the
 * same class of bug in the other direction.
 */
export function clearValidationPosition(
    hostedSession: HostedSession | undefined,
    planName: string,
): void {
    if (!hostedSession || !planName) return;
    POSITIONS.get(hostedSession)?.delete(planName);
}
