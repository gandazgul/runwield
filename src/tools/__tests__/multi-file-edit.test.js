import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { createMultiFileEditTool } from "../multi_file_edit.js";

/**
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} tool
 * @param {unknown} params
 * @returns {Promise<{ content: Array<{ type: string, text?: string }>, details?: { diff?: string, firstChangedLine?: number }, isError?: boolean }>}
 */
async function executeMultiFileEdit(tool, params) {
    const execute =
        /** @type {(id: string, params: unknown, signal: AbortSignal, onUpdate: () => void, ctx: object) => Promise<any>} */ (tool
            .execute);
    return await execute("multi-file-edit-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("multi_file_edit exposes distinct multi-file schema", () => {
    const tool = createMultiFileEditTool("/tmp");

    assertEquals(tool.name, "multi_file_edit");
    assertEquals(tool.label, "multi_file_edit");
    assertMatch(tool.description, /one or more files/i);

    const properties = /** @type {{ properties: Record<string, any> }} */ (tool.parameters).properties;
    assertEquals(Object.keys(properties), ["root", "edits"]);

    const editProperties = properties.edits.items.properties;
    assertEquals(Object.keys(editProperties), ["path", "oldText", "newText"]);
});

Deno.test("multi_file_edit applies replacements across multiple files", async () => {
    const dir = await Deno.makeTempDir();
    const firstPath = join(dir, "first.txt");
    const secondPath = join(dir, "second.txt");
    await Deno.writeTextFile(firstPath, "alpha\nbeta\ngamma\n");
    await Deno.writeTextFile(secondPath, "one\ntwo\nthree\n");

    const tool = createMultiFileEditTool(dir);
    const result = await executeMultiFileEdit(tool, {
        edits: [
            { path: "first.txt", oldText: "beta", newText: "BETA" },
            { path: "second.txt", oldText: "two", newText: "TWO" },
        ],
    });

    const text = result.content.map((c) => c.text || "").join("");
    assertMatch(text, /2 replacements across 2 files/i);
    assertEquals(result.isError, undefined);
    assertEquals(await Deno.readTextFile(firstPath), "alpha\nBETA\ngamma\n");
    assertEquals(await Deno.readTextFile(secondPath), "one\nTWO\nthree\n");

    await Deno.remove(dir, { recursive: true });
});

Deno.test("multi_file_edit applies same-file replacements against original content", async () => {
    const dir = await Deno.makeTempDir();
    const filePath = join(dir, "same-file.txt");
    await Deno.writeTextFile(filePath, "first\nsecond\nthird\n");

    const tool = createMultiFileEditTool(dir);
    const result = await executeMultiFileEdit(tool, {
        edits: [
            { path: "same-file.txt", oldText: "first", newText: "FIRST" },
            { path: "same-file.txt", oldText: "third", newText: "THIRD" },
        ],
    });

    const text = result.content.map((c) => c.text || "").join("");
    assertMatch(text, /2 replacements across 1 file/i);
    assertEquals(await Deno.readTextFile(filePath), "FIRST\nsecond\nTHIRD\n");

    await Deno.remove(dir, { recursive: true });
});

Deno.test("multi_file_edit accepts legacy single-file multi-replace shape", () => {
    const tool = createMultiFileEditTool("/tmp");
    const prepared = tool.prepareArguments?.({
        path: "legacy.txt",
        edits: [
            { oldText: "a", newText: "A" },
            { oldText: "b", newText: "B" },
        ],
    });

    assertEquals(prepared, {
        edits: [
            { path: "legacy.txt", oldText: "a", newText: "A" },
            { path: "legacy.txt", oldText: "b", newText: "B" },
        ],
    });
});
