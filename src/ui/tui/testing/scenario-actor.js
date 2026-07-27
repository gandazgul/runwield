/**
 * @module ui/tui/testing/scenario-actor
 * Protocol-checked deterministic model script dispatcher for Golden scenarios.
 */

import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";

/**
 * @typedef {Object} GoldenScriptTurn
 * @property {string} id
 * @property {string} agent
 * @property {string} [phase]
 * @property {number} [ordinal]
 * @property {string[]} [availableTools]
 * @property {string[]} [requiredTools]
 * @property {string[]} [forbiddenTools]
 * @property {unknown} [response]
 * @property {string} [text]
 * @property {string} [thinking]
 * @property {Array<{ name: string, arguments: unknown, id?: string }>} [toolCalls]
 */

/**
 * @typedef {Object} GoldenTurnRequest
 * @property {string} agent
 * @property {string} [phase]
 * @property {number} [ordinal]
 * @property {string[]} [availableTools]
 */

/** @param {string[]} value */
function normalizeSet(value = []) {
    return new Set(value.map((item) => String(item)));
}

/**
 * @param {GoldenScriptTurn} turn
 * @param {GoldenTurnRequest} request
 */
function turnMatches(turn, request) {
    if (turn.agent !== request.agent) return false;
    if (turn.phase && turn.phase !== request.phase) return false;
    if (turn.ordinal !== undefined && turn.ordinal !== request.ordinal) return false;
    return true;
}

/**
 * @param {GoldenScriptTurn} turn
 * @returns {import('@earendil-works/pi-ai').AssistantMessage}
 */
export function createFauxMessageForTurn(turn) {
    if (turn.response && typeof turn.response === "object") return /** @type {any} */ (turn.response);
    const blocks = [];
    if (turn.thinking) blocks.push(fauxThinking(turn.thinking));
    if (turn.text || typeof turn.response === "string") blocks.push(fauxText(turn.text || String(turn.response || "")));
    for (const toolCall of turn.toolCalls || []) {
        blocks.push(fauxToolCall(toolCall.name, /** @type {any} */ (toolCall.arguments), { id: toolCall.id }));
    }
    return fauxAssistantMessage(blocks.length === 1 ? blocks[0] : blocks);
}

export class GoldenScenarioActor {
    /** @param {GoldenScriptTurn[]} script */
    constructor(script) {
        /** @type {GoldenScriptTurn[]} */
        this.remaining = script.map((turn) => ({ ...turn }));
        /** @type {GoldenScriptTurn[]} */
        this.consumed = [];
    }

    /** @param {GoldenTurnRequest} request */
    next(request) {
        const matches = this.remaining.filter((turn) => turnMatches(turn, request));
        if (matches.length === 0) {
            throw new Error(
                `Unexpected scripted turn for agent=${request.agent} phase=${request.phase || ""}; remaining=${
                    this.remaining.map((turn) => turn.id).join(",")
                }`,
            );
        }
        if (matches.length > 1) {
            throw new Error(
                `Ambiguous scripted turn for agent=${request.agent} phase=${request.phase || ""}; matches=${
                    matches.map((turn) => turn.id).join(",")
                }`,
            );
        }
        const turn = matches[0];
        const availableTools = normalizeSet(request.availableTools);
        if (turn.availableTools) {
            const expectedTools = normalizeSet(turn.availableTools);
            const missing = [...expectedTools].filter((tool) => !availableTools.has(tool));
            const unexpected = [...availableTools].filter((tool) => !expectedTools.has(tool));
            if (missing.length || unexpected.length) {
                throw new Error(
                    `Available tool set mismatch for ${turn.id}: missing=${missing.join(",") || "none"} unexpected=${
                        unexpected.join(",") || "none"
                    }`,
                );
            }
        }
        const requiredTools = new Set([
            ...(turn.requiredTools || []),
            ...(turn.toolCalls || []).map((toolCall) => toolCall.name),
        ]);
        for (const tool of requiredTools) {
            if (!availableTools.has(tool)) throw new Error(`Required tool unavailable for ${turn.id}: ${tool}`);
        }
        for (const tool of turn.forbiddenTools || []) {
            if (availableTools.has(tool)) throw new Error(`Forbidden tool available for ${turn.id}: ${tool}`);
        }
        this.remaining = this.remaining.filter((candidate) => candidate !== turn);
        this.consumed.push(turn);
        return turn.response;
    }

    /**
     * Return a faux-provider response factory that dispatches through the same
     * protocol checks as direct actor use. The caller supplies actual Agent and
     * phase identity from Runtime/Agent context rather than prompt text.
     *
     * @param {(context: unknown, options: unknown) => GoldenTurnRequest} resolveTurn
     */
    toFauxResponseFactory(resolveTurn) {
        return (/** @type {unknown} */ context, /** @type {unknown} */ options) => {
            this.next(resolveTurn(context, options));
            const turn = this.consumed.at(-1);
            if (!turn) throw new Error("Faux response factory did not consume a scripted turn.");
            return createFauxMessageForTurn(turn);
        };
    }

    assertComplete() {
        if (this.remaining.length) {
            throw new Error(`Unused scripted turns: ${this.remaining.map((turn) => turn.id).join(",")}`);
        }
    }

    diagnostics() {
        return {
            consumed: this.consumed.map((turn) => turn.id),
            remaining: this.remaining.map((turn) => turn.id),
        };
    }
}
