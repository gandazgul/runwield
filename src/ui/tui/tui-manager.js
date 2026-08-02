/**
 * @module ui/tui/tui-manager
 * Injectable TUI singleton lifecycle.
 */

/**
 * Restore the terminal window/tab title to its default by writing an empty
 * OSC 0 sequence (`\x1b]0;\x07`). Most terminal emulators interpret this as
 * "reset to default title".
 */
function defaultRestoreTitle() {
    try {
        Deno.stdout.writeSync(new TextEncoder().encode("\x1b]0;\x07"));
    } catch (_e) {
        // Terminal title restoration is cosmetic — never crash on it.
    }
}

/**
 * @param {{
 *     TerminalCtor: new () => any,
 *     TuiCtor: new (terminal: any) => any,
 *     installCrashGuards: () => void,
 *     uninstallCrashGuards: () => void,
 *     restoreTitle?: () => void,
 *     installFocusState?: (terminal: any) => { dispose: () => void },
 * }} deps
 */
export function createTuiManager({
    TerminalCtor,
    TuiCtor,
    installCrashGuards,
    uninstallCrashGuards,
    restoreTitle = defaultRestoreTitle,
    installFocusState,
}) {
    /** @type {any | null} */
    let tuiInstance = null;
    /** @type {any | null} */
    let terminalInstance = null;
    let started = false;
    let crashGuardsInstalled = false;
    /** @type {{ dispose: () => void } | null} */
    let focusStateOwner = null;

    /**
     * @param {{ terminal: any, tui: any }} pair
     * @param {{ installFocusState?: boolean }} [options]
     */
    function startPair(pair, options = {}) {
        terminalInstance = pair.terminal;
        if (options.installFocusState && typeof installFocusState === "function") {
            focusStateOwner = installFocusState(terminalInstance);
        }
        tuiInstance = pair.tui;
        try {
            if (typeof tuiInstance.start === "function") {
                tuiInstance.start();
            }
            started = true;
            installCrashGuards();
            crashGuardsInstalled = true;
            return tuiInstance;
        } catch (error) {
            if (crashGuardsInstalled) {
                try {
                    uninstallCrashGuards();
                } catch {
                    // Preserve the original construction/start failure.
                }
            }
            try {
                if (typeof tuiInstance?.stop === "function") tuiInstance.stop();
            } catch {
                // Preserve the original construction/start failure.
            }
            try {
                focusStateOwner?.dispose();
            } catch {
                // Preserve the original construction/start failure.
            }
            focusStateOwner = null;
            tuiInstance = null;
            terminalInstance = null;
            started = false;
            crashGuardsInstalled = false;
            throw error;
        }
    }

    function initTUI() {
        if (tuiInstance) return tuiInstance;
        const terminal = new TerminalCtor();
        const tui = new TuiCtor(terminal);
        return startPair({ terminal, tui }, { installFocusState: true });
    }

    /**
     * Install an explicit Terminal/TUI pair, primarily for deterministic tests.
     *
     * @param {{ terminal: any, tui: any }} pair
     */
    function initTUIWithPair(pair) {
        if (tuiInstance) return tuiInstance;
        return startPair(pair);
    }

    function getTUI() {
        if (!tuiInstance || !terminalInstance) {
            throw new Error("TUI not initialized. Call initTUI() first.");
        }
        return { tui: tuiInstance, terminal: terminalInstance };
    }

    function stopTUI() {
        try {
            restoreTitle();
        } catch {
            // Terminal title restoration is best effort.
        }
        if (crashGuardsInstalled) {
            try {
                uninstallCrashGuards();
            } finally {
                crashGuardsInstalled = false;
            }
        }
        const tui = tuiInstance;
        const focusState = focusStateOwner;
        tuiInstance = null;
        terminalInstance = null;
        focusStateOwner = null;
        const wasStarted = started;
        started = false;
        try {
            focusState?.dispose();
        } catch {
            // Focus reporting cleanup is best effort.
        }
        if (tui && wasStarted && typeof tui.stop === "function") {
            tui.stop();
        }
    }

    return { initTUI, initTUIWithPair, getTUI, stopTUI };
}
