import { assertEquals } from "@std/assert";
import snipExtension from "./index.js";

/**
 * @param {() => Promise<{ configPath: string, filtersDir: string, written: string[] }> | { configPath: string, filtersDir: string, written: string[] }} [ensureFilters]
 */
function setup(ensureFilters = () => ({ configPath: "/home/me/.hns/snip/config.toml", filtersDir: "", written: [] })) {
    /** @type {Map<string, (event: any, ctx: any) => any>} */
    const handlers = new Map();
    let ensureCalls = 0;

    const pi = /** @type {import('@earendil-works/pi-coding-agent').ExtensionAPI} */ ({
        on(event, handler) {
            handlers.set(event, handler);
        },
    });

    snipExtension(pi, {
        async ensureFilters() {
            ensureCalls++;
            return await ensureFilters();
        },
    });

    /** @param {string} event */
    const getHandler = (event) => handlers.get(event);
    return {
        getHandler,
        get ensureCalls() {
            return ensureCalls;
        },
    };
}

Deno.test("snip extension rewrites bash tool calls in place", async () => {
    const setupResult = setup();
    await setupResult.getHandler("session_start")?.({}, { cwd: "/project" });

    const handler = setupResult.getHandler("tool_call");
    if (!handler) throw new Error("tool_call handler not registered");

    const event = { toolName: "bash", input: { command: "deno test" } };
    await handler(event, {});

    assertEquals(event.input.command, "SNIP_CONFIG=/home/me/.hns/snip/config.toml snip run -- deno test");
    assertEquals(setupResult.ensureCalls, 1);
});

Deno.test("snip extension ignores non-bash, empty, already snip, and setup failures", async () => {
    const noOp = setup();
    const noOpHandler = noOp.getHandler("tool_call");
    if (!noOpHandler) throw new Error("tool_call handler not registered");

    const readEvent = { toolName: "read", input: { command: "deno test" } };
    await noOpHandler(readEvent, {});
    assertEquals(noOp.ensureCalls, 0);

    const emptyEvent = { toolName: "bash", input: { command: "  " } };
    await noOpHandler(emptyEvent, {});
    assertEquals(emptyEvent.input.command, "  ");

    const snipEvent = { toolName: "bash", input: { command: "snip run -- deno test" } };
    await noOpHandler(snipEvent, {});
    assertEquals(snipEvent.input.command, "snip run -- deno test");

    const failing = setup(() => Promise.reject(new Error("nope")));
    const failingHandler = failing.getHandler("tool_call");
    if (!failingHandler) throw new Error("tool_call handler not registered");

    const failingEvent = { toolName: "bash", input: { command: "deno test" } };
    await failingHandler(failingEvent, {});
    assertEquals(failingEvent.input.command, "deno test");
});

Deno.test("snip extension handles shell safety and env prefixes", async () => {
    const { getHandler } = setup(() => ({
        configPath: "/home/me/Library Application Support/harns/snip/config.toml",
        filtersDir: "",
        written: [],
    }));
    const handler = getHandler("tool_call");
    if (!handler) throw new Error("tool_call handler not registered");

    const cdEvent = { toolName: "bash", input: { command: "cd repo && deno test" } };
    await handler(cdEvent, {});
    assertEquals(cdEvent.input.command, "cd repo && deno test");

    const envEvent = { toolName: "bash", input: { command: "FOO=1 deno test" } };
    await handler(envEvent, {});
    assertEquals(
        envEvent.input.command,
        "FOO=1 SNIP_CONFIG='/home/me/Library Application Support/harns/snip/config.toml' snip run -- deno test",
    );

    const chainEvent = { toolName: "bash", input: { command: "deno test && echo done" } };
    await handler(chainEvent, {});
    assertEquals(
        chainEvent.input.command,
        "SNIP_CONFIG='/home/me/Library Application Support/harns/snip/config.toml' snip run -- deno test && echo done",
    );

    const configEvent = {
        toolName: "bash",
        input: { command: "SNIP_CONFIG=/tmp/custom.toml deno lint" },
    };
    await handler(configEvent, {});
    assertEquals(configEvent.input.command, "SNIP_CONFIG=/tmp/custom.toml snip run -- deno lint");

    const snippetEvent = { toolName: "bash", input: { command: "snippets list" } };
    await handler(snippetEvent, {});
    assertEquals(
        snippetEvent.input.command,
        "SNIP_CONFIG='/home/me/Library Application Support/harns/snip/config.toml' snip run -- snippets list",
    );
});
