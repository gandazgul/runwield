/**
 * @module shared/chat-session
 * High-level interactive loop for the TUI. This manages the long-running
 * user interaction — distinct from individual agent invocations (see session.js).
 */

import {
    CombinedAutocompleteProvider,
    Container,
    Editor,
    Image,
    Key,
    matchesKey,
    Spacer,
    Text,
} from "@mariozechner/pi-tui";
import { initTUI, stopTUI } from "./tui.js";
import { editorTheme, imageTheme, theme } from "./ui/theme.js";
import { readClipboardImage } from "./clipboard.js";
import { createUiApi } from "./ui/api.js";
import { SpinnerBlock } from "./ui/blocks.js";
import { abortActiveSession, listPromptTemplates, runAgentSession } from "./session/session.js";
import { cancelActivePlanReview } from "./workflow/submit-plan.js";
import { ensureMnemosyneBinary } from "./runtime-preflight.js";
import { commandRegistry } from "../cmd/registry.js";
import { getDefaultModelAndProvider, getModelRegistry } from "./models/model-registry.js";
import {
    getActiveAgentName,
    getActiveModelState,
    getActiveOnMessage,
    getActiveUiAPIState,
    getRootSessionManager,
    setActiveAgentName,
    setActiveModelState,
    setActiveOnMessage,
    setActiveUiAPI,
    setRootSessionManager,
} from "./session/session-state.js";
import { parseProviderModel } from "./models/model-validation.js";
import { createDirectAgentHandler } from "./direct-agent.js";
import { createRootSessionManager } from "./session/root-session.js";

const UI_PADDING = { x: 0, y: 0 };

const CHAT_PROMPT_AGENT_NAME = "operator";

/** @type {Set<string>} */
export let CHAT_BUILTIN_SLASH_NAMES = new Set();

/**
 * @param {{ name: string, source: "local" | "home" | "bundled" }} template
 */
function toUserFacingPromptPath(template) {
    if (template.source === "local") return `./.hns/prompts/${template.name}.md`;
    return `~/.hns/prompts/${template.name}.md`;
}

/**
 * Update the active agent and its message handler dynamically.
 * @param {string} agentName
 * @param {import('./session/types.js').AgentMessageHandler} handler
 * @param {import('./ui/types.js').UiAPI} [uiAPI]
 * @param {string} [agentModel]
 */
export function setActiveAgent(agentName, handler, uiAPI, agentModel) {
    if (getActiveAgentName() !== agentName) {
        if (uiAPI) {
            const modelText = agentModel ? ` (model: ${agentModel})` : "";
            uiAPI.appendSystemMessage(`Switched to ${agentName}${modelText}.`);
        }
    }
    setActiveAgentName(agentName);
    if (agentModel) {
        const slashIndex = agentModel.indexOf("/");
        if (slashIndex > 0) {
            setActiveModelState(agentModel, agentModel.slice(0, slashIndex));
        } else {
            setActiveModelState(agentModel);
        }
    }
    setActiveOnMessage(handler);
    if (uiAPI) {
        setActiveUiAPI(uiAPI);
        uiAPI.requestRender();
    }
}

/**
 * @param {string} model
 * @param {string} [provider]
 */
export function setActiveModel(model, provider) {
    setActiveModelState(model, provider || "");
    getActiveUiAPIState()?.requestRender();
}

/**
 * Get the active UI API reference.
 * @returns {import('./workflow/workflow.js').UiAPI | null}
 */
export function getActiveUiAPI() {
    return getActiveUiAPIState();
}

/**
 * Get the active model identifier (may include provider prefix).
 * @returns {string}
 */
export function getActiveModel() {
    return getActiveModelState().model;
}

/**
 * Resolve and validate a template-declared model.
 * Requires strict provider/id format and configured auth.
 *
 * @param {string} templateModel
 * @param {object} [modelRegistry]
 * @returns {{ ok: true, provider: string, id: string } | { ok: false }}
 */
