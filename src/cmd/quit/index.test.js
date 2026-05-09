import { assertEquals } from "@std/assert";
import { runQuitCommand } from "./index.js";

Deno.test("runQuitCommand no-ops without editor/tui", async () => {
    await runQuitCommand([], {});
    assertEquals(true, true);
});

Deno.test("runQuitCommand clears editor and triggers shutdown", async () => {
    let stopped = false;
    let exited = false;
    /** @type {Array<() => void>} */
    const timers = [];

    await runQuitCommand(
        [],
        /** @type {any} */ ({
            editor: {
                setText: () => {},
            },
            tui: {
                requestRender: () => {},
            },
            __testDeps: {
                stopTUI: () => {
                    stopped = true;
                },
                exit: () => {
                    exited = true;
                    return undefined;
                },
                setTimeout: (/** @type {() => void} */ fn) => {
                    timers.push(fn);
                    return 0;
                },
            },
        }),
    );

    while (timers.length) {
        const fn = timers.shift();
        fn?.();
    }

    assertEquals(stopped, true);
    assertEquals(exited, true);
});
