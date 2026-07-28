import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
    buildActivationCommand,
    buildAppleTerminalActivationScript,
    buildExactActivationCommand,
    buildITermActivationScript,
    buildNotificationCommand,
    detectTerminalIdentity,
    inferTerminalSenderBundleId,
    notifyRunWieldEvent,
    resolveNotificationSettings,
} from "./system-notifications.js";

/**
 * @param {Record<string, boolean | "fail">} existingCommands
 * @returns {{ calls: Array<{ cmd: string, args: string[] }>, runCommand: (cmd: string, args?: string[]) => Promise<{ success: boolean, stdout: string, stderr: string }> }}
 */
function makeCommandRecorder(existingCommands = {}) {
    /** @type {Array<{ cmd: string, args: string[] }>} */
    const calls = [];
    return {
        calls,
        runCommand(cmd, args = []) {
            calls.push({ cmd, args });
            if (cmd === "command" && args[0] === "-v") {
                const exists = existingCommands[args[1]] === true || existingCommands[args[1]] === "fail";
                return Promise.resolve({ success: exists, stdout: exists ? `/usr/bin/${args[1]}\n` : "", stderr: "" });
            }
            if (cmd === "tty") {
                return Promise.resolve({ success: true, stdout: "/dev/ttys123\n", stderr: "" });
            }
            return Promise.resolve({ success: existingCommands[cmd] !== "fail", stdout: "", stderr: "" });
        },
    };
}

/**
 * @param {{ throwOnWrite?: boolean }} [options]
 * @returns {{ writes: number[][], writeTerminal: (bytes: Uint8Array) => void }}
 */
function makeTerminalWriter(options = {}) {
    /** @type {number[][]} */
    const writes = [];
    return {
        writes,
        writeTerminal(bytes) {
            writes.push([...bytes]);
            if (options.throwOnWrite) {
                throw new Error("bell failed");
            }
        },
    };
}

Deno.test("resolveNotificationSettings defaults on and normalizes malformed values", () => {
    assertEquals(resolveNotificationSettings(undefined), {
        enabled: true,
        activation: "tab",
        events: {
            agentStopped: true,
            planWritten: true,
            userInterview: true,
            compactionFinished: true,
        },
        terminalBell: true,
    });

    assertEquals(
        resolveNotificationSettings({ enabled: false, activation: "invalid", events: { planWritten: false } }),
        {
            enabled: false,
            activation: "tab",
            events: {
                agentStopped: true,
                planWritten: false,
                userInterview: true,
                compactionFinished: true,
            },
            terminalBell: true,
        },
    );

    assertEquals(
        resolveNotificationSettings({ terminalBell: false }),
        {
            enabled: true,
            activation: "tab",
            events: {
                agentStopped: true,
                planWritten: true,
                userInterview: true,
                compactionFinished: true,
            },
            terminalBell: false,
        },
    );
});

Deno.test("detectTerminalIdentity captures tty and terminal environment", async () => {
    const commands = makeCommandRecorder();
    const identity = await detectTerminalIdentity("demo", {
        os: "darwin",
        env: {
            TERM_PROGRAM: "iTerm.app",
            TERM: "xterm-256color",
            ITERM_SESSION_ID: "w0t0p0",
        },
        pid: 42,
        getMergedCustomSetting: () => undefined,
        runCommand: commands.runCommand,
        writeTerminal: () => {},
    });

    assertEquals(identity.sessionLabel, "demo");
    assertEquals(identity.terminalTitle, "wld - demo");
    assertEquals(identity.tty, "/dev/ttys123");
    assertEquals(identity.termProgram, "iTerm.app");
    assertEquals(identity.itermSessionId, "w0t0p0");
    assertEquals(identity.pid, 42);
});

