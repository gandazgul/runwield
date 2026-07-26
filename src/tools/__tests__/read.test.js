import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { Text } from "@earendil-works/pi-tui";
import { __test, createRunWieldReadToolDefinition } from "../read.js";

/**
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} tool
 * @param {unknown} params
 * @returns {Promise<{ content: Array<{ type: string, text?: string }>, details?: any, isError?: boolean }>}
 */
async function executeRead(tool, params) {
    const execute =
        /** @type {(id: string, params: unknown, signal: AbortSignal, onUpdate: () => void, ctx: object) => Promise<any>} */ (tool
            .execute);
    return await execute("read-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("read wrapper exposes expected metadata", () => {
    const tool = createRunWieldReadToolDefinition("/tmp");

    assertEquals(tool.name, "read");
    assertEquals(tool.label, "read");
    assertEquals(typeof tool.execute, "function");
    assertStringIncludes(tool.description || "", "Suppresses binary/control-byte text");
});

Deno.test("read wrapper still returns binary git index content to the model", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await Deno.mkdir(join(dir, ".git"), { recursive: true });
        await Deno.writeFile(join(dir, ".git", "index"), new Uint8Array([68, 73, 82, 67, 0, 7, 1, 2]));

        const tool = createRunWieldReadToolDefinition(dir);
        const result = await executeRead(tool, { path: ".git/index" });

        assertEquals(result.isError, undefined);
        assertEquals(result.details?.blocked, undefined);
        assertStringIncludes(result.content[0].text || "", "DIRC");
        assertEquals((result.content[0].text || "").includes("\u0007"), true);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("read wrapper renders binary/control-byte results as header-only output", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await Deno.writeFile(join(dir, "blob.bin"), new Uint8Array([97, 7, 98]));

        const tool = createRunWieldReadToolDefinition(dir);
        const result = await executeRead(tool, { path: "blob.bin" });
        const component = /** @type {Text} */ (tool.renderResult?.(
            /** @type {any} */ (result),
            /** @type {any} */ ({ expanded: true }),
            /** @type {any} */ ({}),
            /** @type {any} */ ({ lastComponent: new Text("stale", 0, 0) }),
        ));

        assertEquals(component.render(80), []);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("read wrapper delegates image rendering to terminal capability handling", () => {
    const tool = createRunWieldReadToolDefinition("/tmp");
    const component = /** @type {Text} */ (tool.renderResult?.(
        /** @type {any} */ ({
            content: [
                { type: "text", text: "Read image file [image/png]" },
                { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
            ],
        }),
        /** @type {any} */ ({ expanded: true }),
        /** @type {any} */ ({ fg: (/** @type {string} */ _name, /** @type {string} */ text) => text }),
        /** @type {any} */ ({
            lastComponent: new Text("", 0, 0),
            args: { path: "image.png" },
            showImages: false,
        }),
    ));

    const rendered = component.render(80).join("\n");
    assertStringIncludes(rendered, "Read image file [image/png]");
    assertStringIncludes(rendered, "image/png");
});

Deno.test("read wrapper allows normal text files to render normally", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await Deno.writeTextFile(join(dir, "README.md"), "# Hello\n\nSafe text.\n");

        const tool = createRunWieldReadToolDefinition(dir);
        const result = await executeRead(tool, { path: "README.md" });
        const component = /** @type {Text} */ (tool.renderResult?.(
            /** @type {any} */ (result),
            /** @type {any} */ ({ expanded: true }),
            /** @type {any} */ ({ fg: (/** @type {string} */ _name, /** @type {string} */ text) => text }),
            /** @type {any} */ ({ lastComponent: new Text("", 0, 0), args: { path: "README.md" } }),
        ));

        assertEquals(result.isError, undefined);
        assertStringIncludes(result.content[0].text || "", "# Hello");
        assertEquals(component.render(80).join("\n").includes("# Hello"), true);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("read wrapper unsafe display detection catches bell, nul, and replacement chars", () => {
    assertEquals(__test.containsUnsafeDisplayText("A\t\n\rB"), false);
    assertEquals(__test.containsUnsafeDisplayText("A\u0007B"), true);
    assertEquals(__test.containsUnsafeDisplayText("A\u0000B"), true);
    assertEquals(__test.containsUnsafeDisplayText("A\ufffdB"), true);
});
