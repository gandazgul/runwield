import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { __resetSettingsForTests } from "../../shared/settings.js";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import {
    buildActivationCommand,
    buildAppleTerminalActivationScript,
    buildExactActivationCommand,
    buildITermActivationScript,
    buildNotificationCommand,
    detectTerminalIdentity,
    inferTerminalSenderBundleId,
    type NotificationSettings,
    type NotificationSystemPort,
    notifyRunWieldEvent,
    resolveNotificationSettings,
} from "./system-notifications.ts";

interface CommandInvocation {
    cmd: string;
    args: string[];
}

interface FixtureSettings {
    enabled?: boolean;
    activation?: "tab" | "app" | "none";
    events?: {
        agentStopped?: boolean;
        planWritten?: boolean;
        userInterview?: boolean;
        compactionFinished?: boolean;
    };
    terminalBell?: boolean;
}

interface PortFixtureOptions {
    os?: string;
    env?: Record<string, string>;
    commands?: Record<string, boolean | "fail" | "throw">;
    throwOnWrite?: boolean;
}

function makeSystemPort(options: PortFixtureOptions = {}): {
    calls: CommandInvocation[];
    writes: number[][];
    port: NotificationSystemPort;
} {
    const calls: CommandInvocation[] = [];
    const writes: number[][] = [];
    const commands = options.commands || {};
    return {
        calls,
        writes,
        port: {
            os: options.os || "darwin",
            env: options.env || {},
            pid: 42,
            runCommand(cmd, args = []) {
                calls.push({ cmd, args: [...args] });
                if (cmd === "command" && args[0] === "-v") {
                    const state = commands[args[1]];
                    const exists = state === true || state === "fail" || state === "throw";
                    return Promise.resolve({
                        success: exists,
                        stdout: exists ? `/usr/bin/${args[1]}\n` : "",
                        stderr: "",
                    });
                }
                if (cmd === "tty") {
                    return Promise.resolve({ success: true, stdout: "/dev/ttys123\n", stderr: "" });
                }
                if (commands[cmd] === "throw") throw new Error(`${cmd} exploded`);
                return Promise.resolve({ success: commands[cmd] !== "fail", stdout: "", stderr: "" });
            },
            writeTerminal(bytes) {
                writes.push([...bytes]);
                if (options.throwOnWrite) throw new Error("bell failed");
            },
        },
    };
}

