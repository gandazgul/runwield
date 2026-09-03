import { handleBashCommand } from "./bash-interceptor.js";
import { endBlink } from "./boot-logo.ts";
import { installKeybindings } from "./keybindings.ts";
import { handleSlashCommand, isImmediateBuiltinSlashCommandWhileStreaming, type SkillMeta } from "./slash-dispatch.ts";
import { readClipboardImage } from "./clipboard.ts";
import { resolveTemplateModel } from "../../shared/models/model-validation.ts";
import { persistThinkingLevel, recordUserInputHistory, type SessionRuntime } from "./chat-session.ts";
import { createGenerationGuard } from "./generation-guard.js";
import { type ChatView, createPastedImagePreview } from "./chat-view.ts";
import type { ImageAttachment } from "../../shared/session/types.js";
import type { UiAPI } from "./types.js";
import { ClaudeCliBackendError } from "../../shared/session/backends/claude-cli/failure.ts";

type ThinkingLevel = Parameters<typeof persistThinkingLevel>[0];

export interface QueuedInput {
    text: string;
    images: ImageAttachment[];
}
export interface PromptTemplateMeta {
    name: string;
    argumentHint?: string;
    description?: string;
}
export type ChatInputRuntime = SessionRuntime;
export interface ManagedSyncController {
    pause(): Promise<void>;
    resume(): void;
}
export interface ChatInputControllerOptions {
    view: ChatView;
    uiAPI: UiAPI;
    runtime: ChatInputRuntime;
    getSessionId(): string;
    getProjectRoot(): string;
    sessionStartedAt: string;
    isModelSetupRecoveryCommand(userRequest: string): boolean;
    shouldBlockForModelSetup(): boolean;
    isInitCommandAvailable(): boolean;
    getPromptTemplateByName(): Map<string, PromptTemplateMeta>;
    getSkills(): SkillMeta[];
    chatPromptAgentName: string;
    managedSyncController: ManagedSyncController;
    replaceRuntimeSession(nextSessionId: string, options?: { oldRetired?: boolean }): void;
    markCtrlCPendingExit(): void;
    isCtrlCPendingExit(): boolean;
}
export interface ChatInputController {
    isProcessingSubmission(): boolean;
    forceResetUI(): void;
    restoreQueuedItemToEditor(item: QueuedInput): void;
    processSubmissions(initialItem?: QueuedInput | null): Promise<void>;
    dispose(): Promise<void>;
}

function getPreflightWarning(result: Awaited<ReturnType<SessionRuntime["preflightSessionImages"]>>): string {
    return "warning" in result && typeof result.warning === "string" ? result.warning : "";
}

function imageWarningKey(image: ImageAttachment): string {
    return image.ref || image.path || `${image.mimeType}:${image.base64.slice(0, 24)}`;
}

function userTurnFailureMessage(error: Error | string): string | null {
    if (error instanceof ClaudeCliBackendError) {
        // The backend already emitted its sanitized message as a system status.
        return null;
    }
    console.error("[RunWield] tui_submit_failed", error);
    if (error instanceof Error && error.message.includes("model")) {
        return "RunWield could not send the message because model setup is not ready. Choose a model, then try again.";
    }
    return "RunWield could not send that message. Your draft was restored. Try again.";
}

