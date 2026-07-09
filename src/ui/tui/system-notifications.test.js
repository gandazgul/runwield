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

Deno.test("resolveNotificationSettings defaults on and normalizes malformed values", () => {
    assertEquals(resolveNotificationSettings(undefined), {
        enabled: true,
        activation: "tab",
        events: {
            agentStopped: true,
            planWritten: true,
            userInterview: true,
        },
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
            },
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
    });

    assert(command);
    assertEquals(command.cmd, "terminal-notifier");
    assert(command.args.includes("-execute"));
    assert(command.args.includes("-message"));
    assertStringIncludes(command.args[command.args.indexOf("-group") + 1], "runwield-agentStopped-");
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
    });

    assert(command);
    assertEquals(command.cmd, "osascript");
    assertStringIncludes(command.args.join(" "), "display notification");
});

Deno.test("notifyRunWieldEvent returns unsupported on non-macOS and respects disabled events", async () => {
    const unsupported = await notifyRunWieldEvent("agentStopped", {
        sessionName: "demo",
        __deps: {
            os: "linux",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => undefined,
            runCommand: makeCommandRecorder().runCommand,
        },
    });
    assertEquals(unsupported.sent, false);
    assertEquals(unsupported.reason, "unsupported");

    const disabled = await notifyRunWieldEvent("planWritten", {
        sessionName: "demo",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => ({ events: { planWritten: false } }),
            runCommand: makeCommandRecorder({ osascript: true }).runCommand,
        },
    });
    assertEquals(disabled.sent, false);
    assertEquals(disabled.reason, "event_disabled");
});

Deno.test("notifyRunWieldEvent falls back to osascript when terminal-notifier command fails", async () => {
    const commands = makeCommandRecorder({ "terminal-notifier": "fail", osascript: true });
    const result = await notifyRunWieldEvent("agentStopped", {
        sessionName: "demo",
        __deps: {
            os: "darwin",
            env: { TERM_PROGRAM: "Apple_Terminal" },
            pid: 1,
            getMergedCustomSetting: () => undefined,
            runCommand: commands.runCommand,
        },
    });

    assertEquals(result.sent, true);
    assertEquals(result.reason, "sent:terminal_notifier_failed");
    assertEquals(result.command?.cmd, "osascript");
});

Deno.test("notifyRunWieldEvent includes session and agent context in sent notification", async () => {
    const commands = makeCommandRecorder({ osascript: true });
    const result = await notifyRunWieldEvent("userInterview", {
        sessionName: "feature x",
        agentName: "Planner",
        __deps: {
            os: "darwin",
            env: {},
            pid: 1,
            getMergedCustomSetting: () => ({ activation: "none" }),
            runCommand: commands.runCommand,
        },
    });

    assertEquals(result.sent, true);
    assertEquals(result.command?.cmd, "osascript");
    assertStringIncludes(result.title, "Planner");
    assertStringIncludes(result.title, "feature x");
    assertStringIncludes(result.message, "wld - feature x");
});
