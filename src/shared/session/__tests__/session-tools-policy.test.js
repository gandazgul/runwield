import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { CWD } from "../../../constants.js";
import { __resetSettingsForTests } from "../../settings.js";
import { loadAgentDef, resolveSessionToolNames } from "../agents.js";
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
        const def = await loadAgentDef("router");

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

    assert(!def.tools.includes("edit"));
    assert(!def.tools.includes("write"));
    assert(!def.tools.includes("multi_file_edit"));
    assert(!def.tools.includes("task_completed"));
    assert(!def.tools.includes("plan_written"));
    assert(!def.tools.includes("triage_report"));
});

Deno.test("resolveSessionToolNames blocks runtime toolNames from re-enabling removed non-protected tools", () => {
    const agentTools = ["read", "memory_recall", "triage_report"];
    const resolved = resolveSessionToolNames(agentTools, ["read", "bash", "triage_report"], []);

    assertEquals(resolved, ["read", "triage_report"]);
    assert(!resolved.includes("bash"));
});

Deno.test("resolveSessionToolNames allows runtime custom tools", () => {
    const resolved = resolveSessionToolNames(["read"], ["read"], ["extension_tool", "read"]);
    assertEquals(resolved, ["read", "extension_tool"]);
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

Deno.test("buildAgentSession wires task_completed with agent displayName", async () => {
    /** @type {Array<{ agentName: string, text: string }>} */
    const rendered = [];
    const debugLogPath = await Deno.makeTempFile({ prefix: "runwield-session-debug-test-", suffix: ".log" });
    const uiAPI = /** @type {import('../../ui/types.js').UiAPI} */ ({
        appendSystemMessage: () => {},
        appendAgentMessageStart: (agentName) => ({
            appendText: (text) => rendered.push({ agentName, text }),
        }),
        requestRender: () => {},
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    });

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

        const built = await buildAgentSession({
            agentName: "operator",
            modelOverride: "test/model",
            uiAPI,
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

        assertEquals(rendered, [{ agentName: "Operator", text: "**Task completed.**\n\nDone." }]);
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
