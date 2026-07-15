import { assertEquals } from "@std/assert";
import { runRouterCommand } from "./index.js";

Deno.test("runRouterCommand prints help when userRequest is help", async () => {
    let helpCommand = "";
    let started = false;

    await runRouterCommand(["help"], {
        __testDeps: {
            printCommandHelp: (/** @type {string} */ name) => {
                helpCommand = name;
                return true;
            },
            startInteractiveSession: () => {
                started = true;
                return Promise.resolve(/** @type {import('../../ui/tui/types.js').UiAPI} */ ({}));
            },
        },
    });

    assertEquals(helpCommand, "router");
    assertEquals(started, false);
});

Deno.test("runRouterCommand starts session with provided request", async () => {
    /** @type {string | null} */
    let initial = null;
    /** @type {string | null} */
    let mode = null;

    await runRouterCommand(["fix", "bug"], {
        sessionStartMode: "continue",
        __testDeps: {
            startInteractiveSession: (
                /** @type {string | null} */ userRequest,
                opts = /** @type {{ sessionStartMode?: "new" | "continue" } | undefined} */ (undefined),
            ) => {
                initial = userRequest;
                mode = opts?.sessionStartMode || null;
                return Promise.resolve(/** @type {import('../../ui/tui/types.js').UiAPI} */ ({}));
            },
        },
    });

    assertEquals(initial, "fix bug");
    assertEquals(mode, "continue");
});

Deno.test("runRouterCommand passes null when no user request", async () => {
    /** @type {string | null} */
    let initial = "sentinel";

    await runRouterCommand([], {
        __testDeps: {
            startInteractiveSession: (
                /** @type {string | null} */ userRequest,
            ) => {
                initial = userRequest;
                return Promise.resolve(/** @type {import('../../ui/tui/types.js').UiAPI} */ ({}));
            },
        },
    });

    assertEquals(initial, null);
});
