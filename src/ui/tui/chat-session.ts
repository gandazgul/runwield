/**
 * @module ui/tui/chat-session
 * High-level interactive loop for the TUI.
 */

import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { initTUI } from "./tui.ts";
import { setTerminalTitleForName } from "./terminal-title.ts";
import { SYSTEM_BROWSER_PORT } from "../../shared/browser-port.ts";
import { attachTuiRuntimeAdapter } from "./runtime-adapter.js";
import { notifyRunWieldEventQuietly } from "./system-notifications.ts";
import { createManagedSessionSyncController, SYSTEM_MANAGED_SESSION_TIMER } from "./managed-session-sync.js";
import { ensureCymbalBinary, ensureKetchBinary, ensureMnemosyneBinary } from "../../shared/runtime-preflight.ts";
import {
    COMMAND_NAMES,
    commandRegistry,
    getCommandInvocationNames,
    getSlashCommandDefinitions,
} from "../../cmd/registry.js";
import { AGENTS, getCwd } from "../../constants.js";
import {
    EMPTY_PROJECT_DIRECTORY_HEADER,
    EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE,
    EMPTY_PROJECT_DIRECTORY_WELCOME_BODY,
    isEmptyProjectDirectory,
} from "../../shared/project-state.js";
import { listAvailableAgents } from "../../shared/session/agents.js";
import { openFileSessionStore } from "../../shared/session/file-session-store.ts";
import { getSettingsManager, initSettings } from "../../shared/settings.js";
import {
    isInitDone as isInitDoneFn,
    isInitOffered as isInitOfferedFn,
    recordInitOffered as recordInitOfferedFn,
} from "../../cmd/init/init-state.ts";
import { isProjectInitComplete } from "../../cmd/init/init-completion.ts";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
import { setActiveSessionModel } from "../../shared/session/model-selection.ts";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { renderBootBanner } from "./boot-banner.ts";
import { getSelectedDefaultModelAvailability, maybeShowModelWelcome } from "./model-welcome.ts";
import { createChatFooterController } from "./chat-footer.ts";
import { createChatView } from "./chat-view.ts";
import { createChatInputController } from "./chat-input-controller.ts";
import type { BrowserPort } from "../../shared/browser-port.ts";
import type { ImageAttachment } from "../../shared/session/types.js";
import type { UiAPI } from "./types.js";

const CHAT_PROMPT_AGENT_NAME = AGENTS.OPERATOR;
export type SessionRuntime = ReturnType<typeof createSessionRuntime>;

export interface InteractiveLifecycleHandle {
    dispose(): Promise<void>;
}
export interface TerminalPairPort {
    flush?(): Promise<void> | void;
    getScreenText?(): string;
}
export interface StartInteractiveSessionOptions {
    sessionStartMode?: "new" | "continue";
    resumeSessionId?: string;
    initialAgentName?: string;
    initialAgentModel?: string;
    onSessionReady?: (sessionId: string, sessionRuntime: SessionRuntime) => void;
    onSessionReplaced?: (sessionId: string, sessionRuntime: SessionRuntime) => void;
    browser: BrowserPort;
    terminal?: TerminalPairPort;
    skipModelWelcome?: boolean;
    configureUiAPI?: (uiAPI: UiAPI) => void;
    onLifecycleReady?: (handle: InteractiveLifecycleHandle) => void;
}
export interface ScopedSubmitHandoffLoopArgs {
    runtime: SessionRuntime;
    sessionId: string;
    uiAPI: UiAPI;
    initialRequest: string;
    initialImages: ImageAttachment[];
}

export { setActiveSessionModel as setActiveModel };

export function shouldReplaySessionHistory(sessionStartMode: "new" | "continue" | undefined): boolean {
    return sessionStartMode === "continue";
}

export async function persistThinkingLevel(
    level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
    projectRoot?: string,
): Promise<void> {
    try {
        await getSettingsManager(projectRoot).setDefaultThinkingLevel(level);
    } catch (e) {
        console.error(`Failed to persist thinking level: ${e}`);
    }
}

export function getActiveModel(runtime: SessionRuntime, sessionId: string): string {
    return runtime.getSessionSnapshot(sessionId)?.activeModel.model || "";
}

export function recordUserInputHistory(editor: { addToHistory?: (text: string) => void }, text: string): void {
    const historyText = text.trim();
    if (historyText) editor.addToHistory?.(historyText);
}

export async function runScopedSubmitHandoffLoop(args: ScopedSubmitHandoffLoopArgs): Promise<void> {
    const adapter = attachTuiRuntimeAdapter({
        runtime: args.runtime,
        sessionId: args.sessionId,
        uiAPI: args.uiAPI,
        browser: SYSTEM_BROWSER_PORT,
        notifyRunWieldEvent: notifyRunWieldEventQuietly,
    });
    try {
        await args.runtime.promptUserTurn(args.sessionId, {
            initialRequest: args.initialRequest,
            initialImages: args.initialImages,
        });
    } finally {
        adapter.dispose();
    }
}

