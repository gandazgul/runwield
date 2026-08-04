/**
 * @module shared/workflow/validation-local-ci
 *
 * Runs the project's own validation command and captures its output.
 *
 * Output is captured as a bounded tail rather than buffered whole: a failing
 * build can emit far more than is useful, and the end is the part that explains
 * the failure. The captured streams report whether they were truncated so the
 * reader is never shown a partial log as if it were complete.
 */

import { getCustomSetting, setCustomSetting } from "../settings.js";
import { spawnForegroundShell } from "../foreground-process.ts";
import {
    captureProcessStreamTail,
    formatCapturedProcessOutput,
    PROCESS_STREAM_OUTPUT_LIMIT_BYTES,
} from "./process-output.ts";
import {
    emitHostedSessionRuntimeEvent,
    emitSystemStatus,
    normalizeRuntimeToolResult,
    RuntimeEventTypes,
} from "../session/session-runtime-events.js";
import { describeRuntimeTool } from "../session/tool-event-title.js";
import { requestHostedSessionInteraction, RuntimeInteractionTypes } from "../session/session-runtime-interactions.js";

const VALIDATION_STREAM_OUTPUT_LIMIT_BYTES = PROCESS_STREAM_OUTPUT_LIMIT_BYTES;

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {string} projectRoot
 *
 * @returns {Promise<string>}
 */
async function getOrAskForValidationCommand(
    hostedSession: import("../session/hosted-session.js").HostedSession,
    projectRoot: string,
) {
    const existingCommand = getCustomSetting("verification_command", "project", projectRoot);
    if (existingCommand) {
        return (existingCommand as string);
    }

    emitSystemStatus(hostedSession, "No validation command found in project settings.");
    const response = await requestHostedSessionInteraction(hostedSession, {
        type: RuntimeInteractionTypes.TEXT,
        prompt: "Enter the command to validate this project (e.g., 'deno task ci', 'npm test'): ",
        allowEmpty: false,
    });
    const userInput = response.outcome === "text" ? String(response.value || "") : "";

    if (!userInput) {
        return "";
    }

    const newCommand = userInput.trim();
    await setCustomSetting("verification_command", newCommand, "project", projectRoot);

    emitSystemStatus(hostedSession, `Saved validation command: '${newCommand}'`);
    return newCommand;
}

/** Spawns the local validation step. */
export interface LocalCIResult {
    exitCode: number;
    output: string;
    canceled?: boolean;
}

export interface LocalCIPort {
    run(args: {
        hostedSession: import("../session/hosted-session.js").HostedSession;
        cwd: string;
    }): Promise<LocalCIResult>;
}

export async function runLocalCI(
    { hostedSession, cwd }: {
        hostedSession: import("../session/hosted-session.js").HostedSession;
        cwd: string;
    },
): Promise<LocalCIResult> {
    if (!cwd) throw new Error("runLocalCI: cwd is required");
    if (!hostedSession) throw new Error("runLocalCI: hostedSession is required");
    const cmdArgs = await getOrAskForValidationCommand(hostedSession, cwd);

    if (!cmdArgs) {
        return {
            exitCode: 1,
            output:
                "RunWield could not auto-detect a build or test command for this repository. Please explore the project and manually run the appropriate compilation or linting commands to validate your changes.",
        };
    }

    const toolCallId = `validation-ci-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const interactionId = `validation-ci:${toolCallId}`;
    const abortController = new AbortController();
    hostedSession.addActiveInteraction(interactionId, { abortController });
    const runtimeTool = describeRuntimeTool("bash", { command: cmdArgs });

    emitHostedSessionRuntimeEvent(hostedSession, {
        type: RuntimeEventTypes.TOOL_START,
        toolCallId,
        ...runtimeTool,
        args: { command: cmdArgs },
    });
    const startTime = Date.now();

    try {
        // The foreground-process module owns the wrapper shell's process group,
        // so canceling this interaction terminates the whole CI tree — not only
        // `sh -c` — and settles the inherited output pipes.
        const shell = spawnForegroundShell({ command: cmdArgs, cwd, signal: abortController.signal });
        const [outcome, stdout, stderr] = await Promise.all([
            shell.done,
            captureProcessStreamTail(shell.stdout, VALIDATION_STREAM_OUTPUT_LIMIT_BYTES),
            captureProcessStreamTail(shell.stderr, VALIDATION_STREAM_OUTPUT_LIMIT_BYTES),
        ]);
        const canceled = outcome.terminatedBy !== null;
        const output = canceled
            ? `${formatCapturedProcessOutput(stdout, stderr)}\nValidation canceled.\n`
            : formatCapturedProcessOutput(stdout, stderr);
        const durationMs = Date.now() - startTime;
        const isError = canceled || (outcome.exitCode ?? 1) !== 0;

        emitHostedSessionRuntimeEvent(hostedSession, {
            type: RuntimeEventTypes.TOOL_END,
            toolCallId,
            ...runtimeTool,
            ...normalizeRuntimeToolResult(output.trim() ? output : "(no output)\n"),
            isError,
            durationMs,
        });

        return {
            exitCode: canceled ? 130 : outcome.exitCode ?? 1,
            output,
            ...(canceled ? { canceled: true } : {}),
        };
    } catch (error) {
        const canceled = abortController.signal.aborted;
        const reason = error instanceof Error ? error.message : String(error);
        const output = canceled ? "Validation canceled." : `Failed to spawn validation process: ${reason}`;
        const durationMs = Date.now() - startTime;
        emitHostedSessionRuntimeEvent(hostedSession, {
            type: RuntimeEventTypes.TOOL_END,
            toolCallId,
            ...runtimeTool,
            ...normalizeRuntimeToolResult(`${output}\n`),
            isError: true,
            durationMs,
        });
        return {
            exitCode: canceled ? 130 : 1,
            output,
            ...(canceled ? { canceled: true } : {}),
        };
    } finally {
        // Reached only after the process tree and both streams have settled, so
        // Escape cannot unregister the interaction while a descendant still runs.
        hostedSession.removeActiveInteraction(interactionId);
    }
}

export const systemLocalCIPort: LocalCIPort = { run: runLocalCI };