Deno.test("buildExactActivationCommand prefers terminal-specific exact focus", () => {
    assertEquals(
        buildExactActivationCommand({ sessionLabel: "s", terminalTitle: "wld - s", weztermPane: "9" }),
        "wezterm cli activate-pane --pane-id '9'",
    );

    assertEquals(
        buildExactActivationCommand({
            sessionLabel: "s",
            terminalTitle: "wld - s",
            term: "xterm-kitty",
            kittyListenOn: "unix:/tmp/kitty",
            kittyWindowId: "11",
        }),
        "kitty @ --to 'unix:/tmp/kitty' focus-window --match 'id:11'",
    );

    const itermCommand = buildExactActivationCommand({
        sessionLabel: "s",
        terminalTitle: "wld - s",
        termProgram: "iTerm.app",
        tty: "/dev/ttys123",
    });
    assert(itermCommand);
    assertStringIncludes(itermCommand, "iTerm2");
    assertStringIncludes(itermCommand, "/dev/ttys123");

    const terminalCommand = buildExactActivationCommand({
        sessionLabel: "s",
        terminalTitle: "wld - s",
        termProgram: "Apple_Terminal",
        tty: "/dev/ttys123",
    });
    assert(terminalCommand);
    assertStringIncludes(terminalCommand, "Terminal");
    assertStringIncludes(terminalCommand, "/dev/ttys123");
});

Deno.test("buildActivationCommand falls back to app activation when exact tab activation is unavailable", () => {
    assertEquals(
        buildActivationCommand({ sessionLabel: "s", terminalTitle: "wld - s", term: "xterm-kitty" }, "tab"),
        "osascript -e 'tell application \"kitty\" to activate'",
    );
    assertEquals(
        buildActivationCommand({ sessionLabel: "s", terminalTitle: "wld - s", term: "xterm-kitty" }, "none"),
        null,
    );
});

Deno.test("activation scripts look for matching tty", () => {
    assertStringIncludes(buildAppleTerminalActivationScript("/dev/ttys123"), 'tty of t is "/dev/ttys123"');
    assertStringIncludes(buildITermActivationScript("/dev/ttys123"), 'tty of s is "/dev/ttys123"');
});

Deno.test("inferTerminalSenderBundleId maps reliable notification sender terminal apps", () => {
    assertEquals(
        inferTerminalSenderBundleId({ sessionLabel: "s", terminalTitle: "wld - s", termProgram: "iTerm.app" }),
        "com.googlecode.iterm2",
    );
    assertEquals(
        inferTerminalSenderBundleId({ sessionLabel: "s", terminalTitle: "wld - s", termProgram: "Apple_Terminal" }),
        "com.apple.Terminal",
    );
    assertEquals(
        inferTerminalSenderBundleId({ sessionLabel: "s", terminalTitle: "wld - s", term: "xterm-kitty" }),
        null,
    );
    assertEquals(inferTerminalSenderBundleId({ sessionLabel: "s", terminalTitle: "wld - s" }), null);
});

Deno.test("buildNotificationCommand uses terminal-notifier with click execute when available", async () => {
    const commands = makeCommandRecorder({ "terminal-notifier": true, osascript: true });
    const command = await buildNotificationCommand({
        eventName: "agentStopped",
        title: "Agent stopped — demo",
        message: "The agent stopped.\nSession: wld - demo",
        terminal: {
            sessionLabel: "demo",
            terminalTitle: "wld - demo",
            termProgram: "Apple_Terminal",
            tty: "/dev/ttys123",
        },
        settings: resolveNotificationSettings(undefined),
    }, {
        os: "darwin",
        env: {},
        pid: 1,
        getMergedCustomSetting: () => undefined,
        runCommand: commands.runCommand,
        writeTerminal: () => {},
    });

    assert(command);
    assertEquals(command.cmd, "terminal-notifier");
    assert(command.args.includes("-execute"));
    assert(command.args.includes("-message"));
    assertEquals(command.args.includes("-sound"), false);
    assertEquals(command.args[command.args.indexOf("-group") + 1], "runwield-agentStopped-demo");
    assertStringIncludes(command.args[command.args.indexOf("-execute") + 1], "/dev/ttys123");
    assertEquals(command.args[command.args.indexOf("-sender") + 1], "com.apple.Terminal");
});

