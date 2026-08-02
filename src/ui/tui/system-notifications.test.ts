import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
    buildNativeNotificationSequence,
    detectTerminalIdentity,
    notifyRunWieldEvent,
    resolveNotificationSettings,
    selectNativeNotificationProtocol,
    shouldSuppressAttentionNotification,
} from "./system-notifications.ts";

type TerminalWriteRecorder = {
    writes: number[][];
    strings: string[];
    writeTerminal(bytes: Uint8Array): void;
};

function makeTerminalWriter(options: { throwOnWrite?: boolean } = {}): TerminalWriteRecorder {
    const decoder = new TextDecoder();
    return {
        writes: [],
        strings: [],
        writeTerminal(bytes: Uint8Array): void {
            this.writes.push([...bytes]);
            this.strings.push(decoder.decode(bytes));
            if (options.throwOnWrite) {
                throw new Error("write failed");
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
        suppressWhenFocused: true,
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
            suppressWhenFocused: true,
        },
    );

    assertEquals(resolveNotificationSettings({ terminalBell: false, suppressWhenFocused: false }).terminalBell, false);
    assertEquals(
        resolveNotificationSettings({ terminalBell: false, suppressWhenFocused: false }).suppressWhenFocused,
        false,
    );
});

Deno.test("detectTerminalIdentity captures terminal environment without subprocess tty lookup", () => {
    const identity = detectTerminalIdentity("demo", {
        env: {
            TERM_PROGRAM: "iTerm.app",
            TERM: "xterm-256color",
            ITERM_SESSION_ID: "w0t0p0",
        },
        pid: 42,
    });

    assertEquals(identity.sessionLabel, "demo");
    assertEquals(identity.terminalTitle, "wld - demo");
    assertEquals(identity.termProgram, "iTerm.app");
    assertEquals(identity.itermSessionId, "w0t0p0");
    assertEquals(identity.pid, 42);
});

Deno.test("selectNativeNotificationProtocol maps supported terminal families conservatively", () => {
    assertEquals(
        selectNativeNotificationProtocol({ sessionLabel: "s", terminalTitle: "wld - s", term: "xterm-kitty" }),
        "osc99",
    );
    assertEquals(
        selectNativeNotificationProtocol({ sessionLabel: "s", terminalTitle: "wld - s", termProgram: "WezTerm" }),
        "osc777",
    );
    assertEquals(
        selectNativeNotificationProtocol({ sessionLabel: "s", terminalTitle: "wld - s", termProgram: "Ghostty" }),
        "osc777",
    );
    assertEquals(
        selectNativeNotificationProtocol({ sessionLabel: "s", terminalTitle: "wld - s", termProgram: "iTerm.app" }),
        "osc9",
    );
    assertEquals(
        selectNativeNotificationProtocol({
            sessionLabel: "s",
            terminalTitle: "wld - s",
            termProgram: "Apple_Terminal",
        }),
        "unsupported",
    );
    assertEquals(selectNativeNotificationProtocol({ sessionLabel: "s", terminalTitle: "wld - s" }), "unsupported");
});

Deno.test("shouldSuppressAttentionNotification suppresses only known focused terminals by default", () => {
    assertEquals(shouldSuppressAttentionNotification({ suppressWhenFocused: true }, "focused"), true);
    assertEquals(shouldSuppressAttentionNotification({ suppressWhenFocused: true }, "unfocused"), false);
    assertEquals(shouldSuppressAttentionNotification({ suppressWhenFocused: true }, "unknown"), false);
    assertEquals(shouldSuppressAttentionNotification({ suppressWhenFocused: false }, "focused"), false);
});

Deno.test("buildNativeNotificationSequence emits iTerm2 OSC 9 safely", () => {
    const sequence = buildNativeNotificationSequence("osc9", "Hello\x1b]bad\x07;title", "Line\nmessage");
    assert(sequence);
    assertStringIncludes(sequence, "\x1b]9;");
    assertStringIncludes(sequence, "Hello");
    assertEquals(sequence.includes("\x1b]bad"), false);
    assertEquals(sequence.includes(";title"), false);
});

