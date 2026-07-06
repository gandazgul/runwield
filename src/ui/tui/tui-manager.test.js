import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { createTuiManager } from "./tui-manager.js";

Deno.test("createTuiManager initializes once and returns the same running TUI", () => {
    /** @type {string[]} */
    const events = [];

    class FakeTerminal {
        constructor() {
            events.push("terminal");
        }
    }

    class FakeTui {
        /** @param {any} terminal */
        constructor(terminal) {
            this.terminal = terminal;
            this.starts = 0;
            events.push("tui");
        }

        start() {
            this.starts++;
            events.push("start");
        }
    }

    const manager = createTuiManager({
        TerminalCtor: FakeTerminal,
        TuiCtor: FakeTui,
        installCrashGuards: () => events.push("install"),
        uninstallCrashGuards: () => events.push("uninstall"),
        restoreTitle: () => events.push("restoreTitle"),
    });

    const first = manager.initTUI();
    const second = manager.initTUI();
    const current = manager.getTUI();

    assertStrictEquals(first, second);
    assertStrictEquals(current.tui, first);
    assertStrictEquals(current.terminal, first.terminal);
    assertEquals(first.starts, 1);
    assertEquals(events, ["terminal", "tui", "start", "install"]);
});

Deno.test("createTuiManager throws before initialization and clears state on stop", () => {
    /** @type {string[]} */
    const events = [];

    class FakeTerminal {}

    class FakeTui {
        start() {
            events.push("start");
        }

        stop() {
            events.push("stop");
        }
    }

    const manager = createTuiManager({
        TerminalCtor: FakeTerminal,
        TuiCtor: FakeTui,
        installCrashGuards: () => events.push("install"),
        uninstallCrashGuards: () => events.push("uninstall"),
        restoreTitle: () => events.push("restoreTitle"),
    });

    assertThrows(
        () => manager.getTUI(),
        Error,
        "TUI not initialized. Call initTUI() first.",
    );

    manager.initTUI();
    manager.stopTUI();

    assertThrows(
        () => manager.getTUI(),
        Error,
        "TUI not initialized. Call initTUI() first.",
    );
    assertEquals(events, ["start", "install", "restoreTitle", "uninstall", "stop"]);
});

Deno.test("createTuiManager stop is safe before init and with TUI lacking stop", () => {
    /** @type {string[]} */
    const events = [];

    class FakeTerminal {}

    class FakeTui {
        start() {
            events.push("start");
        }
    }

    const manager = createTuiManager({
        TerminalCtor: FakeTerminal,
        TuiCtor: FakeTui,
        installCrashGuards: () => events.push("install"),
        uninstallCrashGuards: () => events.push("uninstall"),
        restoreTitle: () => events.push("restoreTitle"),
    });

    manager.stopTUI();
    manager.initTUI();
    manager.stopTUI();

    assertEquals(events, ["restoreTitle", "uninstall", "start", "install", "restoreTitle", "uninstall"]);
});
