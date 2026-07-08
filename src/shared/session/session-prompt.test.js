import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENTS } from "../../constants.js";
import {
    __getRootSessionMetadataForTests,
    applyAttentionNudge,
    assembleFinalSystemPrompt,
    ensureRootAgentSession,
    getGlobalAgentMdPaths,
    readGlobalAgentMd,
    runAgentSession,
    runPrompt,
    runRootTurn,
    shouldReuseExistingRootSession,
} from "./session.js";
import { HostedSession } from "./hosted-session.js";

Deno.test("assembleFinalSystemPrompt includes project-state context only when provided", async () => {
    const agentDef = {
        name: "test",
        displayName: "Test",
        description: "Test agent",
        model: "",
        tools: [],
        systemPrompt:
            "## Project Context\n\n{{PROJECT_STATE_CONTEXT}}\n{{PROJECT_AGENTSMD}}\n\n{{AVAILABLE_TOOLS}}\n{{GLOBAL_AGENTSMD}}\n{{MEMORIES}}\n{{SKILLS}}\n{{IMAGE_ATTACHMENTS_SECTION}}\n{{BUNDLED_AGENT_DEFS_DIR}}",
    };

    const withoutContext = await assembleFinalSystemPrompt(agentDef, [], [], Deno.cwd());
    const withContext = await assembleFinalSystemPrompt(agentDef, [], [], Deno.cwd(), "Greenfield note.");

    assertEquals(withoutContext.includes("### Project State"), false);
    assertStringIncludes(withContext, "### Project State\n\nGreenfield note.");
});