Deno.test("buildNotificationCommand falls back to osascript notification", async () => {
    const commands = makeCommandRecorder({ "terminal-notifier": true, osascript: true });
    const command = await buildNotificationCommand({
        eventName: "userInterview",
        title: "Input requested — demo",
        message: "Question waiting.\nSession: wld - demo",
        terminal: { sessionLabel: "demo", terminalTitle: "wld - demo", term: "xterm-kitty" },
        settings: resolveNotificationSettings(undefined),
    }, {
        os: "darwin",
        env: {},
        pid: 1,
        getMergedCustomSetting: () => undefined,
        runCommand: commands.runCommand,
        writeTerminal: () => {},
    });

    assert(command);
    assertEquals(command.cmd, "osascript");
    assertStringIncludes(command.args.join(" "), "display notification");
    assertEquals(command.args.join(" ").includes("beep"), false);
    assertEquals(command.args.join(" ").includes("sound"), false);
});

Deno.test("notifyRunWieldEvent emits terminal bell on non-macOS and respects disabled events", async () => {
    const unsupportedCommands = makeCommandRecorder();
    const unsupportedBell = makeTerminalWriter();
    const unsupported = await notifyRunWieldEvent("agentStopped", {
        sessionName: "demo",
        __deps: {
            os: "linux",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => undefined,
            runCommand: unsupportedCommands.runCommand,
            writeTerminal: unsupportedBell.writeTerminal,
        },
    });
    assertEquals(unsupported.sent, false);
    assertEquals(unsupported.reason, "unsupported");
    assertEquals(unsupported.terminalBellEmitted, true);
    assertEquals(unsupportedBell.writes, [[7]]);
    assertEquals(unsupportedCommands.calls.filter((call) => call.cmd === "tty").length, 1);

    const disabledCommands = makeCommandRecorder({ osascript: true });
    const disabledBell = makeTerminalWriter();
    const disabled = await notifyRunWieldEvent("planWritten", {
        sessionName: "demo",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => ({ events: { planWritten: false } }),
            runCommand: disabledCommands.runCommand,
            writeTerminal: disabledBell.writeTerminal,
        },
    });
    assertEquals(disabled.sent, false);
    assertEquals(disabled.reason, "event_disabled");
    assertEquals(disabled.terminalBellEmitted, false);
    assertEquals(disabledBell.writes, []);
    assertEquals(disabledCommands.calls, []);
});

Deno.test("notifyRunWieldEvent falls back to osascript when terminal-notifier command fails", async () => {
    const commands = makeCommandRecorder({ "terminal-notifier": "fail", osascript: true });
    const bell = makeTerminalWriter();
    const result = await notifyRunWieldEvent("agentStopped", {
        sessionName: "demo",
        __deps: {
            os: "darwin",
            env: { TERM_PROGRAM: "Apple_Terminal" },
            pid: 1,
            getMergedCustomSetting: () => undefined,
            runCommand: commands.runCommand,
            writeTerminal: bell.writeTerminal,
        },
    });

    assertEquals(result.sent, true);
    assertEquals(result.reason, "sent:terminal_notifier_failed");
    assertEquals(result.command?.cmd, "osascript");
    assertEquals(result.terminalBellEmitted, true);
    assertEquals(bell.writes, [[7]]);
    assertEquals(result.command?.args.join(" ").includes("beep"), false);
    assertEquals(result.command?.args.join(" ").includes("sound"), false);
});

Deno.test("notifyRunWieldEvent terminalBell false preserves desktop delivery", async () => {
    const commands = makeCommandRecorder({ osascript: true });
    const bell = makeTerminalWriter();
    const result = await notifyRunWieldEvent("userInterview", {
        sessionName: "silent bell",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => ({ activation: "none", terminalBell: false }),
            runCommand: commands.runCommand,
            writeTerminal: bell.writeTerminal,
        },
    });

    assertEquals(result.sent, true);
    assertEquals(result.reason, "sent");
    assertEquals(result.command?.cmd, "osascript");
    assertEquals(result.terminalBellEmitted, false);
    assertEquals(bell.writes, []);
});

