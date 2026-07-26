import { assertEquals } from "@std/assert";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { runThemeCommand } from "./index.js";

Deno.test("runThemeCommand prints help through command help dependency", async () => {
    /** @type {string[]} */
    const helped = [];

    await runThemeCommand(["help"], {
        __testDeps: {
            printCommandHelp: (/** @type {string} */ commandName) => {
                helped.push(commandName);
                return true;
            },
        },
    });

    assertEquals(helped, ["theme"]);
});

Deno.test("runThemeCommand without args outside TUI prints CLI guidance", async () => {
    const originalLog = console.log;
    /** @type {string[]} */
    const logs = [];
    console.log = (/** @type {string} */ message) => logs.push(message);

    try {
        await runThemeCommand([]);
    } finally {
        console.log = originalLog;
    }

    assertEquals(logs, ["Use 'wld theme <name>' or 'wld theme --list'"]);
});

Deno.test("runThemeCommand interactive cancel restores original persisted theme", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalHome = Deno.env.get("HOME");
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-theme-test-" });

        try {
            Deno.env.set("HOME", tempHome);
            await runThemeCommand([], {
                uiAPI: /** @type {any} */ ({
                    promptSelect: (
                        /** @type {string} */ _title,
                        /** @type {Array<{ value: string, label: string }>} */ _items,
                        /** @type {{ onSelectionChange: (value: string) => void }} */ hooks,
                    ) => {
                        hooks.onSelectionChange("catppuccin-mocha");
                        return Promise.resolve(null);
                    },
                }),
            });
        } finally {
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            await Deno.remove(tempHome, { recursive: true });
        }
    });
});