export function resolveTemplateModel(templateModel, modelRegistry) {
    const registry =
        /** @type {{ find: (provider: string, model: string) => unknown, hasConfiguredAuth: (model: unknown) => boolean }} */ (
            modelRegistry || getModelRegistry()
        );
    const parsed = parseProviderModel(templateModel);
    if (!parsed.ok) {
        return { ok: false };
    }

    const resolvedModel = registry.find(parsed.provider, parsed.id);
    if (!resolvedModel || !registry.hasConfiguredAuth(resolvedModel)) {
        return { ok: false };
    }

    const configuredModel = /** @type {{ provider: string, id: string }} */ (resolvedModel);
    return { ok: true, provider: configuredModel.provider, id: configuredModel.id };
}

/**
 * @param {{ type?: string, text?: string, [key: string]: unknown }} block
 * @returns {string}
 */
function blockToDisplayText(block) {
    if (!block || typeof block !== "object") return "";

    if (block.type === "text") {
        return typeof block.text === "string" ? block.text : "";
    }

    if (block.type === "thinking") {
        return typeof block.thinking === "string" ? block.thinking : "";
    }

    if (block.type === "tool_result") {
        const content = block.content;
        if (typeof content === "string") {
            return content;
        }
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
                        return part.text;
                    }
                    return "";
                })
                .filter(Boolean)
                .join("\n");
        }
        return "";
    }

    // Non-textual blocks are rendered separately (e.g. tool blocks, images) or ignored.
    return "";
}

/**
 * @param {unknown} message
 * @returns {string}
 */
function messageToDisplayText(message) {
    if (!message || typeof message !== "object") return "";

    const content = /** @type {{ content?: unknown }} */ (message).content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
        .map((block) =>
            blockToDisplayText(/** @type {{ type?: string, text?: string, [key: string]: unknown }} */ (block))
        )
        .filter(Boolean)
        .join("\n\n")
        .trim();
}

/**
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} sessionManager
 * @param {import('./ui/types.js').UiAPI} uiAPI
 */
