/**
 * @module shared/ui/tui
 * TUI Singleton Manager
 */

import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";

/** @type {TUI | null} */
let tuiInstance = null;
/** @type {ProcessTerminal | null} */
let terminalInstance = null;

/**
 * Initialize the TUI singleton if not already running.
 * @returns {TUI}
 */
export function initTUI() {
    if (tuiInstance) return tuiInstance;
    terminalInstance = new ProcessTerminal();
    tuiInstance = new TUI(terminalInstance);
    tuiInstance.start();
    return tuiInstance;
}

/**
 * Get the current TUI instance.
 * @returns {{ tui: TUI, terminal: ProcessTerminal }}
 */
export function getTUI() {
    if (!tuiInstance || !terminalInstance) {
        throw new Error("TUI not initialized. Call initTUI() first.");
    }
    return { tui: tuiInstance, terminal: terminalInstance };
}

/**
 * Stop the TUI and clean up terminal state.
 */
export function stopTUI() {
    if (tuiInstance) {
        // Attempt to stop TUI if method exists
        if (typeof tuiInstance.stop === "function") {
            tuiInstance.stop();
        }
        tuiInstance = null;
        terminalInstance = null;
    }
}
