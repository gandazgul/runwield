import { assertEquals } from "@std/assert";
import { printCommandHelp, printGlobalHelp, runHelpCommand } from "./index.js";

Deno.test("printCommandHelp returns false for unknown command", () => {
    assertEquals(printCommandHelp("does-not-exist"), false);
});

Deno.test("printGlobalHelp writes usage", () => {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        printGlobalHelp();
    } finally {
        console.log = orig;
    }

    assertEquals(logs.some((line) => line.includes("Usage:")), true);
});

Deno.test("runHelpCommand shows command help", async () => {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runHelpCommand(["model"]);
    } finally {
        console.log = orig;
    }

    assertEquals(logs.some((line) => line.includes("Usage (model):")), true);
});

Deno.test("runHelpCommand unknown command exits", async () => {
    let exited = false;
    const originalExit = Deno.exit;
    Deno.exit = () => {
        exited = true;
        throw new Error("exit");
    };
    try {
        await runHelpCommand(["unknown"]).catch(() => {});
    } finally {
        Deno.exit = originalExit;
    }
    assertEquals(exited, true);
});
