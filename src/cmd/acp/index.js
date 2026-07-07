/**
 * @module cmd/acp
 * ACP stdio command entrypoint.
 */

import { startRunWieldAcpServer } from "../../acp/server.js";

/**
 * @param {string} message
 */
function writeDiagnostic(message) {
    console.error(`[RunWield ACP] ${message}`);
}

/**
 * Run the ACP stdio adapter. stdout is reserved for ACP protocol frames only.
 *
 * @param {string[]} _argv
 * @returns {Promise<void>}
 */
export async function runAcpCommand(_argv = []) {
    const connection = startRunWieldAcpServer(Deno.stdin.readable, Deno.stdout.writable, {
        diagnostic: writeDiagnostic,
    });

    const abort = () => connection.close();
    Deno.addSignalListener("SIGINT", abort);
    Deno.addSignalListener("SIGTERM", abort);

    try {
        await connection.closed;
    } catch (err) {
        writeDiagnostic(`fatal server error: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
    } finally {
        Deno.removeSignalListener("SIGINT", abort);
        Deno.removeSignalListener("SIGTERM", abort);
        connection.close();
    }
}
