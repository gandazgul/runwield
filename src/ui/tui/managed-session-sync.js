/**
 * @module ui/tui/managed-session-sync
 * Idle read-only synchronization loop for dormant managed Sessions.
 */

const DEFAULT_POLL_INTERVAL_MS = 1000;
const TRANSIENT_RETRY_MS = 250;

export const SYSTEM_MANAGED_SESSION_TIMER = Object.freeze({
    set: (/** @type {() => void} */ callback, /** @type {number} */ delayMs) => setTimeout(callback, delayMs),
    clear: (/** @type {unknown} */ timer) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timer)),
});

/**
 * @typedef {Object} ManagedSessionSyncControllerOptions
 * @property {import('../../shared/session/session-runtime.js').SessionRuntime} runtime
 * @property {() => string | null} getSessionId
 * @property {{ set: (callback: () => void, delayMs: number) => unknown, clear: (timer: unknown) => void }} timer
 * @property {number} [pollIntervalMs]
 * @property {number} [retryDelayMs]
 * @property {() => boolean} [isPaused]
 * @property {(error: unknown) => void} [onError]
 */

/**
 * @param {ManagedSessionSyncControllerOptions} options
 */
export function createManagedSessionSyncController(options) {
    const { timer: timerPort } = options;
    const pollIntervalMs = Math.max(100, options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
    const retryDelayMs = Math.max(50, options.retryDelayMs || TRANSIENT_RETRY_MS);
    let disposed = false;
    let paused = false;
    let inFlight = false;
    /** @type {Promise<void> | null} */
    let inFlightPromise = null;
    /** @type {unknown} */
    let timer = null;

    function clearScheduled() {
        if (timer === null) return;
        timerPort.clear(timer);
        timer = null;
    }

    /** @param {number} delayMs */
    function schedule(delayMs) {
        if (disposed || paused) return;
        clearScheduled();
        timer = timerPort.set(() => {
            timer = null;
            void inspect();
        }, delayMs);
    }

    async function inspect() {
        if (disposed || paused || inFlight || options.isPaused?.()) return;
        const sessionId = options.getSessionId();
        if (!sessionId) return;
        if (!options.runtime.isManagedSessionDormant(sessionId)) return;
        inFlight = true;
        inFlightPromise = (async () => {
            try {
                await options.runtime.synchronizeManagedSession(sessionId);
                schedule(pollIntervalMs);
            } catch (error) {
                options.onError?.(error);
                schedule(retryDelayMs);
            } finally {
                inFlight = false;
                inFlightPromise = null;
            }
        })();
        await inFlightPromise;
    }

    return {
        start() {
            if (disposed || paused) return;
            schedule(0);
        },
        async pause() {
            paused = true;
            clearScheduled();
            if (inFlightPromise) await inFlightPromise;
        },
        resume() {
            if (disposed) return;
            paused = false;
            schedule(0);
        },
        async refreshNow() {
            await inspect();
        },
        async dispose() {
            disposed = true;
            clearScheduled();
            if (inFlightPromise) await inFlightPromise;
        },
        isInFlight() {
            return inFlight;
        },
    };
}
