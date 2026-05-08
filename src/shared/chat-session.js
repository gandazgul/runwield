/**
 * @module shared/chat-session
 * High-level interactive loop for the TUI. This manages the long-running
 * user interaction — distinct from individual agent invocations (see session.js).
 */

import { CombinedAutocompleteProvider, Container, Editor, Key, matchesKey, Spacer, Text } from "@mariozechner/pi-tui";
import { initTUI, stopTUI } from "./ui/tui.js";
import { getEditorTheme, initHarnsTheme, theme } from "./ui/theme.js";
import { readClipboardImage } from "./clipboard.js";
import { createUiApi } from "./ui/api.js";
import { SpinnerBlock } from "./ui/blocks.js";
import { abortActiveSession, listPromptTemplates, steerRootSession } from "./session/session.js";
import { cancelActivePlanReview } from "./workflow/submit-plan.js";
import { ensureMnemosyneBinary } from "./runtime-preflight.js";
import { commandRegistry } from "../cmd/registry.js";
import { getModelRegistry } from "./models/model-registry.js";
import { getSettingsManager, initSettings } from "./settings.js";
import {
    clearUserModelOverride,
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
import { createRootSessionManager } from "./session/root-session.js";
import { createGenerationGuard } from "./interactive/generation-guard.js";
import { restorePersistedMessagesToUi } from "./interactive/message-hydration.js";
import { installUiApiOverrides } from "./interactive/ui-api-overrides.js";
import { renderBootBanner } from "./interactive/boot-banner.js";
import { handleBashCommand } from "./interactive/bash-interceptor.js";
import { handleSlashCommand } from "./interactive/slash-dispatch.js";

const UI_PADDING = { x: 0, y: 0 };

const CHAT_PROMPT_AGENT_NAME = "operator";

/** @type {Set<string>} */
export let CHAT_BUILTIN_SLASH_NAMES = new Set();

/**
 * Update the active agent and its message handler dynamically.
 * @param {string} agentName
 * @param {import('./session/types.js').AgentMessageHandler} handler
 * @param {import('./ui/types.js').UiAPI} [uiAPI]
 * @param {string} [agentModel]
 */
export function setActiveAgent(agentName, handler, uiAPI, agentModel) {
    if (getActiveAgentName() !== agentName) {
        clearUserModelOverride();
        if (uiAPI) {
            const modelText = agentModel ? ` (model: ${agentModel})` : "";
            uiAPI.appendSystemMessage(`Switched to ${agentName}${modelText}.`);
        }
    }
    setActiveAgentName(agentName);
    if (agentModel) {
        const slashIndex = agentModel.indexOf("/");
        if (slashIndex > 0) {
            setActiveModelState(agentModel, agentModel.slice(0, slashIndex), false);
        } else {
            setActiveModelState(agentModel, "", false);
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
export async function setActiveModel(model, provider) {
    setActiveModelState(model, provider || "", true);

    try {
        const settingsManager = getSettingsManager();
        await settingsManager.setDefaultModel(model);
        await settingsManager.setDefaultProvider(provider || "");
    } catch (e) {
        console.error(`Failed to persist model selection: ${e}`);
    }

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
    initSettings();
    const sessionStartedAt = rootSessionManager.getHeader()?.timestamp || new Date().toISOString();
    setActiveOnMessage(onMessage);
    await ensureMnemosyneBinary();
    initHarnsTheme();
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

    const editor = new Editor(tui, getEditorTheme());
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
        const settingsManager = getSettingsManager();
        const defaults = {
            model: settingsManager.getDefaultModel() ?? "gemini-2.0-flash",
            provider: settingsManager.getDefaultProvider() ?? "google",
        };
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
    const basePromptSelect = uiAPI.promptSelect?.bind(uiAPI);
    if (basePromptSelect) {
        uiAPI.promptSelect = async (title, options) => {
            const result = await basePromptSelect(title, options);
            tui.setFocus(editor);
            tui.requestRender();
            return result;
        };
    }

    const basePromptText = uiAPI.promptText?.bind(uiAPI);
    if (basePromptText) {
        uiAPI.promptText = async (title, opts) => {
            const result = await basePromptText(title, opts);
            tui.setFocus(editor);
            tui.requestRender();
            return result;
        };
    }

    // ─── Unified Active-Operation Cancellation State ──────────────────

    /** @type {(() => void) | null} */
    let activeOperationCancel = null;

    /** @type {{ pid?: number, kill?: () => void } | null} */
    let activeBashProc = null;

    const generationGuard = createGenerationGuard();
    const generationStillCurrent = generationGuard.isCurrent;

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

    installUiApiOverrides({ uiAPI, tui, editor, container, messageList, setActiveModel });

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

    /** Force-unset the focused component and resolve any hanging prompt promise.
     *  Calling abortActivePrompt settles the promise with null, so the async chain
     *  can gracefully unspool instead of waiting forever. */
    function dismissActivePrompt() {
        if (uiAPI.abortActivePrompt) {
            uiAPI.abortActivePrompt();
        }
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

        // Bash command interception (`!cmd` and `!!cmd`)
        const handledBash = await handleBashCommand({
            userRequest,
            uiAPI,
            tui,
            editor,
            getSessionManager: getRootSessionManager,
            generationGuard,
            registerBashProc: (proc) => {
                activeBashProc = proc;
            },
        });
        if (handledBash) return;

        // Slash commands (`/builtin` or `/template`)
        const handledSlash = await handleSlashCommand({
            userRequest,
            savedImages,
            uiAPI,
            editor,
            tui,
            sessionStartedAt,
            originalHandleInput,
            builtinNames: CHAT_BUILTIN_SLASH_NAMES,
            promptTemplateByName,
            chatPromptAgentName: CHAT_PROMPT_AGENT_NAME,
            resolveTemplateModel,
            setActiveAgent,
            generationGuard,
            registerOperationCancel: (cancel) => {
                activeOperationCancel = cancel;
            },
        });
        if (handledSlash) return;

        // Generation gating
        const thisGen = generationGuard.bump();

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

        const images = [...pastedImages];
        pastedImages.length = 0;
        previewImages.clear();
        editor.setText("");

        if (isProcessingSubmission) {
            steerRootSession(userRequest, images).then((steered) => {
                if (steered) {
                    uiAPI.appendSystemMessage(userRequest, false, "Steering:");
                } else {
                    submissionQueue.push({ text: userRequest, images });
                    uiAPI.appendSystemMessage(userRequest, false, "Queued message:");
                }
                tui.requestRender();
            });
            return;
        }

        submissionQueue.push({ text: userRequest, images });
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
            generationGuard.invalidateAll();
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
                uiAPI.appendSystemMessage("Operation canceled.", false, "Harns");
            } else if (sessionAborted) {
                uiAPI.appendSystemMessage("Agent run canceled.", false, "Harns");
            } else if (planCanceled) {
                uiAPI.appendSystemMessage("Plan review canceled.", false, "Harns");
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
                    uiAPI.appendSystemMessage("Keyboard interrupt. Press again to quit.", false, "Harns");
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

    await renderBootBanner({
        uiAPI,
        invokablePromptTemplates,
        blockedPromptTemplates,
        chatPromptAgentName: CHAT_PROMPT_AGENT_NAME,
    });

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
