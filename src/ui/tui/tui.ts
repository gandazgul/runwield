/**
 * @module ui/tui/tui
 * TUI singleton manager.
 */

import { ProcessTerminal, type Terminal, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { createTuiCrashGuards } from "./tui-crash-guards.ts";
import { createTuiManager } from "./tui-manager.ts";
import { cleanupAgentBrowserSessionSync } from "../../shared/agent-browser-session.ts";

export interface TuiPair {
    terminal: Terminal;
    tui: TUI;
}

const tuiManager = createTuiManager<Terminal, TUI>({
    TerminalCtor: ProcessTerminal,
    TuiCtor: TuiMainScreen as new (terminal: Terminal) => TUI,
    installCrashGuards: () => crashGuards.install(),
    uninstallCrashGuards: () => crashGuards.uninstall(),
});

const crashGuards = createTuiCrashGuards({
    stop: () => tuiManager.stopTUI(),
    eventTarget: globalThis,
    signalRuntime: Deno,
    os: Deno.build.os,
    exit: Deno.exit,
    cleanup: cleanupAgentBrowserSessionSync,
});

/** Initialize the TUI singleton if it is not already running. */
export function initTUI(): TUI {
    return tuiManager.initTUI();
}

/** Install an explicit Terminal/TUI pair for deterministic composition tests. */
export function initTUIWithPair(pair: TuiPair): TUI {
    return tuiManager.initTUIWithPair(pair);
}

/** Get the current TUI instance and terminal. */
export function getTUI(): TuiPair {
    return tuiManager.getTUI();
}

/** Stop the TUI and clean up terminal state. */
export function stopTUI(): void {
    tuiManager.stopTUI();
}
