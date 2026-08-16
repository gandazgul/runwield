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
    return { calls, getTool, host, tools };
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

Deno.test("memory tools expose only unified recall and write", () => {
    const { tools } = setup(() => ({ code: 0, stdout: "", stderr: "" }));

    assertEquals(tools.map((tool) => tool.name), ["memory_recall", "memory_write"]);
});

Deno.test("memory_recall searches project and global memory with labeled provenance", async () => {
    const { calls, getTool } = setup((command, args) => {
        if (command === "git") return { code: 0, stdout: "/repo/runwield/.git\n", stderr: "" };
        if (args[0] === "init") return { code: 0, stdout: "", stderr: "" };
        if (args.includes("--global")) return { code: 0, stdout: "global hit", stderr: "" };
        return { code: 0, stdout: "project hit", stderr: "" };
    });

    const text = await executeText(getTool("memory_recall"), { query: 'he said "hello"' });

    assertEquals(
        text,
        "Project memories (runwield) — these take precedence over global memories:\nproject hit\n\nGlobal memories (cross-project defaults):\nglobal hit",
    );
    assertEquals(calls.map((call) => call.command), ["git", "mnemosyne", "mnemosyne", "mnemosyne"]);
    assertEquals(calls[1]?.args, ["init", "--name", "runwield"]);
    assertEquals(calls[2]?.args, ["search", "--name", "runwield", "--format", "plain", '"he said ""hello"""']);
    assertEquals(calls[3]?.args, ["search", "--global", "--format", "plain", '"he said ""hello"""']);
});

Deno.test("memory_recall returns one missing binary message", async () => {
    const { getTool } = setup((command) => {
        if (command === "git") return { code: 1, stdout: "", stderr: "" };
        return { code: 127, stdout: "", stderr: "" };
    });

    const text = await executeText(getTool("memory_recall"), { query: "test" });

    assertMatch(text, /mnemosyne binary not found/i);
    assertEquals(text.match(/mnemosyne binary not found/gi)?.length, 1);
});

Deno.test("memory_recall returns a simple empty result when both scopes are empty", async () => {
    const { getTool } = setup((command) => {
        if (command === "git") return { code: 1, stdout: "", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
    });

    assertEquals(await executeText(getTool("memory_recall"), { query: "test" }), "No memories found.");
});

Deno.test("memory_recall keeps one scope when the other scope fails", async () => {
    const { getTool } = setup((command, args) => {
        if (command === "git") return { code: 1, stdout: "", stderr: "" };
        if (args[0] === "init") return { code: 0, stdout: "", stderr: "" };
        if (args.includes("--global")) return { code: 2, stdout: "", stderr: "global unavailable" };
        return { code: 0, stdout: "project hit", stderr: "" };
    });

    const text = await executeText(getTool("memory_recall"), { query: "test" });

    assertEquals(
        text,
        "Project memories (project-feature) — these take precedence over global memories:\nproject hit\n\nGlobal memory search failed: global unavailable",
    );
});

Deno.test("memory_write stores project and global memories with scope and core tag", async () => {
    const { calls, getTool } = setup((command, args) => {
        if (command === "git") return { code: 1, stdout: "", stderr: "" };
        return { code: 0, stdout: args[0] === "add" ? "stored" : "", stderr: "" };
    });

    await executeText(getTool("memory_write"), { action: "store", content: "Use deno task ci", core: true });
    await executeText(getTool("memory_write"), {
        action: "store",
        scope: "global",
        content: "Prefer STE",
        core: true,
    });

    assertEquals(calls[2]?.args, ["add", "--name", "project-feature", "--tag", "core", "Use deno task ci"]);
    assertEquals(calls[3]?.args, ["init", "--global"]);
    assertEquals(calls[4]?.args, ["add", "--global", "--tag", "core", "Prefer STE"]);
});

Deno.test("memory_write deletes by id without a scope flag", async () => {
    const { calls, getTool } = setup(() => ({ code: 0, stdout: "   ", stderr: "" }));

    const text = await executeText(getTool("memory_write"), { action: "delete", id: 42, scope: "global" });

    assertEquals(text, "Memory deleted.");
    assertEquals(calls.at(-1)?.args, ["delete", "42"]);
});

Deno.test("memory_write returns error results for missing required fields", async () => {
    const { getTool } = setup(() => ({ code: 0, stdout: "", stderr: "" }));

    assertEquals(
        await executeText(getTool("memory_write"), { action: "store" }),
        "Error: content is required for store.",
    );
    assertEquals(await executeText(getTool("memory_write"), { action: "delete" }), "Error: id is required for delete.");
});
