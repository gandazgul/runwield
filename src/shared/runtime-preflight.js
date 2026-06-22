/**
 * @module shared/runtime-preflight
 * Shared startup/execution preflight checks.
 */

const MNEMOSYNE_INSTALL_URL = "https://github.com/gandazgul/mnemosyne#quick-start";
const CYMBAL_INSTALL_URL = "https://github.com/1broseidon/cymbal#install";

let mnemosyneChecked = false;
let mnemosyneAvailable = false;

let cymbalChecked = false;
let cymbalAvailable = false;

/** @typedef {"mnemosyne" | "cymbal" | "snip"} RuntimeBinary */

/** @type {null | ((binary: RuntimeBinary) => Promise<boolean>)} */
let binaryProbeOverride = null;

/**
 * @param {RuntimeBinary} binary
 * @returns {Promise<boolean>}
 */
async function hasBinary(binary) {
    if (binaryProbeOverride) return await binaryProbeOverride(binary);
    try {
        const proc = new Deno.Command(binary, {
            args: ["--help"],
            stdout: "null",
            stderr: "null",
        }).spawn();

        const status = await proc.status;
        return status.success;
    } catch {
        return false;
    }
}

/**
 * @returns {Promise<boolean>}
 */
async function hasMnemosyneBinary() {
    return await hasBinary("mnemosyne");
}

/**
 * Ensure Mnemosyne is available in PATH.
 *
 * This is a hard requirement for interactive/agent execution flows.
 *
 * @returns {Promise<void>}
 */
export async function ensureMnemosyneBinary() {
    if (!mnemosyneChecked) {
        mnemosyneAvailable = await hasMnemosyneBinary();
        mnemosyneChecked = true;
    }

    if (mnemosyneAvailable) return;

    throw new Error(
        [
            "[Harns] Mnemosyne binary not found in PATH.",
            `Install it: ${MNEMOSYNE_INSTALL_URL}`,
        ].join("\n"),
    );
}

/**
 * @returns {Promise<boolean>}
 */
async function hasCymbalBinary() {
    return await hasBinary("cymbal");
}

/**
 * Ensure Cymbal is available in PATH.
 *
 * @returns {Promise<void>}
 */
export async function ensureCymbalBinary() {
    if (!cymbalChecked) {
        cymbalAvailable = await hasCymbalBinary();
        cymbalChecked = true;
    }

    if (cymbalAvailable) return;

    throw new Error(
        [
            "[Harns] Cymbal binary not found in PATH.",
            `Install it: ${CYMBAL_INSTALL_URL}`,
        ].join("\n"),
    );
}

/**
 * Check whether Snip is available in PATH.
 *
 * Snip is optional: Harns registers its command-prefix extension only when
 * this returns true.
 *
 * @returns {Promise<boolean>}
 */
export async function hasSnipBinary() {
    return await hasBinary("snip");
}

/**
 * Reset cached runtime preflight state for tests.
 *
 * @param {null | ((binary: RuntimeBinary) => Promise<boolean>)} [probe]
 */
export function __resetRuntimePreflightForTest(probe = null) {
    mnemosyneChecked = false;
    mnemosyneAvailable = false;
    cymbalChecked = false;
    cymbalAvailable = false;
    binaryProbeOverride = probe;
}
