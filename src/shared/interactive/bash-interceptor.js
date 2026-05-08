/**
 * @module shared/interactive/bash-interceptor
 *
 * Handles `!command` and `!!command` user input.
 *
 * - `!cmd`  pipes stdout/stderr into a tool block, persists the command and
 *           result on the root session, and is cancellable via Esc (the
 *           caller registers the spawned process so the keybinding handler
 *           can kill it).
 * - `!!cmd` hands the terminal over to the child (stop TUI, run inheriting
 *           stdio, then re-init the TUI). Not persisted, not cancellable.
 *
 * The caller owns: the generation guard, the `activeBashProc` slot, and the
 * root session manager. We never reach into globals from here.
 */

import { initTUI, stopTUI } from "../ui/tui.js";

/**
 * @typedef {Object} BashContext
 * @property {string} userRequest - Raw input (still includes leading `!` or `!!`).
 * @property {import('../ui/types.js').UiAPI} uiAPI
 * @property {import('@earendil-works/pi-tui').TUI} tui
 * @property {import('@earendil-works/pi-tui').Editor} editor
 * @property {() => (import('../session/types.js').SessionManagerLike | null)} getSessionManager
 * @property {import('./generation-guard.js').GenerationGuard} generationGuard
 * @property {(proc: { kill?: () => void } | null) => void} registerBashProc
 */

/**
 * Try to handle a bash-prefixed user submission.
 *
 * @param {BashContext} ctx
 * @returns {Promise<boolean>} True if the input was a bash command (handled or empty); false to defer to the next handler.
 */
export async function handleBashCommand(ctx) {
    const { userRequest } = ctx;
    if (!userRequest.startsWith("!")) return false;

    const isExcluded = userRequest.startsWith("!!");
    const command = isExcluded ? userRequest.slice(2).trim() : userRequest.slice(1).trim();

    // `!` with no command: swallow the prefix but do nothing.
    if (!command) return true;

    if (isExcluded) {
        await runInheritStdio(ctx, command);
        return true;
    }

    await runPipedCommand(ctx, command, userRequest);
    return true;
}

/**
 * `!!cmd` — hand the terminal to the child process.
 *
 * @param {BashContext} ctx
 * @param {string} command
 */
async function runInheritStdio(ctx, command) {
    const { uiAPI, tui, editor } = ctx;
    try {
        stopTUI();
        const cmd = new Deno.Command("sh", {
            args: ["-c", command],
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        });
        await cmd.output();
        initTUI();
        tui.requestRender();
    } catch (_e) {
        // Ignore error
    } finally {
        if (uiAPI.setBusy) uiAPI.setBusy(false);
        if (uiAPI.enableInput) uiAPI.enableInput();
        tui.setFocus(editor);
        tui.requestRender();
    }
}

/**
 * `!cmd` — capture output into a tool block; cancellable.
 *
 * @param {BashContext} ctx
 * @param {string} command
 * @param {string} userRequest - Original input including the `!` prefix (used for transcript).
 */
async function runPipedCommand(ctx, command, userRequest) {
    const { uiAPI, getSessionManager, generationGuard, registerBashProc } = ctx;

    // Persist the user's `!cmd` line to the session so resume shows it.
    if (uiAPI.appendUserMessage) {
        try {
            const msg = {
                role: "user",
                content: [{ type: "text", text: userRequest }],
            };
            getSessionManager()?.addMessage?.(msg);
            uiAPI.appendUserMessage?.(userRequest);
        } catch (_e) {
            // ignore
        }
    }

    const thisGen = generationGuard.bump();
    const activeToolId = `bash-${Date.now()}`;
    uiAPI.addToolInvoked?.({
        id: activeToolId,
        name: "bash",
        input: { command },
    });
    const toolBlock = uiAPI.startToolExecution?.(activeToolId, "$", command);

    let outputBuffer = "";
    let wasCanceled = false;
    const startTime = Date.now();
    /** @type {Deno.ChildProcess | null} */
    let proc = null;
    let code = 1;

    try {
        try {
            const commandProc = new Deno.Command("sh", {
                args: ["-c", command],
                cwd: Deno.cwd(),
                stdout: "piped",
                stderr: "piped",
            });
            proc = commandProc.spawn();

            registerBashProc({
                kill: () => {
                    wasCanceled = true;
                    if (proc) {
                        try {
                            proc.kill("SIGKILL");
                        } catch (_e) { /* ignore */ }
                    }
                    registerBashProc(null);
                },
            });

            /** @param {ReadableStream<Uint8Array>} stream */
            const readStream = async (stream) => {
                const reader = stream.getReader();
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        if (!wasCanceled) {
                            const chunk = new TextDecoder().decode(value);
                            toolBlock?.appendOutput(chunk);
                            outputBuffer += chunk;
                        }
                    }
                } finally {
                    reader.releaseLock();
                }
            };

            const [status] = await Promise.all([
                proc.status,
                readStream(proc.stdout),
                readStream(proc.stderr),
            ]);
            code = status.success ? 0 : status.code || 1;
        } catch (err) {
            if (!wasCanceled) {
                const chunk = `Error starting process: ${err instanceof Error ? err.message : String(err)}\n`;
                toolBlock?.appendOutput(chunk);
                outputBuffer += chunk;
            } else {
                console.error(`Error starting process: ${err}`);
            }
            code = 1;
        }

        if (wasCanceled) {
            if (toolBlock) {
                toolBlock.appendOutput("\n[Harns] Command canceled by user.");
                toolBlock.endExecution(true, Date.now() - startTime);
            }
            uiAPI.appendSystemMessage("Bash command canceled.", false, "Harns");
        } else if (generationGuard.isCurrent(thisGen)) {
            const durationMs = Date.now() - startTime;
            toolBlock?.endExecution(code !== 0, durationMs);
            uiAPI.addToolResult?.({
                id: activeToolId,
                name: "bash",
                result: outputBuffer,
                isError: code !== 0,
                durationMs,
            });
            try {
                const cmdMsg = {
                    role: "assistant",
                    content: [{
                        type: "tool_use",
                        id: activeToolId,
                        name: "bash",
                        input: { command },
                    }],
                };
                getSessionManager()?.addMessage?.(cmdMsg);

                const resultMsg = {
                    role: "user",
                    content: [{
                        type: "tool_result",
                        tool_use_id: activeToolId,
                        is_error: code !== 0,
                        content: outputBuffer,
                    }],
                };
                getSessionManager()?.addMessage?.(resultMsg);
            } catch (_e) {
                // ignore session add failure
            }
        }
    } catch (err) {
        if (generationGuard.isCurrent(thisGen)) {
            uiAPI.appendSystemMessage(
                `Error executing bash command: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    } finally {
        registerBashProc(null);
    }
}
