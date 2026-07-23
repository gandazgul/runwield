/** @module cmd/workspace/pair */

import { CLI_BIN } from "../../constants.js";
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { normalizePairingCode } from "../../shared/owner-coordination/crypto.js";

export function printWorkspacePairHelp() {
    console.log(`Usage: ${CLI_BIN} workspace pair <code>`);
    console.log("Approves a pending browser-initiated owner Workspace pairing request on this machine.");
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: any }} [options]
 */
export function runWorkspacePairCommand(argv, options = {}) {
    const deps = options.__testDeps || {};
    if (argv.includes("--help") || argv.includes("-h")) {
        return (deps.printWorkspacePairHelp || printWorkspacePairHelp)();
    }
    const code = normalizePairingCode(argv[0] || "");
    if (!code) {
        console.error(`[RunWield] Pairing code is required.`);
        console.error(`Run '${CLI_BIN} workspace pair --help' for usage.`);
        return;
    }
    const store = deps.store || openOwnerCoordinationStore({ dbPath: deps.dbPath });
    try {
        const approved = store.approvePairingRequest(code);
        console.log(`[RunWield] Approved Workspace pairing request for ${approved.deviceLabel}.`);
        console.log(`[RunWield] The browser can now finish pairing before ${approved.expiresAt}.`);
    } catch (error) {
        console.error(`[RunWield] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        if (!deps.store) store.close?.();
    }
}
