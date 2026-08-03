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
import {
    emitHostedSessionRuntimeEvent,
    emitSystemStatus,
    normalizeRuntimeToolResult,
    RuntimeEventTypes,
} from "../session/session-runtime-events.js";
import { describeRuntimeTool } from "../session/tool-event-title.js";
import { requestHostedSessionInteraction, RuntimeInteractionTypes } from "../session/session-runtime-interactions.js";

const VALIDATION_STREAM_OUTPUT_LIMIT_BYTES = 1024 * 1024;
interface CapturedProcessStream {
    text: string;
    totalBytes: number;
    truncated: boolean;
}

/**
 * @param {Uint8Array<ArrayBufferLike>} left
 * @param {Uint8Array<ArrayBufferLike>} right
 * @returns {Uint8Array<ArrayBufferLike>}
 */
function concatBytes(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>) {
    const combined = new Uint8Array(left.byteLength + right.byteLength);
    combined.set(left, 0);
    combined.set(right, left.byteLength);
    return combined;
}

/**
 * Read a process stream without using Deno.Command.output(), whose internal
 * buffer can throw before large-but-successful validation commands finish.
 * Retain the tail because build/test failures are usually reported last.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @param {number} limitBytes
 * @returns {Promise<CapturedProcessStream>}
 */
async function captureProcessStreamTail(stream: ReadableStream<Uint8Array>, limitBytes: number) {
    const reader = stream.getReader();
    /** @type {Uint8Array<ArrayBufferLike>} */
    let retained = new Uint8Array(0) as Uint8Array<ArrayBufferLike>;
    let totalBytes = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;

            if (value.byteLength >= limitBytes) {
                retained = value.slice(value.byteLength - limitBytes);
                continue;
            }

            retained = concatBytes(retained, value);
            if (retained.byteLength > limitBytes) {
                retained = retained.slice(retained.byteLength - limitBytes);
            }
        }
    } finally {
        reader.releaseLock();
    }

    return {
        text: new TextDecoder().decode(retained),
        totalBytes,
        truncated: totalBytes > retained.byteLength,
    };
}

/**
 * @param {CapturedProcessStream} stdout
 * @param {CapturedProcessStream} stderr
 * @returns {string}
 */
function formatCapturedProcessOutput(stdout: CapturedProcessStream, stderr: CapturedProcessStream) {
    const output = `${stdout.text}\n${stderr.text}`;
    if (!stdout.truncated && !stderr.truncated) return output;

    const notices = [];
    if (stdout.truncated) {
        notices.push(
            `[RunWield] stdout truncated; showing last ${VALIDATION_STREAM_OUTPUT_LIMIT_BYTES} of ${stdout.totalBytes} bytes.`,
        );
    }
    if (stderr.truncated) {
        notices.push(
            `[RunWield] stderr truncated; showing last ${VALIDATION_STREAM_OUTPUT_LIMIT_BYTES} of ${stderr.totalBytes} bytes.`,
        );
    }
    return `${output}\n${notices.join("\n")}\n`;
}

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
    let child: Deno.ChildProcess | null = null;
    let canceled = false;
    const abortValidationProcess = () => {
        canceled = true;
        try {
            child?.kill();
        } catch (_e) {
            // Process may have already exited.
        }
    };
    abortController.signal.addEventListener("abort", abortValidationProcess, { once: true });
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
        const isWindows = Deno.build.os === "windows";
        const cmdExe = isWindows ? "cmd" : "sh";
        const cmdFlag = isWindows ? "/c" : "-c";

        const command = new Deno.Command(cmdExe, {
            args: [cmdFlag, cmdArgs],
            cwd,
            stdout: "piped",
            stderr: "piped",
        });

        child = command.spawn();
        const [status, stdout, stderr] = await Promise.all([
            child.status,
            captureProcessStreamTail(child.stdout, VALIDATION_STREAM_OUTPUT_LIMIT_BYTES),
            captureProcessStreamTail(child.stderr, VALIDATION_STREAM_OUTPUT_LIMIT_BYTES),
        ]);
        const output = canceled
            ? `${formatCapturedProcessOutput(stdout, stderr)}\nValidation canceled.\n`
            : formatCapturedProcessOutput(stdout, stderr);
        const durationMs = Date.now() - startTime;
        const isError = canceled || status.code !== 0;

        emitHostedSessionRuntimeEvent(hostedSession, {
            type: RuntimeEventTypes.TOOL_END,
            toolCallId,
            ...runtimeTool,
            ...normalizeRuntimeToolResult(output.trim() ? output : "(no output)\n"),
            isError,
            durationMs,
        });

        return {
            exitCode: canceled ? 130 : status.code,
            output,
            ...(canceled ? { canceled: true } : {}),
        };
    } catch (error) {
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
        abortController.signal.removeEventListener("abort", abortValidationProcess);
        hostedSession.removeActiveInteraction(interactionId);
    }
}

export const systemLocalCIPort: LocalCIPort = { run: runLocalCI };