Deno.test("readGlobalAgentMd falls back from ~/.wld/RUNWEILD.md to ~/.wld/AGENTS.md", async () => {
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-agents-md-" });

    try {
        await Deno.mkdir(join(tempHome, ".wld"), { recursive: true });
        await Deno.writeTextFile(join(tempHome, ".wld", "AGENTS.md"), "Global AGENTS fallback");

        const prompt = await readGlobalAgentMd(tempHome);

        assertEquals(prompt, "Global AGENTS fallback");
    } finally {
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("readGlobalAgentMd falls back to ~/.agents/AGENTS.md by default", async () => {
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-agents-md-" });

    try {
        await Deno.mkdir(join(tempHome, ".agents"), { recursive: true });
        await Deno.writeTextFile(join(tempHome, ".agents", "AGENTS.md"), "External AGENTS fallback");

        const prompt = await readGlobalAgentMd(tempHome);

        assertEquals(prompt, "External AGENTS fallback");
    } finally {
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("readGlobalAgentMd can disable ~/.agents/AGENTS.md fallback", async () => {
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-agents-md-" });

    try {
        await Deno.mkdir(join(tempHome, ".agents"), { recursive: true });
        await Deno.writeTextFile(join(tempHome, ".agents", "AGENTS.md"), "External AGENTS fallback");

        const prompt = await readGlobalAgentMd(tempHome, { includeExternal: false });

        assertEquals(prompt, "");
    } finally {
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("getGlobalAgentMdPaths stays inside ~/.wld", () => {
    assertEquals(getGlobalAgentMdPaths("/tmp/home", { includeExternal: false }), [
        "/tmp/home/.wld/RUNWEILD.md",
        "/tmp/home/.wld/AGENTS.md",
    ]);
});

Deno.test("getGlobalAgentMdPaths includes shared ~/.agents/AGENTS.md when enabled", () => {
    assertEquals(getGlobalAgentMdPaths("/tmp/home", { includeExternal: true }), [
        "/tmp/home/.wld/RUNWEILD.md",
        "/tmp/home/.wld/AGENTS.md",
        "/tmp/home/.agents/AGENTS.md",
    ]);
});

Deno.test("applyAttentionNudge only injects scheduled long-lived agent nudges", () => {
    assertEquals(applyAttentionNudge(AGENTS.IDEATOR, "User asks", 1), "User asks");
    assertEquals(applyAttentionNudge(AGENTS.OPERATOR, "User asks", 6), "User asks");

    assertEquals(
        applyAttentionNudge(AGENTS.GUIDE, "User asks", 6),
        [
            "<attention_nudge>",
            "You are still the Guide. Stay read-only, answer direct questions concisely, and return to Router if the user asks for edits, plans, execution, or deeper ideation.",
            "</attention_nudge>",
            "",
            "User asks",
        ].join("\n"),
    );

    assertEquals(
        applyAttentionNudge(AGENTS.IDEATOR, "User asks", 6),
        [
            "<attention_nudge>",
            "You are still the Ideator. Continue as a thinking partner: clarify one decision at a time, verify external facts when needed, and use `return_to_router` for actionable implementation or planning requests.",
            "</attention_nudge>",
            "",
            "User asks",
        ].join("\n"),
    );
});

Deno.test("shouldReuseExistingRootSession ignores undefined optional overrides", () => {
    assertEquals(
        shouldReuseExistingRootSession({
            agentName: AGENTS.OPERATOR,
            userRequest: "commit",
            modelOverride: undefined,
            useRootSession: true,
        }, AGENTS.OPERATOR),
        true,
    );

    assertEquals(
        shouldReuseExistingRootSession({
            agentName: AGENTS.OPERATOR,
            userRequest: "commit",
            modelOverride: "test/model",
            useRootSession: true,
        }, AGENTS.OPERATOR),
        false,
    );

    assertEquals(
        shouldReuseExistingRootSession({
            agentName: AGENTS.OPERATOR,
            userRequest: "sleep",
            useRootSession: false,
        }, AGENTS.OPERATOR),
        false,
    );
});

Deno.test("runPrompt proactively compacts before a prompt that would exceed the safe threshold", async () => {
    const calls = /** @type {string[]} */ ([]);
    const session = /** @type {any} */ ({
        model: { provider: "test", id: "model", input: ["text"], contextWindow: 100 },
        modelRegistry: { hasConfiguredAuth: () => true },
        settingsManager: {
            getCompactionSettings: () => ({ enabled: true, reserveTokens: 40, keepRecentTokens: 10 }),
        },
        sessionManager: {
            buildSessionContext: () => ({ messages: [], thinkingLevel: "", model: null }),
        },
        getContextUsage: () => ({ tokens: 50, contextWindow: 100, percent: 50 }),
        _runAutoCompaction: (/** @type {string} */ reason, /** @type {boolean} */ willRetry) => {
            calls.push(`compact:${reason}:${willRetry}`);
            return Promise.resolve(true);
        },
        prompt: () => {
            calls.push("prompt");
            return Promise.resolve();
        },
        agent: { waitForIdle: () => Promise.resolve(), state: { messages: [] } },
    });
    const subscriberState = /** @type {any} */ ({
        resetTurn: () => {},
        endThinking: () => {},
        drainInvokedToolNames: () => [],
    });

    await runPrompt({
        session,
        agentDef: {
            name: "engineer",
            displayName: "Engineer",
            model: "",
            description: "Test engineer",
            tools: [],
            systemPrompt: "system",
        },
        agentName: "engineer",
        userRequest: "large incoming prompt ".repeat(60),
        finalSystemPrompt: "system",
        subscriberState,
    });

    assertEquals(calls, ["compact:threshold:false", "prompt"]);
});

Deno.test("runPrompt sends fallback image markers without raw image content to text-only model", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalCwd = Deno.cwd();
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-runprompt-home-" });
    const tempProject = await Deno.makeTempDir({ prefix: "runwield-runprompt-project-" });
    try {
        Deno.env.set("HOME", tempHome);
        Deno.chdir(tempProject);
        await Deno.mkdir(".wld", { recursive: true });
        await Deno.writeTextFile(".wld/settings.json", JSON.stringify({ visionFallback: { model: "test/vision" } }));
        const fallbackModel = { provider: "test", id: "vision", input: ["text", "image"] };
        /** @type {Array<{ text: string, options: any }>} */
        const prompts = [];
        const session = /** @type {any} */ ({
            model: { provider: "test", id: "text", input: ["text"] },
            modelRegistry: {
                find: () => fallbackModel,
                hasConfiguredAuth: () => true,
            },
            prompt: (/** @type {string} */ text, /** @type {any} */ options) => {
                prompts.push({ text, options });
                return Promise.resolve();
            },
            agent: { waitForIdle: () => Promise.resolve(), state: { messages: [] } },
        });
        const subscriberState = /** @type {any} */ ({
            resetTurn: () => {},
            endThinking: () => {},
            drainInvokedToolNames: () => [],
        });

        await runPrompt({
            session,
            agentDef: {
                name: "operator",
                displayName: "Operator",
                model: "",
                description: "Test operator",
                tools: [],
                systemPrompt: "system",
            },
            agentName: "operator",
            userRequest: "please inspect",
            finalSystemPrompt: "system",
            images: /** @type {import('./types.js').ImageAttachment[]} */ ([{
                base64: "abc",
                mimeType: "image/png",
                ref: "attachment:123",
            }]),
            subscriberState,
        });

        assertEquals(prompts.length, 1);
        assertEquals(prompts[0].text, "please inspect\n\n[Image attached: attachment:123 image/png]");
        assertEquals(prompts[0].options.images, undefined);
    } finally {
        Deno.chdir(originalCwd);
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        await Deno.remove(tempHome, { recursive: true });
        await Deno.remove(tempProject, { recursive: true });
    }
});

/**
 * @param {string} id
 */
function makeHostedRuntimeSession(id) {
    const manager = {
        getSessionId: () => `${id}-manager`,
        getCwd: () => Deno.cwd(),
    };
    return new HostedSession({ id, cwd: Deno.cwd(), sessionManager: manager });
}

/**
 * @param {string} id
 */
function makeRuntimeAgentSession(id) {
    return /** @type {any} */ ({
        id,
        model: { provider: "test", id: id, input: ["text"] },
        modelRegistry: { find: () => null, hasConfiguredAuth: () => true },
        agent: { state: { messages: [] }, waitForIdle: () => Promise.resolve() },
        prompt: () => Promise.resolve(),
        subscribe: () => () => {},
        disposeCalls: 0,
        dispose() {
            this.disposeCalls++;
        },
    });
}

/**
 * @param {string} label
 * @param {Array<any>} builds
 */
function makeBuildAgentSessionStub(label, builds) {
    return (/** @type {any} */ opts) => {
        builds.push({ label, opts });
        return Promise.resolve({
            session: makeRuntimeAgentSession(`${label}-${builds.length}`),
            agentDef: {
                name: opts.agentName,
                displayName: `${label}-${opts.agentName}`,
                model: "",
                description: "Test agent",
                tools: [],
                systemPrompt: "system",
            },
            promptState: { text: `system-${label}` },
            tools: opts.toolNames || [],
            finalCustomTools: opts.customTools || [],
            resolvedModel: { provider: "test", id: label, input: ["text"] },
            resolvedThinkingLevel: "medium",
        });
    };
}

function makeAttachStub() {
    return () => ({
        resetTurn: () => {},
        drainInvokedToolNames: () => [],
        endThinking: () => {},
        unsubscribe: () => {},
    });
}

Deno.test("ensureRootAgentSession scopes root session, metadata, agent name, and manager to each HostedSession", async () => {
    const hostedA = makeHostedRuntimeSession("root-a");
    const hostedB = makeHostedRuntimeSession("root-b");
    hostedA.setProjectStateContext("context-a");
    hostedB.setProjectStateContext("context-b");
    const builds = /** @type {Array<any>} */ ([]);

    const rootA = await ensureRootAgentSession({
        hostedSession: hostedA,
        agentName: "router",
        _buildAgentSession: makeBuildAgentSessionStub("a", builds),
        _attachUiSubscribers: makeAttachStub(),
    });
    const rootB = await ensureRootAgentSession({
        hostedSession: hostedB,
        agentName: "operator",
        _buildAgentSession: makeBuildAgentSessionStub("b", builds),
        _attachUiSubscribers: makeAttachStub(),
    });

    assertEquals(hostedA.getRootAgentSession(), rootA);
    assertEquals(hostedB.getRootAgentSession(), rootB);
    assertEquals(hostedA.getRootAgentName(), "router");
    assertEquals(hostedB.getRootAgentName(), "operator");
    assertEquals(__getRootSessionMetadataForTests(rootA).projectStateContext, "context-a");
    assertEquals(__getRootSessionMetadataForTests(rootB).projectStateContext, "context-b");
    assertEquals(builds[0].opts.sessionManager, hostedA.getRootSessionManager());
    assertEquals(builds[1].opts.sessionManager, hostedB.getRootSessionManager());
    assertEquals(hostedA.getAgentInfoStack()[0].displayName, "a-router");
    assertEquals(hostedB.getAgentInfoStack()[0].displayName, "b-operator");
});

Deno.test("runRootTurn increments only the target HostedSession root turn metadata", async () => {
    const hostedA = makeHostedRuntimeSession("turn-a");
    const hostedB = makeHostedRuntimeSession("turn-b");
    const builds = /** @type {Array<any>} */ ([]);
    const runPrompts = /** @type {Array<any>} */ ([]);
    const runPromptStub = (/** @type {any} */ opts) => {
        runPrompts.push(opts);
        return Promise.resolve([{ role: "assistant", content: "ok" }]);
    };

    const rootA = await ensureRootAgentSession({
        hostedSession: hostedA,
        agentName: AGENTS.GUIDE,
        _buildAgentSession: makeBuildAgentSessionStub("turn-a", builds),
        _attachUiSubscribers: makeAttachStub(),
    });
    const rootB = await ensureRootAgentSession({
        hostedSession: hostedB,
        agentName: AGENTS.GUIDE,
        _buildAgentSession: makeBuildAgentSessionStub("turn-b", builds),
        _attachUiSubscribers: makeAttachStub(),
    });

    await runRootTurn({
        hostedSession: hostedA,
        agentName: AGENTS.GUIDE,
        userRequest: "one",
        _runPrompt: runPromptStub,
    });
    await runRootTurn({
        hostedSession: hostedA,
        agentName: AGENTS.GUIDE,
        userRequest: "two",
        _runPrompt: runPromptStub,
    });

    assertEquals(__getRootSessionMetadataForTests(rootA).rootTurnCount, 2);
    assertEquals(__getRootSessionMetadataForTests(rootB).rootTurnCount, 0);
    assertEquals(runPrompts.map((entry) => entry.session), [rootA, rootA]);
});

Deno.test("runAgentSession root and transient paths use only the supplied HostedSession state", async () => {
    const hostedA = makeHostedRuntimeSession("run-a");
    const hostedB = makeHostedRuntimeSession("run-b");
    hostedA.setActiveModelState("manual-a", "test", true);
    hostedB.setActiveModelState("manual-b", "test", true);
    hostedA.setThinkingLevel("low");
    hostedB.setThinkingLevel("high");
    const builds = /** @type {Array<any>} */ ([]);
    const prompts = /** @type {Array<any>} */ ([]);
    const runPromptStub = (/** @type {any} */ opts) => {
        prompts.push(opts);
        return Promise.resolve([]);
    };

    await runAgentSession({
        hostedSession: hostedA,
        agentName: "router",
        userRequest: "root a",
        _buildAgentSession: makeBuildAgentSessionStub("run-a", builds),
        _attachUiSubscribers: makeAttachStub(),
        _runPrompt: runPromptStub,
    });
    await runAgentSession({
        hostedSession: hostedB,
        agentName: "operator",
        userRequest: "transient b",
        useRootSession: false,
        _buildAgentSession: makeBuildAgentSessionStub("run-b", builds),
        _attachUiSubscribers: makeAttachStub(),
        _runPrompt: runPromptStub,
    });

    assertEquals(hostedA.getRootAgentName(), "router");
    assertEquals(hostedB.getRootAgentName(), null);
    assertEquals(hostedB.getSubAgentSessions().size, 0, "transient sub-agent is removed from its own HostedSession");
    assertEquals(hostedA.getSubAgentSessions().size, 0, "transient sub-agent never appears in another HostedSession");
    assertEquals(builds[0].opts.hostedSession, hostedA);
    assertEquals(builds[1].opts.hostedSession, hostedB);
    assertEquals(hostedA.getActiveModelState(), { model: "manual-a", provider: "test" });
    assertEquals(hostedB.getActiveModelState(), { model: "manual-b", provider: "test" });
    assertEquals(hostedA.getThinkingLevel(), "low");
    assertEquals(hostedB.getThinkingLevel(), "high");
    assertEquals(prompts.length, 2);
});
