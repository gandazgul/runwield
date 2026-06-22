/**
 * @module cmd/init/init-state
 * Global state module for tracking init status per project.
 *
 * State is stored in ~/.hns/init-state.json, keyed by SHA-256(CWD).
 * This allows the init command to warn on re-runs and the TUI to
 * conditionally hide `/init` from autocomplete once done.
 */

import { dirname, join } from "@std/path";

const HOME_DIR = Deno.env.get("HOME") || "";

/** @type {string | null} */
let STATE_PATH = null;

/**
 * Allow tests to override the state file path.
 * @param {string | null} path
 */
export function _setTestStatePath(path) {
    STATE_PATH = path;
}

/**
 * Resolve the path to the global init-state file.
 * @returns {string}
 */
function getStatePath() {
    if (STATE_PATH) return STATE_PATH;
    STATE_PATH = join(HOME_DIR, ".hns", "init-state.json");
    return STATE_PATH;
}

/**
 * Compute SHA-256 hex digest of a string.
 * @param {string} input
 * @returns {Promise<string>}
 */
async function sha256(input) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const hex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return hex;
}

/**
 * @typedef {object} InitStateEntry
 * @property {string} path - The clear (unhashed) absolute path this entry refers to.
 * @property {boolean} initOffered
 * @property {boolean} initDone
 * @property {string | null} offeredAt - ISO timestamp when init was offered (or declined), or null.
 * @property {string | null} doneAt - ISO timestamp when init was completed, or null.
 * @property {number} [snipMissingWarningCount] - Number of missing-Snip boot warnings shown for this project.
 * @property {string | null} [snipMissingWarningLastShownAt] - ISO timestamp of the last missing-Snip warning, or null.
 */

/**
 * Read the full state file from disk.
 * Returns an empty object if the file does not exist or is invalid.
 * @returns {Promise<Record<string, InitStateEntry>>}
 */
async function readState() {
    const path = getStatePath();
    try {
        const raw = await Deno.readTextFile(path);
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
        }
        return {};
    } catch (_e) {
        return {};
    }
}

/**
 * Write the full state file to disk (synchronous after init completes).
 * @param {Record<string, InitStateEntry>} state
 */
function writeStateSync(state) {
    const path = getStatePath();
    const dir = dirname(path);
    try {
        Deno.mkdirSync(dir, { recursive: true });
    } catch (_e) {
        // directory already exists or cannot be created; proceed
    }
    Deno.writeTextFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

/**
 * Get the SHA-256 hash of the current working directory.
 * @returns {Promise<string>}
 */
export async function getCwdHash() {
    return await sha256(Deno.cwd());
}

/**
 * Get the full init state object.
 * @returns {Promise<Record<string, InitStateEntry>>}
 */
export async function getInitState() {
    return await readState();
}

/**
 * Get the init state entry for the current CWD.
 * @returns {Promise<InitStateEntry | undefined>}
 */
export async function getCwdInitState() {
    const cwdHash = await getCwdHash();
    const state = await readState();
    return state[cwdHash];
}

/**
 * Build a fresh entry for a given path.
 * @param {string} path
 * @returns {InitStateEntry}
 */
function newEntry(path) {
    return {
        path,
        initOffered: false,
        initDone: false,
        offeredAt: null,
        doneAt: null,
        snipMissingWarningCount: 0,
        snipMissingWarningLastShownAt: null,
    };
}

/**
 * Read or create the current CWD state entry.
 *
 * @param {Record<string, InitStateEntry>} state
 * @returns {Promise<InitStateEntry>}
 */
async function ensureCwdEntry(state) {
    const cwd = Deno.cwd();
    const cwdHash = await getCwdHash();
    if (!state[cwdHash]) {
        state[cwdHash] = newEntry(cwd);
    } else {
        state[cwdHash].path = cwd;
    }
    return state[cwdHash];
}

/**
 * Record that init was offered for the current CWD.
 * @returns {Promise<void>}
 */
export async function recordInitOffered() {
    const state = await readState();
    const entry = await ensureCwdEntry(state);
    entry.initOffered = true;
    entry.offeredAt = new Date().toISOString();
    writeStateSync(state);
}

/**
 * Record that init completed successfully for the current CWD.
 * Implicitly marks init as offered as well.
 * @returns {Promise<void>}
 */
export async function recordInitDone() {
    const state = await readState();
    const entry = await ensureCwdEntry(state);
    const now = new Date().toISOString();
    entry.initOffered = true;
    entry.initDone = true;
    if (!entry.offeredAt) entry.offeredAt = now;
    entry.doneAt = now;
    writeStateSync(state);
}

/**
 * Check whether init has been completed for the current CWD.
 * @returns {Promise<boolean>}
 */
export async function isInitDone() {
    const entry = await getCwdInitState();
    return entry?.initDone === true;
}

/**
 * Check whether init was ever offered for the current CWD.
 * @returns {Promise<boolean>}
 */
export async function isInitOffered() {
    const entry = await getCwdInitState();
    return entry?.initOffered === true;
}

/**
 * Check whether Harns should show the missing-Snip boot warning for this CWD.
 *
 * @param {number} [limit]
 * @returns {Promise<boolean>}
 */
export async function shouldShowSnipMissingWarning(limit = 3) {
    const entry = await getCwdInitState();
    return (entry?.snipMissingWarningCount || 0) < limit;
}

/**
 * Record that Harns showed the missing-Snip boot warning for this CWD.
 *
 * @returns {Promise<void>}
 */
export async function recordSnipMissingWarningShown() {
    const state = await readState();
    const entry = await ensureCwdEntry(state);
    entry.snipMissingWarningCount = (entry.snipMissingWarningCount || 0) + 1;
    entry.snipMissingWarningLastShownAt = new Date().toISOString();
    writeStateSync(state);
}
