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
    assertStringIncludes(tool.description || "", "Blocks binary/control-byte files");
});

Deno.test("read wrapper blocks binary git index before bytes reach output", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await Deno.mkdir(join(dir, ".git"), { recursive: true });
        await Deno.writeFile(join(dir, ".git", "index"), new Uint8Array([68, 73, 82, 67, 0, 7, 1, 2]));

        const tool = createRunWieldReadToolDefinition(dir);
        const result = await executeRead(tool, { path: ".git/index" });

        assertEquals(result.isError, undefined);
        assertEquals(result.details?.blocked, true);
        assertEquals(result.details?.reason, "binary-content");
        assertStringIncludes(result.content[0].text || "", "does not appear to be safe UTF-8 text");
        assertEquals((result.content[0].text || "").includes("\u0007"), false);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("read wrapper blocks non-image binary/control-byte files", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await Deno.writeFile(join(dir, "blob.bin"), new Uint8Array([97, 108, 112, 104, 97, 7, 98, 101, 116, 97]));

        const tool = createRunWieldReadToolDefinition(dir);
        const result = await executeRead(tool, { path: "blob.bin" });

        assertEquals(result.isError, undefined);
        assertEquals(result.details?.blocked, true);
        assertEquals(result.details?.reason, "binary-content");
        assertStringIncludes(result.content[0].text || "", "does not appear to be safe UTF-8 text");
        assertEquals((result.content[0].text || "").includes("\u0007"), false);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("read wrapper renders blocked binary results as header-only output", async () => {
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

Deno.test("read wrapper allows normal text files", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await Deno.writeTextFile(join(dir, "README.md"), "# Hello\n\nSafe text.\n");

        const tool = createRunWieldReadToolDefinition(dir);
        const result = await executeRead(tool, { path: "README.md" });

        assertEquals(result.isError, undefined);
        assertStringIncludes(result.content[0].text || "", "# Hello");
        assertStringIncludes(result.content[0].text || "", "Safe text.");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("read wrapper unsafe-byte detection catches bell and nul bytes", () => {
    assertEquals(__test.containsUnsafeTextBytes(new Uint8Array([65, 9, 10, 13, 66])), false);
    assertEquals(__test.containsUnsafeTextBytes(new Uint8Array([65, 7, 66])), true);
    assertEquals(__test.containsUnsafeTextBytes(new Uint8Array([65, 0, 66])), true);
});
