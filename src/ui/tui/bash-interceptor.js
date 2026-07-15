/**
 * @module ui/tui/bash-interceptor
 * Parses TUI `!command` and `!!command` input, then delegates execution to
 * the public SessionRuntime surface.
 */

/**
 * @typedef {Object} BashContext
 * @property {string} userRequest
 * @property {import('../../shared/session/session-runtime.js').SessionRuntime} sessionRuntime
 * @property {string} sessionId
 * @property {boolean} [concurrent]
 */

/**
 * @param {BashContext} ctx
 * @returns {Promise<boolean>}
 */
export async function handleBashCommand(ctx) {
    const { userRequest } = ctx;
    if (!userRequest.startsWith("!")) return false;

    const ephemeral = userRequest.startsWith("!!");
    const command = (ephemeral ? userRequest.slice(2) : userRequest.slice(1)).trim();
    if (!command) return true;

    await ctx.sessionRuntime.runLocalShellCommand(ctx.sessionId, {
        command,
        userRequest,
        persist: !ephemeral && !ctx.concurrent,
    });
    return true;
}
