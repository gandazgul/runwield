/**
 * @module shared/interactive/model-welcome-state
 * Global state for the first-time model setup welcome.
 */

import { dirname, join } from "@std/path";

const HOME_DIR = Deno.env.get("HOME") || "";

/** @type {string | null} */
let STATE_PATH = null;

/**
 * @typedef {Object} ModelWelcomeState
 * @property {boolean} shown
 * @property {string | null} shownAt
 */

/**
 * Test-only state file override.
 *
 * @param {string | null} path
 */
export function _setTestModelWelcomeStatePath(path) {
    STATE_PATH = path;
}

/**
 * @returns {string}
 */
function getStatePath() {
    if (STATE_PATH) return STATE_PATH;
    STATE_PATH = join(HOME_DIR, ".wld", "model-welcome-state.json");
    return STATE_PATH;
}

/**
 * @returns {ModelWelcomeState}
 */
function defaultState() {
    return { shown: false, shownAt: null };
}

/**
 * @returns {Promise<ModelWelcomeState>}
 */
export async function readModelWelcomeState() {
    try {
        const raw = await Deno.readTextFile(getStatePath());
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultState();
        return {
            shown: parsed.shown === true,
            shownAt: typeof parsed.shownAt === "string" ? parsed.shownAt : null,
        };
    } catch (_error) {
        return defaultState();
    }
}

/**
 * @param {ModelWelcomeState} state
 */
function writeModelWelcomeStateSync(state) {
    const path = getStatePath();
    Deno.mkdirSync(dirname(path), { recursive: true });
    Deno.writeTextFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

/**
 * @returns {Promise<boolean>}
 */
export async function hasModelWelcomeBeenShown() {
    const state = await readModelWelcomeState();
    return state.shown === true;
}

/**
 * @returns {Promise<void>}
 */
export async function recordModelWelcomeShown() {
    const existing = await readModelWelcomeState();
    writeModelWelcomeStateSync({
        shown: true,
        shownAt: existing.shownAt || new Date().toISOString(),
    });
}
