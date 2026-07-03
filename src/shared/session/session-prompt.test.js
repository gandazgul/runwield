import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENTS } from "../../constants.js";
import {
    applyAttentionNudge,
    assembleFinalSystemPrompt,
    getGlobalAgentMdPaths,
    readGlobalAgentMd,
    runPrompt,
    shouldReuseExistingRootSession,
} from "./session.js";

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
