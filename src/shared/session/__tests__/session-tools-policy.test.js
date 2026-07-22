import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { AGENTS, CWD } from "../../../constants.js";
import { __resetSettingsForTests } from "../../settings.js";
import { loadAgentDef, resolveSessionToolNames } from "../agents.js";
import { HostedSession } from "../hosted-session.js";
import { buildAgentSession, resolveEffectiveSessionToolNames } from "../session.js";

const localAgentsDir = join(CWD, ".wld", "agents");
const routerOverridePath = join(localAgentsDir, "router.md");

/**
 * @param {string} path
 */
async function readFileIfExists(path) {
    try {
        return await Deno.readTextFile(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

/**
 * @param {string} path
 * @param {string | null} previous
 */
async function restoreFile(path, previous) {
    if (previous === null) {
        try {
            await Deno.remove(path);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return;
            throw error;
        }
        return;
    }

    await Deno.writeTextFile(path, previous);
}

Deno.test("loadAgentDef preserves per-agent protected tools when override narrows router to read", async () => {
    await Deno.mkdir(localAgentsDir, { recursive: true });

    const override = [
        "---",
        "name: router",
        "model: opencode-anthropic/minimax-m2.5-free",
        'description: "router local override"',
        "tools:",
        "  - read",
        "---",
        "",
        "Local prompt.",
        "",
    ].join("\n");

    const previous = await readFileIfExists(routerOverridePath);
    await Deno.writeTextFile(routerOverridePath, override);

    try {
        const def = await loadAgentDef("router", CWD);

        const expectedProtected = [
            "memory_recall",
            "memory_recall_global",
            "code_search",
            "code_show",
            "code_outline",
            "code_batch",
            "code_refs",
            "code_impact",
            "code_trace",
            "code_investigate",
            "code_structure",
            "code_impls",
            "code_importers",
            "triage_report",
        ];

        assertEquals(def.tools, ["read", ...expectedProtected]);
        assert(!def.tools.includes("bash"), "non-protected bundled tool should be removable by override");
    } finally {
        await restoreFile(routerOverridePath, previous);
    }
});

Deno.test("loadAgentDef loads Guide with read-only tools and return_to_router", async () => {
    const def = await loadAgentDef("guide");

    assert(def.tools.includes("read"));
    assert(def.tools.includes("grep"));
    assert(def.tools.includes("find"));
    assert(def.tools.includes("ls"));
    assert(def.tools.includes("bash"));
    assert(def.tools.includes("memory_recall"));
    assert(def.tools.includes("memory_recall_global"));
    assert(def.tools.includes("code_search"));
    assert(def.tools.includes("return_to_router"));
    assert(def.tools.includes("write_docs"));
    assert(def.tools.includes("edit_docs"));
    assert(def.systemPrompt.includes("explicitly asks you to preserve or update"));
    assert(def.systemPrompt.includes("Plans, PRDs, ADRs, `CONTEXT.md`, Work Records, Agent Definitions, Skills"));

    assert(!def.tools.includes("edit"));
    assert(!def.tools.includes("write"));
    assert(!def.tools.includes("multi_file_edit"));
    assert(!def.tools.includes("task_completed"));
    assert(!def.tools.includes("plan_written"));
    assert(!def.tools.includes("triage_report"));
});

Deno.test("layered Agent Definition overrides can remove delegate_agent", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-delegate-override-" });
    const overrideDir = join(projectRoot, ".wld", "agents");
    try {
        await Deno.mkdir(overrideDir, { recursive: true });
        await Deno.writeTextFile(
            join(overrideDir, `${AGENTS.GUIDE}.md`),
            [
                "---",
                "name: Guide",
                'description: "Project-local Guide"',
                "tools:",
                "  - read",
                "---",
                "",
                "Local Guide instructions.",
                "",
            ].join("\n"),
        );

        const def = await loadAgentDef(AGENTS.GUIDE, projectRoot);
        assertEquals(def.tools.includes("read"), true);
        assertEquals(def.tools.includes("delegate_agent"), false);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("Frontend Engineer autonomous base tools include task completion without pair checkpoint", async () => {
    const def = await loadAgentDef(AGENTS.FRONTEND_ENGINEER, CWD);

    assertEquals(def.tools.includes("task_completed"), true);
    assertEquals(def.tools.includes("pair_checkpoint"), false);
});

Deno.test("Router and Recorder do not expose delegate_agent by default", async () => {
    const [router, recorder] = await Promise.all([
        loadAgentDef(AGENTS.ROUTER, CWD),
        loadAgentDef("recorder", CWD),
    ]);

    assertEquals(router.tools.includes("delegate_agent"), false);
    assertEquals(recorder.tools.includes("delegate_agent"), false);
});

Deno.test("resolveSessionToolNames blocks runtime toolNames from re-enabling removed non-protected tools", () => {
    const agentTools = ["read", "memory_recall", "triage_report"];
    const resolved = resolveSessionToolNames(agentTools, ["read", "bash", "triage_report"], []);

    assertEquals(resolved, ["read", "triage_report"]);
    assert(!resolved.includes("bash"));
});

Deno.test("pair checkpoint cannot be re-enabled by static runtime tool names", () => {
    const resolved = resolveSessionToolNames(["read"], ["read", "pair_checkpoint"], []);
    assertEquals(resolved, ["read"]);
});

Deno.test("resolveSessionToolNames allows workflow runtime custom tools", () => {
    const resolved = resolveSessionToolNames(["read"], ["read"], ["pair_checkpoint", "read"]);
    assertEquals(resolved, ["read", "pair_checkpoint"]);
});

Deno.test("resolveEffectiveSessionToolNames filters return_to_router unless explicitly allowed", () => {
    const agentTools = ["read", "return_to_router", "memory_recall"];

    assertEquals(
        resolveEffectiveSessionToolNames(agentTools, undefined, []),
        ["read", "memory_recall"],
    );
    assertEquals(
        resolveEffectiveSessionToolNames(agentTools, undefined, [], { allowReturnToRouter: false }),
        ["read", "memory_recall"],
    );
    assertEquals(
        resolveEffectiveSessionToolNames(agentTools, undefined, [], { allowReturnToRouter: true }),
        ["read", "return_to_router", "memory_recall"],
    );
});

Deno.test("resolveEffectiveSessionToolNames normalizes legacy multi replace tool name", () => {
    assertEquals(
        resolveEffectiveSessionToolNames(["read", "edit", "multi_replace_file_content"], undefined, []),
        ["read", "edit", "multi_file_edit"],
    );
});

Deno.test("buildAgentSession auto-wires Guide docs-only tools when requested", async () => {
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-guide-docs-tools-" });
    /** @type {import('@earendil-works/pi-coding-agent').AgentSession | undefined} */
    let session;

    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await writeVisionModelConfig(tempHome);
        const hostedSession = new HostedSession({ id: "guide-docs-tools", cwd: tempHome });
        const built = await buildAgentSession({
            hostedSession,
            agentName: AGENTS.GUIDE,
            modelOverride: "test/text",
            _agentDefOverride: {
                name: AGENTS.GUIDE,
                displayName: "Guide",
                model: "",
                description: "Guide docs tools",
                tools: ["write_docs", "edit_docs"],
                systemPrompt: "Prompt.",
            },
        });
        session = built.session;

        assertEquals(built.tools.includes("write_docs"), true);
        assertEquals(built.tools.includes("edit_docs"), true);
        const writeDocs = built.finalCustomTools.find((tool) => tool.name === "write_docs");
        const editDocs = built.finalCustomTools.find((tool) => tool.name === "edit_docs");
        assert(writeDocs, "expected write_docs to be auto-wired");
        assert(editDocs, "expected edit_docs to be auto-wired");
        assertEquals(typeof writeDocs.execute, "function");
        assertEquals(typeof editDocs.execute, "function");
    } finally {
        session?.dispose();
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("buildAgentSession auto-wires return_to_router to the target HostedSession", async () => {
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-return-router-wiring-" });
    /** @type {import('@earendil-works/pi-coding-agent').AgentSession | undefined} */
    let session;

    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await Deno.mkdir(join(tempHome, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            join(tempHome, ".wld", "models.json"),
            JSON.stringify({
                providers: {
                    test: {
                        baseUrl: "https://example.invalid/v1",
                        api: "openai-completions",
                        apiKey: "test-key",
                        models: [{ id: "model" }],
                    },
                },
            }),
        );

        const targetHostedSession = new HostedSession({ id: "target-session", cwd: CWD });
        const otherHostedSession = new HostedSession({ id: "other-session", cwd: CWD });
        const built = await buildAgentSession({
            hostedSession: targetHostedSession,
            agentName: AGENTS.GUIDE,
            modelOverride: "test/model",
            allowReturnToRouter: true,
            _agentDefOverride: {
                name: AGENTS.GUIDE,
                displayName: "Guide",
                model: "",
                description: "Test guide",
                tools: ["return_to_router"],
                systemPrompt: "Test guide prompt.",
            },
        });
        session = built.session;
        const tool = built.finalCustomTools.find((candidate) => candidate.name === "return_to_router");
        assert(tool, "expected return_to_router to be auto-wired");
        const execute =
            /** @type {(id: string, params: { reason: string }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<unknown>} */ (tool
                .execute);

        const result = await execute(
            "tool-call-1",
            { reason: "Route this from the target session." },
            new AbortController().signal,
            () => {},
            { hostedSession: otherHostedSession },
        );

        assertEquals(/** @type {{ details?: unknown }} */ (result).details, {
            agentName: AGENTS.ROUTER,
            reason: "Route this from the target session.",
        });
    } finally {
        session?.dispose();
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("buildAgentSession wires task_completed with an event-only HostedSession", async () => {
    /** @type {any[]} */
    const events = [];
    const debugLogPath = await Deno.makeTempFile({ prefix: "runwield-session-debug-test-", suffix: ".log" });

    /** @type {import('@earendil-works/pi-coding-agent').AgentSession | undefined} */
    let session;
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-session-tools-policy-" });

    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await Deno.mkdir(join(tempHome, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            join(tempHome, ".wld", "models.json"),
            JSON.stringify({
                providers: {
                    test: {
                        baseUrl: "https://example.invalid/v1",
                        api: "openai-completions",
                        apiKey: "test-key",
                        models: [{ id: "model" }],
                    },
                },
            }),
        );

        const hostedSession = new HostedSession({ id: "task-completed-policy", cwd: tempHome });
        hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });

        const built = await buildAgentSession({
            hostedSession,
            agentName: "operator",
            modelOverride: "test/model",
            debugLogPath,
            _agentDefOverride: {
                name: "operator",
                displayName: "Operator",
                model: "",
                description: "Test operator",
                tools: ["task_completed"],
                systemPrompt: "Test operator prompt.",
            },
        });
        session = built.session;
        const { finalCustomTools } = built;
        const tool = finalCustomTools.find((candidate) => candidate.name === "task_completed");
        assert(tool, "expected task_completed to be wired");
        const execute =
            /** @type {(id: string, params: { message?: string }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<unknown>} */ (tool
                .execute);

        await execute("tool-call-1", { message: "Done." }, new AbortController().signal, () => {}, {});

        assertEquals(events.length, 1);
        assertEquals(events[0].delta, "**Task completed.**\n\nDone.");
        assertEquals(events[0].agentName, "Operator");
    } finally {
        session?.dispose();
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
        await Deno.remove(debugLogPath);
    }
});

/**
 * @param {string} tempHome
 */
async function writeVisionModelConfig(tempHome) {
    await Deno.mkdir(join(tempHome, ".wld"), { recursive: true });
    await Deno.writeTextFile(
        join(tempHome, ".wld", "models.json"),
        JSON.stringify({
            providers: {
                test: {
                    baseUrl: "https://example.invalid/v1",
                    api: "openai-completions",
                    apiKey: "test-key",
                    models: [
                        { id: "text", input: ["text"] },
                        { id: "vision", input: ["text", "image"] },
                    ],
                },
            },
        }),
    );
}

Deno.test("buildAgentSession applies invocation thinking override before settings and agent defaults", async () => {
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir();
    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await writeVisionModelConfig(tempHome);
        await Deno.writeTextFile(
            join(tempHome, ".wld", "settings.json"),
            JSON.stringify({ defaultThinkingLevel: "low" }),
        );

        const hostedSession = new HostedSession({ id: "thinking-override", cwd: tempHome });
        const built = await buildAgentSession({
            hostedSession,
            agentName: "delegated",
            modelOverride: "test/text",
            thinkingLevelOverride: "high",
            _agentDefOverride: {
                name: "delegated",
                displayName: "Delegated Agent",
                model: "",
                description: "Test delegated agent",
                tools: ["read"],
                systemPrompt: "Prompt.",
                thinkingLevel: "minimal",
            },
        });

        assertEquals(built.resolvedThinkingLevel, "high");
        assertEquals(hostedSession.getThinkingLevel(), "high");
        built.session.dispose();
    } finally {
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("buildAgentSession auto-wires delegate_agent only when retained by effective Agent policy", async () => {
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-delegate-wiring-" });
    /** @type {import('@earendil-works/pi-coding-agent').AgentSession[]} */
    const sessions = [];
    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await writeVisionModelConfig(tempHome);

        const hostedSession = new HostedSession({ id: "delegate-wiring", cwd: tempHome });
        const enabled = await buildAgentSession({
            hostedSession,
            cwd: tempHome,
            agentName: AGENTS.GUIDE,
            modelOverride: "test/vision",
            _agentDefOverride: {
                name: AGENTS.GUIDE,
                displayName: "Guide",
                model: "",
                description: "Guide with delegation",
                tools: ["read", "delegate_agent"],
                systemPrompt: "Prompt.",
            },
        });
        sessions.push(enabled.session);
        assert(enabled.finalCustomTools.some((tool) => tool.name === "delegate_agent"));

        const disabled = await buildAgentSession({
            hostedSession,
            cwd: tempHome,
            agentName: AGENTS.GUIDE,
            modelOverride: "test/vision",
            _agentDefOverride: {
                name: AGENTS.GUIDE,
                displayName: "Guide",
                model: "",
                description: "Guide without delegation",
                tools: ["read"],
                systemPrompt: "Prompt.",
            },
        });
        sessions.push(disabled.session);
        assertEquals(disabled.finalCustomTools.some((tool) => tool.name === "delegate_agent"), false);
    } finally {
        for (const session of sessions) session.dispose();
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("buildAgentSession injects see_image only for text-only model with vision fallback", async () => {
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-see-image-injection-" });
    /** @type {import('@earendil-works/pi-coding-agent').AgentSession[]} */
    const sessions = [];
    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await writeVisionModelConfig(tempHome);
        await Deno.writeTextFile(
            join(tempHome, ".wld", "settings.json"),
            JSON.stringify({
                visionFallback: { model: "test/vision" },
            }),
        );

        const textBuilt = await buildAgentSession({
            cwd: tempHome,
            agentName: "operator",
            modelOverride: "test/text",
            _agentDefOverride: {
                name: "operator",
                displayName: "Operator",
                model: "",
                description: "Test operator",
                tools: ["read"],
                systemPrompt: "Test operator prompt.",
            },
        });
        sessions.push(textBuilt.session);
        assertEquals(textBuilt.tools.includes("see_image"), true);
        assert(textBuilt.finalCustomTools.find((tool) => tool.name === "see_image"));
        const seeImage = /** @type {any} */ (textBuilt.finalCustomTools.find((tool) => tool.name === "see_image"));
        assert(seeImage, "expected see_image custom tool");
        assert(seeImage.execute, "expected see_image execute");

        const visionBuilt = await buildAgentSession({
            cwd: tempHome,
            agentName: "operator",
            modelOverride: "test/vision",
            _agentDefOverride: {
                name: "operator",
                displayName: "Operator",
                model: "",
                description: "Test operator",
                tools: ["read"],
                systemPrompt: "Test operator prompt.",
            },
        });
        sessions.push(visionBuilt.session);
        assertEquals(visionBuilt.tools.includes("see_image"), false);
        assertEquals(Boolean(visionBuilt.finalCustomTools.find((tool) => tool.name === "see_image")), false);
    } finally {
        for (const session of sessions) session.dispose();
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("buildAgentSession omits see_image for text-only model without fallback", async () => {
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-see-image-no-fallback-" });
    /** @type {import('@earendil-works/pi-coding-agent').AgentSession | undefined} */
    let session;
    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await writeVisionModelConfig(tempHome);
        await Deno.writeTextFile(join(tempHome, ".wld", "settings.json"), JSON.stringify({}));

        const built = await buildAgentSession({
            cwd: tempHome,
            agentName: "operator",
            modelOverride: "test/text",
            _agentDefOverride: {
                name: "operator",
                displayName: "Operator",
                model: "",
                description: "Test operator",
                tools: ["read"],
                systemPrompt: "Test operator prompt.",
            },
        });
        session = built.session;
        assertEquals(built.tools.includes("see_image"), false);
    } finally {
        session?.dispose();
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("buildAgentSession fails clearly for invalid vision fallback", async () => {
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-see-image-invalid-fallback-" });
    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await writeVisionModelConfig(tempHome);
        await Deno.writeTextFile(
            join(tempHome, ".wld", "settings.json"),
            JSON.stringify({
                visionFallback: { model: "not-valid" },
            }),
        );

        await assertRejects(
            () =>
                buildAgentSession({
                    cwd: tempHome,
                    agentName: "operator",
                    modelOverride: "test/text",
                    _agentDefOverride: {
                        name: "operator",
                        displayName: "Operator",
                        model: "",
                        description: "Test operator",
                        tools: ["read"],
                        systemPrompt: "Test operator prompt.",
                    },
                }),
            Error,
            "Invalid visionFallback.model",
        );
    } finally {
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        await Deno.remove(tempHome, { recursive: true });
    }
});

Deno.test("resolveModel candidate metrics include enum failed reasons for skipped candidates", async () => {
    const source = await Deno.readTextFile(new URL("../session.js", import.meta.url));
    assertEquals(source.includes('failedReason: "invalid_candidate"'), true);
    assertEquals(source.includes('failedReason: "unknown_candidate"'), true);
    assertEquals(source.includes('failedReason: "discovery_error"'), true);
    assertEquals(source.includes('failedReason: "missing_auth"'), true);
    assertEquals(source.includes('event: "selection_resolved"'), true);
    assertEquals(source.includes("discovered"), true);
});

Deno.test("bundled Work Record tools are protected for planning roles and excluded from Engineer", async () => {
    const plannerOverridePath = join(localAgentsDir, "planner.md");
    const previous = await readFileIfExists(plannerOverridePath);
    await Deno.mkdir(localAgentsDir, { recursive: true });
    await Deno.writeTextFile(
        plannerOverridePath,
        [
            "---",
            "name: Planner",
            "tools:",
            "  - read",
            "---",
            "Local planner override.",
        ].join("\n"),
    );
    try {
        const planner = await loadAgentDef(AGENTS.PLANNER, CWD);
        assert(planner.tools.includes("work_record_search"));
        assert(planner.tools.includes("work_record_read"));
        const guide = await loadAgentDef(AGENTS.GUIDE, CWD);
        const recorder = await loadAgentDef(AGENTS.RECORDER, CWD);
        const ideator = await loadAgentDef(AGENTS.IDEATOR, CWD);
        const architect = await loadAgentDef(AGENTS.ARCHITECT, CWD);
        for (const def of [guide, recorder, ideator, architect]) {
            assert(def.tools.includes("work_record_search"));
            assert(def.tools.includes("work_record_read"));
        }
        const engineer = await loadAgentDef(AGENTS.ENGINEER, CWD);
        assertEquals(engineer.tools.includes("work_record_search"), false);
        assertEquals(engineer.tools.includes("work_record_read"), false);
    } finally {
        await restoreFile(plannerOverridePath, previous);
    }
});

Deno.test("buildAgentSession auto-wires Work Record tools with role access modes", async () => {
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-work-record-tool-wiring-" });
    /** @type {import('@earendil-works/pi-coding-agent').AgentSession[]} */
    const sessions = [];
    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await Deno.mkdir(join(tempHome, ".wld"), { recursive: true });
        await Deno.writeTextFile(
            join(tempHome, ".wld", "models.json"),
            JSON.stringify({
                providers: {
                    test: {
                        baseUrl: "https://example.invalid/v1",
                        api: "openai-completions",
                        apiKey: "test-key",
                        models: [{ id: "model" }],
                    },
                },
            }),
        );

        /** @param {string} agentName */
        const build = async (agentName) => {
            const built = await buildAgentSession({
                cwd: tempHome,
                agentName,
                modelOverride: "test/model",
                _agentDefOverride: {
                    name: agentName,
                    displayName: agentName,
                    model: "",
                    description: "Test Work Record tools",
                    tools: ["work_record_search", "work_record_read"],
                    systemPrompt: "Test prompt.",
                },
            });
            sessions.push(built.session);
            return built;
        };

        const guideBuilt = await build(AGENTS.GUIDE);
        const plannerBuilt = await build(AGENTS.PLANNER);
        const customBuilt = await build("custom-agent");
        for (const built of [guideBuilt, plannerBuilt, customBuilt]) {
            assert(built.finalCustomTools.find((tool) => tool.name === "work_record_search"));
            assert(built.finalCustomTools.find((tool) => tool.name === "work_record_read"));
        }

        const guideSearch = /** @type {any} */ (guideBuilt.finalCustomTools.find((tool) =>
            tool.name === "work_record_search"
        ));
        const plannerSearch = /** @type {any} */ (plannerBuilt.finalCustomTools.find((tool) =>
            tool.name === "work_record_search"
        ));
        const customRead =
            /** @type {any} */ (customBuilt.finalCustomTools.find((tool) => tool.name === "work_record_read"));
        assertEquals(
            (await guideSearch.execute("1", { query: "" }, undefined, undefined, {})).details.accessMode,
            "all",
        );
        assertEquals(
            (await plannerSearch.execute("1", { query: "" }, undefined, undefined, {})).details.accessMode,
            "current",
        );
        assertEquals(
            (await customRead.execute("1", { recordId: "" }, undefined, undefined, {})).details.accessMode,
            "current",
        );
    } finally {
        for (const session of sessions) session.dispose();
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
    }
});
