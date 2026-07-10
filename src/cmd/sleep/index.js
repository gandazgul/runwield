/**
 * @module cmd/sleep
 * Sleep command: back up and conservatively optimize project memory.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { basename, dirname, join, resolve } from "@std/path";
import { AGENTS } from "../../constants.js";
import { createAgentHandler as createAgentHandlerFn } from "../../shared/session/agent-handler.js";
import {
    applyPendingRootSwap as applyPendingRootSwapFn,
    setActiveAgent as setActiveAgentFn,
} from "../../shared/session/agent-switching.js";
import { getRunWieldSessionMemoryBackupDir as getRunWieldSessionMemoryBackupDirFn } from "../../shared/session/root-session.js";
import { runRootTurn as runRootTurnFn } from "../../shared/session/session.js";
import { ensureMnemosyneBinary as ensureMnemosyneBinaryFn } from "../../shared/runtime-preflight.js";
import { startInteractiveSession as startInteractiveSessionFn } from "../../ui/tui/chat-session.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import { COMMAND_NAMES } from "../registry.js";

/**
 * Inlined sleep prompt content.
 * Embedded directly so `/sleep` works in compiled binaries where
 * `__dirname` from import.meta.url points to a temp directory that
 * doesn't include non-code assets.
 */
export const SLEEP_PROMPT = `# Sleep

You are running RunWield sleep mode to optimize long-term memory quality conservatively.

## Goal

- Improve memory signal quality for future sessions without losing useful context.
- Remove exact duplication, truly deprecated facts, and explicitly superseded memories.
- Preserve durable decisions, rationale, constraints, exceptions, and the history needed to understand current truth.
- Keep core memories limited to the most critical and frequently accessed context.

Memory-count reduction is not a goal. When uncertain whether context remains useful, keep the memory.

## Safety Rules

- Never treat age, verbosity, completed implementation work, or discoverability in source code as sufficient reasons to
  delete a memory.
- Do not collapse distinct decisions merely because they concern the same feature. Preserve differences in scope,
  chronology, rationale, constraints, and exceptions.
- A consolidation must be lossless: its replacement must retain every durable fact from the source memories, including
  why a decision changed and which statement is current.
- Delete a superseded memory only when an authoritative replacement clearly captures the current truth and any useful
  transition context.
- Prefer demoting a memory from \`core\` to regular over deleting it when the content remains useful but is not needed in
  every session.
- Preserve all memories that are unrelated to an identified duplicate, deprecation, supersession, or lossless
  consolidation.

## Process

1. Analyze the pre-maintenance export supplied by RunWield and classify proposed changes as one of:
   - exact duplicate;
   - truly deprecated or contradicted by an identified current authority;
   - explicitly superseded by an identified replacement;
   - lossless consolidation;
   - core-tag promotion or demotion;
   - keep.
2. Before mutating Mnemosyne, write a timestamped deletion manifest in the supplied session artifact directory. For
   every proposed deletion, record the memory ID, its full content and tags, the classification and reason, and the
   replacement memory or authoritative source that preserves its context.
3. If the proposal would delete more than 25 memories or more than 10% of the collection, whichever threshold is reached
   first, stop before mutation and ask the user to review the immutable backup and manifest. Continue only after
   explicit approval.
4. Apply approved changes. Add and verify every consolidation or replacement before deleting its source memories. Move
   memories between core (\`--tag core\`) and regular storage as needed; core is for critical, frequently accessed context
   only.
5. Export the post-maintenance collection to a separate file in the supplied session artifact directory and verify:
   - every untouched memory is still present with its original content and tags;
   - every deleted memory appears in the manifest and has a verified replacement or authority;
   - every consolidation preserves the durable facts, rationale, constraints, and exceptions of its sources.
6. Report counts for kept, promoted, demoted, consolidated, and deleted memories, plus the backup, manifest, and
   post-maintenance export paths. Do not claim that deleted memories were unnecessary; report the specific reason each
   category was safe to remove.

Delete with \`mnemosyne delete [memory id]\` and add with \`mnemosyne add [memory content] --tag tag1 --tag tag2\`.
`;

/**
 * @typedef {Object} MnemosyneExportDependencies
 * @property {(path: string, options?: Deno.MkdirOptions) => Promise<void>} [mkdir]
 * @property {(command: string, args: string[]) => Promise<{ success: boolean, code: number, stdout: Uint8Array, stderr: Uint8Array }>} [commandOutput]
 * @property {(path: string) => Promise<Deno.FileInfo>} [stat]
 */

/**
 * Export one Mnemosyne collection to an explicit recovery path and verify the file exists.
 *
 * @param {string} collectionName
 * @param {string} outputPath
 * @param {MnemosyneExportDependencies} [deps]
 * @returns {Promise<void>}
 */