Deno.test("notifyRunWieldEvent sends compaction finished notification with session context", async () => {
    const commands = makeCommandRecorder({ osascript: true });
    const bell = makeTerminalWriter();
    const result = await notifyRunWieldEvent("compactionFinished", {
        sessionName: "compact session",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => ({ activation: "none" }),
            runCommand: commands.runCommand,
            writeTerminal: bell.writeTerminal,
        },
    });

    assertEquals(result.sent, true);
    assertEquals(result.command?.cmd, "osascript");
    assertStringIncludes(result.title, "Compaction finished");
    assertStringIncludes(result.title, "compact session");
    assertStringIncludes(result.message, "The /compact command finished. Return to view the result.");
    assertStringIncludes(result.message, "wld - compact session");
    assertEquals(result.terminalBellEmitted, true);
    assertEquals(bell.writes, [[7]]);
});

Deno.test("notifyRunWieldEvent disables compaction finished independently", async () => {
    const commands = makeCommandRecorder({ osascript: true });
    const bell = makeTerminalWriter();
    const result = await notifyRunWieldEvent("compactionFinished", {
        sessionName: "disabled compact",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => ({ events: { compactionFinished: false } }),
            runCommand: commands.runCommand,
            writeTerminal: bell.writeTerminal,
        },
    });

    assertEquals(result.sent, false);
    assertEquals(result.reason, "event_disabled");
    assertEquals(result.terminalBellEmitted, false);
    assertEquals(bell.writes, []);
    assertEquals(commands.calls, []);
});

Deno.test("notifyRunWieldEvent skips bell, tty lookup, and desktop attempts for disabled or unknown events", async () => {
    const disabledCommands = makeCommandRecorder({ osascript: true });
    const disabledBell = makeTerminalWriter();
    const disabled = await notifyRunWieldEvent("agentStopped", {
        sessionName: "disabled",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => ({ enabled: false }),
            runCommand: disabledCommands.runCommand,
            writeTerminal: disabledBell.writeTerminal,
        },
    });

    assertEquals(disabled.reason, "disabled");
    assertEquals(disabled.terminalBellEmitted, false);
    assertEquals(disabledBell.writes, []);
    assertEquals(disabledCommands.calls, []);

    const unknownCommands = makeCommandRecorder({ osascript: true });
    const unknownBell = makeTerminalWriter();
    const unknown = await notifyRunWieldEvent(/** @type {any} */ ("unknown"), {
        sessionName: "unknown",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => undefined,
            runCommand: unknownCommands.runCommand,
            writeTerminal: unknownBell.writeTerminal,
        },
    });

    assertEquals(unknown.reason, "unknown_event");
    assertEquals(unknown.terminalBellEmitted, false);
    assertEquals(unknownBell.writes, []);
    assertEquals(unknownCommands.calls, []);
});

Deno.test("notifyRunWieldEvent isolates terminal bell write failures from desktop delivery", async () => {
    const commands = makeCommandRecorder({ osascript: true });
    const bell = makeTerminalWriter({ throwOnWrite: true });
    const result = await notifyRunWieldEvent("planWritten", {
        sessionName: "bell failure",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => ({ activation: "none" }),
            runCommand: commands.runCommand,
            writeTerminal: bell.writeTerminal,
        },
    });

    assertEquals(result.sent, true);
    assertEquals(result.reason, "sent");
    assertEquals(result.terminalBellEmitted, false);
    assertEquals(bell.writes, [[7]]);
});

Deno.test("notifyRunWieldEvent includes session and agent context in sent notification", async () => {
    const commands = makeCommandRecorder({ osascript: true });
    const bell = makeTerminalWriter();
    const result = await notifyRunWieldEvent("userInterview", {
        sessionName: "feature x",
        agentName: "Planner",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => ({ activation: "none" }),
            runCommand: commands.runCommand,
            writeTerminal: bell.writeTerminal,
        },
    });

    assertEquals(result.sent, true);
    assertEquals(result.command?.cmd, "osascript");
    assertStringIncludes(result.title, "Planner");
    assertStringIncludes(result.title, "feature x");
    assertStringIncludes(result.message, "wld - feature x");
    assertEquals(result.terminalBellEmitted, true);
    assertEquals(bell.writes, [[7]]);
});
