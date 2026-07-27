/**
 * @module shared/session/early-steering
 * Installs a safe between-tool steering boundary for Pi AgentSessions.
 */

export const EARLY_STEERING_SKIP_REASON =
    "Skipped because user steering is pending; reconsider after reading the user message.";

/** @type {WeakSet<object>} */
const installedSessions = new WeakSet();

/**
 * @typedef {Object} EarlySteeringSession
 * @property {EarlySteeringAgent} [agent]
 * @property {() => unknown[] | undefined} [getSteeringMessages]
 */

/**
 * @typedef {Object} EarlySteeringAgent
 * @property {"parallel" | "sequential" | string} [toolExecution]
 * @property {Function} [beforeToolCall]
 */

/**
 * @param {unknown} result
 * @returns {boolean}
 */
function isBlockingToolCall(result) {
    return Boolean(result && typeof result === "object" && /** @type {{ block?: unknown }} */ (result).block === true);
}

/**
 * @param {EarlySteeringSession} session
 * @param {Object} [options]
 */
export function installEarlySteeringInterruption(session, options = {}) {
    void options;
    if (!session || typeof session !== "object") return;
    if (installedSessions.has(session)) return;
    installedSessions.add(session);

    const agent = session.agent;
    if (!agent || typeof agent !== "object") return;

    agent.toolExecution = "sequential";
    const existingBeforeToolCall = agent.beforeToolCall;

    agent.beforeToolCall = async function earlySteeringBeforeToolCall(/** @type {unknown[]} */ ...args) {
        if (typeof existingBeforeToolCall === "function") {
            const existingResult = await existingBeforeToolCall.apply(this, args);
            if (isBlockingToolCall(existingResult)) return existingResult;
            const steeringMessages = session.getSteeringMessages?.();
            if (Array.isArray(steeringMessages) && steeringMessages.length > 0) {
                return { block: true, reason: EARLY_STEERING_SKIP_REASON };
            }
            return existingResult;
        }

        const steeringMessages = session.getSteeringMessages?.();
        if (Array.isArray(steeringMessages) && steeringMessages.length > 0) {
            return { block: true, reason: EARLY_STEERING_SKIP_REASON };
        }
        return undefined;
    };
}
