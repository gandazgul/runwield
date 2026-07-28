/**
 * @module shared/session/early-steering
 * Keeps Pi AgentSessions from interrupting an in-flight tool batch when user steering arrives.
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

    const existingBeforeToolCall = agent.beforeToolCall;
    if (typeof existingBeforeToolCall !== "function") return;

    agent.beforeToolCall = async function preserveExistingBeforeToolCall(/** @type {unknown[]} */ ...args) {
        return await existingBeforeToolCall.apply(this, args);
    };
}
