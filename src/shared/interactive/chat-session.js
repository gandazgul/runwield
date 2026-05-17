/**
 * @module shared/interactive/chat-session
 * High-level interactive loop for the TUI. This manages the long-running
 * user interaction — distinct from individual agent invocations (see session.js).
 */

import { CombinedAutocompleteProvider, Container, Editor, Spacer, Text } from "@earendil-works/pi-tui";
import { initTUI } from "../ui/tui.js";
import { applyPersistedTheme, getEditorTheme, initHarnsTheme, onThemeChange, theme } from "../ui/theme.js";
import { HNS_VERSION } from "../version.js";
import { endBlink, renderBootLogo } from "../ui/boot-logo.js";
import { createUiApi } from "../ui/api.js";
import { SpinnerBlock, SystemMessageBlock } from "../ui/blocks.js";
import { ensureRootAgentSession, listPromptTemplates, listSkills, steerRootSession } from "../session/session.js";
import { ensureMnemosyneBinary } from "../runtime-preflight.js";
import { commandRegistry } from "../../cmd/registry.js";
import { AGENTS, COMMAND_NAMES } from "../../constants.js";
import { getAgentDisplayName, listAvailableAgents } from "../session/agents.js";
import { getModelRegistry } from "../models/model-registry.js";
import { getSettingsManager, initSettings } from "../settings.js";
import {
    isInitDone as isInitDoneFn,
    isInitOffered as isInitOfferedFn,
    recordInitOffered as recordInitOfferedFn,
} from "../../cmd/init/init-state.js";
import {
    clearUserModelOverride,
    consumePendingSwitchHandoff,
    getActiveAgentName,
    getActiveModelState,
    getActiveOnMessage,
    getActiveUiAPIState,
    getPendingRootSwap,
    getRootAgentName,
    getRootAgentSession,
    getRootSessionManager,
    getThinkingLevel,
    setActiveModelState,
    setActiveOnMessage,
    setActiveUiAPI,
    setPendingRootSwap,
    setRootSessionManager,
    setThinkingLevel,
} from "../session/session-state.js";
import { parseProviderModel } from "../models/model-validation.js";
import { createRootSessionManager } from "../session/root-session.js";
import { createGenerationGuard } from "./generation-guard.js";
import { restorePersistedMessagesToUi } from "./message-hydration.js";
import { installUiApiOverrides } from "./ui-api-overrides.js";
import { renderBootBanner } from "./boot-banner.js";
import { handleBashCommand } from "./bash-interceptor.js";
import { handleSlashCommand } from "./slash-dispatch.js";
import { installKeybindings } from "./keybindings.js";

const CHAT_PROMPT_AGENT_NAME = AGENTS.OPERATOR;

/** @type {Set<string>} */
export let CHAT_BUILTIN_SLASH_NAMES = new Set();

/**
 * Update the active agent and its message handler.
 *
 * Footer state (agent display name + model) is NOT changed here — it is
 * updated only when the root session is actually rebuilt for the new agent,
 * via `buildAgentSession` → `uiAPI.setAgentInfo`. This guarantees the footer
 * reflects the agent that's truly handling turns and never claims a switch
 * that has not yet taken effect.
 *
 * Callers must pass the internal agent name from the `AGENTS` constant; the
 * display name is read from the agent definition's frontmatter when needed.
 *
 * @param {string} agentName  Internal agent name (filename of the agent
 *   definition without `.md`, e.g. `AGENTS.ROUTER` → `"router"`).
 * @param {import('../session/types.js').AgentMessageHandler} handler
 * @param {import('../ui/types.js').UiAPI} [uiAPI]
 * @param {string} [agentModel]
 */
