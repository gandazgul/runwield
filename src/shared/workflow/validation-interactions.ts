/**
 * @module shared/workflow/validation-interactions
 * User interactions for the session-independent engine.
 *
 * `requestInteraction` is the engine's thin window onto the port's interaction
 * method; `pauseForUserAction` is the standard pause the loop offers whenever it
 * runs out of moves.
 */

import { type ValidationInteractionRequest, ValidationInteractionTypes } from "./validation-ports.ts";
import type { ValidationInteractionResponse } from "./validation-ports.ts";
import type { UserActionChoice, UserActionPause, ValidationLoopArgs } from "./validation-types.ts";
import { emitStatus } from "./validation-emit.ts";

export async function requestInteraction(
    args: ValidationLoopArgs,
    request: ValidationInteractionRequest,
): Promise<ValidationInteractionResponse> {
    return await args.session.requestInteraction(request);
}

/**
 * Pause for a decision only the user can make, and offer exactly two ways out.
 *
 * RunWield does not halt. When it runs out of moves it says what happened in plain
 * words, says what the user should do, and waits — Retry runs the same thing again,
 * Stop leaves the work at its last safe point. A failed Retry lands right back here
 * with the same two choices, so there is never a dead end.
 *
 * A session that cannot prompt (headless, scripted, cancelled) reads as Stop, which
 * is the safe answer: it never loops unattended and never guesses on the user's
 * behalf.
 */
export async function pauseForUserAction(
    args: ValidationLoopArgs,
    pause: UserActionPause,
): Promise<UserActionChoice> {
    const detailLines = pause.details?.length ? `\n\n${pause.details.map((detail) => `  ${detail}`).join("\n")}` : "";
    const options = pause.options || [
        { value: "retry" as const, label: "Retry" },
        { value: "stop" as const, label: "Stop" },
    ];
    emitStatus(args, `${pause.whatHappened}${detailLines}\n\n${pause.doThis}`, "warning");
    const response = await requestInteraction(args, {
        type: ValidationInteractionTypes.SELECT,
        prompt: `${pause.whatHappened}${detailLines}\n\n${pause.doThis}`,
        options,
    });
    const selectedValue = response.outcome === "selected" && typeof response.value === "string"
        ? options.find((option) => option.value === response.value)?.value
        : undefined;
    return selectedValue || "stop";
}
