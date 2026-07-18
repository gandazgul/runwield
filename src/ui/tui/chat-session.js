/**
 * @module ui/tui/chat-session
 * High-level interactive loop for the TUI. This manages the long-running
 * user interaction — distinct from individual agent invocations (see session.js).
 */

import {
    CombinedAutocompleteProvider,
    Container,
    Editor,
    Image,
    Spacer,
    Text,
    truncateToWidth,
    visibleWidth,
} from "@earendil-works/pi-tui";
import { initTUI } from "./tui.js";
import { setTerminalTitleForName } from "./terminal-title.js";
import {
    applyPersistedTheme,
    getEditorTheme,
    imageTheme,
    initRunWieldTheme,
    onThemeChange,
    theme,
} from "../theme/theme.js";
import { VERSION } from "../../shared/version.js";
import { endBlink, renderBootLogo } from "./boot-logo.js";
import { createUiApi } from "./api.js";
import { attachTuiRuntimeAdapter } from "./runtime-adapter.js";
import { SpinnerBlock } from "./blocks.js";
import { ensureMnemosyneBinary } from "../../shared/runtime-preflight.js";
import { commandRegistry, getCommandInvocationNames, getSlashCommandDefinitions } from "../../cmd/registry.js";
import { AGENTS } from "../../constants.js";
import {
    EMPTY_PROJECT_DIRECTORY_HEADER,
    EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE,
    EMPTY_PROJECT_DIRECTORY_WELCOME_BODY,
    isEmptyProjectDirectory,
} from "../../shared/project-state.js";
import { COMMAND_NAMES } from "../../cmd/registry.js";
import { getAgentDisplayName, listAvailableAgents } from "../../shared/session/agents.js";
import { getModelRegistry } from "../../shared/models/model-registry.js";
import { getSettingsManager, initSettings } from "../../shared/settings.js";
import {
    isInitDone as isInitDoneFn,
    isInitOffered as isInitOfferedFn,
    recordInitOffered as recordInitOfferedFn,
} from "../../cmd/init/init-state.js";
import { SessionRuntime, SessionTurnInProgressError } from "../../shared/session/session-runtime.js";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { resolveTemplateModel } from "../../shared/models/model-validation.js";
import { createGenerationGuard } from "./generation-guard.js";
import { installUiApiOverrides } from "./ui-api-overrides.js";
import { renderBootBanner } from "./boot-banner.js";
import { getSelectedDefaultModelAvailability, maybeShowModelWelcome } from "./model-welcome.js";
import { handleBashCommand } from "./bash-interceptor.js";
import { handleSlashCommand } from "./slash-dispatch.js";
import { installKeybindings } from "./keybindings.js";
const CHAT_PROMPT_AGENT_NAME = AGENTS.OPERATOR;

/** @type {(projectRoot?: string) => ReturnType<typeof getSettingsManager>} */
let getSettingsManagerForPersistence = getSettingsManager;

/**
 * Test-only hook for code paths that persist model/thinking selections.
 *
 * @param {((projectRoot?: string) => ReturnType<typeof getSettingsManager>) | null} provider
 */
export function __setSettingsManagerForPersistenceTests(provider) {
    getSettingsManagerForPersistence = provider || getSettingsManager;
}

/** @type {Set<string>} */
export let CHAT_BUILTIN_SLASH_NAMES = new Set();

/** @param {"new" | "continue" | undefined} sessionStartMode */
export function shouldReplaySessionHistory(sessionStartMode) {
    return sessionStartMode === "continue";
}

/**
 * Format token counts for footer display (same formatting as Pi.dev).
 * @param {number} count
 * @returns {string}
 */
function formatTokens(count) {
    if (count < 1000) return String(count);
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000) return `${Math.round(count / 1000)}k`;
    if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
    return `${Math.round(count / 1000000)}M`;
}

/**
 * @param {string} modelStr
 * @param {string} thinkingLevel
 * @returns {boolean}
 */
export function shouldShowFooterThinkingLevel(modelStr, thinkingLevel) {
    return Boolean(modelStr) && thinkingLevel !== "off";
}

const FOOTER_WORKFLOW_EXCLUDED_AGENT_NAMES = new Set([AGENTS.IDEATOR, AGENTS.OPERATOR, AGENTS.GUIDE]);
const FOOTER_WORKFLOW_EXCLUDED_DISPLAY_NAMES = new Set(["ideator", "operator", "guide"]);