export function setActiveAgent(agentName, handler, uiAPI, agentModel) {
    setActiveOnMessage(handler);

    if (uiAPI) {
        setActiveUiAPI(uiAPI);
    }

    // If the active root is already this agent, no swap is needed and the
    // footer already matches reality.
    if (agentName === getRootAgentName()) {
        uiAPI?.requestRender();
        return;
    }

    // Queue a root rebuild. The actual swap (and the corresponding footer
    // update + "Switched to X" message) is applied at the next turn boundary
    // by applyPendingRootSwap() — it is unsafe to dispose the root mid-prompt,
    // and updating the footer earlier would let the UI claim a switch that
    // has not yet taken effect.
    setPendingRootSwap({
        agentName,
        displayName: getAgentDisplayName(agentName),
        model: agentModel,
    });

    uiAPI?.requestRender();
}

/**
 * If a pending root swap is queued, dispose the current root and build a new
 * one for the target agent. Safe to call when the root is idle (between user
 * turns).
 *
 * The footer (active agent name + model) is updated as a side-effect of
 * `buildAgentSession` calling `uiAPI.setAgentInfo`, so it changes exactly when
 * the new root is in place — never before. The user-facing "Switched to X"
 * notice is emitted here only after the rebuild succeeds, for the same reason.
 *
 * @param {import('../ui/types.js').UiAPI} uiAPI
 * @returns {Promise<void>}
 */
