import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { __test, createHarnsGrepToolDefinition } from "../grep.js";

/**
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} tool
 * @param {unknown} params
 * @returns {Promise<{ content: Array<{ type: string, text?: string }>, details?: any }>}
 */
async function executeGrep(tool, params) {
    const execute =
        /** @type {(id: string, params: unknown, signal: AbortSignal, onUpdate: () => void, ctx: object) => Promise<any>} */ (tool
            .execute);
    return await execute("grep-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("grep wrapper exposes expected metadata and prepares paths alias", () => {
    const tool = createHarnsGrepToolDefinition("/tmp");

    assertEquals(tool.name, "grep");
    assertEquals(tool.label, "grep");
    assertEquals(typeof tool.execute, "function");
    assertEquals(tool.prepareArguments?.({ pattern: "needle", paths: ["src", "tests"] }), {
        pattern: "needle",
        paths: ["src", "tests"],
        path: ["src", "tests"],
    });
});

Deno.test("grep wrapper splits shell-shaped paths while preserving quotes", () => {
    assertEquals(__test.splitShellLike("src/shared/session src/cmd"), ["src/shared/session", "src/cmd"]);
    assertEquals(__test.splitShellLike('"src/with space" src/cmd'), ["src/with space", "src/cmd"]);
    assertEquals(__test.splitShellLike("'plans/feature*.md' src"), ["plans/feature*.md", "src"]);
});

Deno.test("grep wrapper searches multiple paths passed as one string", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await Deno.mkdir(join(dir, "src", "shared", "session"), { recursive: true });
        await Deno.mkdir(join(dir, "src", "cmd"), { recursive: true });
        await Deno.writeTextFile(
            join(dir, "src", "shared", "session", "chat-session.js"),
            "export function setActiveAgent() {}\n",
        );
        await Deno.writeTextFile(
            join(dir, "src", "cmd", "agents.js"),
            "const current = 'setActiveAgent';\n",
        );

        const tool = createHarnsGrepToolDefinition(dir);
        const result = await executeGrep(tool, {
            pattern: "setActiveAgent",
            path: "src/shared/session src/cmd",
        });
        const text = result.content.map((part) => part.text || "").join("");

        assertStringIncludes(text, "src/shared/session/chat-session.js:1:");
        assertStringIncludes(text, "src/cmd/agents.js:1:");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("grep wrapper searches a path glob mixed with a normal path", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await Deno.mkdir(join(dir, "plans"), { recursive: true });
        await Deno.mkdir(join(dir, "src"), { recursive: true });
        await Deno.writeTextFile(join(dir, "plans", "feature-one.md"), "finalize this slice\n");
        await Deno.writeTextFile(join(dir, "plans", "project.md"), "finalize the project\n");
        await Deno.writeTextFile(join(dir, "src", "workflow.js"), "const step = 'finalize';\n");

        const tool = createHarnsGrepToolDefinition(dir);
        const result = await executeGrep(tool, {
            pattern: "finaliz",
            path: "plans/feature*.md src",
        });
        const text = result.content.map((part) => part.text || "").join("");

        assertStringIncludes(text, "plans/feature-one.md:1:");
        assertStringIncludes(text, "src/workflow.js:1:");
        assertEquals(text.includes("plans/project.md"), false);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("grep wrapper preserves path prefix for a single path glob", async () => {
    const dir = await Deno.makeTempDir();
    try {
        await Deno.mkdir(join(dir, "plans"), { recursive: true });
        await Deno.writeTextFile(join(dir, "plans", "feature-two.md"), "finalize this slice\n");

        const tool = createHarnsGrepToolDefinition(dir);
        const result = await executeGrep(tool, {
            pattern: "finaliz",
            path: "plans/feature*.md",
        });
        const text = result.content.map((part) => part.text || "").join("");

        assertStringIncludes(text, "plans/feature-two.md:1:");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
