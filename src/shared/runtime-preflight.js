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

/** @type {null | ((binary: "mnemosyne" | "cymbal") => Promise<boolean>)} */
let binaryProbeOverride = null;

/**
 * @returns {Promise<boolean>}
 */
async function hasMnemosyneBinary() {
    if (binaryProbeOverride) return await binaryProbeOverride("mnemosyne");
    try {
        const proc = new Deno.Command("mnemosyne", {
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
    if (binaryProbeOverride) return await binaryProbeOverride("cymbal");
    try {
        const proc = new Deno.Command("cymbal", {
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
 * Reset cached runtime preflight state for tests.
 *
 * @param {null | ((binary: "mnemosyne" | "cymbal") => Promise<boolean>)} [probe]
 */
export function __resetRuntimePreflightForTest(probe = null) {
    mnemosyneChecked = false;
    mnemosyneAvailable = false;
    cymbalChecked = false;
    cymbalAvailable = false;
    binaryProbeOverride = probe;
}