const FOOTER_ROUTING_META = new Map([
    ["QUICK_FIX", { label: "Quick Fix", token: "routingQuickFix" }],
    ["FEATURE", { label: "Feature", token: "routingFeature" }],
    ["PROJECT", { label: "Epic", token: "routingEpic" }],
]);

const FOOTER_COMPLEXITY_META = new Map([
    ["LOW", { label: "Low", token: "complexityLow" }],
    ["MEDIUM", { label: "Medium", token: "complexityMedium" }],
    ["HIGH", { label: "High", token: "complexityHigh" }],
]);

/**
 * @typedef {Object} FooterWorkflowPart
 * @property {string} text
 * @property {string} token
 */

/**
 * @param {{ displayName?: string, agentName?: string } | null | undefined} agentInfo
 * @returns {boolean}
 */
export function shouldShowFooterWorkflowContext(agentInfo) {
    const agentName = typeof agentInfo?.agentName === "string" ? agentInfo.agentName.trim().toLowerCase() : "";
    if (agentName) return !FOOTER_WORKFLOW_EXCLUDED_AGENT_NAMES.has(agentName);
    const displayName = typeof agentInfo?.displayName === "string" ? agentInfo.displayName.trim().toLowerCase() : "";
    return !FOOTER_WORKFLOW_EXCLUDED_DISPLAY_NAMES.has(displayName);
}

/**
 * @param {FooterWorkflowPart[]} parts
 * @returns {string}
 */
export function getFooterWorkflowLabelText(parts) {
    return parts.map((part) => part.text).join("");
}

/**
 * @param {{ displayName?: string, agentName?: string } | null | undefined} agentInfo
 * @param {{ routingIntent?: string, complexity?: string, planName?: string } | null | undefined} workflowContext
 * @param {number} maxWidth
 * @returns {FooterWorkflowPart[]}
 */
export function buildFooterWorkflowLabelParts(agentInfo, workflowContext, maxWidth = Infinity) {
    const agentName = typeof agentInfo?.displayName === "string" && agentInfo.displayName.trim()
        ? agentInfo.displayName.trim()
        : "";
    const width = Number.isFinite(maxWidth) ? Math.max(0, Math.floor(maxWidth)) : Infinity;
    if (!agentName || width <= 0) return [];

    const routeMeta = FOOTER_ROUTING_META.get(String(workflowContext?.routingIntent || ""));
    const complexityMeta = FOOTER_COMPLEXITY_META.get(String(workflowContext?.complexity || ""));
    const planName = typeof workflowContext?.planName === "string" ? workflowContext.planName.trim() : "";
    const showContext = shouldShowFooterWorkflowContext(agentInfo);
    const showRouting = Boolean(showContext && routeMeta && complexityMeta);
    const showPlan = showContext && Boolean(planName);

    if (!showRouting && !showPlan) {
        return [{ text: truncateToWidth(agentName, width), token: "accent" }];
    }

    /**
     * @param {{ includeComplexity: boolean, includePlan: boolean, planText?: string }} options
     * @returns {FooterWorkflowPart[]}
     */
    function compose(options) {
        /** @type {FooterWorkflowPart[]} */
        const parts = [{ text: agentName, token: "accent" }];
        if (showRouting) {
            parts.push({ text: " - ", token: "dim" });
            if (options.includeComplexity) {
                parts.push({
                    text: /** @type {{ label: string }} */ (complexityMeta).label,
                    token: /** @type {{ token: string }} */ (complexityMeta).token,
                });
                parts.push({ text: " ", token: "dim" });
            }
            parts.push({
                text: /** @type {{ label: string }} */ (routeMeta).label,
                token: /** @type {{ token: string }} */ (routeMeta).token,
            });
        }
        if (options.includePlan) {
            parts.push({ text: " - ", token: "dim" });
            parts.push({ text: options.planText || planName, token: "dim" });
        }
        return parts;
    }

    let parts = compose({ includeComplexity: true, includePlan: showPlan });
    if (visibleWidth(getFooterWorkflowLabelText(parts)) <= width) return parts;

    if (showPlan) {
        const withoutPlan = compose({ includeComplexity: true, includePlan: false });
        const prefixWidth = visibleWidth(getFooterWorkflowLabelText(withoutPlan)) + visibleWidth(" - ");
        const planMax = width - prefixWidth;
        if (planMax > 0) {
            parts = compose({
                includeComplexity: true,
                includePlan: true,
                planText: truncateToWidth(planName, planMax),
            });
            if (visibleWidth(getFooterWorkflowLabelText(parts)) <= width) return parts;
        }
        parts = withoutPlan;
        if (visibleWidth(getFooterWorkflowLabelText(parts)) <= width) return parts;
    }

    if (showRouting) {
        parts = compose({ includeComplexity: false, includePlan: false });
        if (visibleWidth(getFooterWorkflowLabelText(parts)) <= width) return parts;
    }

    return [{ text: truncateToWidth(getFooterWorkflowLabelText(parts), width), token: "accent" }];
}

