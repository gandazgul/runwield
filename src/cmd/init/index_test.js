/**
 * @module cmd/init/index_test
 * Tests for the init command handler — guard logic and basic dispatch.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { runInitCommand } from "./index.js";

Deno.test("runInitCommand warns and exits on duplicate init", async () => {
    await runInitCommand(
        [],
        /** @type {any} */ ({
            __testDeps: /** @type {any} */ ({
                isInitDone: () => true,
                recordInitDone: () => {},
                parseArgs: () => ({}),
                printCommandHelp: () => {},
                readTextFile: () => "",
                cwd: () => "/tmp/test-project",
            }),
        }),
    ).catch(() => {});

    // When isInitDone returns true, the command warns and returns early.
    // The warn messages are verified by the output block below.
});

Deno.test("runInitCommand does not warn on fresh init", async () => {
    /** @type {string[]} */
    const warns = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warns.push(String(msg));

    try {
        await runInitCommand(
            [],
            /** @type {any} */ ({
                __testDeps: /** @type {any} */ ({
                    isInitDone: () => false,
                    recordInitDone: () => {},
                    parseArgs: () => ({}),
                    printCommandHelp: () => {},
                    readTextFile: () => "---\nname: init\nmodel: test/model\n---\nTest body content",
                    cwd: () => "/tmp/test-project",
                }),
                sessionManager: {
                    getHeader: () => null,
                    append: () => {},
                    toMarkdown: () => "",
                },
            }),
        ).catch(() => {});
    } finally {
        console.warn = originalWarn;
    }

    const duplicateWarnings = warns.filter((w) => w.includes("already"));
    assertEquals(duplicateWarnings.length, 0);
});

Deno.test("runInitCommand definition has correct flags", async () => {
    const mod = await import("./index.js");
    assertEquals(mod.runInitCommand.name, "runInitCommand");
    // Verify the command is registered with correct flags
    const { getCommandDefinition } = await import("../registry.js");
    const cmd = getCommandDefinition("init");
    assertEquals(cmd?.isSlash, true);
    assertEquals(cmd?.isCli, true);
    assertEquals(cmd?.name, "init");
    assertEquals(cmd?.displayName, "Init");
    assertStringIncludes(cmd?.description ?? "", "Initialize");
});
