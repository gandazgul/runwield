/**
 * @module ui/tui/testing/scenario-actor
 * Protocol-checked deterministic model script dispatcher for Golden scenarios.
 */

/**
 * @typedef {Object} GoldenScriptTurn
 * @property {string} id
 * @property {string} agent
 * @property {string} [phase]
 * @property {string[]} [availableTools]
 * @property {string[]} [requiredTools]
 * @property {string[]} [forbiddenTools]
 * @property {unknown} [response]
 */

/**
 * @typedef {Object} GoldenTurnRequest
 * @property {string} agent
 * @property {string} [phase]
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
    return true;
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
        for (const tool of turn.requiredTools || []) {
            if (!availableTools.has(tool)) throw new Error(`Required tool unavailable for ${turn.id}: ${tool}`);
        }
        for (const tool of turn.forbiddenTools || []) {
            if (availableTools.has(tool)) throw new Error(`Forbidden tool available for ${turn.id}: ${tool}`);
        }
        this.remaining = this.remaining.filter((candidate) => candidate !== turn);
        this.consumed.push(turn);
        return turn.response;
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
