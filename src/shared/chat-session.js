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
import { editorTheme, imageTheme, theme } from "./theme.js";
import { readClipboardImage } from "./clipboard.js";
import { createUiApi } from "./ui/api.js";
import { SpinnerBlock } from "./ui/blocks.js";
import { abortActiveSession, listPromptTemplates, runAgentSession } from "./session.js";
import { ensureMnemosyneBinary } from "./runtime-preflight.js";
import { commandRegistry } from "../cmd/registry.js";
import { getDefaultModelAndProvider } from "./model-registry.js";

const UI_PADDING = { x: 0, y: 0 };

const CHAT_PROMPT_AGENT_NAME = "operator";

/** @type {Set<string>} */
export let CHAT_BUILTIN_SLASH_NAMES = new Set();

/**
 * @param {{ name: string, source: "local" | "home" | "bundled" }} template
 */
function toUserFacingPromptPath(template) {
    if (template.source === "local") return `./.hns/prompts/${template.name}.md`;
    if (template.source === "home") return `~/.hns/prompts/${template.name}.md`;
    return `src/prompt-templates/${template.name}.md`;
}

let activeAgentName = "Router";
/** @type {((userRequest: string, images: any[], uiAPI: import('./workflow.js').UiAPI, sessionManager: import('@mariozechner/pi-coding-agent').SessionManager) => Promise<void>) | null} */
let activeOnMessage = null;
/** @type {import('@mariozechner/pi-coding-agent').SessionManager | null} */
let rootSessionManager = null;
/** @type {import('./workflow.js').UiAPI | null} */
let activeUiAPI = null;

/**
 * Update the active agent and its message handler dynamically.
 * @param {string} agentName
 * @param {string} [agentModel]
 * @param {(userRequest: string, images: any[], uiAPI: import('./workflow.js').UiAPI, sessionManager: import('@mariozechner/pi-coding-agent').SessionManager) => Promise<void>} handler
 * @param {import('./workflow.js').UiAPI} [uiAPI]
 */
export function setActiveAgent(agentName, handler, uiAPI, agentModel) {
    if (activeAgentName !== agentName) {
        if (uiAPI) {
            const modelText = agentModel ? ` (model: ${agentModel})` : "";
            uiAPI.appendSystemMessage(`Switched to ${agentName}${modelText}.`);
        }
    }
    activeAgentName = agentName;
    activeOnMessage = handler;
    if (uiAPI) activeUiAPI = uiAPI;
}

let currentAgentModel = "";
let currentAgentProvider = "";
/**
 * @param {string} model
 * @param {string} [provider]
 */
export function setActiveModel(model, provider) {
    currentAgentModel = model;
    if (provider) currentAgentProvider = provider;
}

/**
 * Get the active UI API reference.
 * @returns {import('./workflow.js').UiAPI | null}
 */
export function getActiveUiAPI() {
    return activeUiAPI;
}

/**
 * Starts the interactive TUI loop.
 * @param {string | null} initialUserRequest
 * @param {((userRequest: string, images: any[], uiAPI: import('./workflow.js').UiAPI, sessionManager: import('@mariozechner/pi-coding-agent').SessionManager) => Promise<void>) | null} onMessage - Handler for user submissions
 */
