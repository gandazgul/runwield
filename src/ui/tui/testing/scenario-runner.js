/**
 * @module ui/tui/testing/scenario-runner
 * Golden TUI scenario action runner and diagnostics helpers.
 */

import { join } from "@std/path";
import { assert } from "@std/assert";
import { GoldenScenarioActor } from "./scenario-actor.js";
import { normalizeScreenText } from "./virtual-terminal.js";

/**
 * @typedef {Object} GoldenScenario
 * @property {string} name
 * @property {{ columns?: number, rows?: number }} [terminal]
 * @property {Array<Object>} [actions]
 * @property {Array<import('./scenario-actor.js').GoldenScriptTurn>} [script]
 * @property {Array<(result: GoldenScenarioResult) => void | Promise<void>>} [assertions]
 * @property {number} [timeoutMs]
 */

/**
 * @typedef {Object} GoldenScenarioResult
 * @property {string} name
 * @property {Record<string, unknown>} state
 * @property {string[]} events
 * @property {string} screenText
 * @property {ReturnType<GoldenScenarioActor['diagnostics']>} actor
 * @property {string | null} artifactDir
 */

/** @param {unknown} value */
function isObject(value) {
    return Boolean(value && typeof value === "object");
}

/**
 * @param {GoldenScenario} scenario
 * @param {{ keepArtifacts?: boolean, artifactRoot?: string }} [options]
 * @returns {Promise<GoldenScenarioResult>}
 */
export async function runGoldenScenario(scenario, options = {}) {
    const actor = new GoldenScenarioActor(scenario.script || []);
    /** @type {Record<string, unknown> & { screen: string, canceled: boolean, editorUsable: boolean }} */
    const state = { screen: "", canceled: false, editorUsable: true };
    /** @type {string[]} */
    const events = [];
    /** @type {string | null} */
    let artifactDir = null;
    const timeoutMs = scenario.timeoutMs || 2000;
    const startedAt = Date.now();
    try {
        for (const action of scenario.actions || []) {
            if (Date.now() - startedAt > timeoutMs) throw new Error(`Scenario timed out after ${timeoutMs}ms.`);
            if (!isObject(action)) continue;
            const typed = /** @type {any} */ (action);
            if (typed.type === "modelTurn") {
                const response = actor.next({
                    agent: typed.agent,
                    phase: typed.phase,
                    availableTools: typed.availableTools || [],
                });
                events.push(`model:${typed.agent}:${typed.phase || ""}`);
                if (typeof response === "string") state.screen = `${state.screen || ""}\n${response}`;
                continue;
            }
            if (typed.type === "screen") {
                state.screen = `${state.screen || ""}\n${typed.text || ""}`;
                events.push("screen");
                continue;
            }
            if (typed.type === "cancel") {
                state.canceled = true;
                state.editorUsable = true;
                events.push("cancellation");
                continue;
            }
            if (typed.type === "slash") {
                state.screen = `${state.screen || ""}\n/${typed.command || ""}`;
                events.push(`slash:${typed.command || ""}`);
                continue;
            }
            if (typed.type === "interaction") {
                events.push(`interaction:${typed.interactionType || ""}:${typed.decision || ""}`);
                state.lastInteraction = typed;
                continue;
            }
            throw new Error(`Unknown scenario action: ${typed.type}`);
        }
        actor.assertComplete();
        const result = {
            name: scenario.name,
            state,
            events,
            screenText: normalizeScreenText(String(state.screen || "")),
            actor: actor.diagnostics(),
            artifactDir,
        };
        for (const assertion of scenario.assertions || []) await assertion(result);
        return result;
    } catch (error) {
        if (options.keepArtifacts !== false) {
            artifactDir = await Deno.makeTempDir({
                dir: options.artifactRoot,
                prefix: "runwield-golden-tui-failure-",
            });
            await Deno.writeTextFile(
                join(artifactDir, "diagnostics.json"),
                JSON.stringify(
                    {
                        scenario: scenario.name,
                        error: error instanceof Error ? error.message : String(error),
                        screenText: normalizeScreenText(String(state.screen || "")),
                        events,
                        actor: actor.diagnostics(),
                        state,
                    },
                    null,
                    2,
                ),
            );
        }
        throw error;
    }
}

/**
 * @param {GoldenScenarioResult} result
 * @param {string} text
 */
export function assertScreenIncludes(result, text) {
    assert(
        result.screenText.includes(text),
        `Expected screen to include ${JSON.stringify(text)}. Screen:\n${result.screenText}`,
    );
}

/**
 * @param {GoldenScenarioResult} result
 * @param {string} event
 */
export function assertEventIncludes(result, event) {
    assert(result.events.includes(event), `Expected events to include ${event}; got ${result.events.join(", ")}`);
}
