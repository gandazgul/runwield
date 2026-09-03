/**
 * @module cmd/sleep
 * Sleep command: back up and conservatively optimize project memory.
 */

import { parseArgs } from "@std/cli/parse-args";
import { basename, dirname, join, resolve } from "@std/path";
import { AGENTS } from "../../constants.js";
import { ensureMnemotecaBinary } from "../../shared/runtime-preflight.ts";
import { printCommandHelp } from "../help/index.ts";
import { COMMAND_NAMES } from "../registry.js";
import type { SessionRuntime } from "../../shared/session/session-runtime.js";

interface MnemotecaCommandResult {
    success: boolean;
    code: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
}

export interface MnemotecaPort {
    ensureAvailable(): Promise<void>;
    run(args: string[]): Promise<MnemotecaCommandResult>;
}

export interface InteractiveSessionPort {
    startInteractiveSession(
        initialRequest: string | null,
        options: { initialAgentName?: string },
    ): Promise<import("../../ui/tui/types.js").UiAPI | void>;
}

export interface SleepCommandOptions {
    uiAPI?: Pick<import("../../ui/tui/types.js").UiAPI, "appendSystemMessage">;
    sessionId?: string;
    sessionRuntime?: SessionRuntime;
    mnemotecaPort: MnemotecaPort;
    sessionPort: InteractiveSessionPort;
}

export const SYSTEM_SLEEP_MNEMOTECA_PORT: MnemotecaPort = {
    ensureAvailable: ensureMnemotecaBinary,
    run: (args) =>
        new Deno.Command("mnemoteca", {
            args,
            stdout: "piped",
            stderr: "piped",
        }).output(),
};

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
2. Before mutating Mnemoteca, write a timestamped deletion manifest in the supplied session artifact directory. For
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

Delete with \`mnemoteca delete [memory id]\` and add with \`mnemoteca add [memory content] --tag tag1 --tag tag2\`.
`;

/**
 * Export one Mnemoteca collection to an explicit recovery path and verify the file exists.
 */
export async function exportMnemotecaCollection(
    collectionName: string,
    outputPath: string,
    port: Pick<MnemotecaPort, "run">,
): Promise<void> {
    await Deno.mkdir(dirname(outputPath), { recursive: true });
    const result = await port.run([
        "export",
        "--name",
        collectionName,
        "--no-embeddings",
        "--output",
        outputPath,
    ]);
    if (!result.success) {
        const stderr = new TextDecoder().decode(result.stderr).trim();
        throw new Error(stderr || `mnemoteca export failed with exit code ${result.code}`);
    }

    let outputInfo;
    try {
        outputInfo = await Deno.stat(outputPath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Mnemoteca reported success but did not create the backup: ${message}`);
    }
    if (!outputInfo.isFile) {
        throw new Error(`Mnemoteca backup output is not a file: ${outputPath}`);
    }
}

/**
 * Handle `sleep` command.
 */
export async function runSleepCommand(argv: string[], options: SleepCommandOptions): Promise<void> {
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
        await options.sessionPort.startInteractiveSession("/sleep", {
            initialAgentName: AGENTS.ENGINEER,
        });
        return;
    }

    const sessionRuntime = options.sessionRuntime;
    const runtimeSessionId = options.sessionId;
    if (!sessionRuntime || !runtimeSessionId) {
        throw new Error("Sleep mode requires an active runtime session.");
    }
    let snapshot = sessionRuntime.getSessionSnapshot(runtimeSessionId);
    if (!snapshot) throw new Error("Sleep mode requires an active runtime session.");
    if (!snapshot.sessionManagerId) {
        snapshot = await sessionRuntime.materializePromptReadySession(runtimeSessionId);
    }

    const mnemoteca = options.mnemotecaPort;
    await mnemoteca.ensureAvailable();

    const cwd = snapshot.cwd;
    const rawCollectionName = basename(cwd) || "default";
    const collectionName = rawCollectionName === "global" ? "default" : rawCollectionName;
    const artifactDir = resolve(sessionRuntime.getSessionMemoryBackupDir(runtimeSessionId));
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(
        artifactDir,
        `${collectionName}.sleep-backup-${timestamp}-${crypto.randomUUID()}.jsonl`,
    );

    await exportMnemotecaCollection(collectionName, backupPath, mnemoteca);
    options.uiAPI.appendSystemMessage(`[RunWield] Memory backup created before sleep mode: ${backupPath}`);

    await sessionRuntime.switchAgent(runtimeSessionId, { agentName: AGENTS.ENGINEER });

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

    await sessionRuntime.promptSession(runtimeSessionId, {
        initialRequest: runContext,
    });
}