export async function startInteractiveSession(initialUserRequest, onMessage) {
    const { SessionManager } = await import("@mariozechner/pi-coding-agent");

    CHAT_BUILTIN_SLASH_NAMES = new Set(
        Object.values(commandRegistry)
            .filter((cmd) => cmd.isSlash)
            .map((cmd) => cmd.name),
    );

    rootSessionManager = SessionManager.inMemory();
    activeOnMessage = onMessage;
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

    /** @type {Array<{base64: string, mimeType: string}>} */
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

        if (currentAgentModel) {
            model = currentAgentModel;
        }
        if (currentAgentProvider) {
            provider = currentAgentProvider;
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
            const rendered = container.render(Math.max(10, w - rightMargin));
            return rendered;
        },
    };

    tui.addChild(rootWrapper);
    tui.setFocus(editor);

    // Load prompt-template metadata once per interactive session.
    const promptTemplates = await listPromptTemplates();
    const invokablePromptTemplates = promptTemplates.filter((t) => !CHAT_BUILTIN_SLASH_NAMES.has(t.name));
    const blockedPromptTemplates = promptTemplates.filter((t) => CHAT_BUILTIN_SLASH_NAMES.has(t.name));
    /** @type {Map<string, (typeof invokablePromptTemplates)[number]>} */
    const promptTemplateByName = new Map(invokablePromptTemplates.map((t) => [t.name, t]));

    const autocompleteProvider = new CombinedAutocompleteProvider(
        [
            {
                name: "quit",
                description: "Exit the application",
            },
            ...Array.from(CHAT_BUILTIN_SLASH_NAMES).map((name) => {
                /** @type {import('@mariozechner/pi-tui').SlashCommand} */
                const cmd = {
                    name,
                    description: commandRegistry[name].description,
                    getArgumentCompletions: commandRegistry[name].getArgumentCompletions,
                };
                return cmd;
            }),
            ...invokablePromptTemplates.map((t) => ({
                name: t.name,
                argumentHint: t.argumentHint,
                description: t.description,
            })),
        ],
        Deno.cwd(),
        "fd", // Since pi 0.20 the agent guarantees that fd is available in PATH or it polyfills it so using 'fd' directly as binary path is safe.
    );
    editor.setAutocompleteProvider(autocompleteProvider);

    // Expose a UI API for agents to append to the message list
    const uiAPI = createUiApi(tui, messageList, runningTasksComponent);

    // Chat session specific UI overrides/extensions
    uiAPI.setAgentInfo = (agentName, agentModel) => {
        activeAgentName = agentName;
        currentAgentModel = agentModel;
        tui.requestRender();
    };

    uiAPI.disableInput = () => {
        if (editor) {
            editor.disableSubmit = true;
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

    // Handle Editor events
    editor.onSubmit = async (text) => {
        const userRequest = text.trim();
        if (!userRequest) return;

        /** @type {any} */ (editor).addToHistory(userRequest);

        // Bash command interception
        if (userRequest.startsWith("!")) {
            const isExcluded = userRequest.startsWith("!!");
            const command = isExcluded ? userRequest.slice(2).trim() : userRequest.slice(1).trim();

            if (command) {
                editor.setText("");
                editor.disableSubmit = true;

                pastedImages.length = 0;
                previewImages.clear();

                // @ts-ignore: TS doesn't know about UI API typing inside session management
                if (uiAPI.appendUserMessage && !isExcluded) {
                    try {
                        const msg = {
                            role: "user",
                            content: [{ type: "text", text: userRequest }],
                        };
                        /** @type {any} */ (rootSessionManager)?.addMessage(msg);
                        uiAPI.appendUserMessage(userRequest);
                    } catch (_e) {
                        // ignore
                    }
                }

                try {
                    const activeToolId = `bash-${Date.now()}`;
                    if (!isExcluded) {
                        uiAPI.addToolInvoked?.({
                            id: activeToolId,
                            name: "bash",
                            input: { command },
                        });
                    }

                    const toolBlock = isExcluded
                        ? undefined
                        : uiAPI.startToolExecution?.(activeToolId, `bash`, command);

                    const { exec } = await import("child_process");

                    let outputBuffer = "";

                    if (isExcluded) {
                        try {
                            const { stopTUI, initTUI } = await import("./tui.js");
                            stopTUI();
                            const { spawnSync } = await import("child_process");
                            spawnSync(command, { stdio: "inherit", shell: true });
                            // Re-init terminal to clear visual artifacts
                            initTUI();
                            editor.setText("");
                            tui.requestRender();
                        } catch (_e) {
                            // Ignore error
                        } finally {
                            editor.disableSubmit = false;
                            if (uiAPI.setBusy) uiAPI.setBusy(false);
                            if (uiAPI.enableInput) uiAPI.enableInput();
                            tui.setFocus(editor);
                            tui.requestRender();
                        }
                        return;
                    }

                    const startTime = Date.now();
                    const code = await new Promise((resolve) => {
                        const proc = exec(command, { cwd: Deno.cwd() });

                        proc.stdout?.on("data", (data) => {
                            if (!isExcluded) {
                                toolBlock?.appendOutput(data.toString());
                                outputBuffer += data.toString();
                            }
                        });

                        proc.stderr?.on("data", (data) => {
                            if (!isExcluded) {
                                toolBlock?.appendOutput(data.toString());
                                outputBuffer += data.toString();
                            }
                        });

                        proc.on("close", (code) => {
                            resolve(code);
                        });

                        proc.on("error", (err) => {
                            if (!isExcluded) {
                                toolBlock?.appendOutput(`Error starting process: ${err.message}`);
                                outputBuffer += `Error starting process: ${err.message}\n`;
                            } else {
                                console.error(`Error starting process: ${err.message}`);
                            }
                            resolve(1);
                        });
                    });

                    const durationMs = Date.now() - startTime;
                    if (!isExcluded) {
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
                            /** @type {any} */ (rootSessionManager)?.addMessage(cmdMsg);

                            const resultMsg = {
                                role: "user",
                                content: [{
                                    type: "tool_result",
                                    tool_use_id: activeToolId,
                                    is_error: code !== 0,
                                    content: outputBuffer,
                                }],
                            };
                            /** @type {any} */ (rootSessionManager)?.addMessage(resultMsg);
                        } catch (_e) {
                            // ignore session add failure
                        }
                    }
                } catch (err) {
                    uiAPI.appendSystemMessage(
                        `Error executing bash command: ${err instanceof Error ? err.message : String(err)}`,
                    );
                } finally {
                    editor.disableSubmit = false;
                    if (uiAPI.setBusy) uiAPI.setBusy(false);
                    if (uiAPI.enableInput) uiAPI.enableInput();
                    tui.setFocus(editor);
                }
                return;
            }
        }

        if (userRequest.startsWith("/")) {
            const [rawCmd, ...args] = userRequest.slice(1).split(" ");
            const cmd = rawCmd.trim();

            // Built-in command intercepted logic to just reset editor state,
            // dispatch actually handled via standard registry for TUI route now.
            // (The `agent` command is handled in the generic registry routing block below.)

            const { commandRegistry } = await import("../cmd/registry.js");

            if (CHAT_BUILTIN_SLASH_NAMES.has(cmd) && commandRegistry[cmd]) {
                editor.disableSubmit = true;
                try {
                    await commandRegistry[cmd].execute(args, {
                        uiAPI,
                        editor,
                        tui,
                        originalHandleInput,
                        text, // pass raw text so handlers can check spacing
                    });
                } catch (err) {
                    uiAPI.appendSystemMessage(
                        `Error: ${err instanceof Error ? err.message : String(err)}`,
                    );
                } finally {
                    editor.disableSubmit = false;
                    if (uiAPI.setBusy) uiAPI.setBusy(false);
                    if (uiAPI.enableInput) uiAPI.enableInput();
                    tui.setFocus(editor);
                }
            } else {
                const template = promptTemplateByName.get(cmd);

                if (template) {
                    // Dispatch prompt templates to operator (not selected chat agent)
                    editor.disableSubmit = true;
                    editor.setText("");

                    const images = [...pastedImages];
                    pastedImages.length = 0;
                    previewImages.clear();

                    uiAPI.appendUserMessage(userRequest);
                    images.forEach((img) => {
                        if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
                    });

                    try {
                        await runAgentSession({
                            agentName: CHAT_PROMPT_AGENT_NAME,
                            userRequest,
                            images,
                            uiAPI,
                            sessionManager: rootSessionManager || undefined,
                        });
                    } catch (err) {
                        uiAPI.appendSystemMessage(
                            `Error: ${err instanceof Error ? err.message : String(err)}`,
                        );
                    } finally {
                        editor.disableSubmit = false;
                    }
                    return;
                }

                uiAPI.appendSystemMessage(`Unknown command: /${cmd}`);
                editor.setText("");
                editor.disableSubmit = false;
            }
            return;
        }

        editor.disableSubmit = true;
        editor.setText("");

        const images = [...pastedImages];
        pastedImages.length = 0;
        previewImages.clear();

        uiAPI.appendUserMessage(userRequest);
        images.forEach((img) => {
            if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
        });

        try {
            if (activeOnMessage && rootSessionManager) {
                activeUiAPI = uiAPI;
                await activeOnMessage(userRequest, images, uiAPI, rootSessionManager);
            } else {
                uiAPI.appendSystemMessage("Error: No active agent handler or session manager.");
            }
        } catch (err) {
            uiAPI.appendSystemMessage(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        } finally {
            editor.disableSubmit = false;
            if (uiAPI.setBusy) uiAPI.setBusy(false);
            if (uiAPI.enableInput) uiAPI.enableInput();
        }
    };

    // Re-render UI after handling pasted images
    tui.requestRender();

    let lastCtrlC = 0;

    // Custom keybindings for Editor
    const originalHandleInput = editor.handleInput.bind(editor);
    /** @param {any} data */
    editor.handleInput = async (data) => {
        // Intercept Esc to abort agent
        if (matchesKey(data, Key.escape)) {
            if (abortActiveSession()) {
                uiAPI.appendSystemMessage("[Harns] Canceling operation...");
                tui.requestRender();
            }
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
            /** @type {any} */ (editor).addNewLine();
            tui.requestRender();
            return;
        }
        // Delete pasted images when editor is empty
        if (
            matchesKey(data, Key.backspace) && /** @type {any} */
            (editor).isEditorEmpty() && pastedImages.length > 0
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
        const names = invokablePromptTemplates.map((t) => `/${t.name}`).join(", ");
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

    // Trigger initial user request
    if (initialUserRequest) {
        editor.setText(initialUserRequest);
        editor.onSubmit(initialUserRequest);
    }

    return uiAPI;
}
