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
 * }} deps
 */
export function createTuiManager({
    TerminalCtor,
    TuiCtor,
    installCrashGuards,
    uninstallCrashGuards,
    restoreTitle = defaultRestoreTitle,
}) {
    /** @type {any | null} */
    let tuiInstance = null;
    /** @type {any | null} */
    let terminalInstance = null;

    function initTUI() {
        if (tuiInstance) return tuiInstance;
        terminalInstance = new TerminalCtor();
        tuiInstance = new TuiCtor(terminalInstance);
        tuiInstance.start();
        installCrashGuards();
        return tuiInstance;
    }

    function getTUI() {
        if (!tuiInstance || !terminalInstance) {
            throw new Error("TUI not initialized. Call initTUI() first.");
        }
        return { tui: tuiInstance, terminal: terminalInstance };
    }

    function stopTUI() {
        restoreTitle();
        uninstallCrashGuards();
        if (tuiInstance) {
            if (typeof tuiInstance.stop === "function") {
                tuiInstance.stop();
            }
            tuiInstance = null;
            terminalInstance = null;
        }
    }

    return { initTUI, getTUI, stopTUI };
}