export async function applyPendingRootSwap(uiAPI) {
    const pending = getPendingRootSwap();
    if (!pending) return;
    if (pending.agentName === getRootAgentName()) {
        setPendingRootSwap(null);
        return;
    }
    setPendingRootSwap(null);
    try {
        clearUserModelOverride();
        await ensureRootAgentSession({
            agentName: pending.agentName,
            modelOverride: pending.model,
            uiAPI,
            sessionManager: getRootSessionManager() || undefined,
        });
        const modelText = pending.model ? ` (model: ${pending.model})` : "";
        uiAPI.appendSystemMessage(`Switched to ${pending.displayName}${modelText}.`);
        uiAPI.requestRender();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        uiAPI.appendSystemMessage(`Failed to switch root agent to "${pending.agentName}": ${msg}`);
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
 * @param {"off" | "minimal" | "low" | "medium" | "high" | "xhigh"} level
 */
export async function persistThinkingLevel(level) {
    try {
        const settingsManager = getSettingsManager();
        await settingsManager.setDefaultThinkingLevel(level);
    } catch (e) {
        console.error(`Failed to persist thinking level: ${e}`);
    }
}

/**
 * Get the active UI API reference.
 * @returns {import('../workflow/workflow.js').UiAPI | null}
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
 * @param {import('../session/types.js').AgentMessageHandler | null} onMessage - Handler for user submissions
 * @param {{ sessionStartMode?: "new" | "continue", initialAgentName?: string, initialAgentModel?: string }} [options]
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

    // Pre-warm the display-name cache so any sync getAgentDisplayName call
    // before the root session is built can resolve from cache instead of
    // re-reading the frontmatter file. (The footer itself is not set here —
    // ensureRootAgentSession below will populate it via setAgentInfo once the
    // session actually exists, so the UI never shows an agent name that has
    // no live session behind it.)
    await listAvailableAgents();

    // Track which agent the initial root will be built for. Callers (e.g. `hns agent <name>`)
    // can override via options.initialAgentName.
    const initialAgentInternalName = options.initialAgentName || AGENTS.ROUTER;
    await ensureMnemosyneBinary();
    initHarnsTheme();
    await applyPersistedTheme();
    const tui = initTUI();

    const container = new Container();

    // Header
    const titleLine = `${theme.fg("accent", theme.bold("Harns ─ Plan-by-Default Harness"))} ${
        theme.fg("dim", `v${HNS_VERSION}`)
    }`;

    const compactHelp = theme.fg(
        "muted",
        ["esc interrupt", "ctrl+c clear/exit", "/ commands", "! bash", "ctrl+o more"].join(" · "),
    );
    const expandedHelp = theme.fg(
        "muted",
        [
            "esc          to interrupt",
            "ctrl+c       to clear input",
            "ctrl+c twice to exit",
            "shift+tab    to cycle thinking level",
            "ctrl+o       to expand tool outputs / collapse this help",
            "ctrl+t       to toggle thinking block visibility",
            "ctrl+g       for external editor (not-implemented)",
            "ctrl+v       to paste image",
            "shift+enter  to insert newline",
            "/            for commands",
            "!            to run bash",
            "!!           to run bash (no context)",
        ].join("\n"),
    );

    let helpExpanded = false;
    const helpText = new Text(compactHelp, 0, 0);
    /** @param {boolean} expanded */
    function setHelpExpanded(expanded) {
        helpExpanded = expanded;
        helpText.setText(expanded ? expandedHelp : compactHelp);
    }

    // Render the logo first
    renderBootLogo(container);
    // Title line
    container.addChild(new Text(titleLine, 0, 0));
    // Help text
    container.addChild(helpText);

    // Blank lines before first message
    container.addChild(new Spacer(1));
    container.addChild(new Spacer(1));
    container.addChild(new Spacer(1));

    const messageList = new Container();
    container.addChild(messageList);
    container.addChild(new Spacer(1));

    const runningTasksComponent = new SpinnerBlock();
    container.addChild(runningTasksComponent);

    /** @type {import('../session/types.js').ImageAttachment[]} */
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

        const thinkingLevel = getThinkingLevel();

        return { model, provider, thinkingLevel };
    };

    let ctrlCPendingExit = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let ctrlCPendingTimer = null;

    function markCtrlCPendingExit() {
        ctrlCPendingExit = true;
        if (ctrlCPendingTimer) clearTimeout(ctrlCPendingTimer);
        ctrlCPendingTimer = setTimeout(() => {
            ctrlCPendingExit = false;
            ctrlCPendingTimer = null;
            tui.requestRender();
        }, 1000);
        tui.requestRender();
    }

    /** @type {Map<string, string>} */
    const thinkingLevelTheme = new Map([
        ["off", "thinkingOff"],
        ["minimal", "thinkingMinimal"],
        ["low", "thinkingLow"],
        ["medium", "thinkingMedium"],
        ["high", "thinkingHigh"],
        ["xhigh", "thinkingXhigh"],
    ]);

    /**
     * @param {string} level
     * @returns {import('@earendil-works/pi-coding-agent').ThemeColor}
     */
    function getThinkingThemeToken(level) {
        return /** @type {import('@earendil-works/pi-coding-agent').ThemeColor} */ (thinkingLevelTheme.get(level) ||
            "thinkingOff");
    }

    const footer = {
        invalidate: () => {},
        /** @param {number} w */
        render: (w) => {
            const { model, provider, thinkingLevel } = getModelAndProvider();
            const modelStr = model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
            const activeAgentName = getActiveAgentName();

            const line1Left = `${cwd} (${branch})`;
            const line1Pad = Math.max(1, w - line1Left.length - activeAgentName.length);
            const line1 = theme.fg("dim", line1Left) +
                " ".repeat(line1Pad) +
                theme.fg("accent", activeAgentName);

            const thinkingStr = `(${thinkingLevel})`;
            const thinkingStyled = theme.fg(getThinkingThemeToken(thinkingLevel), thinkingStr);
            const line2LeftRaw = ctrlCPendingExit ? "Ctrl+C - Press again to exit" : "";
            const line2LeftStyled = ctrlCPendingExit ? theme.fg("warning", line2LeftRaw) : "";
            const thinkingPad = thinkingLevel !== "off" ? thinkingStr.length + 1 : 0;
            const line2Pad = Math.max(1, w - line2LeftRaw.length - modelStr.length - thinkingPad);
            const line2 = line2LeftStyled +
                " ".repeat(line2Pad) +
                theme.fg("dim", modelStr) +
                (thinkingPad > 0 ? " " + thinkingStyled : "");

            return [line1, line2];
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

    // ── Init state check: conditionally filter /init from slash commands ──
    const initDone = await isInitDoneFn();
    if (initDone) {
        CHAT_BUILTIN_SLASH_NAMES.delete("init");
    }

    // Load prompt-template metadata once per interactive session.
    const promptTemplates = await listPromptTemplates();

    // Load skills metadata once per interactive session.
    const skills = await listSkills();

    // Expose a UI API for agents to append to the message list
    const uiAPI = createUiApi(tui, messageList, runningTasksComponent);

    // Install chat-session-specific UiAPI methods (setAgentInfo, enableInput,
    // showModelSelector, …) BEFORE building the first root session — buildAgentSession
    // calls uiAPI.setAgentInfo() to seed the footer with the agent's display name
    // and model, and that setter only exists once the overrides are installed.
    installUiApiOverrides({ uiAPI, tui, editor, container, messageList, setActiveModel });

    // ── Eagerly build the root AgentSession for the initial agent ──
    // The root persists across turns of the same agent so /compact and other long-lived
    // session operations have something to act on. setActiveAgent rebuilds the root on
    // an agent switch (applied at turn boundaries via applyPendingRootSwap).
    try {
        await ensureRootAgentSession({
            agentName: initialAgentInternalName,
            modelOverride: options.initialAgentModel,
            uiAPI,
            sessionManager: rootSessionManager,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        uiAPI.appendSystemMessage(`Failed to initialize root agent "${initialAgentInternalName}": ${msg}`);
    }

    // ── Init auto-offer: conditionally offer /init on first TUI visit ──
    if (!initDone) {
        const alreadyOffered = await isInitOfferedFn();
        if (!alreadyOffered) {
            const choice = await uiAPI.promptSelect(
                "Would you like to run /init to bootstrap Harns?",
                [
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                ],
            );

            if (choice === "yes") {
                // User accepted — run init and record success
                await commandRegistry[COMMAND_NAMES.INIT].execute([], {
                    uiAPI,
                    sessionManager: rootSessionManager || undefined,
                });
                // Dynamically hide /init from slash commands for the rest of this session
                CHAT_BUILTIN_SLASH_NAMES.delete("init");
            } else {
                // User declined or dismissed — record that init was offered
                await recordInitOfferedFn();
            }
            // Restore focus to editor after init prompt (before the wrapper is applied)
            tui.setFocus(editor);
            tui.requestRender();
        }
    }

    // ── Build autocomplete AFTER auto-offer (so /init removal is reflected) ──
    const invokablePromptTemplates = promptTemplates.filter((template) => !CHAT_BUILTIN_SLASH_NAMES.has(template.name));
    const blockedPromptTemplates = promptTemplates.filter((template) => CHAT_BUILTIN_SLASH_NAMES.has(template.name));
    /** @type {Map<string, (typeof invokablePromptTemplates)[number]>} */
    const promptTemplateByName = new Map(invokablePromptTemplates.map((template) => [template.name, template]));

    const autocompleteProvider = new CombinedAutocompleteProvider(
        [
            ...Array.from(CHAT_BUILTIN_SLASH_NAMES).map((name) => {
                /** @type {import('@earendil-works/pi-tui').SlashCommand} */
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
            // ── Skill commands ──
            ...skills
                .filter((skill) => skill.description && skill.description !== "No description provided")
                .map((skill) => ({
                    name: `skill:${skill.name}`,
                    description: skill.description,
                })),
        ],
        Deno.cwd(),
        "fd", // Since pi 0.20 the agent guarantees that fd is available in PATH or it polyfills it so using 'fd' directly as binary path is safe.
    );
    editor.setAutocompleteProvider(autocompleteProvider);

    // Ensure modal prompts (select/text) always return focus to the editor once settled.
    const basePromptSelect = uiAPI.promptSelect?.bind(uiAPI);
    if (basePromptSelect) {
        uiAPI.promptSelect = async (title, options, hooks) => {
            const result = await basePromptSelect(title, options, hooks);
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

    // Repaint everything when the theme swaps (live preview for /theme, plus any
    // future theme-change source). Invalidate drops cached layout in Text/Markdown
    // and re-bakes themed strings in PromptSelectBlock / PromptTextBlock.
    onThemeChange(() => {
        tui.invalidate();
        tui.requestRender();
    });

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
    /** @type {Array<{text: string, images: import('../session/types.js').ImageAttachment[], block?: SystemMessageBlock, spacer?: Spacer}>} */
    const submissionQueue = [];
    let isProcessingSubmission = false;

    /** Pop the most recent queued submission and restore it into the editor.
     *  Returns true if a queued message was dequeued. */
    function dequeueLastSubmission() {
        if (submissionQueue.length === 0) return false;
        const item = submissionQueue.pop();
        if (!item) return false;
        if (item.block) messageList.removeChild(item.block);
        if (item.spacer) messageList.removeChild(item.spacer);
        editor.setText(item.text);
        if (item.images && item.images.length > 0) {
            for (const img of item.images) {
                pastedImages.push(img);
                previewImages.addChild(
                    new Text(theme.fg("dim", `[Attached image: ${img.mimeType}]`)),
                );
            }
        }
        tui.requestRender();
        return true;
    }

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
     * @param {import('../session/types.js').ImageAttachment[]} savedImages
     */
    async function executeUserRequest(text, savedImages) {
        const userRequest = text.trim();
        if (!userRequest) return;

        editor.addToHistory?.(userRequest);

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
            skills,
            chatPromptAgentName: CHAT_PROMPT_AGENT_NAME,
            resolveTemplateModel,
            setActiveAgent,
            applyPendingRootSwap,
            generationGuard,
            registerOperationCancel: (cancel) => {
                activeOperationCancel = cancel;
            },
        });
        if (handledSlash) return;

        // Generation gating
        const thisGen = generationGuard.bump();

        let currentRequest = userRequest;
        let currentImages = savedImages;
        let isHandoff = false;
        // Safety cap on chained switch_agent handoffs in a single user submission.
        let handoffsLeft = 4;

        uiAPI.appendUserMessage?.(currentRequest);
        currentImages.forEach((/** @type {import('../session/types.js').ImageAttachment} */ img) => {
            if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
        });

        try {
            while (true) {
                // Apply any root swap queued before this turn (e.g. by a slash
                // `/agent engineer` between turns, or by a switch_agent tool call
                // in the previous iteration). Without this, the first turn after a
                // switch would hit a transient fallback that still uses the previous
                // agent's session history.
                await applyPendingRootSwap(uiAPI);
                const activeOnMessage = getActiveOnMessage();
                const rootSessionManager = getRootSessionManager();
                if (!activeOnMessage || !rootSessionManager) {
                    uiAPI.appendSystemMessage("Error: No active agent handler or session manager.");
                    break;
                }
                setActiveUiAPI(uiAPI);
                if (isHandoff) {
                    uiAPI.appendSystemMessage(currentRequest, false, "Handoff:");
                }
                await activeOnMessage(currentRequest, currentImages, uiAPI, rootSessionManager);

                // If the agent called switch_agent, its turn was terminated and the
                // tool recorded a handoff. Continue the loop: the next iteration
                // applies the queued root swap and feeds `reason` as the new agent's
                // first user message — making the chain visible and uninterrupted.
                const handoff = consumePendingSwitchHandoff();
                if (!handoff) break;
                if (handoffsLeft-- <= 0) {
                    uiAPI.appendSystemMessage(
                        "switch_agent handoff limit reached — refusing further chained switches in this turn.",
                    );
                    break;
                }
                currentRequest = handoff.reason;
                currentImages = [];
                isHandoff = true;
            }
        } catch (err) {
            if (generationStillCurrent(thisGen)) {
                uiAPI.appendSystemMessage(
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        } finally {
            // Drain any pending root swap recorded during the last turn (covers the
            // case where the agent queued a swap but didn't call switch_agent).
            await applyPendingRootSwap(uiAPI);
        }
    }

    editor.onSubmit = (text) => {
        // end the logo blink and make it static
        endBlink();

        const userRequest = text.trim();
        if (!userRequest) return;

        editor.addToHistory?.(userRequest);

        const images = [...pastedImages];
        pastedImages.length = 0;
        previewImages.clear();
        editor.setText("");

        // Bash interception (`!cmd` / `!!cmd`) runs ahead of the steering and
        // queueing paths so a stray `!` typed during a model turn is executed
        // locally instead of being sent as steering text.
        if (userRequest.startsWith("!")) {
            handleBashCommand({
                userRequest,
                uiAPI,
                tui,
                editor,
                getSessionManager: getRootSessionManager,
                generationGuard,
                registerBashProc: (proc) => {
                    activeBashProc = proc;
                },
                concurrent: isProcessingSubmission,
            }).catch(() => {/* swallow — UI already surfaces errors */});
            return;
        }

        if (isProcessingSubmission) {
            steerRootSession(userRequest, images).then((steered) => {
                if (steered) {
                    uiAPI.appendSystemMessage(userRequest, false, "Steering:");
                } else {
                    // Add the visual block manually (bypassing appendSystemMessage's coalescing)
                    // so we can remove this exact block if the user dequeues with up-arrow.
                    const block = new SystemMessageBlock(userRequest, false, "Queued message:");
                    const spacer = new Spacer(1);
                    messageList.addChild(block);
                    messageList.addChild(spacer);
                    submissionQueue.push({ text: userRequest, images, block, spacer });
                }
                tui.requestRender();
            });
            return;
        }

        submissionQueue.push({ text: userRequest, images });
        processSubmissions();
    };

    // Initialize thinking level from settings
    const settingsManager = getSettingsManager();
    const savedThinkingLevel = settingsManager.getDefaultThinkingLevel();
    if (savedThinkingLevel) {
        setThinkingLevel(savedThinkingLevel);
    }

    // Ordered thinking levels for cycling
    /** @type {("off" | "minimal" | "low" | "medium" | "high" | "xhigh")[]} */
    const THINKING_LEVELS = [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
    ];

    /** Cycle the thinking level and persist to settings */
    async function cycleThinkingLevel() {
        // If an active agent session exists, delegate to it for model-aware cycling
        const session = getRootAgentSession();
        if (session) {
            const newLevel = session.cycleThinkingLevel();
            if (newLevel === undefined) {
                uiAPI.appendSystemMessage("Current model does not support thinking");
                return;
            }
            setThinkingLevel(newLevel);
            await persistThinkingLevel(newLevel);
            tui.requestRender();
            return;
        }
        // No active session: cycle through levels directly and persist
        const current = getThinkingLevel();
        const currentIdx = THINKING_LEVELS.indexOf(current);
        const nextIdx = (currentIdx + 1) % THINKING_LEVELS.length;
        const nextLevel = THINKING_LEVELS[nextIdx];
        setThinkingLevel(nextLevel);
        await persistThinkingLevel(nextLevel);
        tui.requestRender();
    }

    // Re-render UI after handling pasted images
    tui.requestRender();

    const originalHandleInput = installKeybindings({
        editor,
        tui,
        uiAPI,
        pastedImages,
        previewImages,
        submissionQueue,
        generationGuard,
        cancelActiveOperation,
        dismissActivePrompt,
        dequeueLastSubmission,
        forceResetUI,
        markCtrlCPendingExit,
        isCtrlCPendingExit: () => ctrlCPendingExit,
        toggleStartupHelp: () => setHelpExpanded(!helpExpanded),
        cycleThinkingLevel,
    });

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
