import { assertArrayIncludes, assertEquals, assertStringIncludes } from "@std/assert";
import cymbalExtension from "./index.js";

/**
 * @param {(command: string, args: string[], opts: { cwd: string }) => Promise<{code: number, stdout: string, stderr: string}> | {code: number, stdout: string, stderr: string}} execImpl
 */
function setup(execImpl) {
    /** @type {Map<string, (event: any, ctx: any) => any>} */
    const handlers = new Map();
    /** @type {Array<{ name: string, execute: (id: string, params: object, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: object | null }>, label: string, description: string, parameters: object }>} */
    const tools = [];
    /** @type {Array<{command: string, args: string[], opts: { cwd: string }}>} */
    const calls = [];

    const pi = /** @type {import('@mariozechner/pi-coding-agent').ExtensionAPI} */ ({
        on(event, handler) {
            handlers.set(event, handler);
        },
        registerTool(tool) {
            tools.push(/** @type {typeof tools[number]} */ (tool));
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

    cymbalExtension(pi);

    /** @param {string} name */
    const getTool = (name) => {
        const tool = tools.find((registeredTool) => registeredTool.name === name);
        if (!tool) throw new Error(`Tool not found in test setup: ${name}`);
        return tool;
    };

    /** @param {string} event */
    const getHandler = (event) => {
        return handlers.get(event);
    };

    return { handlers, tools, calls, getTool, getHandler };
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

Deno.test("cymbal extension registers all tools", () => {
    const { tools } = setup(() => Promise.resolve({ code: 0, stdout: "", stderr: "" }));

    const names = tools.map((tool) => tool.name);
    assertArrayIncludes(names, [
        "code_search",
        "code_show",
        "code_outline",
        "code_refs",
        "code_impact",
        "code_trace",
        "code_investigate",
        "code_structure",
        "code_impls",
        "code_importers",
    ]);

    for (const tool of tools) {
        assertEquals(typeof tool.label, "string");
        assertEquals(typeof tool.description, "string");
        assertEquals(typeof tool.parameters, "object");
        assertEquals(typeof tool.execute, "function");
    }
});

Deno.test("code_search tool executes correctly", async () => {
    const { getTool, calls } = setup(() => Promise.resolve({ code: 0, stdout: "search result", stderr: "" }));
    const tool = getTool("code_search");

    const params = { query: "AuthHandler" };
    const result = await executeTool(tool, params);

    assertEquals(result.details, params);
    assertEquals(firstText(result), "search result");

    const call = calls.at(-1);
    assertEquals(call?.command, "cymbal");
    assertEquals(call?.args, ["search", "AuthHandler"]);
});

Deno.test("cymbal nudge correctly intercepts bash and grep", async () => {
    const { getHandler, calls } = setup((_command, args) => {
        if (args.includes("nudge")) {
            return Promise.resolve({ code: 0, stdout: "", stderr: "Consider using cymbal search instead" });
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    });

    const handler = getHandler("tool_result");
    if (!handler) throw new Error("tool_result handler not registered");

    // Test intercepting grep
    const grepEvent = {
        toolName: "grep",
        input: { pattern: "auth system", path: "src" },
        content: [{ type: "text", text: "original output" }],
    };

    const result = await handler(grepEvent, {});
    assertEquals(calls.at(-1)?.args, ["hook", "nudge", "--format=text", "--", 'grep "auth system" src']);

    // Nudge should be appended
    assertEquals(result.content.length, 2);
    assertEquals(result.content[0].text, "original output");
    assertStringIncludes(result.content[1].text, "Consider using cymbal search instead");
});
