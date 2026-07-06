/**
 * @module ui/tui/tui
 * TUI Singleton Manager
 */

import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import { createTuiCrashGuards } from "./tui-crash-guards.js";
import { createTuiManager } from "./tui-manager.js";

const tuiManager = createTuiManager({
    TerminalCtor: ProcessTerminal,
    TuiCtor: TUI,
    installCrashGuards: () => crashGuards.install(),
    uninstallCrashGuards: () => crashGuards.uninstall(),
});

const crashGuards = createTuiCrashGuards({
    stop: () => tuiManager.stopTUI(),
});

/**
 * Initialize the TUI singleton if not already running.
 * @returns {TUI}
 */
export function initTUI() {
    return tuiManager.initTUI();
}

/**
 * Get the current TUI instance.
 * @returns {{ tui: TUI, terminal: ProcessTerminal }}
 */
export function getTUI() {
    return tuiManager.getTUI();
}

/**
 * Stop the TUI and clean up terminal state.
 */
export function stopTUI() {
    tuiManager.stopTUI();
}
