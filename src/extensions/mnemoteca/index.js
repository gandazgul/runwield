/**
 * @module extensions/mnemoteca
 * Mnemoteca memory extension for RunWield agent invocations.
 */

import { createMnemotecaTools } from "./tools.ts";
export { memoryToolDef } from "./tools.ts";

/**
 * Register Mnemoteca lifecycle hooks and memory tools.
 *
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function mnemotecaExtension(pi) {
    const host = {
        cwd: Deno.cwd(),
        /**
         * @param {string} command
         * @param {string[]} args
         * @param {{ cwd: string, signal?: AbortSignal }} options
         */
        exec(command, args, options) {
            return pi.exec(command, args, options);
        },
    };

    pi.on("session_start", (_event, ctx) => {
        host.cwd = ctx.cwd;
    });

    for (const tool of createMnemotecaTools(host)) {
        pi.registerTool(tool);
    }
}
