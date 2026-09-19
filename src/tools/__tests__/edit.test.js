import { assertEquals, assertMatch, assertNotMatch, assertRejects, fail } from "@std/assert";
import { join } from "@std/path";
import { createSingleEditToolDefinition } from "../edit.js";

/**
 * Helper to execute the edit tool with typed parameters.
 *
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} tool
 * @param {unknown} params
 * @returns {Promise<{ content: Array<{ type: string, text?: string }>, details?: { diff?: string, firstChangedLine?: number } }>}
 */
async function executeEdit(tool, params) {
    const execute =
        /** @type {(id: string, params: unknown, signal: AbortSignal, onUpdate: () => void, ctx: object) => Promise<any>} */ (tool
            .execute);
    return await execute("edit-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("createSingleEditToolDefinition exposes expected metadata", () => {
    const tool = createSingleEditToolDefinition("/tmp");
    assertEquals(tool.name, "edit");
    assertEquals(tool.label, "edit");
    assertMatch(tool.description, /single file/i);
    assertEquals(typeof tool.execute, "function");
    assertEquals(typeof tool.parameters, "object");

    const properties = /** @type {{ properties: Record<string, unknown> }} */ (tool.parameters).properties;
    assertEquals(Object.keys(properties), ["path", "oldText", "newText"]);
});

Deno.test("edit: normal successful edit", async () => {
    const dir = await Deno.makeTempDir();
    const filePath = join(dir, "test.txt");
    const originalContent = "Hello world\nFoo bar\nBaz qux\n";
    await Deno.writeTextFile(filePath, originalContent);

    const tool = createSingleEditToolDefinition(dir);
    const result = await executeEdit(tool, {
        path: "test.txt",
        oldText: "Foo bar",
        newText: "Foo baz",
    });

    const text = result.content.map((c) => c.text || "").join("");
    assertMatch(text, /successfully replaced/i);
    assertMatch(text, /1 block/i);

    // Verify file was actually modified
    const afterContent = await Deno.readTextFile(filePath);
    assertEquals(afterContent, "Hello world\nFoo baz\nBaz qux\n");

    await Deno.remove(dir, { recursive: true });
});

Deno.test("edit: propagates permission errors without file contents", async () => {
    const dir = await Deno.makeTempDir();
    const filePath = join(dir, "readonly.txt");
    const originalContent = "Line 1: alpha\nLine 2: beta\nLine 3: gamma\nLine 4: delta\n";
    await Deno.writeTextFile(filePath, originalContent);

    // Make file read-only
    const stat = await Deno.stat(filePath);
    if (stat.mode !== null) {
        await Deno.chmod(filePath, 0o444);
    }

    try {
        const tool = createSingleEditToolDefinition(dir);
        const error = await assertRejects(() =>
            executeEdit(tool, {
                path: filePath,
                oldText: "Line 2: beta",
                newText: "Line 2: replaced",
            }), Error);
        assertMatch(error.message, /permission denied|EACCES/i);
        assertNotMatch(error.message, /Line 1: alpha|Line 4: delta|File exists on disk/);
        assertEquals(await Deno.readTextFile(filePath), originalContent);
    } finally {
        await Deno.chmod(filePath, 0o644);
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("edit: failed match in a large file does not dump source", async () => {
    const dir = await Deno.makeTempDir();
    const filePath = join(dir, "large.txt");

    // Create a file with well over 1000 lines
    const lines = [];
    for (let i = 1; i <= 1500; i++) {
        lines.push(`Line ${i}: content data here`);
    }
    const originalContent = lines.join("\n");
    await Deno.writeTextFile(filePath, originalContent);

    try {
        const tool = createSingleEditToolDefinition(dir);
        const error = await assertRejects(() =>
            executeEdit(tool, {
                path: filePath,
                oldText: "This text is absent from the file",
                newText: "replacement",
            }), Error);
        assertMatch(error.message, /not find|not found|match/i);
        assertNotMatch(error.message, /content data here|Showing first|File exists on disk/);
        assertEquals(await Deno.readTextFile(filePath), originalContent);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("edit: propagates error when file does not exist", async () => {
    const dir = await Deno.makeTempDir();
    const tool = createSingleEditToolDefinition(dir);

    try {
        await executeEdit(tool, {
            path: "nonexistent-file.txt",
            oldText: "anything",
            newText: "replacement",
        });
        fail("Expected an error but edit succeeded");
    } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
        const ok = msg.includes("could not edit file") ||
            msg.includes("cannot") ||
            msg.includes("not found") ||
            msg.includes("no such file");
        if (!ok) {
            throw new Error(`Unexpected error message: ${msg}`);
        }
    }

    await Deno.remove(dir, { recursive: true });
});

Deno.test("edit: rejects an empty path", async () => {
    const tool = createSingleEditToolDefinition("/tmp");

    try {
        await executeEdit(tool, {
            path: "",
            oldText: "a",
            newText: "b",
        });
        fail("Expected an error but edit succeeded");
    } catch {
        // Expected — error was thrown
    }
});

Deno.test("edit: works with relative path", async () => {
    const dir = await Deno.makeTempDir();
    const filePath = join(dir, "relative-test.txt");
    const originalContent = "First line\nSecond line\nThird line\n";
    await Deno.writeTextFile(filePath, originalContent);

    const tool = createSingleEditToolDefinition(dir);
    const result = await executeEdit(tool, {
        path: "relative-test.txt",
        oldText: "Second line",
        newText: "Second line (edited)",
    });

    const text = result.content.map((c) => c.text || "").join("");
    assertMatch(text, /successfully replaced/i);

    await Deno.remove(dir, { recursive: true });
});

Deno.test("edit: accepts legacy single-entry edits array", async () => {
    const dir = await Deno.makeTempDir();
    const filePath = join(dir, "legacy-test.txt");
    await Deno.writeTextFile(filePath, "First line\nSecond line\n");

    const tool = createSingleEditToolDefinition(dir);
    const prepared = tool.prepareArguments?.({
        path: "legacy-test.txt",
        edits: [{ oldText: "Second line", newText: "Updated line" }],
    });

    assertEquals(prepared, {
        path: "legacy-test.txt",
        oldText: "Second line",
        newText: "Updated line",
    });

    const result = await executeEdit(tool, prepared);
    const text = result.content.map((c) => c.text || "").join("");
    assertMatch(text, /successfully replaced/i);
    assertEquals(await Deno.readTextFile(filePath), "First line\nUpdated line\n");

    await Deno.remove(dir, { recursive: true });
});