async function withNotificationSettings(
    settings: FixtureSettings | undefined,
    run: (projectRoot: string) => Promise<void>,
): Promise<void> {
    await withProcessGlobalTestLock(async () => {
        const previousHome = Deno.env.get("HOME");
        const previousSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const previousCwd = Deno.cwd();
        const root = await Deno.makeTempDir({ prefix: "system-notification-" });
        const home = join(root, "home");
        const projectRoot = join(root, "project");
        await Deno.mkdir(join(home, ".wld"), { recursive: true });
        await Deno.mkdir(projectRoot, { recursive: true });
        await Deno.writeTextFile(
            join(home, ".wld", "settings.json"),
            JSON.stringify(settings ? { notifications: settings } : {}),
        );
        try {
            Deno.env.set("HOME", home);
            Deno.env.set("WLD_TEST_SANDBOX_HOME", home);
            Deno.chdir(projectRoot);
            __resetSettingsForTests();
            await run(projectRoot);
        } finally {
            __resetSettingsForTests();
            Deno.chdir(previousCwd);
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            if (previousSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", previousSandboxHome);
            await Deno.remove(root, { recursive: true }).catch(() => {});
        }
    });
}

const DEFAULT_SETTINGS: NotificationSettings = resolveNotificationSettings(undefined);

Deno.test("notification settings default on and normalize persisted values", () => {
    assertEquals(DEFAULT_SETTINGS, {
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
});

Deno.test("terminal identity and activation target the actual terminal tab when possible", async () => {
    const system = makeSystemPort({ env: { TERM_PROGRAM: "iTerm.app", ITERM_SESSION_ID: "w0t0p0" } });
    const identity = await detectTerminalIdentity("demo", system.port);
    assertEquals(identity.tty, "/dev/ttys123");
    assertEquals(identity.termProgram, "iTerm.app");
    assertEquals(identity.pid, 42);

    const exact = buildExactActivationCommand(identity);
    assert(exact);
    assertStringIncludes(exact, "iTerm2");
    assertStringIncludes(exact, "/dev/ttys123");
    assertEquals(buildActivationCommand(identity, "none"), null);
    assertStringIncludes(buildAppleTerminalActivationScript("/dev/ttys123"), 'tty of t is "/dev/ttys123"');
    assertStringIncludes(buildITermActivationScript("/dev/ttys123"), 'tty of s is "/dev/ttys123"');
});

Deno.test("terminal-specific activation supports WezTerm, kitty, and reliable sender bundles", () => {
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
    assertEquals(
        inferTerminalSenderBundleId({ sessionLabel: "s", terminalTitle: "wld - s", termProgram: "Apple_Terminal" }),
        "com.apple.Terminal",
    );
    assertEquals(
        inferTerminalSenderBundleId({ sessionLabel: "s", terminalTitle: "wld - s", termProgram: "ghostty" }),
        "com.mitchellh.ghostty",
    );
});

Deno.test("notification command prefers grouped terminal-notifier and falls back to osascript", async () => {
    const notifier = makeSystemPort({ commands: { "terminal-notifier": true, osascript: true } });
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
        settings: DEFAULT_SETTINGS,
    }, notifier.port);
    assertEquals(command?.cmd, "terminal-notifier");
    assertEquals(command?.args[command.args.indexOf("-group") + 1], "runwield-agentStopped-demo");
    assertEquals(command?.args[command.args.indexOf("-sender") + 1], "com.apple.Terminal");

    const fallback = makeSystemPort({ commands: { osascript: true } });
    const fallbackCommand = await buildNotificationCommand({
        eventName: "userInterview",
        title: "Input requested — demo",
        message: "Question waiting.\nSession: wld - demo",
        terminal: { sessionLabel: "demo", terminalTitle: "wld - demo" },
        settings: DEFAULT_SETTINGS,
    }, fallback.port);
    assertEquals(fallbackCommand?.cmd, "osascript");
    assertStringIncludes(fallbackCommand?.args.join(" ") || "", "display notification");
});

Deno.test("Golden TUI guard prevents every external notification effect", async () => {
    await withNotificationSettings(undefined, async () => {
        const system = makeSystemPort({
            env: { WLD_GOLDEN_TUI: "1", TERM_PROGRAM: "Apple_Terminal" },
            commands: { "terminal-notifier": true, osascript: true },
        });
        const result = await notifyRunWieldEvent("agentStopped", { sessionName: "golden", port: system.port });
        assertEquals(result.reason, "golden_tui");
        assertEquals(result.terminalBellEmitted, false);
        assertEquals(system.calls, []);
        assertEquals(system.writes, []);
    });
});

Deno.test("real project notification settings disable one event before external effects", async () => {
    await withNotificationSettings(undefined, async (projectRoot) => {
        await Deno.mkdir(join(projectRoot, ".wld"));
        await Deno.writeTextFile(
            join(projectRoot, ".wld", "settings.json"),
            JSON.stringify({ notifications: { events: { planWritten: false } } }),
        );
        __resetSettingsForTests();
        const system = makeSystemPort({ commands: { osascript: true } });
        const result = await notifyRunWieldEvent("planWritten", { sessionName: "demo", port: system.port });
        assertEquals(result.reason, "event_disabled");
        assertEquals(system.calls, []);
        assertEquals(system.writes, []);
    });
});

Deno.test("unsupported operating systems still emit the configured terminal bell", async () => {
    await withNotificationSettings(undefined, async () => {
        const system = makeSystemPort({ os: "linux" });
        const result = await notifyRunWieldEvent("agentStopped", { sessionName: "demo", port: system.port });
        assertEquals(result.reason, "unsupported");
        assertEquals(result.terminalBellEmitted, true);
        assertEquals(system.writes, [[7]]);
        assertEquals(system.calls.filter((call) => call.cmd === "tty").length, 1);
    });
});

Deno.test("failed terminal-notifier delivery uses the real osascript fallback policy", async () => {
    await withNotificationSettings(undefined, async () => {
        const system = makeSystemPort({
            env: { TERM_PROGRAM: "Apple_Terminal" },
            commands: { "terminal-notifier": "fail", osascript: true },
        });
        const result = await notifyRunWieldEvent("agentStopped", { sessionName: "demo", port: system.port });
        assertEquals(result.sent, true);
        assertEquals(result.reason, "sent:terminal_notifier_failed");
        assertEquals(result.command?.cmd, "osascript");
        assertEquals(system.writes, [[7]]);
    });
});

Deno.test("desktop command failures remain best-effort results", async () => {
    await withNotificationSettings({ activation: "none", terminalBell: false }, async () => {
        const failed = makeSystemPort({ commands: { osascript: "fail" } });
        const failedResult = await notifyRunWieldEvent("agentStopped", { port: failed.port });
        assertEquals(failedResult.sent, false);
        assertEquals(failedResult.reason, "command_failed");

        const thrown = makeSystemPort({ commands: { osascript: "throw" } });
        const thrownResult = await notifyRunWieldEvent("agentStopped", { port: thrown.port });
        assertEquals(thrownResult.sent, false);
        assertEquals(thrownResult.reason, "command_error:osascript exploded");
    });
});

Deno.test("persisted terminalBell false preserves desktop delivery without writing stdout", async () => {
    await withNotificationSettings({ activation: "none", terminalBell: false }, async () => {
        const system = makeSystemPort({ commands: { osascript: true } });
        const result = await notifyRunWieldEvent("userInterview", {
            sessionName: "silent bell",
            port: system.port,
        });
        assertEquals(result.sent, true);
        assertEquals(result.command?.cmd, "osascript");
        assertEquals(result.terminalBellEmitted, false);
        assertEquals(system.writes, []);
    });
});

Deno.test("compaction notification includes persisted session context", async () => {
    await withNotificationSettings({ activation: "none" }, async () => {
        const system = makeSystemPort({ commands: { osascript: true } });
        const result = await notifyRunWieldEvent("compactionFinished", {
            sessionName: "compact session",
            port: system.port,
        });
        assertEquals(result.sent, true);
        assertStringIncludes(result.title, "Compaction finished");
        assertStringIncludes(result.message, "The /compact command finished. Return to view the result.");
        assertStringIncludes(result.message, "wld - compact session");
    });
});

Deno.test("unknown events and terminal write failures remain isolated", async () => {
    await withNotificationSettings({ activation: "none" }, async () => {
        const unknownSystem = makeSystemPort({ commands: { osascript: true } });
        const unknown = await notifyRunWieldEvent("unknown", { sessionName: "unknown", port: unknownSystem.port });
        assertEquals(unknown.reason, "unknown_event");
        assertEquals(unknownSystem.calls, []);
        assertEquals(unknownSystem.writes, []);

        const bellFailure = makeSystemPort({ commands: { osascript: true }, throwOnWrite: true });
        const delivered = await notifyRunWieldEvent("userInterview", {
            sessionName: "bell failure",
            agentName: "Planner",
            port: bellFailure.port,
        });
        assertEquals(delivered.sent, true);
        assertEquals(delivered.terminalBellEmitted, false);
        assertStringIncludes(delivered.title, "Planner");
        assertEquals(bellFailure.writes, [[7]]);
    });
});
