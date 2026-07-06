import { assertEquals } from "@std/assert";
import {
    formatTerminalTitle,
    sanitizeSessionName,
    setTerminalTitleForName,
    setTerminalTitleForSession,
} from "./terminal-title.js";

Deno.test("sanitizeSessionName trims, collapses whitespace, and strips control characters", () => {
    assertEquals(sanitizeSessionName("  fix\n\tmodel\u0007 routing  "), "fix model routing");
});

Deno.test("sanitizeSessionName truncates to a tab-friendly length", () => {
    assertEquals(sanitizeSessionName("a".repeat(50)), "a".repeat(40));
});

Deno.test("formatTerminalTitle prefixes sanitized names and falls back to wld", () => {
    assertEquals(formatTerminalTitle(" terminal titles "), "wld - terminal titles");
    assertEquals(formatTerminalTitle("\n\t"), "wld");
});

Deno.test("setTerminalTitleForName best-effort sets the active terminal title", () => {
    /** @type {string[]} */
    const titles = [];

    const attempted = setTerminalTitleForName("  plan\nboard  ", {
        getTUI: () => /** @type {any} */ ({
            terminal: {
                setTitle: (/** @type {string} */ title) => titles.push(title),
            },
        }),
    });

    assertEquals(attempted, "wld - plan board");
    assertEquals(titles, ["wld - plan board"]);
});

Deno.test("setTerminalTitleForName ignores unavailable terminals", () => {
    const attempted = setTerminalTitleForName("safe", {
        getTUI: () => {
            throw new Error("not initialized");
        },
    });

    assertEquals(attempted, "wld - safe");
});

Deno.test("setTerminalTitleForSession uses session name or cwd basename", () => {
    /** @type {string[]} */
    const titles = [];
    const deps = {
        getTUI: () => /** @type {any} */ ({
            terminal: {
                setTitle: (/** @type {string} */ title) => titles.push(title),
            },
        }),
    };

    assertEquals(
        setTerminalTitleForSession({ getSessionName: () => "custom work" }, "/tmp/project", deps),
        "wld - custom work",
    );
    assertEquals(
        setTerminalTitleForSession({ getSessionName: () => undefined }, "/tmp/project", deps),
        "wld - project",
    );
    assertEquals(titles, ["wld - custom work", "wld - project"]);
});
