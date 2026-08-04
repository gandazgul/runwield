import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AGENTS } from "../../constants.js";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { HostedSession } from "./hosted-session.js";
import { getRunWieldSessionDir, openPersistedRootSession } from "./root-session.js";
import { ensureRootAgentSession, runIsolatedAgentSession, runRootTurn } from "./session.js";

async function removeTempDir(path: string): Promise<void> {
    await Deno.remove(path, { recursive: true }).catch(() => undefined);
}

async function installClaudeFixture(binDir: string, logPath: string): Promise<void> {
    await Deno.mkdir(binDir, { recursive: true });
    const script =
        `#!/usr/bin/env -S deno run -A\nconst stdin = await new Response(Deno.stdin.readable).text();\nconst promptIndex = Deno.args.indexOf("--append-system-prompt-file");\nconst promptPath = promptIndex >= 0 ? Deno.args[promptIndex + 1] : "";\nconst promptText = promptPath ? await Deno.readTextFile(promptPath) : "";\nawait Deno.writeTextFile(Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_LOG"), JSON.stringify({ args: Deno.args, stdin, promptText }) + "\\n", { append: true });\nconst text = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_TEXT") || "fixture reply";\nconsole.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }));\nconsole.log(JSON.stringify({ type: "result", result: text, session_id: "external-root", usage: { input_tokens: 5, output_tokens: 7 } }));\n`;
    const path = join(binDir, "claude");
    await Deno.writeTextFile(path, script);
    await Deno.chmod(path, 0o755);
    await Deno.writeTextFile(logPath, "");
}

async function withClaudeExecutionFixture(
    callback: (home: string, cwd: string, logPath: string) => Promise<void>,
): Promise<void> {
    await withProcessGlobalTestLock(async () => {
        const previousHome = Deno.env.get("HOME");
        const previousPath = Deno.env.get("PATH");
        const previousLog = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_LOG");
        const previousText = Deno.env.get("RUNWIELD_CLAUDE_FIXTURE_TEXT");
        const home = await Deno.makeTempDir({ prefix: "runwield-claude-exec-home-" });
        const cwd = join(home, "project");
        const binDir = join(home, "bin");
        const logPath = join(home, "claude-log.jsonl");
        try {
            await Deno.mkdir(cwd, { recursive: true });
            await installClaudeFixture(binDir, logPath);
            Deno.env.set("HOME", home);
            Deno.env.set("PATH", `${binDir}:${previousPath || ""}`);
            Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", logPath);
            await callback(home, cwd, logPath);
        } finally {
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            if (previousPath === undefined) Deno.env.delete("PATH");
            else Deno.env.set("PATH", previousPath);
            if (previousLog === undefined) Deno.env.delete("RUNWIELD_CLAUDE_FIXTURE_LOG");
            else Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_LOG", previousLog);
            if (previousText === undefined) Deno.env.delete("RUNWIELD_CLAUDE_FIXTURE_TEXT");
            else Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_TEXT", previousText);
            await removeTempDir(home);
        }
    });
}

function createHostedSession(cwd: string, manager: SessionManager): HostedSession {
    const hostedSession = new HostedSession({
        id: `hosted-${crypto.randomUUID()}`,
        cwd,
        sessionManager: manager as never,
    });
    hostedSession.setActiveModelState("sonnet", "claude-cli", true);
    return hostedSession;
}

Deno.test("Claude CLI selected root turn dispatches without Pi AgentSession", async () => {
    await withClaudeExecutionFixture(async (_home, cwd, logPath) => {
        const manager = SessionManager.inMemory(cwd);
        const hostedSession = createHostedSession(cwd, manager);
        const root = await ensureRootAgentSession({ hostedSession, agentName: AGENTS.GUIDE });
        assertEquals((root as never as { kind: string }).kind, "claude-cli");
        await runRootTurn({ hostedSession, agentName: AGENTS.GUIDE, userRequest: "hello" });
        const log = JSON.parse((await Deno.readTextFile(logPath)).trim());
        assertEquals(log.args.includes("--model"), true);
        assertEquals(log.args[log.args.indexOf("--model") + 1], "sonnet");
        assertEquals("agent" in root, false);
    });
});

Deno.test("Claude CLI root turn emits live assistant text deltas", async () => {
    await withClaudeExecutionFixture(async (_home, cwd) => {
        Deno.env.set("RUNWIELD_CLAUDE_FIXTURE_TEXT", "live reply");
        const manager = SessionManager.inMemory(cwd);
        const hostedSession = createHostedSession(cwd, manager);
        const events: string[] = [];
        hostedSession.setEventSink((event: { type?: string; delta?: string }) => {
            if (event.type === "assistant_text_delta" && event.delta) events.push(event.delta);
        });
        await ensureRootAgentSession({ hostedSession, agentName: AGENTS.GUIDE });
        await runRootTurn({ hostedSession, agentName: AGENTS.GUIDE, userRequest: "stream" });
        assertEquals(events, ["live reply"]);
    });
});

Deno.test("Claude CLI isolated turns persist only to the supplied isolated manager", async () => {
    await withClaudeExecutionFixture(async (_home, cwd) => {
        const rootManager = SessionManager.inMemory(cwd);
        const isolatedManager = SessionManager.inMemory(cwd);
        const hostedSession = createHostedSession(cwd, rootManager);
        const messages = await runIsolatedAgentSession({
            hostedSession,
            agentName: AGENTS.GUIDE,
            userRequest: "isolated",
            sessionManager: isolatedManager,
        });
        assertEquals(messages.at(-1)?.role, "assistant");
        assertEquals(rootManager.getBranch().length, 0);
        assertEquals(isolatedManager.getBranch().filter((entry) => entry.type === "message").length, 2);
    });
});

Deno.test("Claude CLI root turn persists normal messages and backend metadata in the existing root JSONL", async () => {
    await withClaudeExecutionFixture(async (_home, cwd) => {
        const sessionDir = getRunWieldSessionDir(cwd);
        await Deno.mkdir(sessionDir, { recursive: true });
        const manager = SessionManager.create(cwd, sessionDir, { id: "claude-root-persist" });
        const hostedSession = createHostedSession(cwd, manager);
        await ensureRootAgentSession({ hostedSession, agentName: AGENTS.GUIDE });
        await runRootTurn({ hostedSession, agentName: AGENTS.GUIDE, userRequest: "persist me" });
        const opened = await openPersistedRootSession({ cwd, sessionId: "claude-root-persist" });
        const serialized = JSON.stringify(opened.sessionManager.getBranch());
        assertStringIncludes(serialized, "persist me");
        assertStringIncludes(serialized, "fixture reply");
        assertStringIncludes(serialized, "runwield.execution_backend");
        assertStringIncludes(serialized, "model_change");
    });
});

Deno.test("Claude CLI image turns fail before subprocess start or transcript append", async () => {
    await withClaudeExecutionFixture(async (_home, cwd, logPath) => {
        const manager = SessionManager.inMemory(cwd);
        const hostedSession = createHostedSession(cwd, manager);
        await ensureRootAgentSession({ hostedSession, agentName: AGENTS.GUIDE });
        await assertRejects(
            () =>
                runRootTurn({
                    hostedSession,
                    agentName: AGENTS.GUIDE,
                    userRequest: "image",
                    images: [{ base64: btoa("image"), mimeType: "image/png" }],
                }),
            Error,
            "does not support image attachments",
        );
        assertEquals(await Deno.readTextFile(logPath), "");
        assertEquals(manager.getBranch().filter((entry) => entry.type === "message").length, 0);
    });
});
