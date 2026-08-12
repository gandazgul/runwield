import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { VirtualTerminal } from "./testing/virtual-terminal.js";
import { getTUI, initTUIWithPair, stopTUI } from "./tui.ts";

class CompatibleVirtualTerminal extends VirtualTerminal {
    override drainInput(): Promise<void> {
        return Promise.resolve();
    }

    override moveBy(lines: number, columns?: number): void {
        super.moveBy(lines, columns ?? 0);
    }

    override setProgress(active: boolean | number | null): void {
        super.setProgress(typeof active === "boolean" ? (active ? 1 : null) : active);
    }
}

function makePair(): { terminal: CompatibleVirtualTerminal; tui: TUI } {
    const terminal = new CompatibleVirtualTerminal({ columns: 100, rows: 30 });
    return { terminal, tui: new TuiMainScreen(terminal) };
}

Deno.test("TUI singleton uses Pi TuiMainScreen regular mode", () => {
    const { terminal, tui } = makePair();
    const initialized = initTUIWithPair({ terminal, tui });
    try {
        const current = getTUI();
        assertStrictEquals(initialized, tui);
        assertStrictEquals(current.tui, tui);
        assertStrictEquals(current.terminal, terminal);
        assertEquals(current.tui.mode, "regular");
        assertEquals(terminal.started, true);
    } finally {
        stopTUI();
    }
});

Deno.test("TUI singleton stop is idempotent and clears deterministic pair state", () => {
    const { terminal, tui } = makePair();
    initTUIWithPair({ terminal, tui });

    stopTUI();
    stopTUI();

    assertEquals(terminal.stopped, true);
    assertThrows(() => getTUI(), Error, "TUI not initialized. Call initTUI() first.");
});

Deno.test("TUI singleton accepts a second compatible pair after cleanup", () => {
    const first = makePair();
    initTUIWithPair(first);
    stopTUI();

    const second = makePair();
    try {
        initTUIWithPair(second);
        const current = getTUI();
        assertStrictEquals(current.tui, second.tui);
        assertStrictEquals(current.terminal, second.terminal);
        assertEquals(current.tui.mode, "regular");
    } finally {
        stopTUI();
    }
});
