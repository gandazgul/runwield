// @ts-nocheck: browser question bridge keeps JS Runtime interaction types at the boundary.
/**
 * @module shared/session/browser-question
 * Starts the compiled Workspace question page for Runtime interactions.
 */

import { startSessionQuestionWorkspaceServer } from "../../ui/workspace/server.js";

/**
 * @typedef {Object} BrowserQuestionServer
 * @property {string} token
 * @property {string} url
 * @property {() => Promise<void>} shutdown
 */

/**
 * @param {{ interaction: import('./session-runtime-interactions.js').RuntimeInteractionRequest, answerQuestion: (request: Request) => Promise<Response>|Response }} options
 * @returns {BrowserQuestionServer}
 */
export function startBrowserQuestionServer({ interaction, answerQuestion }) {
    const token = crypto.randomUUID();
    const server = startSessionQuestionWorkspaceServer({
        token,
        questionPayload: {
            mode: interaction.type,
            prompt: interaction.prompt,
            defaultValue: interaction.defaultValue || "",
            placeholder: interaction.placeholder || "",
            allowEmpty: interaction.allowEmpty === true,
            options: interaction.options || [],
        },
        answerQuestion,
    });
    const origin = `http://${server.addr.hostname}:${server.addr.port}`;
    return {
        token,
        url: `${origin}/session-question?token=${encodeURIComponent(token)}`,
        shutdown: () => server.shutdown(),
    };
}