/**
 * @param {FooterWorkflowPart[]} parts
 * @param {{ fg?: (token: import('@earendil-works/pi-coding-agent').ThemeColor, text: string) => string }} [themeImpl]
 * @returns {string}
 */
export function renderFooterWorkflowLabelParts(parts, themeImpl = theme) {
    return parts.map((part) => {
        const token = /** @type {import('@earendil-works/pi-coding-agent').ThemeColor} */ (part.token);
        return themeImpl.fg ? themeImpl.fg(token, part.text) : part.text;
    }).join("");
}

/**
 * @param {{ displayName?: string, agentName?: string } | null | undefined} agentInfo
 * @param {{ routingIntent?: string, complexity?: string, planName?: string } | null | undefined} workflowContext
 * @param {string} leftRaw
 * @param {number} width
 * @returns {{ left: string, rightParts: FooterWorkflowPart[] }}
 */
export function buildFooterLine1Parts(agentInfo, workflowContext, leftRaw, width) {
    const priorityRightParts = buildFooterWorkflowLabelParts(
        agentInfo,
        workflowContext ? { ...workflowContext, planName: "" } : workflowContext,
        Infinity,
    );
    const priorityRightWidth = visibleWidth(getFooterWorkflowLabelText(priorityRightParts));
    const leftMax = Math.max(0, width - priorityRightWidth - 1);
    const left = truncateToWidth(leftRaw, leftMax);
    const rightMax = Math.max(0, width - visibleWidth(left) - 1);
    return {
        left,
        rightParts: buildFooterWorkflowLabelParts(agentInfo, workflowContext, rightMax),
    };
}

/**
 * @param {import('../../shared/session/types.js').ImageAttachment} image
 * @returns {Image}
 */
function createPastedImagePreview(image) {
    return new Image(image.base64, image.mimeType, imageTheme, {
        filename: image.ref || image.path || image.mimeType,
        maxWidthCells: 30,
        maxHeightCells: 10,
    });
}

/**
 * @param {SessionRuntime} runtime
 * @param {string} sessionId
 * @param {string} model
 * @param {string} [provider]
 */
export async function setActiveModel(runtime, sessionId, model, provider) {
    const snapshot = runtime.getSessionSnapshot(sessionId);
    if (!snapshot) throw new Error("Cannot set model for a missing runtime session.");
    await runtime.reconfigureSessionModel(sessionId, model, provider || "");

    try {
        const settingsManager = getSettingsManagerForPersistence(snapshot.cwd);
        await settingsManager.setDefaultModel(model);
        await settingsManager.setDefaultProvider(provider || "");
    } catch (e) {
        console.error(`Failed to persist model selection: ${e}`);
    }
}

/**
 * @param {"off" | "minimal" | "low" | "medium" | "high" | "xhigh"} level
 * @param {string} [projectRoot]
 */
export async function persistThinkingLevel(level, projectRoot) {
    try {
        const settingsManager = getSettingsManagerForPersistence(projectRoot);
        await settingsManager.setDefaultThinkingLevel(level);
    } catch (e) {
        console.error(`Failed to persist thinking level: ${e}`);
    }
}

/**
 * Get the active model identifier (may include provider prefix).
 * @param {SessionRuntime} runtime
 * @param {string} sessionId
 * @returns {string}
 */
export function getActiveModel(runtime, sessionId) {
    return runtime.getSessionSnapshot(sessionId)?.activeModel.model || "";
}

/**
 * Testable core of the interactive submit loop. It follows typed handoff
 * results produced by the runtime session's active handler only.
 *
 * @param {Object} args
 * @param {SessionRuntime} args.runtime
 * @param {string} args.sessionId
 * @param {import('./types.js').UiAPI} args.uiAPI
 * @param {string} args.initialRequest
 * @param {import('../../shared/session/types.js').ImageAttachment[]} args.initialImages
 */
export async function runScopedSubmitHandoffLoop(
    { runtime, sessionId, uiAPI, initialRequest, initialImages },
) {
    const adapter = attachTuiRuntimeAdapter({ runtime, sessionId, uiAPI });
    try {
        await runtime.promptSession(sessionId, { initialRequest, initialImages });
    } finally {
        adapter.dispose();
    }
}

