import {
    CombinedAutocompleteProvider,
    Container,
    Editor,
    Image,
    Spacer,
    Text,
    truncateToWidth,
    TUI,
    visibleWidth,
} from "@earendil-works/pi-tui";
import {
    applyPersistedTheme,
    getEditorTheme,
    imageTheme,
    initRunWieldTheme,
    onThemeChange,
    theme,
} from "../theme/theme.js";
import { VERSION } from "../../shared/version.js";
import {
    getCachedUpdateAvailabilitySync,
    refreshUpdateCheckCache,
    SYSTEM_UPDATE_CHECK_PORTS,
} from "../../shared/update-check.js";
import { endBlink, renderBootLogo } from "./boot-logo.ts";
import { createUiApi } from "./api.js";
import { SpinnerBlock } from "./blocks.js";
import { type FooterTheme, renderUpdateNoticeLine } from "./chat-footer.ts";
import { installUiApiOverrides } from "./ui-api-overrides.ts";
import { hasClipboardImage } from "./clipboard.ts";
import type { Component } from "@earendil-works/pi-tui";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ImageAttachment } from "../../shared/session/types.js";
import type { UiAPI } from "./types.js";
import {
    composePinnedSessionSidebar,
    isSessionSidebarCycleKey,
    TuiSessionSidebar,
    type TuiSessionSidebarSnapshot,
} from "./session-sidebar.ts";

const SESSION_SIDEBAR_MIN_WIDTH = 132;

export interface ChatViewSessionSnapshot extends TuiSessionSidebarSnapshot {
    cwd: string;
    activeModel: { model?: string | null; provider?: string | null };
}

export interface ChatViewRuntime {
    getSessionSnapshot(sessionId: string): ChatViewSessionSnapshot | null;
}
export interface ChatViewOptions {
    tui: TUI;
    sessionRuntime: ChatViewRuntime;
    getSessionId(): string;
    suppressStartupHeader: boolean;
    setActiveModel(model: string, provider?: string): Promise<{ status: "active" | "deferred"; message?: string }>;
    configureUiAPI?: (uiAPI: UiAPI) => void;
}
export interface ChatView {
    uiAPI: UiAPI;
    tui: TUI;
    editor: Editor;
    container: Container;
    footerContainer: Container;
    messageList: Container;
    validationPanelContainer: Container;
    runningTasksComponent: SpinnerBlock;
    activeInteractionContainer: Container;
    inputAccessoryContainer: Container;
    previewImages: Container;
    pastedImages: ImageAttachment[];
    installAutocompleteProvider(provider: CombinedAutocompleteProvider): void;
    addPastedImagePreview(image: ImageAttachment): void;
    clearPastedImages(): void;
    resetForSessionReplacement(): void;
    focusEditor(): void;
    requestRender(): void;
    dispose(): void;
}

const CLIPBOARD_IMAGE_HINT_TEXT = "Image in clipboard · ctrl+v to paste";

export function renderClipboardImageHintLines(
    clipboardImageAvailable: boolean,
    pastedImageCount: number,
    width: number,
    themeImpl: FooterTheme = theme,
): string[] {
    if (!clipboardImageAvailable || pastedImageCount > 0 || width <= 0) return [];
    const text = truncateToWidth(CLIPBOARD_IMAGE_HINT_TEXT, width);
    const padding = " ".repeat(Math.max(0, width - visibleWidth(text)));
    return [padding + themeImpl.fg("dim" as ThemeColor, text)];
}

export function createPastedImagePreview(image: ImageAttachment): Image {
    return new Image(image.base64, image.mimeType, imageTheme, {
        filename: image.ref || image.path || image.mimeType,
        maxWidthCells: 30,
        maxHeightCells: 10,
    });
}

export function createChatView(options: ChatViewOptions): Promise<ChatView> {
    return createChatViewInternal(options);
}

