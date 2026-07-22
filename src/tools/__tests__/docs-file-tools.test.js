import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { createEditDocsToolDefinition, createWriteDocsToolDefinition } from "../docs-file-tools.js";

/**
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} tool
 * @param {unknown} params
 * @returns {Promise<any>}
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: unknown, signal: AbortSignal, onUpdate: () => void, ctx: object) => Promise<any>} */
        (tool.execute);
    return await execute("docs-tool-call-1", params, new AbortController().signal, () => {}, {});
}

/**
 * @param {unknown} result
 * @returns {string}
 */
function toolText(result) {
    const typed = /** @type {{ content?: Array<{ text?: string }> }} */ (result);
    return (typed.content || []).map((item) => item.text || "").join("\n");
}

Deno.test("write_docs exposes Markdown-only metadata", () => {
    const tool = createWriteDocsToolDefinition("/tmp");
    assertEquals(tool.name, "write_docs");
    assertEquals(tool.label, "write_docs");
    assertMatch(tool.description, /\.md/i);
    assertEquals(typeof tool.execute, "function");
    assertEquals(typeof tool.parameters, "object");
});

Deno.test("edit_docs exposes Markdown-only single-edit metadata", () => {
    const tool = createEditDocsToolDefinition("/tmp");
    assertEquals(tool.name, "edit_docs");
    assertEquals(tool.label, "edit_docs");
    assertMatch(tool.description, /\.md/i);
    assertEquals(typeof tool.execute, "function");
    assertEquals(typeof tool.parameters, "object");

    const properties = /** @type {{ properties: Record<string, unknown> }} */ (tool.parameters).properties;
    assertEquals(Object.keys(properties), ["path", "oldText", "newText"]);
});

Deno.test("write_docs creates and overwrites relative Markdown files, including parent directories", async () => {
    const dir = await Deno.makeTempDir();
    try {
        const tool = createWriteDocsToolDefinition(dir);
        const first = await executeTool(tool, {
            path: "docs/walkthrough.md",
            content: "# Walkthrough\n\nFirst version.\n",
        });
        assertMatch(toolText(first), /Successfully wrote/);
        assertEquals(await Deno.readTextFile(join(dir, "docs", "walkthrough.md")), "# Walkthrough\n\nFirst version.\n");

        const second = await executeTool(tool, {
            path: "docs/walkthrough.md",
            content: "# Walkthrough\n\nSecond version.\n",
        });
        assertMatch(toolText(second), /Successfully wrote/);
        assertEquals(
            await Deno.readTextFile(join(dir, "docs", "walkthrough.md")),
            "# Walkthrough\n\nSecond version.\n",
        );
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("write_docs accepts absolute .md paths and case-insensitive .MD suffix", async () => {
    const dir = await Deno.makeTempDir();
    try {
        const absolutePath = join(dir, "ABSOLUTE.MD");
        const tool = createWriteDocsToolDefinition("/tmp");
        const result = await executeTool(tool, {
            path: absolutePath,
            content: "# Absolute\n",
        });
        assertMatch(toolText(result), /Successfully wrote/);
        assertEquals(await Deno.readTextFile(absolutePath), "# Absolute\n");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("edit_docs replaces one exact block in Markdown", async () => {
    const dir = await Deno.makeTempDir();
    try {
        const filePath = join(dir, "guide.md");
        await Deno.writeTextFile(filePath, "# Guide\n\nOld section.\n");
        const tool = createEditDocsToolDefinition(dir);
        const result = await executeTool(tool, {
            path: "guide.md",
            oldText: "Old section.",
            newText: "New section.",
        });
        assertMatch(toolText(result), /Successfully replaced/);
        assertEquals(await Deno.readTextFile(filePath), "# Guide\n\nNew section.\n");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("edit_docs accepts absolute Markdown paths", async () => {
    const dir = await Deno.makeTempDir();
    try {
        const filePath = join(dir, "absolute.md");
        await Deno.writeTextFile(filePath, "alpha\nbeta\n");
        const tool = createEditDocsToolDefinition("/tmp");
        const result = await executeTool(tool, {
            path: filePath,
            oldText: "beta",
            newText: "gamma",
        });
        assertMatch(toolText(result), /Successfully replaced/);
        assertEquals(await Deno.readTextFile(filePath), "alpha\ngamma\n");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("write_docs rejects non-.md suffixes before creating files", async () => {
    const dir = await Deno.makeTempDir();
    try {
        const tool = createWriteDocsToolDefinition(dir);
        for (const path of ["report.txt", "report.markdown", "report.mdx", "report"]) {
            const result = await executeTool(tool, { path, content: "should not write" });
            assertEquals(result.isError, true);
            assertMatch(toolText(result), /only Markdown \.md files/i);
            let exists = true;
            try {
                await Deno.stat(join(dir, path));
            } catch (error) {
                if (error instanceof Deno.errors.NotFound) exists = false;
                else throw error;
            }
            assertEquals(exists, false, `${path} should not be created`);
        }
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("edit_docs rejects non-.md suffixes before changing files", async () => {
    const dir = await Deno.makeTempDir();
    try {
        const filePath = join(dir, "notes.txt");
        await Deno.writeTextFile(filePath, "alpha\n");
        const tool = createEditDocsToolDefinition(dir);
        const result = await executeTool(tool, {
            path: "notes.txt",
            oldText: "alpha",
            newText: "beta",
        });
        assertEquals(result.isError, true);
        assertMatch(toolText(result), /only Markdown \.md files/i);
        assertEquals(await Deno.readTextFile(filePath), "alpha\n");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