/**
 * Starts the interactive TUI loop.
 * @param {string | null} initialUserRequest
 * @param {{
 *   sessionStartMode?: "new" | "continue",
 *   initialAgentName?: string,
 *   initialAgentModel?: string,
 *   onSessionReady?: (sessionId: string, sessionRuntime: SessionRuntime) => void,
 * }} [options]
 */
export async function startInteractiveSession(initialUserRequest, options = {}) {
    CHAT_BUILTIN_SLASH_NAMES = new Set(
        getSlashCommandDefinitions().map((command) => command.name),
    );

    const sessionRuntime = new SessionRuntime();
    const createdSession = await sessionRuntime.createInteractiveSession({
        cwd: Deno.cwd(),
        mode: options.sessionStartMode || "new",
    });
    let sessionId = createdSession.sessionId;
    function getRuntimeSnapshot() {
        const snapshot = sessionRuntime.getSessionSnapshot(sessionId);
        if (!snapshot) throw new Error("Active runtime session is missing.");
        return snapshot;
    }
    options.onSessionReady?.(sessionId, sessionRuntime);
    initSettings(getRuntimeSnapshot().cwd);
    const sessionStartedAt = createdSession.startedAt;

    let sessionStartedEmptyProjectDirectory = false;
    try {
        sessionStartedEmptyProjectDirectory = await isEmptyProjectDirectory(Deno.cwd());
    } catch {
        sessionStartedEmptyProjectDirectory = false;
    }
    sessionRuntime.setProjectStateContext(
        sessionId,
        sessionStartedEmptyProjectDirectory ? EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE : "",
    );

    // Pre-warm the display-name cache so the footer's sync fallback can
    // resolve an internal Agent name without re-reading front matter.
    await listAvailableAgents(getRuntimeSnapshot().cwd);

    // Callers (for example `wld agent <name>`) may select the initial Agent.
    // Runtime commits its root and handler together after model setup.
    const initialAgentInternalName = options.initialAgentName || AGENTS.ROUTER;
    await ensureMnemosyneBinary();
    initRunWieldTheme();
    await applyPersistedTheme();
    const tui = initTUI();
    setTerminalTitleForName(getRuntimeSnapshot().name || getRuntimeSnapshot().cwd.split("/").at(-1) || "RunWield");

    const container = new Container();
    const suppressStartupHeader = options.sessionStartMode === "continue";

    // Header
    const titleLine = `${theme.fg("accent", theme.bold("RunWield ─ Plan-by-Default Harness"))} ${
        theme.fg("dim", `${VERSION}`)
    }`;

    const compactHelp = theme.fg(
        "muted",
        ["? help", "esc interrupt", "ctrl+c clear/exit", "/ commands", "! bash", "ctrl+o tool output"].join(" · "),
    );

    const helpText = new Text(compactHelp, 0, 0);

    if (!suppressStartupHeader) {
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
    }

    const messageList = new Container();
    container.addChild(messageList);
    container.addChild(new Spacer(1));

    const runningTasksComponent = new SpinnerBlock();
    container.addChild(runningTasksComponent);

    const inputAccessoryContainer = new Container();
    container.addChild(inputAccessoryContainer);

    /** @type {import('../../shared/session/types.js').ImageAttachment[]} */
    const pastedImages = [];
    const previewImages = new Container();
    container.addChild(previewImages);

    const editor = new Editor(tui, getEditorTheme());
    container.addChild(editor);

    const runtimeUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    let unsubscribeRuntimeTelemetry = () => {};
    function attachRuntimeTelemetry() {
        unsubscribeRuntimeTelemetry();
        unsubscribeRuntimeTelemetry = sessionRuntime.subscribeSessionEvents(sessionId, (event) => {
            if (event.type !== RuntimeEventTypes.USAGE) return;
            runtimeUsage.input += event.usage.inputTokens;
            runtimeUsage.output += event.usage.outputTokens;
            runtimeUsage.cacheRead += event.usage.cacheReadTokens;
            runtimeUsage.cacheWrite += event.usage.cacheWriteTokens;
            runtimeUsage.cost += event.usage.costUsd;
        });
    }
    attachRuntimeTelemetry();

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
        const snapshot = getRuntimeSnapshot();
        const settingsManager = getSettingsManager(snapshot.cwd);
        const defaults = {
            model: settingsManager.getDefaultModel() ?? "",
            provider: settingsManager.getDefaultProvider() ?? "",
        };
        let { model, provider } = defaults;

        const activeModel = snapshot.activeModel;
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

        const thinkingLevel = snapshot.thinkingLevel;

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
            const modelStr = model
                ? provider && !model.startsWith(`${provider}/`) ? `${provider}/${model}` : model
                : "";
            const snapshot = getRuntimeSnapshot();
            const rootAgentName = snapshot.activeAgent || "";
            const activeAgentInfo = snapshot.activeAgentInfo || {
                displayName: rootAgentName ? getAgentDisplayName(rootAgentName, snapshot.cwd) : "",
                agentName: rootAgentName,
            };

            // Right block (agent/workflow label) is always pinned flush to the
            // right edge. The left block (cwd/branch) is truncated when it would
            // collide, so the right segment never gets pushed inward on long
            // content.
            const line1LeftRaw = `${cwd} (${branch})`;
            const { left: line1Left, rightParts: line1RightParts } = buildFooterLine1Parts(
                activeAgentInfo,
                snapshot.workflowContext,
                line1LeftRaw,
                w,
            );
            const line1RightText = getFooterWorkflowLabelText(line1RightParts);
            const line1RightWidth = visibleWidth(line1RightText);
            const line1Pad = Math.max(1, w - visibleWidth(line1Left) - line1RightWidth);
            const line1 = theme.fg("dim", line1Left) +
                " ".repeat(line1Pad) +
                renderFooterWorkflowLabelParts(line1RightParts);

            // ── Token consumption data (Pi.dev-style footer) ──
            const usage = runtimeUsage;
            const contextStr = "";

            const statsParts = [];
            if (usage.input > 0) statsParts.push(`↑${formatTokens(usage.input)}`);
            if (usage.output > 0) statsParts.push(`↓${formatTokens(usage.output)}`);
            if (usage.cacheRead > 0) statsParts.push(`R${formatTokens(usage.cacheRead)}`);
            if (usage.cacheWrite > 0) statsParts.push(`W${formatTokens(usage.cacheWrite)}`);

            if (usage.cost > 0) {
                statsParts.push(`$${usage.cost.toFixed(3)}`);
            }

            if (contextStr) statsParts.push(contextStr);
            const statsSegment = statsParts.length > 0 ? statsParts.join(" ") : "";

            const showThinkingLevel = shouldShowFooterThinkingLevel(modelStr, thinkingLevel);
            const thinkingStr = `(${thinkingLevel})`;
            const thinkingStyled = theme.fg(getThinkingThemeToken(thinkingLevel), thinkingStr);
            // Right block (model + thinking level) is always pinned flush to the
            // right edge. The left block (token stats) is truncated when it would
            // collide, so the model segment never drifts toward the middle on long
            // sessions. Widths use visibleWidth() so embedded ANSI color codes in
            // the stats segment don't throw off the padding math.
            const thinkingWidth = showThinkingLevel ? visibleWidth(thinkingStr) + 1 : 0;
            const line2RightWidth = visibleWidth(modelStr) + thinkingWidth;
            const line2LeftRaw = ctrlCPendingExit ? "Ctrl+C - Press again to exit" : statsSegment;
            const line2LeftMax = Math.max(0, w - line2RightWidth - 1);
            const line2LeftTrunc = truncateToWidth(line2LeftRaw, line2LeftMax);
            const line2LeftStyled = ctrlCPendingExit
                ? theme.fg("warning", line2LeftTrunc)
                : theme.fg("dim", line2LeftTrunc);
            const line2Pad = Math.max(1, w - visibleWidth(line2LeftTrunc) - line2RightWidth);
            const line2 = line2LeftStyled +
                " ".repeat(line2Pad) +
                theme.fg("dim", modelStr) +
                (showThinkingLevel ? " " + thinkingStyled : "");

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
    const promptTemplates = await sessionRuntime.listSessionPromptTemplates(sessionId);

    // Load skills metadata once per interactive session.
    const skills = await sessionRuntime.listSessionSkills(sessionId);

    // Expose a UI API for agents to append to the message list
    const uiAPI = createUiApi(tui, messageList, runningTasksComponent, inputAccessoryContainer);

    let tuiRuntimeAdapter = attachTuiRuntimeAdapter({ runtime: sessionRuntime, sessionId: sessionId, uiAPI });

    /** @param {string} model @param {string} [provider] */
    const setCurrentActiveModel = (model, provider) => setActiveModel(sessionRuntime, sessionId, model, provider);

    /**
     * @param {string} nextSessionId
     */
    function replaceRuntimeSession(nextSessionId) {
        const previousSessionId = sessionId;
        tuiRuntimeAdapter.dispose();
        if (previousSessionId !== nextSessionId) {
            sessionRuntime.closeSession(previousSessionId);
        }
        sessionId = nextSessionId;
        runtimeUsage.input = 0;
        runtimeUsage.output = 0;
        runtimeUsage.cacheRead = 0;
        runtimeUsage.cacheWrite = 0;
        runtimeUsage.cost = 0;
        attachRuntimeTelemetry();
        tuiRuntimeAdapter = attachTuiRuntimeAdapter({
            runtime: sessionRuntime,
            sessionId: sessionId,
            uiAPI,
        });
        pastedImages.length = 0;
        previewImages.clear();
        uiAPI.hideKeyboardHelp?.();
        editor.setText("");
        tui.setFocus(editor);
        tui.requestRender();
    }

    // Install input, model-selection, and pasted-image behavior before model
    // onboarding and initial Runtime activation.
    installUiApiOverrides({
        uiAPI,
        tui,
        editor,
        container,
        messageList,
        setActiveModel: setCurrentActiveModel,
        getActiveModelState: () => getRuntimeSnapshot().activeModel,
        __deps: { getSettingsManager: () => getSettingsManager(getRuntimeSnapshot().cwd) },
    });

    const modelWelcomeResult = await maybeShowModelWelcome({
        uiAPI,
        editor,
        tui,
        sessionId,
        sessionRuntime,
        initialAgentInternalName,
        initialAgentModel: options.initialAgentModel,
        setActiveModel: setCurrentActiveModel,
        commandRegistry,
        getModelRegistry,
        getSettingsManager: () => getSettingsManager(getRuntimeSnapshot().cwd),
    });

    // Activate the initial root/handler pair as one Runtime transaction. The
    // root then persists across turns for compaction and other session work.
    if (!modelWelcomeResult.shown) {
        try {
            await sessionRuntime.switchAgent(sessionId, {
                agentName: initialAgentInternalName,
                model: options.initialAgentModel,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            uiAPI.appendSystemMessage(`Failed to initialize root agent "${initialAgentInternalName}": ${msg}`);
        }
    }

    /**
     * @param {string} userRequest
     * @returns {boolean}
     */
    function isModelSetupRecoveryCommand(userRequest) {
        const commandName = userRequest.trim().slice(1).split(/\s+/, 1)[0];
        return [
            COMMAND_NAMES.LOGIN,
            COMMAND_NAMES.MODEL,
            COMMAND_NAMES.QUIT,
            COMMAND_NAMES.EXIT,
        ].includes(commandName);
    }

    let modelSetupRequired = modelWelcomeResult.noModel;

    /** @returns {boolean} */
    function shouldBlockForModelSetup() {
        if (!modelSetupRequired) return false;
        const availability = getSelectedDefaultModelAvailability(
            getModelRegistry,
            () => getSettingsManager(getRuntimeSnapshot().cwd),
        );
        if (availability.available) {
            modelSetupRequired = false;
            editor.disableSubmit = false;
            return false;
        }
        return true;
    }

    /** @type {Set<string>} */
    const warnedImageRefs = new Set();

    /** @param {import('../../shared/session/types.js').ImageAttachment} image */
    function imageWarningKey(image) {
        return image.ref || image.path || `${image.mimeType}:${image.base64.slice(0, 24)}`;
    }

    /**
     * @param {import('../../shared/session/types.js').ImageAttachment[]} images
     * @returns {Promise<{ ok: true, warning?: string } | { ok: false, message: string }>}
     */
    async function preflightCurrentImages(images) {
        return await sessionRuntime.preflightSessionImages(sessionId, images);
    }

    /**
     * @param {import('../../shared/session/types.js').ImageAttachment} image
     * @returns {Promise<import('../../shared/session/types.js').ImageAttachment | null>}
     */
    async function handleImagePaste(image) {
        const persisted = await sessionRuntime.persistSessionImage(sessionId, image);
        const preflight = await preflightCurrentImages([persisted]);
        if (!preflight.ok) {
            uiAPI.appendSystemMessage(preflight.message);
            return null;
        }
        if (preflight.warning) {
            uiAPI.appendSystemMessage(preflight.warning);
            warnedImageRefs.add(imageWarningKey(persisted));
        }
        return persisted;
    }

    // ── Init auto-offer: conditionally offer /init on first TUI visit ──
    if (!sessionStartedEmptyProjectDirectory && !initDone && !modelWelcomeResult.noModel) {
        const alreadyOffered = await isInitOfferedFn();
        if (!alreadyOffered) {
            const choice = await uiAPI.promptSelect(
                "Would you like to run /init to bootstrap RunWield?",
                [
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                ],
            );

            if (choice === "yes") {
                // User accepted — run init and record success
                await commandRegistry[COMMAND_NAMES.INIT].execute([], {
                    uiAPI,
                    sessionId,
                    sessionRuntime,
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
    const builtinSlashInvocationNames = new Set(
        Array.from(CHAT_BUILTIN_SLASH_NAMES).flatMap((name) => getCommandInvocationNames(commandRegistry[name])),
    );
    const invokablePromptTemplates = promptTemplates.filter((template) =>
        !builtinSlashInvocationNames.has(template.name)
    );
    const blockedPromptTemplates = promptTemplates.filter((template) => builtinSlashInvocationNames.has(template.name));
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
        getRuntimeSnapshot().cwd,
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

    let isProcessingSubmission = false;

    /**
     * Restore a queued item into the editor.
     *
     * @param {{ text: string, images: import('../../shared/session/types.js').ImageAttachment[] }} item
     */
    function restoreQueuedItemToEditor(item) {
        editor.setText(item.text);
        if (item.images && item.images.length > 0) {
            for (const img of item.images) {
                pastedImages.push(img);
                previewImages.addChild(createPastedImagePreview(img));
            }
        }
    }

    /**
     * Pop the most recent queued submission or pending steering message and
     * restore it into the editor. Returns true if a message was dequeued.
     */
    async function dequeueLastSubmission() {
        const dequeued = await sessionRuntime.dequeueLastQueuedMessage(sessionId);
        if (!dequeued.ok || !dequeued.message) return false;
        restoreQueuedItemToEditor(dequeued.message);
        tui.requestRender();
        return true;
    }

    /**
     * @param {{ text: string, images: import('../../shared/session/types.js').ImageAttachment[] } | null} [initialItem]
     */
    async function processSubmissions(initialItem = null) {
        if (isProcessingSubmission) return;
        isProcessingSubmission = true;
        try {
            let item = initialItem || sessionRuntime.takeNextTurnMessage(sessionId).message;
            while (item) {
                await executeUserRequest(item.text, item.images);
                item = sessionRuntime.takeNextTurnMessage(sessionId).message;
            }
        } finally {
            isProcessingSubmission = false;
            forceResetUI();
        }
    }

    /**
     * @param {string} text
     * @param {import('../../shared/session/types.js').ImageAttachment[]} images
     */
    function queueForNextTurn(text, images) {
        const result = sessionRuntime.queueNextTurnMessage(sessionId, text, images);
        if (!result.queued) {
            uiAPI.appendSystemMessage(
                `Unable to queue message: ${result.error || result.reason || "unknown error"}`,
                true,
                "RunWield",
            );
            return;
        }
        if (!isProcessingSubmission) processSubmissions();
        tui.requestRender();
    }

    // Handle Editor events
    /**
     * @param {string} userRequest
     * @param {import('../../shared/session/types.js').ImageAttachment[]} savedImages
     */
    async function submitToActiveRoot(userRequest, savedImages) {
        // Generation gating
        const thisGen = generationGuard.bump();

        try {
            await sessionRuntime.promptSession(sessionId, {
                initialRequest: userRequest,
                initialImages: savedImages,
            });
        } catch (err) {
            if (generationStillCurrent(thisGen) && err instanceof SessionTurnInProgressError) {
                uiAPI.appendSystemMessage(
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
    }

    /**
     * @param {string} text
     * @param {import('../../shared/session/types.js').ImageAttachment[]} savedImages
     */
    async function executeUserRequest(text, savedImages) {
        const userRequest = text.trim();
        if (!userRequest && savedImages.length === 0) return;

        if (userRequest) editor.addToHistory?.(userRequest);

        // Slash commands (`/builtin` or `/template`)
        const handledSlash = userRequest
            ? await handleSlashCommand({
                userRequest,
                savedImages,
                sessionId,
                sessionRuntime,
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
                dispatchExpandedUserRequest: submitToActiveRoot,
                setActiveModel: setCurrentActiveModel,
                replaceRuntimeSession,
                generationGuard,
            })
            : false;
        if (handledSlash) return;

        await submitToActiveRoot(userRequest, savedImages);
    }

    editor.onSubmit = async (text) => {
        // end the logo blink and make it static
        endBlink();

        const userRequest = text.trim();
        const images = [...pastedImages];
        uiAPI.hideKeyboardHelp?.();
        if (!userRequest && images.length === 0) return;

        if (shouldBlockForModelSetup() && !(userRequest.startsWith("/") && isModelSetupRecoveryCommand(userRequest))) {
            uiAPI.appendSystemMessage(
                "Choose a default model before sending chat messages. Run /model to select a model, run /login to configure credentials, or quit with /quit.",
                true,
                "RunWield",
            );
            editor.disableSubmit = false;
            tui.setFocus(editor);
            tui.requestRender();
            return;
        }

        if (images.length > 0) {
            const preflight = await preflightCurrentImages(images);
            if (!preflight.ok) {
                uiAPI.appendSystemMessage(preflight.message);
                tui.requestRender();
                return;
            }
            const unwarnedImages = images.filter((image) => !warnedImageRefs.has(imageWarningKey(image)));
            if (preflight.warning && unwarnedImages.length > 0) {
                uiAPI.appendSystemMessage(preflight.warning);
                for (const image of unwarnedImages) warnedImageRefs.add(imageWarningKey(image));
            }
        }

        if (userRequest) editor.addToHistory?.(userRequest);

        pastedImages.length = 0;
        previewImages.clear();
        editor.setText("");

        // Bash interception (`!cmd` / `!!cmd`) runs ahead of the steering and
        // queueing paths so a stray `!` typed during a model turn is executed
        // locally instead of being sent as steering text.
        if (userRequest.startsWith("!")) {
            handleBashCommand({
                userRequest,
                sessionRuntime,
                sessionId,
                concurrent: isProcessingSubmission,
            }).catch(() => {/* Runtime surfaces shell failures through events. */});
            return;
        }

        if (isProcessingSubmission) {
            if (userRequest === "/model" || userRequest.startsWith("/model ")) {
                uiAPI.appendSystemMessage(
                    "I'm not able to change the model right now wait until idle or cancel with Esc.",
                    false,
                    "RunWield",
                );
                return;
            }

            sessionRuntime.steerSession(sessionId, userRequest, images).then((result) => {
                if (!result.queued) queueForNextTurn(userRequest, images);
                tui.requestRender();
            }).catch((_err) => {
                // On error (e.g. extension command rejected by session.steer()),
                // fall back to queuing for next submission
                queueForNextTurn(userRequest, images);
            });
            return;
        }

        processSubmissions({ text: userRequest, images });
    };

    // Initialize thinking level from settings
    const settingsManager = getSettingsManager(getRuntimeSnapshot().cwd);
    const savedThinkingLevel = settingsManager.getDefaultThinkingLevel();
    if (savedThinkingLevel) {
        sessionRuntime.setSessionThinkingLevel(sessionId, savedThinkingLevel);
    }

    /** Cycle the thinking level and persist to settings */
    async function cycleThinkingLevel() {
        const result = sessionRuntime.cycleSessionThinkingLevel(sessionId);
        if (!result.ok || !result.thinkingLevel) return;
        await persistThinkingLevel(result.thinkingLevel, getRuntimeSnapshot().cwd);
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
        generationGuard,
        dismissActivePrompt,
        dequeueLastSubmission,
        forceResetUI,
        markCtrlCPendingExit,
        isCtrlCPendingExit: () => ctrlCPendingExit,
        requestKeyboardHelp: () => sessionRuntime.requestSessionHelp(sessionId),
        hideKeyboardHelp: () => uiAPI.hideKeyboardHelp?.(),
        cycleThinkingLevel,
        handleImagePaste,
        cancelRuntimeSession: () => sessionRuntime.cancelSession(sessionId).aborted,
    });

    if (!suppressStartupHeader && sessionStartedEmptyProjectDirectory && !initialUserRequest) {
        uiAPI.appendSystemMessage(
            EMPTY_PROJECT_DIRECTORY_WELCOME_BODY,
            false,
            EMPTY_PROJECT_DIRECTORY_HEADER,
            { headingColor: "success", bodyColor: "accent" },
        );
    } else if (!suppressStartupHeader && !modelWelcomeResult.suppressBootBanner) {
        await renderBootBanner({
            uiAPI,
            sessionRuntime,
            sessionId,
            invokablePromptTemplates,
            blockedPromptTemplates,
            chatPromptAgentName: CHAT_PROMPT_AGENT_NAME,
            projectRoot: getRuntimeSnapshot().cwd,
        });
    }

    // A new session contains initialization metadata but no conversation to
    // hydrate. Only continuing sessions replay persisted history.
    if (shouldReplaySessionHistory(options.sessionStartMode)) {
        sessionRuntime.replaySession(sessionId);
    }

    // Trigger initial user request
    if (initialUserRequest) {
        editor.setText(initialUserRequest);
        editor.onSubmit(initialUserRequest);
    }

    return uiAPI;
}
