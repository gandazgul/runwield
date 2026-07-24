/**
 * @module ui/tui/managed-session-sync
 * Idle read-only synchronization loop for dormant managed Sessions.
 */

const DEFAULT_POLL_INTERVAL_MS = 1000;
const TRANSIENT_RETRY_MS = 250;

/**
 * @typedef {Object} ManagedSessionSyncControllerOptions
 * @property {import('../../shared/session/session-runtime.js').SessionRuntime} runtime
 * @property {() => string | null} getSessionId
 * @property {(callback: () => void, delayMs: number) => unknown} [setTimer]
 * @property {(timer: unknown) => void} [clearTimer]
 * @property {number} [pollIntervalMs]
 * @property {number} [retryDelayMs]
 * @property {() => boolean} [isPaused]
 * @property {(error: unknown) => void} [onError]
 */

/**
 * @param {ManagedSessionSyncControllerOptions} options
 */
export function createManagedSessionSyncController(options) {
    const setTimer = options.setTimer || ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimer = options.clearTimer ||
        ((timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)));
    const pollIntervalMs = Math.max(100, options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
    const retryDelayMs = Math.max(50, options.retryDelayMs || TRANSIENT_RETRY_MS);
    let disposed = false;
    let paused = false;
    let inFlight = false;
    /** @type {unknown} */
    let timer = null;

    function clearScheduled() {
        if (timer === null) return;
        clearTimer(timer);
        timer = null;
    }

    /** @param {number} delayMs */
    function schedule(delayMs) {
        if (disposed || paused) return;
        clearScheduled();
        timer = setTimer(() => {
            timer = null;
            void inspect();
        }, delayMs);
    }

    async function inspect() {
        if (disposed || paused || inFlight || options.isPaused?.()) return;
        const sessionId = options.getSessionId();
        if (!sessionId) return;
        const snapshot = options.runtime.getSessionSnapshot(sessionId);
        if (!snapshot?.managed?.dormant) return;
        inFlight = true;
        try {
            await options.runtime.synchronizeManagedSession(sessionId);
            schedule(pollIntervalMs);
        } catch (error) {
            options.onError?.(error);
            schedule(retryDelayMs);
        } finally {
            inFlight = false;
        }
    }

    return {
        start() {
            if (disposed || paused) return;
            schedule(0);
        },
        pause() {
            paused = true;
            clearScheduled();
        },
        resume() {
            if (disposed) return;
            paused = false;
            schedule(0);
        },
        async refreshNow() {
            await inspect();
        },
        dispose() {
            disposed = true;
            clearScheduled();
        },
        isInFlight() {
            return inFlight;
        },
    };
}
