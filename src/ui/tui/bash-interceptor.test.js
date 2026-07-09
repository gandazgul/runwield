import { assertEquals } from "@std/assert";
import { handleBashCommand } from "./bash-interceptor.js";

/**
 * @returns {{ ctx: any, records: any }}
 */
function makeContext() {
    const records = {
        messages: /** @type {any[]} */ ([]),
        userMessages: /** @type {string[]} */ ([]),
        toolInvoked: /** @type {any[]} */ ([]),
        toolResults: /** @type {any[]} */ ([]),
        toolBlocks: /** @type {any[]} */ ([]),
        systemMessages: /** @type {string[]} */ ([]),
        renders: 0,
        bumps: 0,
        currentChecks: /** @type {number[]} */ ([]),
        registeredProcs: /** @type {any[]} */ ([]),
    };
    const sessionManager = {
        addMessage: (/** @type {any} */ message) => records.messages.push(message),
    };
    const ctx = {
        userRequest: "",
        uiAPI: {
            appendUserMessage: (/** @type {string} */ message) => records.userMessages.push(message),
            addToolInvoked: (/** @type {any} */ tool) => records.toolInvoked.push(tool),
            addToolResult: (/** @type {any} */ result) => records.toolResults.push(result),
            startToolExecution: (/** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ args) => {
                const block = {
                    id,
                    name,
                    args,
                    output: "",
                    ended: false,
                    isError: false,
                    durationMs: 0,
                    /** @param {string} chunk */
                    appendOutput(chunk) {
                        this.output += chunk;
                    },
                    /**
                     * @param {boolean} isError
                     * @param {number} durationMs
                     */
                    endExecution(isError, durationMs) {
                        this.ended = true;
                        this.isError = isError;
                        this.durationMs = durationMs;
                    },
                };
                records.toolBlocks.push(block);
                return block;
            },
            appendSystemMessage: (/** @type {string} */ message) => records.systemMessages.push(message),
        },
        tui: {
            requestRender: () => records.renders++,
        },
        editor: {},
        getSessionManager: () => sessionManager,
        generationGuard: {
            bump: () => {
                records.bumps++;
                return 7;
            },
            isCurrent: (/** @type {number} */ generation) => {
                records.currentChecks.push(generation);
                return true;
            },
        },
        registerBashProc: (/** @type {any} */ proc) => records.registeredProcs.push(proc),
    };
    return { ctx, records };
}

Deno.test("handleBashCommand ignores non-bang input and swallows empty bang input", async () => {
    const { ctx, records } = makeContext();

    ctx.userRequest = "hello";
    assertEquals(await handleBashCommand(ctx), false);

    ctx.userRequest = "!";
    assertEquals(await handleBashCommand(ctx), true);
    assertEquals(records.toolBlocks, []);
});

Deno.test("handleBashCommand runs persistent commands and records transcript messages", async () => {
    const { ctx, records } = makeContext();
    ctx.userRequest = "!printf persistent";

    assertEquals(await handleBashCommand(ctx), true);

    assertEquals(records.bumps, 1);
    assertEquals(records.userMessages, ["!printf persistent"]);
    assertEquals(records.toolInvoked[0].input, { command: "printf persistent" });
    assertEquals(records.toolBlocks[0].name, "$");
    assertEquals(records.toolBlocks[0].args, "printf persistent");
    assertEquals(records.toolBlocks[0].output, "persistent");
    assertEquals(records.toolBlocks[0].ended, true);
    assertEquals(records.toolBlocks[0].isError, false);
    assertEquals(records.toolResults[0].result, "persistent");
    assertEquals(records.toolResults[0].isError, false);
    assertEquals(records.messages.map((/** @type {{ role: string }} */ message) => message.role), [
        "user",
        "assistant",
        "user",
    ]);
});

Deno.test("handleBashCommand runs ephemeral commands without persisting to session", async () => {
    const { ctx, records } = makeContext();
    ctx.userRequest = "!!printf ephemeral";

    assertEquals(await handleBashCommand(ctx), true);

    assertEquals(records.bumps, 1);
    assertEquals(records.userMessages, []);
    assertEquals(records.messages, []);
    assertEquals(records.toolBlocks[0].output, "ephemeral");
    assertEquals(records.toolResults[0].isError, false);
});

Deno.test("handleBashCommand keeps concurrent commands out of generation guard and persistence", async () => {
    const { ctx, records } = makeContext();
    ctx.userRequest = "!printf concurrent";
    ctx.concurrent = true;

    assertEquals(await handleBashCommand(ctx), true);

    assertEquals(records.bumps, 0);
    assertEquals(records.currentChecks, []);
    assertEquals(records.messages, []);
    assertEquals(records.userMessages, []);
    assertEquals(records.toolBlocks[0].output, "concurrent");
});

Deno.test("handleBashCommand reports non-zero command status as an errored tool result", async () => {
    const { ctx, records } = makeContext();
    ctx.userRequest = "!sh -c 'printf fail >&2; exit 3'";

    assertEquals(await handleBashCommand(ctx), true);

    assertEquals(records.toolBlocks[0].output, "fail");
    assertEquals(records.toolBlocks[0].isError, true);
    assertEquals(records.toolResults[0].isError, true);
    assertEquals(records.messages.at(-1).content[0].is_error, true);
});