export function createChatInputController(options: ChatInputControllerOptions): ChatInputController {
    const { view, uiAPI, runtime } = options;
    const { editor, pastedImages, previewImages } = view;
    const generationGuard = createGenerationGuard();
    const generationStillCurrent = generationGuard.isCurrent;
    const warnedImageRefs = new Set<string>();
    const preflightedImageRefs = new Set<string>();
    const pendingImagePastes = new WeakMap<ImageAttachment, Promise<ImageAttachment | null>>();
    let isProcessingSubmission = false;
    let shouldDrainQueuedAfterProcessing = false;
    let pendingThinkingLevel: ThinkingLevel | null = null;
    let pendingThinkingLevelTimer: ReturnType<typeof setTimeout> | null = null;
    let thinkingLevelPersistenceQueue: Promise<void> = Promise.resolve();
    let originalHandleInput: (data: string) => void | Promise<void> = (data: string) => editor.handleInput(data);

    function flushPendingThinkingLevelPersistence(): Promise<void> {
        const level = pendingThinkingLevel;
        if (!level) return thinkingLevelPersistenceQueue;
        pendingThinkingLevel = null;
        if (pendingThinkingLevelTimer !== null) {
            clearTimeout(pendingThinkingLevelTimer);
            pendingThinkingLevelTimer = null;
        }
        thinkingLevelPersistenceQueue = thinkingLevelPersistenceQueue
            .then(() => persistThinkingLevel(level, options.getProjectRoot()))
            .catch((error) => console.error(`[RunWield] thinking_level_persist_failed ${error}`));
        return thinkingLevelPersistenceQueue;
    }

    function scheduleThinkingLevelPersistence(level: ThinkingLevel): void {
        pendingThinkingLevel = level;
        if (pendingThinkingLevelTimer !== null) clearTimeout(pendingThinkingLevelTimer);
        pendingThinkingLevelTimer = setTimeout(() => {
            pendingThinkingLevelTimer = null;
            void flushPendingThinkingLevelPersistence();
        }, 50);
    }

    function forceResetUI(): void {
        editor.disableSubmit = false;
        uiAPI.setBusy?.(false);
        uiAPI.enableInput?.();
        view.focusEditor();
        view.requestRender();
    }
    function dismissActivePrompt(): void {
        uiAPI.abortActivePrompt?.();
        view.focusEditor();
    }
    function restoreQueuedItemToEditor(item: QueuedInput): void {
        editor.setText(item.text);
        for (const img of item.images || []) {
            pastedImages.push(img);
            previewImages.addChild(createPastedImagePreview(img));
        }
    }
    async function recallQueuedSubmissionsToEditor(): Promise<void> {
        const queuedMessages = runtime.getQueuedMessages(options.getSessionId());
        if (queuedMessages.length === 0) return;
        for (let index = 0; index < queuedMessages.length; index += 1) {
            await runtime.dequeueLastQueuedMessage(options.getSessionId());
        }
        restoreQueuedItemToEditor({
            text: queuedMessages.map((message) => message.text).join("\n"),
            images: queuedMessages.flatMap((message) => message.images),
        });
    }
    async function dequeueLastSubmission(): Promise<boolean> {
        const dequeued = await runtime.dequeueLastQueuedMessage(options.getSessionId());
        if (!dequeued.ok || !dequeued.message) return false;
        restoreQueuedItemToEditor(dequeued.message);
        view.requestRender();
        return true;
    }
    function queueForNextTurn(text: string, images: ImageAttachment[]): void {
        const result = runtime.queueNextTurnMessage(options.getSessionId(), text, images);
        if (!result.queued) {
            uiAPI.appendSystemMessage(
                `Unable to queue message: ${result.error || result.reason || "unknown error"}`,
                true,
                "RunWield",
            );
            return;
        }
        if (isProcessingSubmission) shouldDrainQueuedAfterProcessing = true;
        else void processSubmissions();
        view.requestRender();
    }
    async function submitToActiveRoot(userRequest: string, savedImages: ImageAttachment[]): Promise<void> {
        const thisGen = generationGuard.bump();
        try {
            await options.managedSyncController.pause();
            const result = await runtime.promptUserTurn(options.getSessionId(), {
                initialRequest: userRequest,
                initialImages: savedImages,
            });
            if (result?.error === "refresh_required") {
                await runtime.synchronizeManagedSession(options.getSessionId());
                restoreQueuedItemToEditor({ text: result.submittedRequest, images: savedImages });
                editor.disableSubmit = false;
                view.focusEditor();
                uiAPI.appendSystemMessage(
                    "This Session changed elsewhere. Your draft was restored after refreshing; submit again to send it.",
                    false,
                    "RunWield",
                );
            } else if (result?.restoreDraft) {
                restoreQueuedItemToEditor({ text: result.submittedRequest, images: savedImages });
            } else if (result?.historyText) {
                recordUserInputHistory(editor, result.historyText);
            }
        } catch (err) {
            restoreQueuedItemToEditor({ text: userRequest, images: savedImages });
            if (generationStillCurrent(thisGen)) {
                const message = userTurnFailureMessage(err instanceof Error ? err : String(err));
                if (message) uiAPI.appendSystemMessage(message, true, "RunWield");
            }
        } finally {
            options.managedSyncController.resume();
        }
    }
    async function executeUserRequest(text: string, savedImages: ImageAttachment[]): Promise<void> {
        const userRequest = text.trim();
        if (!userRequest && savedImages.length === 0) return;
        if (userRequest.startsWith("/")) recordUserInputHistory(editor, userRequest);
        const handledSlash = userRequest
            ? await handleSlashCommand({
                userRequest,
                savedImages,
                sessionId: options.getSessionId(),
                sessionRuntime: runtime,
                uiAPI,
                editor,
                tui: view.tui,
                sessionStartedAt: options.sessionStartedAt,
                originalHandleInput,
                initCommandAvailable: options.isInitCommandAvailable(),
                promptTemplateByName: options.getPromptTemplateByName(),
                skills: options.getSkills(),
                chatPromptAgentName: options.chatPromptAgentName,
                resolveTemplateModel,
                dispatchExpandedUserRequest: submitToActiveRoot,
                replaceRuntimeSession: options.replaceRuntimeSession,
                generationGuard,
            })
            : false;
        if (handledSlash) return;
        await submitToActiveRoot(text, savedImages);
    }
    async function processSubmissions(initialItem: QueuedInput | null = null): Promise<void> {
        if (isProcessingSubmission) return;
        isProcessingSubmission = true;
        try {
            await flushPendingThinkingLevelPersistence();
            let item = initialItem || runtime.takeNextTurnMessage(options.getSessionId()).message;
            while (item) {
                await executeUserRequest(item.text, item.images);
                item = runtime.takeNextTurnMessage(options.getSessionId()).message;
            }
        } finally {
            isProcessingSubmission = false;
            forceResetUI();
            if (shouldDrainQueuedAfterProcessing && runtime.getQueuedMessages(options.getSessionId()).length > 0) {
                shouldDrainQueuedAfterProcessing = false;
                void processSubmissions();
            }
        }
    }
    async function preflightCurrentImages(images: ImageAttachment[]) {
        return await runtime.preflightSessionImages(options.getSessionId(), images);
    }
    async function awaitPendingImagePastes(images: ImageAttachment[]): Promise<void> {
        const pending = images.flatMap((image) => {
            const task = pendingImagePastes.get(image);
            return task ? [task] : [];
        });
        if (pending.length === 0) return;
        await Promise.allSettled(pending);
    }
    function handleImagePaste(image: ImageAttachment): Promise<ImageAttachment | null> {
        const task = (async (): Promise<ImageAttachment | null> => {
            let attachment = image;
            try {
                attachment = await runtime.persistSessionImage(options.getSessionId(), image);
                Object.assign(image, attachment);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.includes("no active session is available")) throw error;
            }
            const preflight = await preflightCurrentImages([image]);
            if (!preflight.ok) {
                uiAPI.appendSystemMessage(preflight.message);
                return null;
            }
            preflightedImageRefs.add(imageWarningKey(image));
            const pasteWarning = getPreflightWarning(preflight);
            if (pasteWarning) {
                uiAPI.appendSystemMessage(pasteWarning);
                warnedImageRefs.add(imageWarningKey(image));
            }
            return image;
        })();
        pendingImagePastes.set(image, task);
        task.then(
            () => pendingImagePastes.delete(image),
            () => pendingImagePastes.delete(image),
        );
        return task;
    }
    editor.onSubmit = async (text: string) => {
        const userRequest = text.trim();
        let images = [...pastedImages];
        uiAPI.hideKeyboardHelp?.();
        if (!userRequest && images.length === 0) return;
        if (
            options.shouldBlockForModelSetup() &&
            !(userRequest.startsWith("/") && options.isModelSetupRecoveryCommand(userRequest))
        ) {
            uiAPI.appendSystemMessage(
                "Choose a default model before sending chat messages. Run /model to select a model, run /login to configure credentials, or quit with /quit.",
                true,
                "RunWield",
            );
            editor.setText(text);
            forceResetUI();
            return;
        }
        const managedSnapshot = runtime.getSessionSnapshot(options.getSessionId());
        const activeElsewhere = managedSnapshot?.managed?.syncState?.status === "active_elsewhere";
        const managedBlockMessage = runtime.getUserTurnSubmissionBlockMessage(options.getSessionId());
        if (
            managedBlockMessage && (!activeElsewhere || userRequest.startsWith("/")) &&
            !(userRequest.startsWith("/") && options.isModelSetupRecoveryCommand(userRequest))
        ) {
            uiAPI.appendSystemMessage(managedBlockMessage, true, "RunWield");
            editor.setText(text);
            forceResetUI();
            return;
        }
        if (images.length > 0) {
            await awaitPendingImagePastes(images);
            images = images.filter((image) => pastedImages.includes(image));
            if (!userRequest && images.length === 0) return;
            const imagesNeedingPreflight = images.filter((image) => !preflightedImageRefs.has(imageWarningKey(image)));
            if (imagesNeedingPreflight.length > 0) {
                const preflight = await preflightCurrentImages(imagesNeedingPreflight);
                if (!preflight.ok) {
                    uiAPI.appendSystemMessage(preflight.message);
                    view.requestRender();
                    return;
                }
                for (const image of imagesNeedingPreflight) preflightedImageRefs.add(imageWarningKey(image));
                const unwarnedImages = imagesNeedingPreflight.filter((image) =>
                    !warnedImageRefs.has(imageWarningKey(image))
                );
                const submitWarning = getPreflightWarning(preflight);
                if (submitWarning && unwarnedImages.length > 0) {
                    uiAPI.appendSystemMessage(submitWarning);
                    for (const image of unwarnedImages) warnedImageRefs.add(imageWarningKey(image));
                }
            }
        }
        endBlink();
        view.clearPastedImages();
        editor.setText("");
        if (activeElsewhere) {
            const queued = runtime.queueNextTurnMessage(options.getSessionId(), text, images, {
                deliverWhenAvailable: true,
            });
            if (!queued.queued) {
                restoreQueuedItemToEditor({ text, images });
                uiAPI.appendSystemMessage(
                    `Unable to queue message: ${queued.error || queued.reason || "unknown error"}`,
                    true,
                    "RunWield",
                );
            } else {
                if (userRequest) recordUserInputHistory(editor, userRequest);
            }
            view.requestRender();
            return;
        }
        if (userRequest.startsWith("!")) {
            recordUserInputHistory(editor, userRequest);
            handleBashCommand({
                userRequest,
                sessionRuntime: runtime,
                sessionId: options.getSessionId(),
                concurrent: isProcessingSubmission,
            }).catch(() => {});
            return;
        }
        if (isProcessingSubmission) {
            if (isImmediateBuiltinSlashCommandWhileStreaming(userRequest)) {
                executeUserRequest(userRequest, images).catch((error) => {
                    const message = userTurnFailureMessage(error instanceof Error ? error : String(error));
                    if (message) uiAPI.appendSystemMessage(message, true, "RunWield");
                });
                return;
            }
            if (userRequest.startsWith("/")) {
                queueForNextTurn(userRequest, images);
                return;
            }
            runtime.steerSession(options.getSessionId(), userRequest, images).then((result) => {
                if (!result.queued) queueForNextTurn(userRequest, images);
                view.requestRender();
            }).catch(() => queueForNextTurn(userRequest, images));
            return;
        }
        await processSubmissions({ text, images });
    };
    function cycleThinkingLevel(): void {
        const result = runtime.cycleSessionThinkingLevel(options.getSessionId());
        if (!result.ok || !result.thinkingLevel) return;
        view.requestRender();
        scheduleThinkingLevelPersistence(result.thinkingLevel);
    }
    originalHandleInput = installKeybindings({
        editor,
        tui: view.tui,
        uiAPI,
        pastedImages,
        previewImages,
        generationGuard,
        dismissActivePrompt,
        dequeueLastSubmission,
        recallQueuedSubmissionsToEditor,
        forceResetUI,
        markCtrlCPendingExit: options.markCtrlCPendingExit,
        isCtrlCPendingExit: options.isCtrlCPendingExit,
        requestKeyboardHelp: () => runtime.requestSessionHelp(options.getSessionId()),
        hideKeyboardHelp: () => uiAPI.hideKeyboardHelp?.(),
        cycleThinkingLevel,
        handleImagePaste,
        readClipboardImage,
        cancelRuntimeSession: () => runtime.cancelSession(options.getSessionId()).aborted,
    });
    return {
        isProcessingSubmission: () => isProcessingSubmission,
        forceResetUI,
        restoreQueuedItemToEditor,
        processSubmissions,
        dispose: async () => {
            await flushPendingThinkingLevelPersistence();
        },
    };
}
