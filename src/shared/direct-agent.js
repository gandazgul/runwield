/**
 * @module shared/direct-agent
 * Handler for direct agent invocation — sends user prompts straight to
 * a named agent, bypassing the router triage flow. The agent takes over
 * the TUI with full streaming output (not suppressed like parallel tasks).
 */

import { runAgentSession } from "./session.js";

/**
 * Create an onMessage handler that sends prompts directly to a specific agent.
 *
 * The returned function matches the `(userRequest, images, uiAPI) => Promise<void>`
 * signature used by `setActiveAgent()` / `startInteractiveSession()`.
 *
 * @param {string} agentName - Agent definition name (filename without .md)
 * @returns {(userRequest: string, images: Array<{base64: string, mimeType: string}>, uiAPI: import('./workflow.js').UiAPI) => Promise<void>}
 */
export function createDirectAgentHandler(agentName) {
    return async (userRequest, images, uiAPI) => {
        await runAgentSession({
            agentName,
            userRequest,
            images,
            uiAPI,
        });
    };
}
