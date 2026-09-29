/**
 * @module cmd/acp
 * ACP stdio command entrypoint.
 */

import { startRunWieldAcpServer } from "../../acp/server.js";

function writeDiagnostic(message: string): void {
    console.error(`[RunWield ACP] ${message}`);
}

/**
 * Run the ACP stdio adapter. stdout is reserved for ACP protocol frames only.
 */
export async function runAcpCommand(_argv: string[] = []): Promise<void> {
    const connection = startRunWieldAcpServer(Deno.stdin.readable, Deno.stdout.writable, {
        diagnostic: writeDiagnostic,
    });

    const abort = () => connection.close();
    const signals: Deno.Signal[] = Deno.build.os === "windows" ? ["SIGINT"] : ["SIGINT", "SIGTERM"];
    for (const signal of signals) Deno.addSignalListener(signal, abort);

    try {
        await connection.closed;
    } catch (err) {
        writeDiagnostic(`fatal server error: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
    } finally {
        for (const signal of signals) Deno.removeSignalListener(signal, abort);
        connection.close();
    }
}
