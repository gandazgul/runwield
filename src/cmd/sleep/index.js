/**
 * @module cmd/sleep
 * Sleep command: run memory optimization/cleanup agent invocation.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { dirname, fromFileUrl, join } from "@std/path";
import { COMMAND_NAMES } from "../registry.js";
import { runAgentSession as runAgentSessionFn } from "../../shared/session/session.js";
import { SessionHost } from "../../shared/session/session-host.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import { ensureMnemosyneBinary as ensureMnemosyneBinaryFn } from "../../shared/runtime-preflight.js";

export const __dirname = dirname(fromFileUrl(import.meta.url));
const SLEEP_PROMPT_FILE = "prompt.md";

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof ensureMnemosyneBinaryFn} [ensureMnemosyneBinary]
 * @property {typeof runAgentSessionFn} [runAgentSession]
 * @property {typeof Deno.readTextFile} [readTextFile]
 */

/**
 * Handle `sleep` command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: CommandDependencies, uiAPI?: { appendSystemMessage?: (message: string) => void } }} [options]
 */
export async function runSleepCommand(argv, options = {}) {
    const deps = /** @type {CommandDependencies} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        parseArgs: parseArgsDep,
        printCommandHelp: printCommandHelpDep,
        ensureMnemosyneBinary: ensureMnemosyneBinaryDep,
        runAgentSession: runAgentSessionDep,
        readTextFile: readTextFileDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const ensureMnemosyneBinary = ensureMnemosyneBinaryDep || ensureMnemosyneBinaryFn;
    const runAgentSession = runAgentSessionDep || runAgentSessionFn;
    const readTextFile = readTextFileDep || Deno.readTextFile.bind(Deno);

    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsed.help) {
        printCommandHelp(COMMAND_NAMES.SLEEP);
        return;
    }

    await ensureMnemosyneBinary();

    const uiAPI = options.uiAPI;
    /** @param {string} message */
    const notify = (message) => {
        if (uiAPI?.appendSystemMessage) {
            uiAPI.appendSystemMessage(message);
            return;
        }
        console.log(message);
    };

    notify("[RunWield] Running sleep mode (memory optimization)...");

    const sleepPrompt = await readTextFile(join(__dirname, SLEEP_PROMPT_FILE));

    const sessionHost = new SessionHost();
    const hostedSession = options.hostedSession || sessionHost.createSession({
        id: `sleep-${crypto.randomUUID()}`,
        cwd: Deno.cwd(),
        sessionManager: null,
        uiAPI,
        eventSink: uiAPI,
    });

    // Sleep is command-owned rather than a prompt template so memory-system
    // maintenance cannot be shadowed by local/home prompt-template overrides.
    await runAgentSession({
        hostedSession,
        agentName: "operator",
        userRequest: sleepPrompt,
        uiAPI,
        sessionManager: /** @type {any} */ (hostedSession.getRootSessionManager() || undefined),
        useRootSession: false,
    });

    notify("[RunWield] ✅ Sleep complete.");
}
