/**
 * @module ui/tui/tui
 * TUI Singleton Manager
 */

import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import { createTuiCrashGuards } from "./tui-crash-guards.js";
import { createTuiManager } from "./tui-manager.js";
import { installTerminalFocusState } from "./terminal-focus-state.ts";

const tuiManager = createTuiManager({
    TerminalCtor: ProcessTerminal,
    TuiCtor: TUI,
    installCrashGuards: () => crashGuards.install(),
    uninstallCrashGuards: () => crashGuards.uninstall(),
    installFocusState: installProductionTerminalFocusState,
});

const crashGuards = createTuiCrashGuards({
    stop: () => tuiManager.stopTUI(),
});

/** @param {{ write(data: string): void, start(onInput: (data: string) => void, onResize?: (size: { columns: number, rows: number }) => void): void }} terminal */
function installProductionTerminalFocusState(terminal) {
    if (Deno.env.get("WLD_GOLDEN_TUI") || Deno.env.get("WLD_GOLDEN_TUI_CHILD")) {
        return { dispose() {} };
    }
    return installTerminalFocusState(terminal);
}

/**
 * Initialize the TUI singleton if not already running.
 * @returns {TUI}
 */
export function initTUI() {
    return tuiManager.initTUI();
}

/**
 * Install an explicit Terminal/TUI pair for deterministic composition tests.
 * Production callers should continue to use initTUI().
 *
 * @param {{ terminal: any, tui: TUI }} pair
 * @returns {TUI}
 */
export function initTUIWithPair(pair) {
    return tuiManager.initTUIWithPair(pair);
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
