import { assertEquals, assertMatch } from "@std/assert";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMnemosyneTools, type MnemosyneToolHost } from "./tools.ts";
import type { HelperBinaryExecResult } from "../helper-binary-exec.ts";

interface RecordedCall {
    command: string;
    args: string[];
    cwd: string;
}

function setup(
    execImpl: (
        command: string,
        args: string[],
        cwd: string,
    ) => HelperBinaryExecResult | Promise<HelperBinaryExecResult>,
) {
    const calls: RecordedCall[] = [];
    const host: MnemosyneToolHost = {
        cwd: "/tmp/worktrees/project-feature",
        async exec(command, args, options) {
            calls.push({ command, args, cwd: options.cwd });
            return await execImpl(command, args, options.cwd);
        },
    };
    const tools = createMnemosyneTools(host);
    const getTool = (name: string) => {
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`tool not found: ${name}`);
        return tool;
    };
    return { calls, getTool, host };
}

function fakeContext(): ExtensionContext {
    return {} as ExtensionContext;
}

async function executeText(
    tool: ReturnType<ReturnType<typeof setup>["getTool"]>,
    params: Record<string, string | number | boolean>,
) {
    const result = await tool.execute("call", params, new AbortController().signal, () => undefined, fakeContext());
    return result.content[0]?.type === "text" ? result.content[0].text : "";
}

Deno.test("memory_recall lazily resolves the primary checkout collection and escapes quotes", async () => {
    const { calls, getTool } = setup((command, args) => {
        if (command === "git") return { code: 0, stdout: "/repo/runwield/.git\n", stderr: "" };
        if (args[0] === "init") return { code: 0, stdout: "", stderr: "" };
        return { code: 0, stdout: "hit", stderr: "" };
    });

    const text = await executeText(getTool("memory_recall"), { query: 'he said "hello"' });

    assertEquals(text, "hit");
    assertEquals(calls.map((call) => call.command), ["git", "mnemosyne", "mnemosyne"]);
    assertEquals(calls[1]?.args, ["init", "--name", "runwield"]);
    assertEquals(calls[2]?.args, ["search", "--name", "runwield", "--format", "plain", '"he said ""hello"""']);
});

Deno.test("project and global store calls pass the correct scope and core tag", async () => {
    const { calls, getTool } = setup((command, args) => {
        if (command === "git") return { code: 1, stdout: "", stderr: "" };
        return { code: 0, stdout: args[0] === "add" ? "stored" : "", stderr: "" };
    });

    await executeText(getTool("memory_store"), { content: "Use deno task ci", core: true });
    await executeText(getTool("memory_store_global"), { content: "Prefer STE", core: true });

    assertEquals(calls[2]?.args, ["add", "--name", "project-feature", "--tag", "core", "Use deno task ci"]);
    assertEquals(calls[3]?.args, ["init", "--global"]);
    assertEquals(calls[4]?.args, ["add", "--global", "--tag", "core", "Prefer STE"]);
});

Deno.test("missing mnemosyne binary returns installer guidance", async () => {
    const { getTool } = setup((command) => {
        if (command === "git") return { code: 1, stdout: "", stderr: "" };
        return { code: 127, stdout: "", stderr: "" };
    });

    const text = await executeText(getTool("memory_recall"), { query: "test" });

    assertMatch(text, /mnemosyne binary not found/i);
});

Deno.test("empty memory results use scope-specific fallback text", async () => {
    const { getTool } = setup((command) => {
        if (command === "git") return { code: 1, stdout: "", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
    });

    assertEquals(await executeText(getTool("memory_recall"), { query: "test" }), "No memories found.");
    assertEquals(await executeText(getTool("memory_recall_global"), { query: "test" }), "No global memories found.");
});