function getRuntimeSnapshot(runtime: SessionRuntime, sessionId: string) {
    const snapshot = runtime.getSessionSnapshot(sessionId);
    if (!snapshot) throw new Error("Active runtime session is missing.");
    return snapshot;
}

export async function startInteractiveSession(
    initialUserRequest: string | null,
    options: StartInteractiveSessionOptions,
): Promise<UiAPI> {
    const chatBuiltinSlashNames = new Set<string>();
    for (const command of getSlashCommandDefinitions()) chatBuiltinSlashNames.add(command.name);
    const sessionStartMode = options.sessionStartMode || "new";
    const shouldDeferManagedActivation = sessionStartMode === "new";
    const sessionStore = shouldDeferManagedActivation ? null : openFileSessionStore();
    const sessionRuntime = createSessionRuntime({ sessionStore, ownerProcessKind: "tui" });
    const disposables: Array<() => void | Promise<void>> = [];
    let uiAPIForDispose: UiAPI | null = null;
    let lifecycleDisposed = false;
    const lifecycleHandle: InteractiveLifecycleHandle = {
        dispose: async () => {
            if (lifecycleDisposed) return;
            lifecycleDisposed = true;
            const cleanupErrors: Error[] = [];
            const recordCleanupError = (error: Error): void => {
                cleanupErrors.push(error);
            };
            for (const dispose of disposables.toReversed()) {
                try {
                    await dispose();
                } catch (error) {
                    recordCleanupError(error instanceof Error ? error : new Error(String(error)));
                }
            }
            try {
                uiAPIForDispose?.dispose?.();
            } catch (error) {
                recordCleanupError(error instanceof Error ? error : new Error(String(error)));
            }
            try {
                await sessionRuntime.closeAllSessions?.();
            } catch (error) {
                recordCleanupError(error instanceof Error ? error : new Error(String(error)));
            }
            try {
                sessionStore?.close();
            } catch (error) {
                recordCleanupError(error instanceof Error ? error : new Error(String(error)));
            }
            if (cleanupErrors.length > 0) {
                throw new AggregateError(cleanupErrors, "Interactive TUI cleanup failed.");
            }
        },
    };
    options.onLifecycleReady?.(lifecycleHandle);
    try {
        const sessionCwd = getCwd();
        const createdSession = await sessionRuntime.createInteractiveSession({
            cwd: sessionCwd,
            mode: sessionStartMode,
            resumeSessionId: options.resumeSessionId,
            deferManagedActivationUntilAgentReady: shouldDeferManagedActivation,
        });
        let sessionId = createdSession.sessionId;
        const runtimeSnapshot = () => getRuntimeSnapshot(sessionRuntime, sessionId);
        options.onSessionReady?.(sessionId, sessionRuntime);
        initSettings(runtimeSnapshot().cwd);
        const sessionStartedAt = createdSession.startedAt;
        let sessionStartedEmptyProjectDirectory = false;
        try {
            sessionStartedEmptyProjectDirectory = await isEmptyProjectDirectory(getCwd());
        } catch {
            sessionStartedEmptyProjectDirectory = false;
        }
        sessionRuntime.setProjectStateContext(
            sessionId,
            sessionStartedEmptyProjectDirectory ? EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE : "",
        );
        const initialAgentInternalName = options.initialAgentName || AGENTS.ROUTER;
        const tui = initTUI();
        setTerminalTitleForName(runtimeSnapshot().name || runtimeSnapshot().cwd.split("/").at(-1) || "RunWield");
        const suppressStartupHeader = options.sessionStartMode === "continue";
        const view = await createChatView({
            tui,
            sessionRuntime,
            getSessionId: () => sessionId,
            suppressStartupHeader,
            setActiveModel: (model, provider) => setActiveSessionModel(sessionRuntime, sessionId, model, provider),
            configureUiAPI: options.configureUiAPI,
        });
        disposables.push(() => view.dispose());
        const footer = createChatFooterController({
            runtime: sessionRuntime,
            getSessionId: () => sessionId,
            requestRender: () => tui.requestRender(),
        });
        disposables.push(() => footer.dispose());
        view.container.addChild(footer.component);
        const uiAPI = view.uiAPI;
        uiAPIForDispose = uiAPI;
        let inputControllerForPause: { isProcessingSubmission(): boolean } | null = null;
        let tuiRuntimeAdapter = attachTuiRuntimeAdapter({
            runtime: sessionRuntime,
            sessionId,
            uiAPI,
            browser: options.browser,
            notifyRunWieldEvent: notifyRunWieldEventQuietly,
            onSessionReplaced: ({ newSessionId }) => replaceRuntimeSession(newSessionId, { oldRetired: true }),
        });
        disposables.push(() => tuiRuntimeAdapter.dispose());
        const managedSyncController = createManagedSessionSyncController({
            runtime: sessionRuntime,
            getSessionId: () => sessionId,
            timer: SYSTEM_MANAGED_SESSION_TIMER,
            isPaused: () => inputControllerForPause?.isProcessingSubmission() || false,
            onError: () => {},
        });
        disposables.push(() => managedSyncController.dispose());
        managedSyncController.start();
        view.requestRender();
        if (!options.skipModelWelcome) {
            await listAvailableAgents(runtimeSnapshot().cwd);
            await ensureMnemosyneBinary();
            await ensureCymbalBinary();
            await ensureKetchBinary();
        }
        let promptTemplates = options.skipModelWelcome
            ? []
            : await sessionRuntime.listSessionPromptTemplates(sessionId);
        let skills = options.skipModelWelcome ? [] : await sessionRuntime.listSessionSkills(sessionId);
        let builtinSlashInvocationNames = new Set<string>();
        let invokablePromptTemplates = promptTemplates;
        let blockedPromptTemplates = promptTemplates.slice(0, 0);
        let promptTemplateByName = new Map<string, (typeof promptTemplates)[number]>();
        const refreshPromptTemplateCommandGroups = (): void => {
            builtinSlashInvocationNames = new Set(
                Array.from(chatBuiltinSlashNames).flatMap((name) => getCommandInvocationNames(commandRegistry[name])),
            );
            invokablePromptTemplates = promptTemplates.filter((template) =>
                !builtinSlashInvocationNames.has(template.name)
            );
            blockedPromptTemplates = promptTemplates.filter((template) =>
                builtinSlashInvocationNames.has(template.name)
            );
            promptTemplateByName = new Map(invokablePromptTemplates.map((template) => [template.name, template]));
        };
        let unsubscribeCommandCatalog: (() => void) | null = null;
        const subscribeCommandCatalog = (): void => {
            unsubscribeCommandCatalog?.();
            unsubscribeCommandCatalog = sessionRuntime.subscribeSessionEvents(sessionId, (event) => {
                if (event.type !== RuntimeEventTypes.COMMAND_CATALOG_CHANGED) return;
                promptTemplates = event.promptTemplates;
                skills = event.skills;
                refreshPromptTemplateCommandGroups();
                installAutocompleteProvider();
                view.requestRender();
            });
        };
        const replaceRuntimeSession = (nextSessionId: string, replaceOptions: { oldRetired?: boolean } = {}): void => {
            const previousSessionId = sessionId;
            tuiRuntimeAdapter.dispose();
            if (!replaceOptions.oldRetired && previousSessionId !== nextSessionId) {
                sessionRuntime.closeSession(previousSessionId);
            }
            sessionId = nextSessionId;
            options.onSessionReplaced?.(sessionId, sessionRuntime);
            footer.rebindSession(sessionId);
            tuiRuntimeAdapter = attachTuiRuntimeAdapter({
                runtime: sessionRuntime,
                sessionId,
                uiAPI,
                browser: options.browser,
                notifyRunWieldEvent: notifyRunWieldEventQuietly,
                onSessionReplaced: ({ newSessionId }) => replaceRuntimeSession(newSessionId, { oldRetired: true }),
            });
            subscribeCommandCatalog();
            view.resetForSessionReplacement();
            tui.requestRender();
        };
        refreshPromptTemplateCommandGroups();
        const initStateClaimedDone = options.skipModelWelcome ? true : await isInitDoneFn();
        const initDone = options.skipModelWelcome ? true : await isProjectInitComplete();
        let initCommandAvailable = !initDone;
        if (!suppressStartupHeader && !sessionStartedEmptyProjectDirectory) {
            await renderBootBanner({
                uiAPI,
                sessionRuntime,
                sessionId,
                invokablePromptTemplates,
                blockedPromptTemplates,
                chatPromptAgentName: CHAT_PROMPT_AGENT_NAME,
                projectRoot: runtimeSnapshot().cwd,
            });
        }
        const modelWelcomeResult = options.skipModelWelcome
            ? { shown: false, suppressBootBanner: false, noModel: false, setupCompleted: false }
            : await maybeShowModelWelcome({
                uiAPI,
                editor: view.editor,
                tui,
                sessionId,
                sessionRuntime,
                initialAgentInternalName,
                initialAgentModel: options.initialAgentModel,
                projectRoot: runtimeSnapshot().cwd,
                deferRootActivation: shouldDeferManagedActivation,
            });
        if (!modelWelcomeResult.noModel && shouldDeferManagedActivation) {
            sessionRuntime.markPromptReadyAgent(sessionId, {
                agentName: initialAgentInternalName,
                model: options.initialAgentModel,
            });
        }
        const isModelSetupRecoveryCommand = (userRequest: string): boolean => {
            const commandName = userRequest.trim().slice(1).split(/\s+/, 1)[0];
            return [COMMAND_NAMES.LOGIN, COMMAND_NAMES.MODEL, COMMAND_NAMES.QUIT, COMMAND_NAMES.EXIT].includes(
                commandName,
            );
        };
        let modelSetupRequired = modelWelcomeResult.noModel;
        const shouldBlockForModelSetup = (): boolean => {
            if (!modelSetupRequired) return false;
            const availability = getSelectedDefaultModelAvailability(runtimeSnapshot().cwd);
            if (availability.available) {
                modelSetupRequired = false;
                view.editor.disableSubmit = false;
                return false;
            }
            return true;
        };
        if (!sessionStartedEmptyProjectDirectory && !initDone && !modelWelcomeResult.noModel) {
            const alreadyOffered = await isInitOfferedFn();
            if (!alreadyOffered || initStateClaimedDone) {
                const choice = await uiAPI.promptSelect("Would you like to run /init to bootstrap RunWield?", [{
                    value: "yes",
                    label: "Yes",
                }, { value: "no", label: "No" }]);
                if (choice === "yes") {
                    await commandRegistry[COMMAND_NAMES.INIT].execute([], { uiAPI, sessionId, sessionRuntime });
                    initCommandAvailable = !(await isProjectInitComplete());
                } else await recordInitOfferedFn();
                view.focusEditor();
                view.requestRender();
            }
        }
        refreshPromptTemplateCommandGroups();
        const installAutocompleteProvider = (): void => {
            const autocompleteProvider = new CombinedAutocompleteProvider(
                [
                    ...Array.from(chatBuiltinSlashNames).map((name) => ({
                        name,
                        description: name === "init" && !initCommandAvailable
                            ? "Already initialized for this project"
                            : commandRegistry[name].description,
                        getArgumentCompletions: commandRegistry[name].getArgumentCompletions,
                    })),
                    ...invokablePromptTemplates.map((template) => ({
                        name: template.name,
                        argumentHint: template.argumentHint,
                        description: template.description,
                    })),
                    ...skills.filter((skill) => skill.description && skill.description !== "No description provided")
                        .map((skill) => ({ name: `skill:${skill.name}`, description: skill.description })),
                ],
                runtimeSnapshot().cwd,
                "fd",
            );
            view.installAutocompleteProvider(autocompleteProvider);
        };
        installAutocompleteProvider();
        const inputController = createChatInputController({
            view,
            uiAPI,
            runtime: sessionRuntime,
            getSessionId: () => sessionId,
            getProjectRoot: () => runtimeSnapshot().cwd,
            sessionStartedAt,
            isModelSetupRecoveryCommand,
            shouldBlockForModelSetup,
            isInitCommandAvailable: () => initCommandAvailable,
            getPromptTemplateByName: () => promptTemplateByName,
            getSkills: () => skills,
            chatPromptAgentName: CHAT_PROMPT_AGENT_NAME,
            managedSyncController,
            replaceRuntimeSession,
            markCtrlCPendingExit: footer.markCtrlCPendingExit,
            isCtrlCPendingExit: footer.isCtrlCPendingExit,
        });
        disposables.push(() => inputController.dispose());
        subscribeCommandCatalog();
        disposables.push(() => unsubscribeCommandCatalog?.());
        inputControllerForPause = inputController;
        const settingsManager = getSettingsManager(runtimeSnapshot().cwd);
        const savedThinkingLevel = settingsManager.getDefaultThinkingLevel();
        if (savedThinkingLevel) sessionRuntime.setSessionThinkingLevel(sessionId, savedThinkingLevel);
        view.requestRender();
        if (
            !suppressStartupHeader && sessionStartedEmptyProjectDirectory && !initialUserRequest &&
            !modelWelcomeResult.noModel
        ) {
            uiAPI.appendSystemMessage(EMPTY_PROJECT_DIRECTORY_WELCOME_BODY, false, EMPTY_PROJECT_DIRECTORY_HEADER, {
                headingColor: "success",
                bodyColor: "accent",
            });
        }
        if (shouldReplaySessionHistory(options.sessionStartMode)) {
            await sessionRuntime.replaySession(sessionId);
        }
        if (initialUserRequest && !modelWelcomeResult.noModel) {
            view.editor.setText(initialUserRequest);
            await view.editor.onSubmit?.(initialUserRequest);
        }
        return uiAPI;
    } catch (error) {
        try {
            await lifecycleHandle.dispose();
        } catch (cleanupError) {
            console.error(`Interactive TUI cleanup failed after startup error: ${cleanupError}`);
        }
        throw error;
    }
}