Deno.test("buildNativeNotificationSequence emits WezTerm and Ghostty OSC 777 safely", () => {
    const sequence = buildNativeNotificationSequence("osc777", "Title;part", "Message\x07part");
    assertEquals(sequence, "\x1b]777;notify;Title part;Message part\x07");
});

Deno.test("buildNativeNotificationSequence emits Kitty OSC 99 with unfocused option and encoded text", () => {
    const sequence = buildNativeNotificationSequence("osc99", "Title;\x1b", "Message\x07\x1b\\done");
    assert(sequence);
    assertStringIncludes(sequence, "\x1b]99;");
    assertStringIncludes(sequence, "o=unfocused");
    assertEquals(sequence.includes("Title;"), false);
    assertEquals(sequence.includes("Message\x07"), false);
    assertEquals(sequence.endsWith("\x1b\\"), true);
});

Deno.test("notifyRunWieldEvent never reaches notifications from a Golden TUI run", async () => {
    const terminal = makeTerminalWriter();
    const result = await notifyRunWieldEvent("agentStopped", {
        sessionName: "golden",
        __deps: {
            env: { WLD_GOLDEN_TUI: "1", TERM_PROGRAM: "iTerm.app" },
            pid: 1,
            getMergedCustomSetting: () => undefined,
            writeTerminal: terminal.writeTerminal.bind(terminal),
        },
    });

    assertEquals(result.sent, false);
    assertEquals(result.reason, "golden_tui");
    assertEquals(result.terminalBellEmitted, false);
    assertEquals(terminal.writes, []);
});

Deno.test("notifyRunWieldEvent emits unsupported-terminal BEL fallback when enabled", async () => {
    const terminal = makeTerminalWriter();
    const result = await notifyRunWieldEvent("agentStopped", {
        sessionName: "demo",
        terminalFocusState: "unknown",
        __deps: {
            env: { TERM_PROGRAM: "Apple_Terminal" },
            pid: 1,
            getMergedCustomSetting: () => undefined,
            writeTerminal: terminal.writeTerminal.bind(terminal),
        },
    });

    assertEquals(result.sent, false);
    assertEquals(result.reason, "unsupported");
    assertEquals(result.protocol, "unsupported");
    assertEquals(result.terminalBellEmitted, true);
    assertEquals(terminal.writes, [[7]]);
});

Deno.test("notifyRunWieldEvent respects terminalBell false while preserving OSC delivery", async () => {
    const terminal = makeTerminalWriter();
    const result = await notifyRunWieldEvent("userInterview", {
        sessionName: "silent bell",
        terminalFocusState: "unknown",
        __deps: {
            env: { TERM_PROGRAM: "iTerm.app" },
            pid: 1,
            getMergedCustomSetting: () => ({ terminalBell: false }),
            writeTerminal: terminal.writeTerminal.bind(terminal),
        },
    });

    assertEquals(result.sent, true);
    assertEquals(result.reason, "sent");
    assertEquals(result.protocol, "osc9");
    assertEquals(result.terminalBellEmitted, false);
    assertEquals(terminal.writes.length, 1);
    assertStringIncludes(terminal.strings[0], "\x1b]9;");
});

Deno.test("notifyRunWieldEvent suppresses focused terminals before BEL or OSC emission", async () => {
    const terminal = makeTerminalWriter();
    const result = await notifyRunWieldEvent("planWritten", {
        sessionName: "focused",
        terminalFocusState: "focused",
        __deps: {
            env: { TERM_PROGRAM: "WezTerm" },
            pid: 1,
            getMergedCustomSetting: () => undefined,
            writeTerminal: terminal.writeTerminal.bind(terminal),
        },
    });

    assertEquals(result.sent, false);
    assertEquals(result.reason, "focused");
    assertEquals(result.terminalBellEmitted, false);
    assertEquals(result.oscEmitted, false);
    assertEquals(terminal.writes, []);
});

