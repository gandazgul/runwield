import { assertEquals } from "@std/assert";
import snipExtension from "./index.js";

const SNIP_NO_FILTER_STDERR_FILTER =
    `2> >(grep -vE '^snip: no filter for ".+", passing through -- you can run ".+" directly$' >&2)`;

function setup() {
    /** @type {Map<string, (event: any, ctx: any) => any>} */
    const handlers = new Map();

    const pi = /** @type {import('@earendil-works/pi-coding-agent').ExtensionAPI} */ ({
        on(event, handler) {
            handlers.set(event, handler);
        },
    });

    snipExtension(pi);

    /** @param {string} event */
    const getHandler = (event) => handlers.get(event);
    return { getHandler };
}

Deno.test("snip extension rewrites bash tool calls in place", async () => {
    const setupResult = setup();

    const handler = setupResult.getHandler("tool_call");
    if (!handler) throw new Error("tool_call handler not registered");

    const event = { toolName: "bash", input: { command: "deno test" } };
    await handler(event, {});

    assertEquals(event.input.command, `snip run -- deno test ${SNIP_NO_FILTER_STDERR_FILTER}`);
});

Deno.test("snip extension ignores non-bash, empty, and already snip commands", async () => {
    const noOp = setup();
    const noOpHandler = noOp.getHandler("tool_call");
    if (!noOpHandler) throw new Error("tool_call handler not registered");

    const readEvent = { toolName: "read", input: { command: "deno test" } };
    await noOpHandler(readEvent, {});

    const emptyEvent = { toolName: "bash", input: { command: "  " } };
    await noOpHandler(emptyEvent, {});
    assertEquals(emptyEvent.input.command, "  ");

    const snipEvent = { toolName: "bash", input: { command: "snip run -- deno test" } };
    await noOpHandler(snipEvent, {});
    assertEquals(snipEvent.input.command, "snip run -- deno test");
});

Deno.test("snip extension handles shell safety and env prefixes", async () => {
    const { getHandler } = setup();
    const handler = getHandler("tool_call");
    if (!handler) throw new Error("tool_call handler not registered");

    const cdEvent = { toolName: "bash", input: { command: "cd repo && deno test" } };
    await handler(cdEvent, {});
    assertEquals(cdEvent.input.command, "cd repo && deno test");

    const gitCloneEvent = {
        toolName: "bash",
        input: { command: "git clone https://example.test/repo.git third_party/repo" },
    };
    await handler(gitCloneEvent, {});
    assertEquals(gitCloneEvent.input.command, "git clone https://example.test/repo.git third_party/repo");

    const gitWorktreeEvent = { toolName: "bash", input: { command: "git worktree add -b demo ../demo HEAD" } };
    await handler(gitWorktreeEvent, {});
    assertEquals(gitWorktreeEvent.input.command, "git worktree add -b demo ../demo HEAD");

    const gitDiffEvent = { toolName: "bash", input: { command: "/usr/bin/git -C repo diff --cached" } };
    await handler(gitDiffEvent, {});
    assertEquals(gitDiffEvent.input.command, "/usr/bin/git -C repo diff --cached");

    const envEvent = { toolName: "bash", input: { command: "FOO=1 deno test" } };
    await handler(envEvent, {});
    assertEquals(envEvent.input.command, `FOO=1 snip run -- deno test ${SNIP_NO_FILTER_STDERR_FILTER}`);

    const chainEvent = { toolName: "bash", input: { command: "deno test && echo done" } };
    await handler(chainEvent, {});
    assertEquals(chainEvent.input.command, `snip run -- deno test ${SNIP_NO_FILTER_STDERR_FILTER}&& echo done`);

    const extraEnvEvent = {
        toolName: "bash",
        input: { command: "BAR=/tmp/custom deno lint" },
    };
    await handler(extraEnvEvent, {});
    assertEquals(extraEnvEvent.input.command, `BAR=/tmp/custom snip run -- deno lint ${SNIP_NO_FILTER_STDERR_FILTER}`);

    const snippetEvent = { toolName: "bash", input: { command: "snippets list" } };
    await handler(snippetEvent, {});
    assertEquals(snippetEvent.input.command, `snip run -- snippets list ${SNIP_NO_FILTER_STDERR_FILTER}`);
});
