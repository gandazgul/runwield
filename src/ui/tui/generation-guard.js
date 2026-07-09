/**
 * @module ui/tui/generation-guard
 *
 * Generation gating for the interactive TUI loop.
 *
 * Each new operation calls `bump()` to claim a fresh generation id; late async
 * callbacks check `isCurrent(id)` before applying their results so a canceled
 * or superseded operation cannot leak output into the UI.
 */

/**
 * @typedef {Object} GenerationGuard
 * @property {() => number} bump - Start a new generation; returns its id.
 * @property {(gen: number) => boolean} isCurrent - True iff `gen` is still the active generation.
 * @property {() => void} invalidateAll - Bump without exposing the new id (used on Esc to cancel everything in-flight).
 */

/**
 * @returns {GenerationGuard}
 */
export function createGenerationGuard() {
    let operationGeneration = 0;

    return {
        bump: () => ++operationGeneration,
        isCurrent: (gen) => gen === operationGeneration,
        invalidateAll: () => {
            ++operationGeneration;
        },
    };
}
