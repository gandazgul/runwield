/**
 * @module ui/tui/testing/coverage-matrix
 * Golden TUI scenario coverage inventory and meta-test helpers.
 */

import { assert } from "@std/assert";

/** @typedef {import('./scenario-runner.js').GoldenScenario} GoldenScenario */

export const GOLDEN_TUI_REQUIRED_CAPABILITIES = Object.freeze({
    roles: ["role:guide", "role:ideator", "role:operator", "role:engineer"],
    routingIntents: ["intent:INQUIRY", "intent:IDEATION", "intent:OPERATION", "intent:QUICK_FIX"],
    workflows: ["workflow:PLANNED_CHANGE", "workflow:PROJECT"],
    presentation: [
        "block:user",
        "block:thinking",
        "block:assistant",
        "block:tool",
        "block:system-error",
        "block:review-result",
        "block:validation-handoff",
        "block:select",
        "block:text",
        "block:spinner",
        "block:keyboard-help",
        "block:managed-sync",
        "block:queued-steering",
        "block:image",
    ],
    terminal: [
        "terminal:ctrl-c",
        "terminal:slash-command",
        "terminal:autocomplete",
        "terminal:resize",
        "terminal:prompt-focus-restoration",
        "terminal:queueing",
        "terminal:replay-hydration",
    ],
    recovery: ["recovery:tool-failure", "recovery:workflow-validation", "recovery:reviewer-rejection"],
    durableOutcomes: [
        "durable:plan-lifecycle",
        "durable:worktree-publication",
        "durable:registry-cleanup",
        "durable:session-replaced",
        "durable:epic-evidence",
        "durable:work-record",
        "durable:mutation-policy",
    ],
});

export const GOLDEN_TUI_REQUIRED_CAPABILITY_IDS = Object.freeze(
    Object.values(GOLDEN_TUI_REQUIRED_CAPABILITIES).flat().sort(),
);

/**
 * @param {GoldenScenario[]} scenarios
 * @returns {Map<string, string[]>}
 */
export function collectGoldenScenarioCoverage(scenarios) {
    const owners = new Map();
    for (const scenario of scenarios) {
        for (const capability of scenario.coverage || []) {
            const list = owners.get(capability) || [];
            list.push(scenario.name);
            owners.set(capability, list);
        }
    }
    return owners;
}

/** @param {GoldenScenario[]} scenarios */
export function assertGoldenScenarioCoverage(scenarios) {
    const known = new Set(GOLDEN_TUI_REQUIRED_CAPABILITY_IDS);
    const owners = collectGoldenScenarioCoverage(scenarios);
    const missing = GOLDEN_TUI_REQUIRED_CAPABILITY_IDS.filter((capability) => !owners.has(capability));
    assert(missing.length === 0, `Missing Golden TUI coverage: ${missing.join(", ")}`);

    const unasserted = [];
    const unknown = [];
    for (const scenario of scenarios) {
        const declared = scenario.coverage || [];
        const asserted = new Set(scenario.assertedCoverage || []);
        for (const capability of declared) {
            if (!known.has(capability)) unknown.push(`${scenario.name}:${capability}`);
            if (!asserted.has(capability)) unasserted.push(`${scenario.name}:${capability}`);
        }
    }
    assert(unknown.length === 0, `Unknown Golden TUI coverage capabilities: ${unknown.join(", ")}`);
    assert(unasserted.length === 0, `Golden TUI coverage lacks concrete assertions: ${unasserted.join(", ")}`);
}
