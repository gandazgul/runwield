import { assertEquals } from "@std/assert";
import { runSleepCommand } from "./index.js";

Deno.test("runSleepCommand help path", async () => {
    let helped = "";

    await runSleepCommand(["--help"], {
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: true }),
            printCommandHelp: (/** @type {string} */ name) => {
                helped = name;
            },
        }),
    });

    assertEquals(helped, "sleep");
});

Deno.test("runSleepCommand runs operator /sleep", async () => {
    let invoked = "";

    await runSleepCommand([], {
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false }),
            ensureMnemosyneBinary: () => Promise.resolve(),
            runAgentSession: (/** @type {{agentName: string, userRequest: string}} */ opts) => {
                invoked = `${opts.agentName}:${opts.userRequest}`;
                return Promise.resolve([]);
            },
        }),
    });

    assertEquals(invoked, "operator:/sleep");
});
