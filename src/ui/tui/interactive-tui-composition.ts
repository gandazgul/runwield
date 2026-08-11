import { TUI } from "@earendil-works/pi-tui";
import { endBlink } from "./boot-logo.ts";
import { getTUI, initTUIWithPair, stopTUI } from "./tui.js";
import {
    type InteractiveLifecycleHandle,
    type SessionRuntime,
    startInteractiveSession,
    type StartInteractiveSessionOptions,
} from "./chat-session.ts";
interface ScreenTextTerminal {
    getScreenText(): string;
}
import type { UiAPI } from "./types.js";

export interface InteractiveTuiComposition {
    uiAPI: UiAPI;
    runtime: SessionRuntime;
    sessionId: string;
    tui: TUI;
    terminal: ReturnType<typeof getTUI>["terminal"];
    waitForIdle(timeoutMs?: number): Promise<void>;
    dispose(): Promise<void>;
}

export async function createInteractiveTuiComposition(
    initialUserRequest: string | null,
    options: StartInteractiveSessionOptions,
): Promise<InteractiveTuiComposition> {
    let runtime: SessionRuntime | null = null;
    let sessionId: string | null = null;
    let uiAPI: UiAPI | null = null;
    let lifecycleHandle: InteractiveLifecycleHandle | null = null;
    async function cleanupCompositionState(): Promise<void> {
        try {
            await lifecycleHandle?.dispose();
            if (!lifecycleHandle) {
                uiAPI?.dispose?.();
                runtime?.closeAllSessions?.();
            }
        } finally {
            endBlink();
            stopTUI();
        }
    }
    try {
        if (options.terminal) {
            const terminalPair = options.terminal as ConstructorParameters<typeof TUI>[0];
            initTUIWithPair({ terminal: terminalPair, tui: new TUI(terminalPair) });
        }
        uiAPI = await startInteractiveSession(initialUserRequest, {
            ...options,
            onLifecycleReady: (handle) => {
                lifecycleHandle = handle;
                options.onLifecycleReady?.(handle);
            },
            onSessionReady: (readySessionId, readyRuntime) => {
                sessionId = readySessionId;
                runtime = readyRuntime;
                options.onSessionReady?.(readySessionId, readyRuntime);
            },
            onSessionReplaced: (readySessionId, readyRuntime) => {
                sessionId = readySessionId;
                runtime = readyRuntime;
                options.onSessionReplaced?.(readySessionId, readyRuntime);
            },
        });
        if (!runtime || !sessionId) throw new Error("Interactive TUI composition did not report a Runtime session.");
    } catch (error) {
        await cleanupCompositionState();
        throw error;
    }
    const { tui, terminal } = getTUI();
    let disposed = false;
    return {
        uiAPI,
        runtime,
        get sessionId() {
            if (!sessionId) throw new Error("Interactive TUI composition does not have an active session.");
            return sessionId;
        },
        tui,
        terminal,
        async waitForIdle(timeoutMs = 2000) {
            const startedAt = Date.now();
            let stableSamples = 0;
            let previousScreen = "";
            while (Date.now() - startedAt < timeoutMs) {
                const snapshot = runtime?.getSessionSnapshot(sessionId || "");
                const screen = terminal && "getScreenText" in terminal
                    ? (terminal as ScreenTextTerminal).getScreenText()
                    : "";
                if (!snapshot?.busy && screen === previousScreen) {
                    stableSamples += 1;
                    if (stableSamples >= 3) return;
                } else {
                    stableSamples = 0;
                    previousScreen = screen;
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            throw new Error(`Timed out waiting for TUI composition idle after ${timeoutMs}ms.`);
        },
        async dispose() {
            if (disposed) return;
            disposed = true;
            await cleanupCompositionState();
        },
    };
}
