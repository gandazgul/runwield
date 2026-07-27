/**
 * @module ui/tui/testing/scripted-review-surface
 * Protocol-checked Plan Review decision fixture.
 */

/**
 * @typedef {Object} ScriptedReviewDecision
 * @property {boolean} approved
 * @property {string} [feedback]
 * @property {boolean} [canceled]
 * @property {string} [approvalAction]
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
        };
    }

    assertComplete() {
        if (this.decisions.length) throw new Error(`Unused scripted review decisions: ${this.decisions.length}`);
    }
}
