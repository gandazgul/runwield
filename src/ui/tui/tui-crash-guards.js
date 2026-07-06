/**
 * @module ui/tui/tui-crash-guards
 * Injectable crash guards for restoring terminal state on abrupt exits.
 */

/**
 * @typedef {{
 *     addSignalListener: (signal: "SIGINT" | "SIGTERM" | "SIGHUP", handler: () => void) => void,
 *     removeSignalListener: (signal: "SIGINT" | "SIGTERM" | "SIGHUP", handler: () => void) => void,
 * }} SignalRuntime
 */

/**
 * @typedef {{
 *     addEventListener: (type: string, handler: () => void) => void,
 *     removeEventListener: (type: string, handler: () => void) => void,
 * }} EventRuntime
 */

/**
 * @param {{
 *     stop: () => void,
 *     eventTarget?: EventRuntime,
 *     signalRuntime?: SignalRuntime,
 *     os?: string,
 *     exit?: (code: number) => never,
 * }} deps
 */
export function createTuiCrashGuards({
    stop,
    eventTarget = globalThis,
    signalRuntime = Deno,
    os = Deno.build.os,
    exit = Deno.exit,
}) {
    let installed = false;

    function safeStop() {
        try {
            stop();
        } catch (_e) {
            // Terminal restoration is best-effort during process failure paths.
        }
    }

    const onUnhandledRejection = () => {
        safeStop();
    };

    const onUncaughtError = () => {
        safeStop();
    };

    /** @param {"SIGINT"|"SIGTERM"|"SIGHUP"} signal */
    function makeSignalHandler(signal) {
        return () => {
            safeStop();
            const code = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129;
            exit(code);
        };
    }

    const onSigint = makeSignalHandler("SIGINT");
    const onSigterm = makeSignalHandler("SIGTERM");
    const onSighup = makeSignalHandler("SIGHUP");

    function install() {
        if (installed) return;
        eventTarget.addEventListener("unhandledrejection", onUnhandledRejection);
        eventTarget.addEventListener("error", onUncaughtError);
        try {
            signalRuntime.addSignalListener("SIGINT", onSigint);
            signalRuntime.addSignalListener("SIGTERM", onSigterm);
            if (os !== "windows") {
                signalRuntime.addSignalListener("SIGHUP", onSighup);
            }
        } catch (_e) {
            // Signal listeners are unavailable in some runtimes and tests.
        }
        installed = true;
    }

    function uninstall() {
        if (!installed) return;
        eventTarget.removeEventListener("unhandledrejection", onUnhandledRejection);
        eventTarget.removeEventListener("error", onUncaughtError);
        try {
            signalRuntime.removeSignalListener("SIGINT", onSigint);
            signalRuntime.removeSignalListener("SIGTERM", onSigterm);
            if (os !== "windows") {
                signalRuntime.removeSignalListener("SIGHUP", onSighup);
            }
        } catch (_e) {
            // Removal is also best-effort when the process is already failing.
        }
        installed = false;
    }

    /** @returns {boolean} */
    function isInstalled() {
        return installed;
    }

    return { install, uninstall, isInstalled };
}
