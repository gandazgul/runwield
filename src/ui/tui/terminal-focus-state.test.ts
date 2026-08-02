import { assertEquals } from "@std/assert";
import {
    createTerminalFocusStateOwner,
    getCurrentTerminalFocusState,
    installTerminalFocusState,
} from "./terminal-focus-state.ts";

type InputHandler = (data: string) => void;
type ResizeHandler = (size: { columns: number; rows: number }) => void;

class FocusTestTerminal {
    writes: string[] = [];
    onInput: InputHandler | null = null;
    onResize: ResizeHandler | null = null;

    write(data: string): void {
        this.writes.push(data);
    }

    start(onInput: InputHandler, onResize?: ResizeHandler): void {
        this.onInput = onInput;
        this.onResize = onResize || null;
    }

    input(data: string): void {
        this.onInput?.(data);
    }
}

Deno.test("createTerminalFocusStateOwner enables and disables focus reporting idempotently", () => {
    const terminal = new FocusTestTerminal();
    const owner = createTerminalFocusStateOwner(terminal);

    assertEquals(terminal.writes, ["\x1b[?1004h"]);
    assertEquals(owner.getState(), "unknown");

    owner.dispose();
    owner.dispose();

    assertEquals(terminal.writes, ["\x1b[?1004h", "\x1b[?1004l"]);
});

Deno.test("filterInput consumes focus reports and updates state", () => {
    const terminal = new FocusTestTerminal();
    const owner = createTerminalFocusStateOwner(terminal);

    assertEquals(owner.filterInput("a\x1b[Ib"), "ab");
    assertEquals(owner.getState(), "focused");
    assertEquals(owner.filterInput("c\x1b[Od"), "cd");
    assertEquals(owner.getState(), "unfocused");
});

Deno.test("filterInput passes non-focus input through unchanged and in order", () => {
    const terminal = new FocusTestTerminal();
    const owner = createTerminalFocusStateOwner(terminal);

    assertEquals(owner.filterInput("\x1b[Ahello\r\x1b[B"), "\x1b[Ahello\r\x1b[B");
    assertEquals(owner.getState(), "unknown");
});

Deno.test("installTerminalFocusState filters terminal start input before the TUI callback", () => {
    const terminal = new FocusTestTerminal();
    const owner = installTerminalFocusState(terminal);
    const inputs: string[] = [];

    terminal.start((data) => inputs.push(data));
    terminal.input("one");
    terminal.input("\x1b[I");
    terminal.input("two\x1b[Othree");

    assertEquals(inputs, ["one", "twothree"]);
    assertEquals(owner.getState(), "unfocused");
    assertEquals(getCurrentTerminalFocusState(), "unfocused");

    owner.dispose();
    assertEquals(getCurrentTerminalFocusState(), "unknown");
});

Deno.test("installTerminalFocusState suppresses empty focus-only reports", () => {
    const terminal = new FocusTestTerminal();
    installTerminalFocusState(terminal);
    const inputs: string[] = [];

    terminal.start((data) => inputs.push(data));
    terminal.input("\x1b[I");
    terminal.input("\x1b[O");

    assertEquals(inputs, []);
});
