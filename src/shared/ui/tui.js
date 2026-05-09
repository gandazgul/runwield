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
    installCrashGuards();
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
    uninstallCrashGuards();
    if (tuiInstance) {
        if (typeof tuiInstance.stop === "function") {
            tuiInstance.stop();
        }
        tuiInstance = null;
        terminalInstance = null;
    }
}

// pi-tui puts the terminal into raw mode, bracketed-paste, and Kitty keyboard
// protocol. If the process dies without TUI.stop() those modes leak and the
// terminal becomes unusable (bell + escape sequences on every keystroke).
// These guards run stopTUI() on signals and unhandled errors so the terminal
// is always restored before the process exits.

let crashGuardsInstalled = false;

const onUnhandledRejection = () => {
    try {
        stopTUI();
    } catch (_e) { /* ignore */ }
};

const onUncaughtError = () => {
    try {
        stopTUI();
    } catch (_e) { /* ignore */ }
};

/** @param {"SIGINT"|"SIGTERM"|"SIGHUP"} signal */
function makeSignalHandler(signal) {
    return () => {
        try {
            stopTUI();
        } catch (_e) { /* ignore */ }
        const code = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129;
        Deno.exit(code);
    };
}

const onSigint = makeSignalHandler("SIGINT");
const onSigterm = makeSignalHandler("SIGTERM");
const onSighup = makeSignalHandler("SIGHUP");

function installCrashGuards() {
    if (crashGuardsInstalled) return;
    globalThis.addEventListener("unhandledrejection", onUnhandledRejection);
    globalThis.addEventListener("error", onUncaughtError);
    try {
        Deno.addSignalListener("SIGINT", onSigint);
        Deno.addSignalListener("SIGTERM", onSigterm);
        if (Deno.build.os !== "windows") {
            Deno.addSignalListener("SIGHUP", onSighup);
        }
    } catch (_e) { /* signal listeners unavailable on some platforms */ }
    crashGuardsInstalled = true;
}

function uninstallCrashGuards() {
    if (!crashGuardsInstalled) return;
    globalThis.removeEventListener("unhandledrejection", onUnhandledRejection);
    globalThis.removeEventListener("error", onUncaughtError);
    try {
        Deno.removeSignalListener("SIGINT", onSigint);
        Deno.removeSignalListener("SIGTERM", onSigterm);
        if (Deno.build.os !== "windows") {
            Deno.removeSignalListener("SIGHUP", onSighup);
        }
    } catch (_e) { /* ignore */ }
    crashGuardsInstalled = false;
}
