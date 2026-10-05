/**
 * @module ui/tui/generation-guard
 *
 * Generation gating for the interactive TUI loop.
 *
 * Each new operation calls `bump()` to claim a fresh generation id; late async
 * callbacks check `isCurrent(id)` before applying their results so a canceled
 * or superseded operation cannot leak output into the UI.
 */

export interface GenerationGuard {
    /** Start a new generation; returns its id. */
    bump: () => number;
    /** True iff `gen` is still the active generation. */
    isCurrent: (gen: number) => boolean;
    /** Bump without exposing the new id (used on Esc to cancel everything in-flight). */
    invalidateAll: () => void;
}

export function createGenerationGuard(): GenerationGuard {
    let operationGeneration = 0;

    return {
        bump: () => ++operationGeneration,
        isCurrent: (gen) => gen === operationGeneration,
        invalidateAll: () => {
            ++operationGeneration;
        },
    };
}