async function createChatViewInternal(options: ChatViewOptions): Promise<ChatView> {
    initRunWieldTheme();
    await applyPersistedTheme();
    const tui = options.tui;
    const container = new Container();
    if (!options.suppressStartupHeader) {
        const titleLine = `${theme.fg("accent", theme.bold("RunWield ─ Plan-by-Default Harness"))} ${
            theme.fg("dim", `${VERSION}`)
        }`;
        const compactHelp = theme.fg(
            "muted",
            ["? help", "esc interrupt", "ctrl+c clear/exit", "/ commands", "! bash", "ctrl+o tool output"].join(" · "),
        );
        const helpText = new Text(compactHelp, 0, 0);
        const updateNoticeText = new Text("", 0, 0);
        const cachedUpdateAvailability = getCachedUpdateAvailabilitySync(SYSTEM_UPDATE_CHECK_PORTS.clock, {
            currentVersion: VERSION,
        });
        if (cachedUpdateAvailability) {
            if (cachedUpdateAvailability.available) {
                updateNoticeText.setText(renderUpdateNoticeLine(cachedUpdateAvailability.latestVersion));
            }
        } else {
            void refreshUpdateCheckCache({ currentVersion: VERSION }, SYSTEM_UPDATE_CHECK_PORTS).then(
                (availability) => {
                    updateNoticeText.setText(
                        availability.available ? renderUpdateNoticeLine(availability.latestVersion) : "",
                    );
                    tui.requestRender();
                },
            ).catch(() => {});
        }
        renderBootLogo(container);
        container.addChild(new Text(titleLine, 0, 0));
        container.addChild(updateNoticeText);
        container.addChild(helpText);
        container.addChild(new Spacer(1));
        container.addChild(new Spacer(1));
        container.addChild(new Spacer(1));
    }
    const messageList = new Container();
    container.addChild(messageList);
    container.addChild(new Spacer(1));
    const validationPanelContainer = new Container();
    container.addChild(validationPanelContainer);
    const runningTasksComponent = new SpinnerBlock();
    container.addChild(runningTasksComponent);
    const activeInteractionContainer = new Container();
    container.addChild(activeInteractionContainer);
    const composerContainer = new Container();
    const inputAccessoryContainer = new Container();
    composerContainer.addChild(inputAccessoryContainer);
    const queuedInputContainer = new Container();
    composerContainer.addChild(queuedInputContainer);
    const pastedImages: ImageAttachment[] = [];
    let clipboardImageAvailable = false;
    const previewImages = new Container();
    composerContainer.addChild(previewImages);
    const clipboardImageHint: Component = {
        invalidate: () => {},
        render: (w: number) => renderClipboardImageHintLines(clipboardImageAvailable, pastedImages.length, w),
    };
    composerContainer.addChild(clipboardImageHint);
    const editor = new Editor(tui, getEditorTheme());
    composerContainer.addChild(editor);
    const footerContainer = new Container();
    const sessionSidebar = new TuiSessionSidebar(
        options.getSessionId,
        () => options.sessionRuntime.getSessionSnapshot(options.getSessionId()),
    );
    const rootWrapper: Component = {
        invalidate: () => {
            container.invalidate();
            composerContainer.invalidate();
            sessionSidebar.invalidate();
            footerContainer.invalidate();
        },
        render: (w: number) => {
            const availableWidth = Math.max(10, w - 2);
            const snapshot = options.sessionRuntime.getSessionSnapshot(options.getSessionId());
            const bottomDockLines = [
                ...composerContainer.render(availableWidth),
                ...footerContainer.render(availableWidth),
            ];
            if (!snapshot?.managed || availableWidth < SESSION_SIDEBAR_MIN_WIDTH) {
                return [...container.render(availableWidth), ...bottomDockLines];
            }
            const sidebarWidth = Math.min(34, Math.max(28, Math.floor(availableWidth * 0.28)));
            const mainWidth = Math.max(48, availableWidth - sidebarWidth - 1);
            const mainLines = container.render(mainWidth);
            const sidebarLines = sessionSidebar.render(sidebarWidth, snapshot);
            return composePinnedSessionSidebar(mainLines, sidebarLines, mainWidth, tui.terminal.rows, bottomDockLines);
        },
    };
    tui.addChild(rootWrapper);
    const removeSidebarKeyListener = tui.addInputListener((data) => {
        if (!isSessionSidebarCycleKey(data)) return undefined;
        sessionSidebar.cycleTab();
        tui.requestRender();
        return { consume: true };
    });
    tui.setFocus(editor);
    const uiAPI = createUiApi(
        tui,
        messageList,
        runningTasksComponent,
        inputAccessoryContainer,
        validationPanelContainer,
        activeInteractionContainer,
        queuedInputContainer,
    );
    const baseSetManagedSyncStatus = uiAPI.setManagedSyncStatus?.bind(uiAPI);
    uiAPI.setManagedSyncStatus = (state) => {
        baseSetManagedSyncStatus?.(state);
        editor.disableSubmit = state.status === "blocked" || state.status === "degraded";
    };
    installUiApiOverrides({
        uiAPI,
        tui,
        editor,
        container: composerContainer,
        messageList,
        getProjectRoot: () => {
            const snapshot = options.sessionRuntime.getSessionSnapshot(options.getSessionId());
            if (!snapshot) throw new Error("Active runtime session is missing.");
            return snapshot.cwd;
        },
        setActiveModel: options.setActiveModel,
        getActiveModelState: () => {
            const snapshot = options.sessionRuntime.getSessionSnapshot(options.getSessionId());
            if (!snapshot) throw new Error("Active runtime session is missing.");
            return { model: snapshot.activeModel.model || "", provider: snapshot.activeModel.provider || "" };
        },
    });
    options.configureUiAPI?.(uiAPI);
    const basePromptSelect = uiAPI.promptSelect?.bind(uiAPI);
    if (basePromptSelect) {
        uiAPI.promptSelect = async (title, promptOptions, hooks) => {
            const result = await basePromptSelect(title, promptOptions, hooks);
            tui.setFocus(editor);
            tui.requestRender();
            return result;
        };
    }
    const basePromptText = uiAPI.promptText?.bind(uiAPI);
    if (basePromptText) {
        uiAPI.promptText = async (title, promptOptions) => {
            const result = await basePromptText(title, promptOptions);
            tui.setFocus(editor);
            tui.requestRender();
            return result;
        };
    }
    const unsubscribeThemeChange = onThemeChange(() => {
        tui.invalidate();
        tui.requestRender();
    });
    let clipboardCheckInFlight = false;
    async function refreshClipboardImageHint(): Promise<void> {
        if (clipboardCheckInFlight) return;
        clipboardCheckInFlight = true;
        try {
            const nextClipboardImageAvailable = await hasClipboardImage();
            if (nextClipboardImageAvailable !== clipboardImageAvailable) {
                clipboardImageAvailable = nextClipboardImageAvailable;
                tui.requestRender();
            }
        } catch {
            if (clipboardImageAvailable) {
                clipboardImageAvailable = false;
                tui.requestRender();
            }
        } finally {
            clipboardCheckInFlight = false;
        }
    }
    void refreshClipboardImageHint();
    const clipboardPollingInterval = setInterval(() => void refreshClipboardImageHint(), 1500);
    Object.assign(editor, {
        onFocus: () => {
            try {
                tui.requestRender();
            } catch { /* no action */ }
        },
        onBlur: () => {
            try {
                tui.requestRender();
            } catch { /* no action */ }
        },
        onChange: () => {
            try {
                tui.requestRender();
            } catch { /* no action */ }
        },
    });
    return {
        uiAPI,
        tui,
        editor,
        container,
        footerContainer,
        messageList,
        validationPanelContainer,
        runningTasksComponent,
        activeInteractionContainer,
        inputAccessoryContainer,
        previewImages,
        pastedImages,
        installAutocompleteProvider(provider) {
            editor.setAutocompleteProvider(provider);
        },
        addPastedImagePreview(image) {
            pastedImages.push(image);
            previewImages.addChild(createPastedImagePreview(image));
        },
        clearPastedImages() {
            pastedImages.length = 0;
            previewImages.clear();
        },
        resetForSessionReplacement() {
            pastedImages.length = 0;
            previewImages.clear();
            uiAPI.hideKeyboardHelp?.();
            uiAPI.clearValidationPanel?.();
            uiAPI.clearMessages?.();
            editor.setText("");
            tui.setFocus(editor);
            tui.requestRender();
        },
        focusEditor() {
            tui.setFocus(editor);
        },
        requestRender() {
            tui.requestRender();
        },
        dispose() {
            removeSidebarKeyListener();
            clearInterval(clipboardPollingInterval);
            unsubscribeThemeChange();
            endBlink();
        },
    };
}
