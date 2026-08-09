import { assert, assertEquals, assertMatch } from "@std/assert";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createCymbalTools, type CymbalToolHost, MAX_CODE_BATCH_OUTPUT_CHARS } from "./tools.ts";
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
    const host: CymbalToolHost = {
        cwd: "/repo/runwield",
        async exec(command, args, options) {
            calls.push({ command, args, cwd: options.cwd });
            return await execImpl(command, args, options.cwd);
        },
    };
    const tools = createCymbalTools(host);
    const getTool = (name: string) => {
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`tool not found: ${name}`);
        return tool;
    };
    return { calls, getTool };
}

function fakeContext(): ExtensionContext {
    return {} as ExtensionContext;
}

async function executeTool(
    tool: ReturnType<ReturnType<typeof setup>["getTool"]>,
    params: Record<string, string | boolean | { op: string; target?: string; file?: string }[]>,
) {
    return await tool.execute("call", params, new AbortController().signal, () => undefined, fakeContext());
}

function firstText(result: Awaited<ReturnType<typeof executeTool>>): string {
    return result.content[0]?.type === "text" ? result.content[0].text : "";
}

Deno.test("every Cymbal invocation starts with no-federate", async () => {
    const { calls, getTool } = setup(() => ({ code: 0, stdout: "ok", stderr: "" }));

    await executeTool(getTool("code_search"), { query: "Session", textSearch: true });
    await executeTool(getTool("code_structure"), {});
    await executeTool(getTool("code_show"), { target: "file.ts" });

    for (const call of calls) {
        assertEquals(call.command, "cymbal");
        assertEquals(call.args[0], "--no-federate");
    }
    assertEquals(calls[0]?.args, ["--no-federate", "search", "--text", "Session"]);
});

Deno.test("Cymbal failures strip Usage tail and return text", async () => {
    const { getTool } = setup(() => ({ code: 2, stdout: "", stderr: "bad args\nUsage: cymbal ..." }));

    const result = await executeTool(getTool("code_refs"), { symbol: "Thing" });

    assertEquals(firstText(result), "Error (exit 2): bad args");
});

Deno.test("empty Cymbal output returns no results text", async () => {
    const { getTool } = setup(() => ({ code: 0, stdout: "", stderr: "" }));

    const result = await executeTool(getTool("code_outline"), { file: "src/a.ts" });

    assertEquals(firstText(result), "No results found.");
});

Deno.test("code_batch validates operations and limits batch size", async () => {
    const { getTool } = setup(() => ({ code: 0, stdout: "ok", stderr: "" }));
    const tool = getTool("code_batch");

    const tooMany = await executeTool(tool, {
        operations: [
            { op: "show", target: "a" },
            { op: "show", target: "b" },
            { op: "show", target: "c" },
            { op: "show", target: "d" },
            { op: "show", target: "e" },
            { op: "show", target: "f" },
        ],
    });
    const malformed = await executeTool(tool, { operations: [{ op: "show" }] });

    assertEquals((tooMany as { isError?: boolean }).isError, true);
    assertMatch(firstText(tooMany), /at most 5/);
    assertEquals((malformed as { isError?: boolean }).isError, true);
    assertMatch(firstText(malformed), /target must be/);
});

Deno.test("code_batch numbers sections and truncates after the output limit", async () => {
    const longText = "x".repeat(MAX_CODE_BATCH_OUTPUT_CHARS + 10);
    const { getTool } = setup((_command, args) => ({
        code: 0,
        stdout: args.includes("big") ? longText : "small",
        stderr: "",
    }));

    const result = await executeTool(getTool("code_batch"), {
        operations: [{ op: "show", target: "big" }, { op: "outline", file: "small.ts" }],
    });
    const text = firstText(result);

    assert(text.startsWith("## 1. show big"));
    assertMatch(text, /code_batch output truncated at 50000 characters/);
    assertEquals(result.details, { operationCount: 2, truncated: true });
});
