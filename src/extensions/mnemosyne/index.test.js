import { assertArrayIncludes, assertEquals, assertMatch } from "@std/assert";
import mnemosyneExtension from "./index.js";

/**
 * @param {(command: string, args: string[], opts: { cwd: string }) => Promise<{code: number, stdout: string, stderr: string}> | {code: number, stdout: string, stderr: string}} execImpl
 */
function setup(execImpl) {
    /** @type {Map<string, (event: object, ctx: object) => unknown>} */
    const handlers = new Map();
    /** @type {Array<any>} */
    const tools = [];
    /** @type {Array<{command: string, args: string[], opts: { cwd: string }}>} */
    const calls = [];

    const pi = /** @type {import('@earendil-works/pi-coding-agent').ExtensionAPI} */ ({
        on(event, handler) {
            handlers.set(event, /** @type {(event: object, ctx: object) => unknown} */ (handler));
        },
        registerTool(tool) {
            tools.push(tool);
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

    mnemosyneExtension(pi);

    /** @param {string} name */
    const getTool = (name) => {
        const tool = tools.find((registeredTool) => registeredTool.name === name);
        if (!tool) throw new Error(`Tool not found in test setup: ${name}`);
        return tool;
    };

    return { handlers, tools, calls, getTool };
}

/**
 * @param {{ execute: unknown }} tool
 * @param {object} params
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: object, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: unknown }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, {});
}

/**
 * @param {{ content: Array<{ type: string, text?: string }> }} result
 */
function firstText(result) {
    const first = result.content[0];
    assertEquals(first?.type, "text");
    if (!first || first.type !== "text") throw new Error("Expected text content.");
    return first.text ?? "";
}

Deno.test("mnemosyne extension registers all memory tools", () => {
    const { tools } = setup(() => Promise.resolve({ code: 0, stdout: "", stderr: "" }));

    const names = tools.map((tool) => tool.name);
    assertArrayIncludes(names, [
        "memory_recall",
        "memory_recall_global",
        "memory_store",
        "memory_store_global",
        "memory_delete",
    ]);

    for (const tool of tools) {
        assertEquals(typeof tool.label, "string");
        assertEquals(typeof tool.description, "string");
        assertEquals(typeof tool.parameters, "object");
        assertEquals(typeof tool.execute, "function");
    }
});

Deno.test("memory_recall searches project memory and escapes quotes", async () => {
    const { getTool, calls } = setup(() => Promise.resolve({ code: 0, stdout: "  found memory  \n", stderr: "" }));
    const tool = getTool("memory_recall");

    const params = { query: 'he said "hello"' };
    const result = await executeTool(tool, params);

    assertEquals(result.details, params);
    assertEquals(firstText(result), "found memory");

    const call = calls.at(-1);
    assertEquals(call?.command, "mnemosyne");
    assertEquals(call?.args, [
        "search",
        "--name",
        "default",
        "--format",
        "plain",
        '"he said ""hello"""',
    ]);
});

Deno.test("memory_recall returns missing binary message when mnemosyne is unavailable", async () => {
    const { getTool } = setup(() => Promise.resolve({ code: 127, stdout: "", stderr: "" }));
    const tool = getTool("memory_recall");

    const result = await executeTool(tool, { query: "test" });

    assertMatch(firstText(result), /mnemosyne binary not found/i);
});

Deno.test("memory_recall_global searches global memory", async () => {
    const { getTool, calls } = setup(() => Promise.resolve({ code: 0, stdout: "global hit", stderr: "" }));
    const tool = getTool("memory_recall_global");

    const params = { query: "coding style" };
    const result = await executeTool(tool, params);

    assertEquals(result.details, params);
    assertEquals(firstText(result), "global hit");
    assertEquals(calls.at(-1)?.args, [
        "search",
        "--global",
        "--format",
        "plain",
        '"coding style"',
    ]);
});

Deno.test("memory_store adds project memory with optional core tag", async () => {
    const { getTool, calls } = setup(() => Promise.resolve({ code: 0, stdout: "stored", stderr: "" }));
    const tool = getTool("memory_store");

    const params = { content: "Use deno task ci", core: true };
    const result = await executeTool(tool, params);

    assertEquals(result.details, params);
    assertEquals(firstText(result), "stored");
    assertEquals(calls.at(-1)?.args, [
        "add",
        "--name",
        "default",
        "--tag",
        "core",
        "Use deno task ci",
    ]);
});

Deno.test("memory_store_global initializes global storage then adds memory", async () => {
    const { getTool, calls } = setup(() => Promise.resolve({ code: 0, stdout: "ok", stderr: "" }));
    const tool = getTool("memory_store_global");

    const params = { content: "Prefer concise commit messages", core: true };
    const result = await executeTool(tool, params);

    assertEquals(result.details, params);
    assertEquals(firstText(result), "ok");
    assertEquals(calls[0]?.args, ["init", "--global"]);
    assertEquals(calls[1]?.args, [
        "add",
        "--global",
        "--tag",
        "core",
        "Prefer concise commit messages",
    ]);
});

Deno.test("memory_delete deletes by id and uses fallback message for empty output", async () => {
    const { getTool, calls } = setup(() => Promise.resolve({ code: 0, stdout: "   ", stderr: "" }));
    const tool = getTool("memory_delete");

    const params = { id: 42 };
    const result = await executeTool(tool, params);

    assertEquals(result.details, params);
    assertEquals(firstText(result), "Memory deleted.");
    assertEquals(calls.at(-1)?.args, ["delete", "42"]);
});
