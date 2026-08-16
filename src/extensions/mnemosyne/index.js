/**
 * @module extensions/mnemosyne
 * Mnemosyne memory extension for RunWield agent invocations.
 */

import { createMnemosyneTools } from "./tools.ts";
export { memoryRecallToolDef, memoryWriteToolDef } from "./tools.ts";

/**
 * Register Mnemosyne lifecycle hooks and memory tools.
 *
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function mnemosyneExtension(pi) {
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

    for (const tool of createMnemosyneTools(host)) {
        pi.registerTool(tool);
    }
}
