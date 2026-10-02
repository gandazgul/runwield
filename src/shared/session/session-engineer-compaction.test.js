import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { estimateTokens, SessionManager } from "@earendil-works/pi-coding-agent";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { attachSessionEventSubscribers, buildAgentSession, runPrompt } from "./session.js";

/** @param {number} tokens */
function answer(tokens) {
    const message = fauxAssistantMessage(fauxText("Answer"));
    message.usage.input = tokens;
    message.usage.totalTokens = tokens + message.usage.output;
    return message;
}

/** @param {SessionManager} manager
 * @param {number} tokens */
function seedConversation(manager, tokens) {
    manager.appendMessage({ role: "user", content: "Earlier task", timestamp: Date.now() });
    manager.appendMessage(answer(tokens));
    manager.appendMessage({ role: "user", content: "Recent task", timestamp: Date.now() });
}

Deno.test("Engineer retry below 120K does not compact accumulated Agent instructions", async () => {
    await withRuntimeCommandFixture("engineer-context-count-", async (fixture) => {
        const settings = JSON.parse(await Deno.readTextFile(fixture.settingsPath));
        settings.compaction = { enabled: true, reserveTokens: 16_384, keepRecentTokens: 1 };
        await Deno.writeTextFile(fixture.settingsPath, JSON.stringify(settings));
        const manager = SessionManager.create(fixture.projectRoot, join(fixture.homeDir, "sessions"));
        for (const role of ["Router", "Operator", "Engineer"]) {
            manager.appendMessage({ role: "system", content: role.repeat(40_000), timestamp: Date.now() });
        }
        seedConversation(manager, 61_121);
        manager.appendMessage(fauxAssistantMessage(fauxText(""), { stopReason: "aborted" }));
        fixture.setModelResponseFactory(() => answer(61_141));
        const built = await buildAgentSession({
            agentName: "engineer",
            cwd: fixture.projectRoot,
            toolNames: [],
            sessionManager: manager,
        });
        const subscriber = attachSessionEventSubscribers(built.session, built.agentDef);
        try {
            assertEquals(built.session.model?.contextWindow, 272_000);
            assertEquals(built.session.getContextUsage()?.tokens, 61_124);
            assertEquals(
                manager.buildSessionContext().messages.reduce((sum, message) => sum + estimateTokens(message), 0) >
                    120_000,
                true,
            );
            await runPrompt({
                ...built,
                agentName: "engineer",
                userRequest: "Retry the benchmark",
                subscriberState: subscriber,
                finalSystemPrompt: built.agentDef.systemPrompt,
            });
            assertEquals(manager.getEntries().filter((entry) => entry.type === "compaction").length, 0);
        } finally {
            subscriber.unsubscribe();
            built.session.dispose();
        }
    }, { contextWindow: 272_000 });
});

Deno.test("successful Engineer compaction without queued messages does not immediately repeat", async () => {
    await withRuntimeCommandFixture("engineer-compaction-reset-", async (fixture) => {
        const settings = JSON.parse(await Deno.readTextFile(fixture.settingsPath));
        settings.compaction = { enabled: true, reserveTokens: 16_384, keepRecentTokens: 1 };
        await Deno.writeTextFile(fixture.settingsPath, JSON.stringify(settings));
        const manager = SessionManager.create(fixture.projectRoot, join(fixture.homeDir, "sessions"));
        seedConversation(manager, 120_100);
        fixture.setModelResponse("Summary");
        const built = await buildAgentSession({
            agentName: "engineer",
            cwd: fixture.projectRoot,
            toolNames: [],
            sessionManager: manager,
        });
        const subscriber = attachSessionEventSubscribers(built.session, built.agentDef);
        try {
            assertEquals(built.session.model?.contextWindow, 272_000);
            assertEquals(built.session.getContextUsage()?.tokens, 120_103);
            built.session.agent.streamFunction = () => {
                const message = answer(120_100);
                const stream = createAssistantMessageEventStream();
                queueMicrotask(() => {
                    stream.push({ type: "done", reason: "stop", message });
                    stream.end(message);
                });
                return stream;
            };
            for (const userRequest of ["Continue", "Continue again"]) {
                await runPrompt({
                    ...built,
                    agentName: "engineer",
                    userRequest,
                    subscriberState: subscriber,
                    finalSystemPrompt: built.agentDef.systemPrompt,
                });
            }
            assertEquals(manager.getEntries().filter((entry) => entry.type === "compaction").length, 1);
        } finally {
            subscriber.unsubscribe();
            built.session.dispose();
        }
    }, { contextWindow: 272_000 });
});

Deno.test("Engineer includes the incoming prompt in the 120K threshold", async () => {
    await withRuntimeCommandFixture("engineer-incoming-context-", async (fixture) => {
        const settings = JSON.parse(await Deno.readTextFile(fixture.settingsPath));
        settings.compaction = { enabled: true, reserveTokens: 16_384, keepRecentTokens: 1 };
        await Deno.writeTextFile(fixture.settingsPath, JSON.stringify(settings));
        const manager = SessionManager.create(fixture.projectRoot, join(fixture.homeDir, "sessions"));
        seedConversation(manager, 61_121);
        fixture.setModelResponse("Summary and answer");
        const built = await buildAgentSession({
            agentName: "engineer",
            cwd: fixture.projectRoot,
            toolNames: [],
            sessionManager: manager,
        });
        const subscriber = attachSessionEventSubscribers(built.session, built.agentDef);
        try {
            await runPrompt({
                ...built,
                agentName: "engineer",
                userRequest: "x".repeat(240_000),
                subscriberState: subscriber,
                finalSystemPrompt: built.agentDef.systemPrompt,
            });
            assertEquals(manager.getEntries().filter((entry) => entry.type === "compaction").length, 1);
        } finally {
            subscriber.unsubscribe();
            built.session.dispose();
        }
    }, { contextWindow: 272_000 });
});

Deno.test("Engineer can resume while context usage is unknown after compaction", async () => {
    await withRuntimeCommandFixture("engineer-unknown-context-", async (fixture) => {
        const settings = JSON.parse(await Deno.readTextFile(fixture.settingsPath));
        settings.compaction = { enabled: true, reserveTokens: 16_384, keepRecentTokens: 1 };
        await Deno.writeTextFile(fixture.settingsPath, JSON.stringify(settings));
        const manager = SessionManager.create(fixture.projectRoot, join(fixture.homeDir, "sessions"));
        seedConversation(manager, 61_121);
        fixture.setModelResponse("Summary and answer");
        const built = await buildAgentSession({
            agentName: "engineer",
            cwd: fixture.projectRoot,
            toolNames: [],
            sessionManager: manager,
        });
        const subscriber = attachSessionEventSubscribers(built.session, built.agentDef);
        try {
            await built.session.compact();
            assertEquals(built.session.getContextUsage()?.tokens, null);
            await runPrompt({
                ...built,
                agentName: "engineer",
                userRequest: "Continue",
                subscriberState: subscriber,
                finalSystemPrompt: built.agentDef.systemPrompt,
            });
            assertEquals(manager.getEntries().filter((entry) => entry.type === "compaction").length, 1);
        } finally {
            subscriber.unsubscribe();
            built.session.dispose();
        }
    }, { contextWindow: 272_000 });
});
