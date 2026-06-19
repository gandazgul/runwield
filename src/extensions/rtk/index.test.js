import { assertEquals } from "@std/assert";
import rtkExtension from "./index.js";

/**
 * @param {(command: string, args: string[], opts: { cwd: string }) => Promise<{code: number, stdout: string, stderr: string}> | {code: number, stdout: string, stderr: string}} execImpl
 */
function setup(execImpl) {
    /** @type {Map<string, (event: any, ctx: any) => any>} */
    const handlers = new Map();
    /** @type {Array<{command: string, args: string[], opts: { cwd: string }}>} */
    const calls = [];

    const pi = /** @type {import('@earendil-works/pi-coding-agent').ExtensionAPI} */ ({
        on(event, handler) {
            handlers.set(event, handler);
        },
        async exec(
            /** @type {string} */ command,
            /** @type {string[]} */ args,
            /** @type {{ cwd: string }} */ opts,
        ) {
            calls.push({ command, args, opts });
            return await execImpl(command, args, opts);
        },
    });

    rtkExtension(pi);

    /** @param {string} event */
    const getHandler = (event) => handlers.get(event);

    return { calls, getHandler };
}

Deno.test("rtk extension rewrites bash tool calls in place", async () => {
    const { calls, getHandler } = setup(() =>
        Promise.resolve({
            code: 0,
            stdout: "rtk deno task test\n",
            stderr: "",
        })
    );
    getHandler("session_start")?.({}, { cwd: "/project" });

    const handler = getHandler("tool_call");
    if (!handler) throw new Error("tool_call handler not registered");

    const event = { toolName: "bash", input: { command: "deno task test" } };
    await handler(event, {});

    assertEquals(event.input.command, "rtk deno task test");
    assertEquals(calls, [{
        command: "rtk",
        args: ["rewrite", "deno task test"],
        opts: { cwd: "/project" },
    }]);
});

Deno.test("rtk extension ignores non-bash, already rewritten, no-op, and failed rewrites", async () => {
    const noOp = setup(() => Promise.resolve({ code: 0, stdout: "git status\n", stderr: "" }));
    const noOpHandler = noOp.getHandler("tool_call");
    if (!noOpHandler) throw new Error("tool_call handler not registered");

    const readEvent = { toolName: "read", input: { command: "git status" } };
    await noOpHandler(readEvent, {});
    assertEquals(noOp.calls, []);

    const rtkEvent = { toolName: "bash", input: { command: "rtk git status" } };
    await noOpHandler(rtkEvent, {});
    assertEquals(noOp.calls, []);

    const sameEvent = { toolName: "bash", input: { command: "git status" } };
    await noOpHandler(sameEvent, {});
    assertEquals(sameEvent.input.command, "git status");

    const failing = setup(() => Promise.resolve({ code: 1, stdout: "", stderr: "nope" }));
    const failingHandler = failing.getHandler("tool_call");
    if (!failingHandler) throw new Error("tool_call handler not registered");

    const failingEvent = { toolName: "bash", input: { command: "deno test" } };
    await failingHandler(failingEvent, {});
    assertEquals(failingEvent.input.command, "deno test");
});

Deno.test("rtk extension bypasses RTK for excluded binaries like git", async () => {
    const spy = setup(() => Promise.resolve({ code: 0, stdout: "rtk whatever\n", stderr: "" }));
    const handler = spy.getHandler("tool_call");
    if (!handler) throw new Error("tool_call handler not registered");

    // git commands should not call rtk at all
    const gitEvent = { toolName: "bash", input: { command: "git status" } };
    await handler(gitEvent, {});
    assertEquals(gitEvent.input.command, "git status");
    assertEquals(spy.calls, [], "should not call rtk for git commands");

    // git with subcommands and flags
    const diffEvent = { toolName: "bash", input: { command: "git diff --cached" } };
    await handler(diffEvent, {});
    assertEquals(diffEvent.input.command, "git diff --cached");
    assertEquals(spy.calls, [], "should not call rtk for git diff");

    // other commands still go through rtk
    const denoEvent = { toolName: "bash", input: { command: "deno test" } };
    await handler(denoEvent, {});
    assertEquals(spy.calls.length, 1, "should call rtk for non-excluded commands");
});