Deno.test("notifyRunWieldEvent suppressWhenFocused false restores always-emit behavior", async () => {
    const terminal = makeTerminalWriter();
    const result = await notifyRunWieldEvent("planWritten", {
        sessionName: "focused",
        terminalFocusState: "focused",
        __deps: {
            env: { TERM_PROGRAM: "WezTerm" },
            pid: 1,
            getMergedCustomSetting: () => ({ suppressWhenFocused: false }),
            writeTerminal: terminal.writeTerminal.bind(terminal),
        },
    });

    assertEquals(result.sent, true);
    assertEquals(result.protocol, "osc777");
    assertEquals(result.terminalBellEmitted, true);
    assertEquals(terminal.writes[0], [7]);
    assertStringIncludes(terminal.strings[1], "\x1b]777;notify;");
});

Deno.test("notifyRunWieldEvent preserves per-event settings and compaction finished text", async () => {
    const disabledTerminal = makeTerminalWriter();
    const disabled = await notifyRunWieldEvent("compactionFinished", {
        sessionName: "disabled compact",
        __deps: {
            env: { TERM_PROGRAM: "Ghostty" },
            pid: 1,
            getMergedCustomSetting: () => ({ events: { compactionFinished: false } }),
            writeTerminal: disabledTerminal.writeTerminal.bind(disabledTerminal),
        },
    });

    assertEquals(disabled.reason, "event_disabled");
    assertEquals(disabledTerminal.writes, []);

    const terminal = makeTerminalWriter();
    const sent = await notifyRunWieldEvent("compactionFinished", {
        sessionName: "compact session",
        terminalFocusState: "unfocused",
        __deps: {
            env: { TERM_PROGRAM: "Ghostty" },
            pid: 1,
            getMergedCustomSetting: () => undefined,
            writeTerminal: terminal.writeTerminal.bind(terminal),
        },
    });

    assertEquals(sent.sent, true);
    assertStringIncludes(sent.title, "Compaction finished");
    assertStringIncludes(sent.message, "The /compact command finished. Return to view the result.");
    assertStringIncludes(sent.message, "wld - compact session");
});

Deno.test("notifyRunWieldEvent skips bell and OSC for disabled or unknown events", async () => {
    const disabledTerminal = makeTerminalWriter();
    const disabled = await notifyRunWieldEvent("agentStopped", {
        sessionName: "disabled",
        __deps: {
            env: { TERM_PROGRAM: "iTerm.app" },
            pid: 1,
            getMergedCustomSetting: () => ({ enabled: false }),
            writeTerminal: disabledTerminal.writeTerminal.bind(disabledTerminal),
        },
    });

    assertEquals(disabled.reason, "disabled");
    assertEquals(disabledTerminal.writes, []);

    const unknownTerminal = makeTerminalWriter();
    const unknown = await notifyRunWieldEvent("unknownEvent", {
        sessionName: "unknown",
        __deps: {
            env: { TERM_PROGRAM: "iTerm.app" },
            pid: 1,
            getMergedCustomSetting: () => undefined,
            writeTerminal: unknownTerminal.writeTerminal.bind(unknownTerminal),
        },
    });

    assertEquals(unknown.reason, "unknown_event");
    assertEquals(unknownTerminal.writes, []);
});

Deno.test("notifyRunWieldEvent isolates terminal write failures", async () => {
    const terminal = makeTerminalWriter({ throwOnWrite: true });
    const result = await notifyRunWieldEvent("planWritten", {
        sessionName: "write failure",
        terminalFocusState: "unknown",
        __deps: {
            env: { TERM_PROGRAM: "iTerm.app" },
            pid: 1,
            getMergedCustomSetting: () => undefined,
            writeTerminal: terminal.writeTerminal.bind(terminal),
        },
    });

    assertEquals(result.sent, false);
    assertEquals(result.reason, "write_failed");
    assertEquals(result.terminalBellEmitted, false);
});

Deno.test("command-based notification helpers are removed from active source", async () => {
    const source = await Deno.readTextFile(new URL("./system-notifications.ts", import.meta.url));
    const removedTerms = [
        "CommandSpec",
        "run" + "Command",
        "command" + "Exists",
        "build" + "Notification" + "Command",
        "build" + "Osascript" + "Notification" + "Command",
        "build" + "Activation" + "Command",
        "terminal" + "-" + "notifier",
        "display" + " notification",
    ];
    for (const term of removedTerms) {
        assertEquals(source.includes(term), false);
    }
});
