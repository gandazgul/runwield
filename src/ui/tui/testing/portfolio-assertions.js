/**
 * @module ui/tui/testing/portfolio-assertions
 * Reusable semantic assertions for Golden TUI portfolio scenarios.
 */

import { assert, assertEquals } from "@std/assert";
import { assertEventIncludes, assertScreenIncludes } from "./scenario-runner.js";

/** @typedef {import('./scenario-runner.js').GoldenScenarioResult} GoldenScenarioResult */

/**
 * @param {string[]} capabilities
 * @param {(result: GoldenScenarioResult) => void | Promise<void>} assertion
 * @returns {(result: GoldenScenarioResult) => void | Promise<void>}
 */
export function assertsGoldenCoverage(capabilities, assertion) {
    const wrapped = (/** @type {GoldenScenarioResult} */ result) => assertion(result);
    Object.defineProperty(wrapped, "goldenCoverage", { value: [...capabilities] });
    return wrapped;
}

/** @param {string} event */
export function assertRuntimeEvent(event) {
    return assertsGoldenCoverage([], (result) => assertEventIncludes(result, event));
}

/** @param {string} text */
export function assertVisibleText(text) {
    return assertsGoldenCoverage([], (result) => assertScreenIncludes(result, text));
}

/**
 * @param {string} path
 * @param {unknown} expected
 */
export function assertStateValue(path, expected) {
    return assertsGoldenCoverage([], (result) => {
        const parts = path.split(".").filter(Boolean);
        /** @type {unknown} */
        let value = result.state;
        for (const part of parts) {
            value = value && typeof value === "object"
                ? /** @type {Record<string, unknown>} */ (value)[part]
                : undefined;
        }
        assertEquals(value, expected, `Expected state.${path} to equal ${JSON.stringify(expected)}.`);
    });
}

/**
 * @param {string} path
 * @param {string} expected
 */
export function assertStateStringIncludes(path, expected) {
    return assertsGoldenCoverage([], (result) => {
        const parts = path.split(".").filter(Boolean);
        /** @type {unknown} */
        let value = result.state;
        for (const part of parts) {
            value = value && typeof value === "object"
                ? /** @type {Record<string, unknown>} */ (value)[part]
                : undefined;
        }
        assert(
            typeof value === "string" && value.includes(expected),
            `Expected state.${path} to include ${JSON.stringify(expected)}; got ${JSON.stringify(value)}.`,
        );
    });
}

/**
 * @param {string[]} capabilities
 * @param {(result: GoldenScenarioResult) => void | Promise<void>} assertion
 */
export function assertCoverageWith(capabilities, assertion) {
    return assertsGoldenCoverage(capabilities, assertion);
}