export async function exportMnemosyneCollection(collectionName, outputPath, deps = {}) {
    const mkdir = deps.mkdir || Deno.mkdir;
    const stat = deps.stat || Deno.stat;
    const commandOutput = deps.commandOutput || ((command, args) =>
        new Deno.Command(command, {
            args,
            stdout: "piped",
            stderr: "piped",
        }).output());

    await mkdir(dirname(outputPath), { recursive: true });
    const args = [
        "export",
        "--name",
        collectionName,
        "--no-embeddings",
        "--output",
        outputPath,
    ];
    const result = await commandOutput("mnemosyne", args);
    if (!result.success) {
        const stderr = new TextDecoder().decode(result.stderr).trim();
        throw new Error(stderr || `mnemosyne export failed with exit code ${result.code}`);
    }

    let outputInfo;
    try {
        outputInfo = await stat(outputPath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Mnemosyne reported success but did not create the backup: ${message}`);
    }
    if (!outputInfo.isFile) {
        throw new Error(`Mnemosyne backup output is not a file: ${outputPath}`);
    }
}

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof ensureMnemosyneBinaryFn} [ensureMnemosyneBinary]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof createAgentHandlerFn} [createAgentHandler]
 * @property {typeof setActiveAgentFn} [setActiveAgent]
 * @property {typeof applyPendingRootSwapFn} [applyPendingRootSwap]
 * @property {typeof runRootTurnFn} [runRootTurn]
 * @property {typeof exportMnemosyneCollection} [exportMnemosyneCollection]
 * @property {typeof getRunWieldSessionMemoryBackupDirFn} [getRunWieldSessionMemoryBackupDir]
 * @property {() => Date} [now]
 * @property {() => string} [randomUUID]
 */

/**
 * Handle `sleep` command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: CommandDependencies }} [options]
 */
export async function runSleepCommand(argv, options = {}) {
    const deps = /** @type {CommandDependencies} */ ((/** @type {any} */ (options)).__testDeps || {});
    const parseArgs = deps.parseArgs || parseArgsFn;
    const printCommandHelp = deps.printCommandHelp || printCommandHelpFn;
    const startInteractiveSession = deps.startInteractiveSession || startInteractiveSessionFn;

    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsed.help) {
        printCommandHelp(COMMAND_NAMES.SLEEP);
        return;
    }

    if (!options.uiAPI) {
        await startInteractiveSession("/sleep", null, { initialAgentName: AGENTS.ENGINEER });
        return;
    }

    const hostedSession = options.hostedSession;
    if (!hostedSession) throw new Error("Sleep mode requires an active Hosted Session.");

    const sessionManager = options.sessionManager || hostedSession.getRootSessionManager();
    const sessionId = sessionManager?.getSessionId?.();
    if (!sessionId) throw new Error("Sleep mode requires a persisted root Session ID.");

    const ensureMnemosyneBinary = deps.ensureMnemosyneBinary || ensureMnemosyneBinaryFn;
    const exportCollection = deps.exportMnemosyneCollection || exportMnemosyneCollection;
    const getMemoryBackupDir = deps.getRunWieldSessionMemoryBackupDir ||
        getRunWieldSessionMemoryBackupDirFn;
    const now = deps.now || (() => new Date());
    const randomUUID = deps.randomUUID || crypto.randomUUID.bind(crypto);
    const createAgentHandler = deps.createAgentHandler || createAgentHandlerFn;
    const setActiveAgent = options.setActiveAgent || deps.setActiveAgent || setActiveAgentFn;
    const applyPendingRootSwap = options.applyPendingRootSwap || deps.applyPendingRootSwap || applyPendingRootSwapFn;
    const runRootTurn = deps.runRootTurn || runRootTurnFn;

    await ensureMnemosyneBinary();

    const cwd = hostedSession.cwd || Deno.cwd();
    const rawCollectionName = basename(cwd) || "default";
    const collectionName = rawCollectionName === "global" ? "default" : rawCollectionName;
    const artifactDir = resolve(getMemoryBackupDir(cwd, sessionId));
    const timestamp = now().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(
        artifactDir,
        `${collectionName}.sleep-backup-${timestamp}-${randomUUID()}.jsonl`,
    );

    await exportCollection(collectionName, backupPath);
    options.uiAPI.appendSystemMessage(`[RunWield] Memory backup created before sleep mode: ${backupPath}`);

    const handler = createAgentHandler(AGENTS.ENGINEER, { hostedSession });
    setActiveAgent(hostedSession, AGENTS.ENGINEER, handler, options.uiAPI);
    await applyPendingRootSwap(hostedSession, options.uiAPI);

    const runContext = [
        SLEEP_PROMPT,
        "",
        "## Run-specific artifact context",
        "",
        `- Immutable pre-maintenance backup: ${backupPath}`,
        `- Session artifact directory: ${artifactDir}`,
        "- Do not modify or overwrite the pre-maintenance backup.",
        "- Keep the deletion manifest, post-maintenance export, and reports in the session artifact directory.",
    ].join("\n");

    // Sleep remains command-owned so prompt-template overrides cannot weaken its safety rules.
    await runRootTurn({
        hostedSession,
        agentName: AGENTS.ENGINEER,
        userRequest: runContext,
        uiAPI: options.uiAPI,
        sessionManager: /** @type {any} */ (sessionManager),
    });
}
