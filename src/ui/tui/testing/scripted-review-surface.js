/**
 * @module ui/tui/testing/scripted-review-surface
 * Protocol-checked Plan Review and Runtime interaction fixtures.
 */

/**
 * @typedef {Object} ScriptedReviewDecision
 * @property {boolean} approved
 * @property {string} [feedback]
 * @property {boolean} [canceled]
 * @property {string} [approvalAction]
 * @property {unknown} [plan]
 */

/**
 * @typedef {Object} ScriptedRuntimeInteraction
 * @property {"select"|"text"|"approval"} type
 * @property {string} [promptIncludes]
 * @property {string|null} [value]
 */

export class ScriptedReviewSurface {
    /** @param {ScriptedReviewDecision[]} decisions */
    constructor(decisions) {
        /** @type {ScriptedReviewDecision[]} */
        this.decisions = decisions.map((decision) => ({ ...decision }));
        /** @type {Array<{ request: Record<string, unknown>, decision: ScriptedReviewDecision }>} */
        this.consumed = [];
    }

    /** @param {Record<string, unknown>} request */
    submit(request) {
        if (!this.decisions.length) {
            throw new Error("Unexpected Plan Review interaction: no scripted decisions remain.");
        }
        const decision = this.decisions.shift();
        if (!decision) throw new Error("Unexpected Plan Review interaction: no scripted decisions remain.");
        this.consumed.push({ request, decision });
        return {
            approved: Boolean(decision.approved),
            canceled: Boolean(decision.canceled),
            feedback: decision.feedback || "",
            approvalAction: decision.approvalAction || (decision.approved ? "later" : undefined),
            plan: decision.plan,
        };
    }

    assertComplete() {
        if (this.decisions.length) throw new Error(`Unused scripted review decisions: ${this.decisions.length}`);
    }
}

export class ScriptedInteractionSurface {
    /** @param {ScriptedRuntimeInteraction[]} interactions */
    constructor(interactions) {
        /** @type {ScriptedRuntimeInteraction[]} */
        this.interactions = interactions.map((interaction) => ({ ...interaction }));
        /** @type {Array<{ request: Record<string, unknown>, interaction: ScriptedRuntimeInteraction }>} */
        this.consumed = [];
    }

    /**
     * @param {"select"|"text"|"approval"} type
     * @param {Record<string, unknown>} request
     */
    next(type, request) {
        if (!this.interactions.length) throw new Error(`Unexpected Runtime interaction: ${type}`);
        const interaction = this.interactions.shift();
        if (!interaction) throw new Error(`Unexpected Runtime interaction: ${type}`);
        if (interaction.type !== type) {
            throw new Error(`Unexpected Runtime interaction: expected ${interaction.type}, got ${type}`);
        }
        if (interaction.promptIncludes && !String(request.prompt || "").includes(interaction.promptIncludes)) {
            throw new Error(
                `Unexpected Runtime interaction prompt for ${type}: expected ${
                    JSON.stringify(interaction.promptIncludes)
                }`,
            );
        }
        this.consumed.push({ request, interaction });
        return interaction.value ?? null;
    }

    assertComplete() {
        if (this.interactions.length) {
            throw new Error(`Unused scripted Runtime interactions: ${this.interactions.length}`);
        }
    }
}