export function restorePersistedMessagesToUi(sessionManager, uiAPI) {
    const context = sessionManager.buildSessionContext();
    const messages = Array.isArray(context?.messages) ? context.messages : [];
    if (messages.length === 0) return;

    for (const message of messages) {
        if (!message || typeof message !== "object") continue;

        const role = /** @type {{ role?: string }} */ (message).role;

        if (role === "custom") {
            const display = /** @type {{ display?: boolean }} */ (message).display;
            if (display === false) continue;
            const text = messageToDisplayText(message);
            if (text) uiAPI.appendSystemMessage(text);
            continue;
        }

        if (role === "assistant") {
            const content = /** @type {{ content?: unknown }} */ (message).content;

            if (Array.isArray(content)) {
                /** @type {{ appendText: (delta: string) => void } | null} */
                let appender = null;

                for (const block of content) {
                    if (!block || typeof block !== "object") continue;

                    const typedBlock =
                        /** @type {{ type?: string, text?: unknown, thinking?: unknown, name?: unknown, id?: unknown }} */ (block);

                    if (typedBlock.type === "thinking") {
                        if (typeof typedBlock.thinking === "string" && typedBlock.thinking.trim()) {
                            uiAPI.appendSystemMessage(typedBlock.thinking);
                        }
                        continue;
                    }

                    if (typedBlock.type === "text") {
                        if (typeof typedBlock.text === "string" && typedBlock.text) {
                            if (!appender) {
                                appender = uiAPI.appendAgentMessageStart(getActiveAgentName() || "assistant");
                            }
                            appender.appendText(typedBlock.text);
                        }
                        continue;
                    }

                    if (typedBlock.type === "tool_use") {
                        const toolName = typeof typedBlock.name === "string" ? typedBlock.name : "tool";
                        const toolId = typeof typedBlock.id === "string"
                            ? typedBlock.id
                            : `restored-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        const toolBlock = uiAPI.startToolExecution?.(toolId, toolName, "");
                        toolBlock?.endExecution(false, 0);
                    }
                }
                continue;
            }

            const text = messageToDisplayText(message);
            if (text) {
                const appender = uiAPI.appendAgentMessageStart(getActiveAgentName() || "assistant");
                appender.appendText(text);
            }
            continue;
        }

        if (role === "user") {
            const text = messageToDisplayText(message);
            if (text) {
                uiAPI.appendUserMessage?.(text);
            }

            const content = /** @type {{ content?: unknown }} */ (message).content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (
                        block && typeof block === "object" &&
                        /** @type {{ type?: string }} */ (block).type === "image" &&
                        typeof /** @type {{ data?: unknown }} */ (block).data === "string" &&
                        typeof /** @type {{ mimeType?: unknown }} */ (block).mimeType === "string"
                    ) {
                        uiAPI.appendImage?.(
                            /** @type {{ data: string }} */ (block).data,
                            /** @type {{ mimeType: string }} */ (block).mimeType,
                        );
                    }
                }
            }
            continue;
        }

        const fallbackText = messageToDisplayText(message);
        if (fallbackText) {
            uiAPI.appendSystemMessage(fallbackText);
        }
    }
}

/**
 * Starts the interactive TUI loop.
 * @param {string | null} initialUserRequest
 * @param {import('./session/types.js').AgentMessageHandler | null} onMessage - Handler for user submissions
 * @param {{ sessionStartMode?: "new" | "continue" }} [options]
 */
export async function startInteractiveSession(initialUserRequest, onMessage, options = {}) {
    CHAT_BUILTIN_SLASH_NAMES = new Set(
        Object.values(commandRegistry)
            .filter((command) => command.isSlash)
            .map((command) => command.name),
    );

    const rootSessionManager = await createRootSessionManager(options.sessionStartMode || "new", Deno.cwd());
    setRootSessionManager(rootSessionManager);
    const sessionStartedAt = rootSessionManager.getHeader()?.timestamp || new Date().toISOString();
    setActiveOnMessage(onMessage);
    await ensureMnemosyneBinary();
    const tui = initTUI();

    const container = new Container();

    // Header
    container.addChild(new Spacer(1));
    container.addChild(
        new Text(
            theme.fg("accent", theme.bold("Harns ─ Plan-by-Default Harness")),
            UI_PADDING.x,
            UI_PADDING.y,
        ),
    );
    container.addChild(new Spacer(1));

    const messageList = new Container();
    container.addChild(messageList);
    container.addChild(new Spacer(1));

    const runningTasksComponent = new SpinnerBlock();
    container.addChild(runningTasksComponent);

    /** @type {import('./session/types.js').ImageAttachment[]} */
    const pastedImages = [];
    const previewImages = new Container();
    container.addChild(previewImages);

    const editor = new Editor(tui, editorTheme);
    container.addChild(editor);

    // Footer
    const cwd = Deno.cwd().replace(Deno.env.get("HOME") || "", "~");
    let branch = "main";
    try {
        const cmd = new Deno.Command("git", { args: ["branch", "--show-current"] });
        const { success, stdout } = cmd.outputSync();
        if (success) {
            branch = new TextDecoder().decode(stdout).trim();
        }
    } catch (_e) {
        branch = "unknown";
    }

    const getModelAndProvider = () => {
        const defaults = getDefaultModelAndProvider();
        let { model, provider } = defaults;

        const activeModel = getActiveModelState();
        if (activeModel.model) {
            const slashIndex = activeModel.model.indexOf("/");
            if (slashIndex > 0) {
                provider = activeModel.model.slice(0, slashIndex);
                model = activeModel.model.slice(slashIndex + 1);
            } else {
                model = activeModel.model;
                if (activeModel.provider) {
                    provider = activeModel.provider;
                }
            }
        } else if (activeModel.provider) {
            provider = activeModel.provider;
        }

        return { model, provider };
    };

    const footer = {
        invalidate: () => {},
        /** @param {number} w */
        render: (w) => {
            const { model, provider } = getModelAndProvider();
            const leftStr = `${cwd} (${branch})`;
            const rightStr = model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
            const spaceCount = Math.max(0, w - leftStr.length - rightStr.length);
            const activeAgentName = getActiveAgentName();
            const agentLine = " ".repeat(Math.max(0, w - activeAgentName.length)) +
                theme.fg("accent", activeAgentName);
            return [
                agentLine,
                theme.fg("dim", leftStr + " ".repeat(spaceCount) + rightStr),
            ];
        },
    };
    container.addChild(footer);

    const rootWrapper = {
        invalidate: () => container.invalidate(),
        /** @param {number} w */
        render: (w) => {
            const rightMargin = 2;

            return container.render(Math.max(10, w - rightMargin));
        },
    };

    tui.addChild(rootWrapper);
    tui.setFocus(editor);

    // Load prompt-template metadata once per interactive session.
    const promptTemplates = await listPromptTemplates();
    const invokablePromptTemplates = promptTemplates.filter((template) => !CHAT_BUILTIN_SLASH_NAMES.has(template.name));
    const blockedPromptTemplates = promptTemplates.filter((template) => CHAT_BUILTIN_SLASH_NAMES.has(template.name));
    /** @type {Map<string, (typeof invokablePromptTemplates)[number]>} */
    const promptTemplateByName = new Map(invokablePromptTemplates.map((template) => [template.name, template]));

    const autocompleteProvider = new CombinedAutocompleteProvider(
        [
            ...Array.from(CHAT_BUILTIN_SLASH_NAMES).map((name) => {
                /** @type {import('@mariozechner/pi-tui').SlashCommand} */
                return {
                    name,
                    description: commandRegistry[name].description,
                    getArgumentCompletions: commandRegistry[name].getArgumentCompletions,
                };
            }),
            ...invokablePromptTemplates.map((template) => ({
                name: template.name,
                argumentHint: template.argumentHint,
                description: template.description,
            })),
        ],
        Deno.cwd(),
        "fd", // Since pi 0.20 the agent guarantees that fd is available in PATH or it polyfills it so using 'fd' directly as binary path is safe.
    );
    editor.setAutocompleteProvider(autocompleteProvider);

    // Expose a UI API for agents to append to the message list
    const uiAPI = createUiApi(tui, messageList, runningTasksComponent);

    // Ensure modal prompts (select/text) always return focus to the editor once settled.
    // Otherwise a settled prompt block can keep focus and swallow Esc, making cancellation feel broken.
    const basePromptSelect = uiAPI.promptSelect?.bind(uiAPI);
    if (basePromptSelect) {
        uiAPI.promptSelect = async (title, options) => {
            try {
                return await basePromptSelect(title, options);
            } finally {
                tui.setFocus(editor);
                tui.requestRender();
            }
        };
    }

    const basePromptText = uiAPI.promptText?.bind(uiAPI);
    if (basePromptText) {
        uiAPI.promptText = async (title, opts) => {
            try {
                return await basePromptText(title, opts);
            } finally {
                tui.setFocus(editor);
                tui.requestRender();
            }
        };
    }

    // ─── Unified Active-Operation Cancellation State ──────────────────

    /** @type {(() => void) | null} */
    let activeOperationCancel = null;

    /** @type {{ pid?: number, kill?: () => void } | null} */
    let activeBashProc = null;

    /** Monotonically increasing counter; each new operation increments it.
     *  Late callbacks check their captured generation against the current value. */
    let operationGeneration = 0;

    /** Check if the given generation is still the current one.
     *  Returns false when a newer operation has started (i.e., we were canceled).
     *  @param {number} gen
     */
    function generationStillCurrent(gen) {
        return gen === operationGeneration;
    }

    /** Reset UI to idle state regardless of what was running.
     *  Safe to call multiple times (idempotent). */
    function forceResetUI() {
        editor.disableSubmit = false;
        if (uiAPI.setBusy) uiAPI.setBusy(false);
        if (uiAPI.enableInput) uiAPI.enableInput();
        tui.setFocus(editor);
        tui.requestRender();
    }

    /** Cancel the currently active operation, if any.
     *  Returns true if something was actually canceled.
     */
    function cancelActiveOperation() {
        // 1. Kill running bash process
        if (activeBashProc) {
            try {
                if (activeBashProc.kill) activeBashProc.kill();
            } catch (_e) { /* ignore */ }
            activeBashProc = null;
        }
        // 2. Call registered operation cancel callback
        if (activeOperationCancel) {
            try {
                activeOperationCancel();
            } catch (_e) { /* ignore */ }
            activeOperationCancel = null;
            return true;
        }
        return false;
    }

    // Chat session specific UI overrides/extensions
    uiAPI.setAgentInfo = (agentName, agentModel) => {
        setActiveAgentName(agentName);
        if (agentModel) {
            const slashIndex = agentModel.indexOf("/");
            if (slashIndex > 0) {
                setActiveModelState(agentModel, agentModel.slice(0, slashIndex));
            } else {
                setActiveModelState(agentModel);
            }
        }
        tui.requestRender();
    };

    uiAPI.disableInput = () => {
        if (editor) {
            // editor.disableSubmit = true;
            tui.requestRender();
        }
    };

    uiAPI.enableInput = () => {
        if (editor) {
            editor.disableSubmit = false;
            tui.requestRender();
        }
    };

    uiAPI.appendImage = (base64, mimeType) => {
        if (uiAPI.isOutputSuppressed?.()) return;
        const img = new Image(base64, mimeType, imageTheme, {
            maxWidthCells: 60,
            maxHeightCells: 20,
        });
        messageList.addChild(img);
        tui.requestRender();
    };

    // @ts-ignore: TS doesn't know about pi-tui Editor internals
    editor.onFocus = () => {
        try {
            tui.requestRender();
        } catch (_e) {
            // Ignore
        }
    };
    // @ts-ignore: TS doesn't know about pi-tui Editor internals
    editor.onBlur = () => {
        try {
            tui.requestRender();
        } catch (_e) {
            // Ignore
        }
    };
    editor.onChange = () => {
        try {
            tui.requestRender();
        } catch (_e) {
            // Ignore
        }
    };

    /** Force-unset the focused component if it's a prompt block, so Esc
     *  can return focus to the editor even when a choice/text prompt is active. */
    function dismissActivePrompt() {
        // The TUI tracks focus via setFocus; we just need to re-focus the editor.
        // Any pending Promise from promptSelect/promptText will stay pending until
        // it is settled by its own block callbacks, but after focus is returned the
        // user sees a working editor immediately.
        tui.setFocus(editor);
    }

    // Handle Editor events
    /** @type {Array<{text: string, images: import('./session/types.js').ImageAttachment[]}>} */
    const submissionQueue = [];
    let isProcessingSubmission = false;

    async function processSubmissions() {
        if (isProcessingSubmission) return;
        isProcessingSubmission = true;

        while (submissionQueue.length > 0) {
            const item = submissionQueue.shift();
            if (!item) continue;
            const { text, images: savedImages } = item;
            await executeUserRequest(text, savedImages);
        }

        isProcessingSubmission = false;
        forceResetUI();
    }

    // Handle Editor events
    /**
     * @param {string} text
     * @param {import('./session/types.js').ImageAttachment[]} savedImages
     */
    async function executeUserRequest(text, savedImages) {
        const userRequest = text.trim();
        if (!userRequest) return;

        editor.addToHistory?.(userRequest);

        // Bash command interception
        if (userRequest.startsWith("!")) {
            const isExcluded = userRequest.startsWith("!!");
            const command = isExcluded ? userRequest.slice(2).trim() : userRequest.slice(1).trim();

            if (command) {
                // @ts-ignore: TS doesn't know about UI API typing inside session management
                if (uiAPI.appendUserMessage && !isExcluded) {
                    try {
                        const msg = {
                            role: "user",
                            content: [{ type: "text", text: userRequest }],
                        };
                        getRootSessionManager()?.addMessage?.(msg);
                        uiAPI.appendUserMessage?.(userRequest);
                    } catch (_e) {
                        // ignore
                    }
                }

                // Generation gating: suppress late results if canceled
                const thisGen = ++operationGeneration;

                try {
                    const activeToolId = `bash-${Date.now()}`;
                    if (!isExcluded) {
                        uiAPI.addToolInvoked?.({
                            id: activeToolId,
                            name: "bash",
                            input: { command },
                        });
                    }

                    const toolBlock = isExcluded ? undefined : uiAPI.startToolExecution?.(activeToolId, "$", command);

                    let outputBuffer = "";
                    let wasCanceled = false;

                    if (isExcluded) {
                        try {
                            const { stopTUI, initTUI } = await import("./tui.js");
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
                        return;
                    }

                    const startTime = Date.now();
                    /** @type {Deno.ChildProcess | null} */
                    let proc = null;
                    let code = 1;

                    try {
                        const commandProc = new Deno.Command("sh", {
                            args: ["-c", command],
                            cwd: Deno.cwd(),
                            stdout: "piped",
                            stderr: "piped",
                        });
                        proc = commandProc.spawn();

                        // Register cancel callback for this bash operation
                        activeBashProc = {
                            kill: () => {
                                wasCanceled = true;
                                if (proc) {
                                    try {
                                        proc.kill("SIGKILL");
                                    } catch (_e) { /* ignore */ }
                                }
                                activeBashProc = null;
                            },
                        };

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
                            const chunk = `Error starting process: ${
                                err instanceof Error ? err.message : String(err)
                            }\n`;
                            toolBlock?.appendOutput(chunk);
                            outputBuffer += chunk;
                        } else {
                            console.error(`Error starting process: ${err}`);
                        }
                        code = 1;
                    }

                    // After wait, check if we were canceled while waiting
                    if (wasCanceled) {
                        if (toolBlock) {
                            toolBlock.appendOutput("\n[Harns] Command canceled by user.");
                            toolBlock.endExecution(true, Date.now() - startTime);
                        }
                        uiAPI.appendSystemMessage("[Harns] Bash command canceled.");
                    } else if (!isExcluded && generationStillCurrent(thisGen)) {
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
                            getRootSessionManager()?.addMessage?.(cmdMsg);

                            const resultMsg = {
                                role: "user",
                                content: [{
                                    type: "tool_result",
                                    tool_use_id: activeToolId,
                                    is_error: code !== 0,
                                    content: outputBuffer,
                                }],
                            };
                            getRootSessionManager()?.addMessage?.(resultMsg);
                        } catch (_e) {
                            // ignore session add failure
                        }
                    }
                } catch (err) {
                    if (generationStillCurrent(thisGen)) {
                        uiAPI.appendSystemMessage(
                            `Error executing bash command: ${err instanceof Error ? err.message : String(err)}`,
                        );
                    }
                } finally {
                    activeBashProc = null;
                    // forceResetUI(); handled by queue
                }
                return;
            }
        }

        if (userRequest.startsWith("/")) {
            const [rawCommand, ...args] = userRequest.slice(1).split(" ");
            const command = rawCommand.trim();

            // Built-in command intercepted logic to just reset editor state,
            // dispatch actually handled via standard registry for TUI route now.
            // (The `agent` command is handled in the generic registry routing block below.)

            const thisGen = ++operationGeneration;

            const { commandRegistry } = await import("../cmd/registry.js");

            if (CHAT_BUILTIN_SLASH_NAMES.has(command) && commandRegistry[command]) {
                // Register cancel hook: abort any agent session started by this command
                activeOperationCancel = () => {
                    abortActiveSession();
                };
                try {
                    await commandRegistry[command].execute(args, {
                        uiAPI,
                        editor,
                        sessionManager: getRootSessionManager() || undefined,
                        sessionStartedAt,
                        tui,
                        originalHandleInput,
                    });
                } catch (err) {
                    if (generationStillCurrent(thisGen)) {
                        uiAPI.appendSystemMessage(
                            `Error: ${err instanceof Error ? err.message : String(err)}`,
                        );
                    }
                } finally {
                    activeOperationCancel = null;
                    // forceResetUI(); handled by queue
                }
            } else {
                const template = promptTemplateByName.get(command);

                if (template) {
                    // Dispatch prompt templates to operator (not selected chat agent)

                    let resolvedTemplateModel = null;
                    if (template.model) {
                        const resolution = resolveTemplateModel(template.model);
                        if (!resolution.ok) {
                            uiAPI.appendSystemMessage("Invalid template model. Use /model to switch.");
                            return;
                        }

                        resolvedTemplateModel = resolution;
                    }

                    const images = savedImages;

                    uiAPI.appendUserMessage?.(userRequest);
                    images.forEach((/** @type {import('./session/types.js').ImageAttachment} */ img) => {
                        if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
                    });

                    const templateModelValue = resolvedTemplateModel?.ok
                        ? `${resolvedTemplateModel?.provider}/${resolvedTemplateModel?.id}`
                        : undefined;

                    setActiveAgent(
                        CHAT_PROMPT_AGENT_NAME,
                        createDirectAgentHandler(CHAT_PROMPT_AGENT_NAME),
                        uiAPI,
                        templateModelValue,
                    );

                    try {
                        await runAgentSession({
                            agentName: CHAT_PROMPT_AGENT_NAME,
                            modelOverride: templateModelValue,
                            userRequest,
                            images,
                            uiAPI,
                            sessionManager: getRootSessionManager() || undefined,
                        });
                    } catch (err) {
                        if (generationStillCurrent(thisGen)) {
                            uiAPI.appendSystemMessage(
                                `Error: ${err instanceof Error ? err.message : String(err)}`,
                            );
                        }
                    }
                    return;
                }

                uiAPI.appendSystemMessage(`Unknown command: /${command}`);
            }
            return;
        }

        // Generation gating
        const thisGen = ++operationGeneration;

        const images = savedImages;

        uiAPI.appendUserMessage?.(userRequest);
        images.forEach((/** @type {import('./session/types.js').ImageAttachment} */ img) => {
            if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
        });

        try {
            const activeOnMessage = getActiveOnMessage();
            const rootSessionManager = getRootSessionManager();
            if (activeOnMessage && rootSessionManager) {
                setActiveUiAPI(uiAPI);
                await activeOnMessage(userRequest, images, uiAPI, rootSessionManager);
            } else {
                uiAPI.appendSystemMessage("Error: No active agent handler or session manager.");
            }
        } catch (err) {
            if (generationStillCurrent(thisGen)) {
                uiAPI.appendSystemMessage(
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        } finally {
            // forceResetUI(); handled by queue
        }
    }

    editor.onSubmit = (text) => {
        const userRequest = text.trim();
        if (!userRequest) return;

        editor.addToHistory?.(userRequest);

        submissionQueue.push({ text: userRequest, images: [...pastedImages] });
        pastedImages.length = 0;
        previewImages.clear();
        editor.setText("");

        if (isProcessingSubmission) {
            uiAPI.appendSystemMessage(`[Queued message: ${userRequest}]`);
            tui.requestRender();
            return;
        }

        processSubmissions();
    };

    // Re-render UI after handling pasted images
    tui.requestRender();

    let lastCtrlC = 0;

    // Custom keybindings for Editor
    const originalHandleInput = editor.handleInput.bind(editor);
    /** @param {string} data */
    editor.handleInput = async (data) => {
        // Intercept Esc: ALWAYS cancels whatever is going on
        if (matchesKey(data, Key.escape)) {
            // 1. Bump generation to suppress late results from whatever is running
            ++operationGeneration;
            // 1.5 Clear the submission queue
            submissionQueue.length = 0;
            // 2. Dismiss any active prompt overlay/block
            dismissActivePrompt();
            // 3. Cancel active operation (bash, registered callback, etc.)
            const opCanceled = cancelActiveOperation();
            // 4. Fall back to abort active agent session
            const sessionAborted = abortActiveSession();
            // 5. Fall back to cancel active plan review wait
            const planCanceled = cancelActivePlanReview();
            // 6. Always force-reset UI to idle
            forceResetUI();
            // 7. Give user feedback about what was canceled
            if (opCanceled) {
                uiAPI.appendSystemMessage("[Harns] Operation canceled.");
            } else if (sessionAborted) {
                uiAPI.appendSystemMessage("[Harns] Agent run canceled.");
            } else if (planCanceled) {
                uiAPI.appendSystemMessage("[Harns] Plan review canceled.");
            } else {
                // Nothing was actively running, but we still reset UI for safety
                // (covers stale Thinking... state after provider errors)
                uiAPI.appendSystemMessage("[Harns] Cleared.");
            }
            tui.requestRender();
            return;
        }

        // Intercept Ctrl+C
        if (matchesKey(data, Key.ctrl("c"))) {
            const now = Date.now();
            if (now - lastCtrlC < 1000) {
                stopTUI();
                setTimeout(() => Deno.exit(0), 100);
                return;
            } else {
                lastCtrlC = now;
                const aborted = abortActiveSession();
                if (aborted) {
                    uiAPI.appendSystemMessage("[Harns] Keyboard interrupt. Press again to quit.");
                    tui.requestRender();
                }
                return;
            }
        }

        // Ctrl+V for paste image
        if (matchesKey(data, Key.ctrl("v"))) {
            const img = await readClipboardImage();
            if (img) {
                pastedImages.push(img);
                previewImages.addChild(
                    new Text(theme.fg("dim", `[Attached image: ${img.mimeType}]`)),
                );
                tui.requestRender();
            }
            return;
        }
        // Ctrl+O toggles expand/collapse for tool output blocks
        if (matchesKey(data, Key.ctrl("o"))) {
            if (uiAPI.toggleToolOutputsExpanded) {
                uiAPI.toggleToolOutputsExpanded();
                tui.requestRender();
                return;
            }
        }

        // Shift+Enter or Alt+Enter for new line
        if (
            matchesKey(data, Key.shift("enter")) || matchesKey(data, Key.alt("enter"))
        ) {
            // @ts-ignore: private pi-tui internals used intentionally
            editor.addNewLine();
            tui.requestRender();
            return;
        }
        // Delete pasted images when editor is empty
        if (
            matchesKey(data, Key.backspace) &&
            // @ts-ignore: private pi-tui internals used intentionally
            editor.isEditorEmpty() && pastedImages.length > 0
        ) {
            pastedImages.pop();
            const lastChild = previewImages.children[previewImages.children.length - 1];
            if (lastChild) previewImages.removeChild(lastChild);
            tui.requestRender();
            return;
        }
        originalHandleInput(data);
    };

    // User-facing prompt listing and collision warnings
    if (invokablePromptTemplates.length > 0) {
        const names = invokablePromptTemplates.map((template) => `/${template.name}`).join(", ");
        uiAPI.appendSystemMessage(`Loaded prompt templates (${invokablePromptTemplates.length}): ${names}`);
        uiAPI.appendSystemMessage(
            `Prompt slash commands execute via ${CHAT_PROMPT_AGENT_NAME}.`,
        );
    } else {
        uiAPI.appendSystemMessage("Loaded prompt templates: none");
    }

    for (const blocked of blockedPromptTemplates) {
        if (blocked.source !== "local" && blocked.source !== "home") continue;
        const userPath = toUserFacingPromptPath(blocked);
        uiAPI.appendSystemMessage(
            `Warning: ${userPath} command can't be invoked because it would override Harns built-in commands. Please rename it.`,
            true,
        );
    }

    // Hydrate TUI from persisted root-session history (e.g. --continue)
    // Keep this after startup system notices so those appear first.
    restorePersistedMessagesToUi(rootSessionManager, uiAPI);

    // Trigger initial user request
    if (initialUserRequest) {
        editor.setText(initialUserRequest);
        editor.onSubmit(initialUserRequest);
    }

    return uiAPI;
}
