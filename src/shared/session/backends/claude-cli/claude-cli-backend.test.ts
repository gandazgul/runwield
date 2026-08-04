import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { withProcessGlobalTestLock } from "../../../../testing/process-global-lock.js";
import { getModelRegistry } from "../../../models/model-registry.ts";
import { prepareClaudeCliCommand, removeClaudeCliPromptFile } from "./command.ts";
import { ClaudeCliExecutionSession } from "./execution-session.ts";
import { parseClaudeCliStream } from "./stream-parser.ts";

async function withTempDir(callback: (dir: string) => Promise<void>): Promise<void> {
    const dir = await Deno.makeTempDir({ prefix: "runwield-claude-backend-" });
    try {
        await callback(dir);
    } finally {
        await Deno.remove(dir, { recursive: true }).catch(() => undefined);
    }
}

async function installClaudeFixture(binDir: string, logPath: string): Promise<void> {
    await Deno.mkdir(binDir, { recursive: true });
    const script =
        `#!/usr/bin/env -S deno run -A\nconst stdin = await new Response(Deno.stdin.readable).text();\nconst promptIndex = Deno.args.indexOf("--append-system-prompt-file");\nconst promptPath = promptIndex >= 0 ? Deno.args[promptIndex + 1] : "";\nconst promptText = promptPath ? await Deno.readTextFile(promptPath) : "";\nawait Deno.writeTextFile(Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_LOG"), JSON.stringify({ args: Deno.args, stdin, promptText }) + "\\n", { append: true });\nconst output = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_OUTPUT") || "";\nconsole.log(output || JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "fixture" }] } }));\nconsole.log(JSON.stringify({ type: "result", result: output ? JSON.parse(output).result : "fixture", session_id: "external-1", usage: { input_tokens: 1, output_tokens: 2 } }));\n`;
    const path = join(binDir, "claude");
    await Deno.writeTextFile(path, script);
    await Deno.chmod(path, 0o755);
    await Deno.writeTextFile(logPath, "");
}

async function withClaudeFixture(callback: (root: string, logPath: string) => Promise<void>): Promise<void> {
    await withProcessGlobalTestLock(async () => {
        const previousPath = Deno.env.get("PATH");
        const previousLog = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_LOG");
        const previousOutput = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_OUTPUT");
        await withTempDir(async (root) => {
            const binDir = join(root, "bin");
            const logPath = join(root, "fixture.jsonl");
            await installClaudeFixture(binDir, logPath);
            Deno.env.set("PATH", `${binDir}:${previousPath || ""}`);
            Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", logPath);
            try {
                await callback(root, logPath);
            } finally {
                if (previousPath === undefined) Deno.env.delete("PATH");
                else Deno.env.set("PATH", previousPath);
                if (previousLog === undefined) Deno.env.delete("RUNWIELD_CLAUDE_FIXTURE_LOG");
                else Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", previousLog);
                if (previousOutput === undefined) Deno.env.delete("RUNWIELD_CLAUDE_FIXTURE_OUTPUT");
                else Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_OUTPUT", previousOutput);
            }
        });
    });
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
        },
    });
}

Deno.test("Claude CLI command uses direct argv with stream-json and no resume", async () => {
    await withTempDir(async () => {
        const command = await prepareClaudeCliCommand({ selector: "sonnet", systemPrompt: "system" });
        try {
            assertEquals(command.command, "claude");
            assertEquals(command.args.includes("--output-format"), true);
            assertEquals(command.args.includes("stream-json"), true);
            assertEquals(command.args.includes("--no-session-persistence"), true);
            assertEquals(command.args.includes("--resume"), false);
            assertEquals(command.args[command.args.indexOf("--model") + 1], "sonnet");
        } finally {
            await removeClaudeCliPromptFile(command);
        }
    });
});

Deno.test("Claude CLI command writes an owner-only appended prompt file", async () => {
    const command = await prepareClaudeCliCommand({ selector: "opus", systemPrompt: "private prompt" });
    try {
        assertEquals(await Deno.readTextFile(command.promptFilePath), "private prompt");
        const mode = (await Deno.stat(command.promptFilePath)).mode;
        if (mode !== null) assertEquals(mode & 0o777, 0o600);
    } finally {
        await removeClaudeCliPromptFile(command);
    }
});

