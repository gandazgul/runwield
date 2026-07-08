/**
 * @module cmd/sleep
 * Sleep command: run memory optimization/cleanup agent invocation.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { COMMAND_NAMES } from "../registry.js";
import { runAgentSession as runAgentSessionFn } from "../../shared/session/session.js";
import { SessionHost } from "../../shared/session/session-host.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import { ensureMnemosyneBinary as ensureMnemosyneBinaryFn } from "../../shared/runtime-preflight.js";

/**
 * Inlined sleep prompt content.
 * Embedded directly so `/sleep` works in compiled binaries where
 * `__dirname` from import.meta.url points to a temp directory that
 * doesn't include non-code assets.
 */
export const SLEEP_PROMPT = `# Sleep

You are running RunWield sleep mode to optimize long-term memory quality.

## Goal

- Improve memory signal quality for future sessions.
- Preserve high-value, durable context.
- Reduce noise, redundancy, and stale information.

## Process

1. Use \`mnemosyne export --no-embeddings\` to export all memories and core memories to a file ([project name].jsonl in
   the root directory).
2. Analyze the memories for relevance, redundancy, and importance. Optimize the memories by deleting irrelevant or
   redundant ones, and consolidating important but similar memories. Focus on keeping the most relevant and important
   information while minimizing noise and redundancy in the memory system.
3. Move memories from the core memories (tags: ['core']) to regular or vice versa as needed. Core memories should be
   reserved for the most critical and frequently accessed information, while regular memories can be used for less
   critical or less frequently accessed information.

Delete with \`mnemosyne delete [memory id]\` and add with \`mnemosyne add [memory content] --tag tag1 --tag tag2\`.
`;

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof ensureMnemosyneBinaryFn} [ensureMnemosyneBinary]
 * @property {typeof runAgentSessionFn} [runAgentSession]
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
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const ensureMnemosyneBinary = ensureMnemosyneBinaryDep || ensureMnemosyneBinaryFn;
    const runAgentSession = runAgentSessionDep || runAgentSessionFn;

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

    const sleepPrompt = SLEEP_PROMPT;

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
