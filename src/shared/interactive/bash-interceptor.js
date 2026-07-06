/**
 * @module shared/interactive/bash-interceptor
 *
 * Handles `!command` and `!!command` user input.
 *
 * Both variants run the command and stream stdout/stderr into a tool block in
 * the TUI. The difference is context: `!cmd` persists the command and result
 * onto the root session so the model sees it on resume; `!!cmd` is ephemeral
 * (block only, never written to the session).
 *
 * When invoked while another operation is already running (`concurrent=true`)
 * the bash run never bumps the generation guard and never writes to the
 * session — both would race with the in-flight model.
 *
 * The caller owns: the generation guard, the `activeBashProc` slot, and the
 * root session manager. We never reach into globals from here.
 */

/**
 * @typedef {Object} BashContext
 * @property {string} userRequest - Raw input (still includes leading `!` or `!!`).
 * @property {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @property {import('@earendil-works/pi-tui').TUI} tui
 * @property {import('@earendil-works/pi-tui').Editor} editor
 * @property {() => (import('../session/types.js').SessionManagerLike | null)} getSessionManager
 * @property {import('./generation-guard.js').GenerationGuard} generationGuard
 * @property {(proc: { kill?: () => void } | null) => void} registerBashProc
 * @property {boolean} [concurrent] - True when another operation is in flight; skips gen-guard bump and session persistence.
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

    const isEphemeral = userRequest.startsWith("!!");
    const command = isEphemeral ? userRequest.slice(2).trim() : userRequest.slice(1).trim();

    // `!` with no command: swallow the prefix but do nothing.
    if (!command) return true;

    const persistToSession = !isEphemeral && !ctx.concurrent;
    await runPipedCommand(ctx, command, userRequest, persistToSession);
    return true;
}

/**
 * Run a shell command and stream its output into a TUI tool block.
 *
 * @param {BashContext} ctx
 * @param {string} command
 * @param {string} userRequest - Original input including the `!` prefix (used for transcript).
 * @param {boolean} persistToSession - When true, write the user line, tool_use, and tool_result onto the root session.
 */
async function runPipedCommand(ctx, command, userRequest, persistToSession) {
    const { uiAPI, tui, getSessionManager, generationGuard, registerBashProc, concurrent } = ctx;

    if (persistToSession && uiAPI.appendUserMessage) {
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

    // Skip gen-guard bump while another operation owns the current generation;
    // bumping would invalidate that operation's late UI updates.
    const thisGen = concurrent ? -1 : generationGuard.bump();
    const genIsCurrent = () => concurrent ? true : generationGuard.isCurrent(thisGen);

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
                            // Text.setText only invalidates the cache; force a redraw
                            // so the user sees output as it streams.
                            tui.requestRender();
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
                toolBlock.appendOutput("\n[RunWield] Command canceled by user.");
                toolBlock.endExecution(true, Date.now() - startTime);
            }
            uiAPI.appendSystemMessage("Bash command canceled.", false, "RunWield");
        } else if (genIsCurrent()) {
            const durationMs = Date.now() - startTime;
            toolBlock?.endExecution(code !== 0, durationMs);
            uiAPI.addToolResult?.({
                id: activeToolId,
                name: "bash",
                result: outputBuffer,
                isError: code !== 0,
                durationMs,
            });
            if (persistToSession) {
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
        }
    } catch (err) {
        if (genIsCurrent()) {
            uiAPI.appendSystemMessage(
                `Error executing bash command: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    } finally {
        registerBashProc(null);
    }
}