Deno.test("Claude CLI command prompt file cleanup removes the file", async () => {
    const command = await prepareClaudeCliCommand({ selector: "haiku", systemPrompt: "cleanup" });
    await removeClaudeCliPromptFile(command);
    await assertRejects(() => Deno.stat(command.promptFilePath), Deno.errors.NotFound);
});

Deno.test("Claude CLI parser emits assistant text and ignores internal events", async () => {
    const deltas: string[] = [];
    const result = await parseClaudeCliStream(
        streamFromText([
            JSON.stringify({ type: "system", subtype: "init" }),
            JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hel" }] } }),
            JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }),
            JSON.stringify({ type: "tool_use", name: "Bash" }),
            JSON.stringify({ type: "result", result: "hello", usage: { input_tokens: 3, output_tokens: 4 } }),
        ].join("\n")),
        { onDelta: (delta) => deltas.push(delta.text) },
    );
    assertEquals(deltas, ["hel", "lo"]);
    assertEquals(result.text, "hello");
    assertEquals(result.metadata.usage.inputTokens, 3);
});

Deno.test("Claude CLI line parser rejects malformed stream-json", async () => {
    await assertRejects(
        () => parseClaudeCliStream(streamFromText("{bad-json}\n"), { onDelta: () => undefined }),
        Error,
        "malformed",
    );
});

Deno.test("Claude CLI parser rejects final text that differs from visible stream", async () => {
    await assertRejects(
        () =>
            parseClaudeCliStream(
                streamFromText(
                    `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "a" }] } })}\n${
                        JSON.stringify({ type: "result", result: "b" })
                    }\n`,
                ),
                { onDelta: () => undefined },
            ),
        Error,
        "did not match",
    );
});

Deno.test("Claude CLI execution session appends RunWield transcript entries and sends stdin history", async () => {
    await withClaudeFixture(async (root, logPath) => {
        Deno.env.set(
            "RUNWIELD_CLAUDE_FIXTURE_OUTPUT",
            JSON.stringify({
                type: "assistant",
                message: { content: [{ type: "text", text: "reply" }] },
                result: "reply",
            }),
        );
        const model = getModelRegistry().find("claude-cli", "sonnet");
        if (!model) throw new Error("missing claude model");
        const manager = SessionManager.inMemory(root);
        manager.appendMessage({ role: "user", timestamp: Date.now(), content: [{ type: "text", text: "prior" }] });
        const session = new ClaudeCliExecutionSession({
            cwd: root,
            agentName: "Guide",
            finalSystemPrompt: "system",
            model,
            sessionManager: manager,
        });
        const messages = await session.runTurn({ userRequest: "now" });
        const log = JSON.parse((await Deno.readTextFile(logPath)).trim());
        assertStringIncludes(log.stdin, "USER: prior");
        assertStringIncludes(log.stdin, "USER: now");
        assertStringIncludes(log.promptText, "system");
        assertEquals(messages.at(-1)?.role, "assistant");
        const entries = manager.getBranch();
        assertEquals(entries.filter((entry) => entry.type === "message").length, 3);
        assertEquals(
            entries.some((entry) => entry.type === "custom" && entry.customType === "runwield.execution_backend"),
            true,
        );
        assertEquals(entries.some((entry) => entry.type === "model_change"), true);
    });
});

Deno.test("Claude CLI execution metadata is sanitized", async () => {
    await withClaudeFixture(async (root) => {
        Deno.env.set(
            "RUNWIELD_CLAUDE_FIXTURE_OUTPUT",
            JSON.stringify({
                type: "assistant",
                message: { content: [{ type: "text", text: "safe" }] },
                result: "safe",
            }),
        );
        const model = getModelRegistry().find("claude-cli", "sonnet");
        if (!model) throw new Error("missing claude model");
        const manager = SessionManager.inMemory(root);
        const session = new ClaudeCliExecutionSession({
            cwd: root,
            agentName: "Guide",
            finalSystemPrompt: "secret prompt",
            model,
            sessionManager: manager,
        });
        await session.runTurn({ userRequest: "hello" });
        const serialized = JSON.stringify(manager.getBranch().filter((entry) => entry.type === "custom"));
        assertStringIncludes(serialized, "runwield.execution_backend");
        assertEquals(serialized.includes("secret prompt"), false);
        assertEquals(serialized.includes("append-system-prompt-file"), false);
        assertEquals(serialized.includes("RUNWIELD_CLAUDE_FIXTURE"), false);
        assertStringIncludes(serialized, "external-1");
    });
});
