import { assert, assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { withProcessGlobalTestLock } from "../../../testing/process-global-lock.js";
import { AGENTS, SUBAGENTS } from "../../../constants.js";
import { __resetSettingsForTests } from "../../settings.js";
import { loadAgentDef, resolveSessionToolNames } from "../agents.js";
import { HostedSession } from "../hosted-session.js";
import { loadSubAgentDefinition, REVIEWER_SUBAGENT_TOOLS } from "../subagent-definitions.ts";
import { buildAgentSession, resolveEffectiveSessionToolNames } from "../session.js";
import { createReviewDiffTool } from "../../workflow/review-diff-tool.js";

// Anchored to this file, not Deno.cwd(): test realms share one process, so a
// concurrent test file's chdir would otherwise point these at its temp dir.
const REPO_ROOT = fromFileUrl(new URL("../../../..", import.meta.url));
/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {string} path */
async function removeTempDir(path) {
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await Deno.remove(path, { recursive: true });
            return;
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return;
            if (attempt === 4) throw error;
            await delay(20 * (attempt + 1));
        }
    }
}

Deno.test("loadAgentDef preserves per-agent protected tools when override narrows router to read", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-router-override-" });
    const localAgentsDir = join(projectRoot, ".wld", "agents");
    const routerOverridePath = join(localAgentsDir, "router.md");
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

    await Deno.writeTextFile(routerOverridePath, override);

    try {
        const def = await loadAgentDef("router", projectRoot);

        const expectedProtected = [
            "memory",
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

        assertEquals(def.tools, ["read", ...expectedProtected, "set_session_name"]);
        assert(!def.tools.includes("bash"), "non-protected bundled tool should be removable by override");
    } finally {
        await removeTempDir(projectRoot);
    }
});

Deno.test("loadAgentDef keeps filename identity separate from frontmatter display name", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-agent-identity-" });
    const agentDirectory = join(projectRoot, ".wld", "agents");
    await Deno.mkdir(agentDirectory, { recursive: true });
    await Deno.writeTextFile(
        join(agentDirectory, "case-contract.md"),
        [
            "---",
            "name: Arbitrary Frontmatter Display Name",
            "tools: []",
            "---",
            "",
            "Fixture prompt.",
        ].join("\n"),
    );

    try {
        const definition = await loadAgentDef("CASE-CONTRACT", projectRoot);

        assertEquals(definition.name, "case-contract");
        assertEquals(definition.displayName, "Arbitrary Frontmatter Display Name");
        assert(definition.tools.includes("set_session_name"));
    } finally {
        await removeTempDir(projectRoot);
    }
});

Deno.test("loadAgentDef loads Operator with structured interview capability", async () => {
    const def = await loadAgentDef("operator");

    assert(def.tools.includes("task_completed"));
    assert(def.tools.includes("user_interview"));
    assert(def.systemPrompt.includes("Use `user_interview` for operational choices or confirmations"));
});

Deno.test("loadAgentDef loads Guide with read-only tools", async () => {
    const def = await loadAgentDef("guide");

    assert(def.tools.includes("read"));
    assert(def.tools.includes("grep"));
    assert(def.tools.includes("find"));
    assert(def.tools.includes("ls"));
    assert(def.tools.includes("bash"));
    assert(def.tools.includes("memory"));
    assert(def.tools.includes("code_search"));
    assert(def.tools.includes("write_docs"));
    assert(def.tools.includes("edit_docs"));
    assert(def.systemPrompt.includes("explicitly asks you to preserve or update"));
    assert(def.systemPrompt.includes("Plans, PRDs, ADRs, `docs/domain-language.md`, `docs/domain-language-map.md`"));
    assert(def.systemPrompt.includes("context\n  `domain-language.md`, Work Records, Agent Definitions, Skills"));
    assert(def.systemPrompt.includes("## Durable Evidence for Project Questions"));
    assert(def.systemPrompt.includes("root `PRD.md`; `docs/prd/**/*.md`, including `docs/prd/done/**`"));
    assert(def.systemPrompt.includes("Intent and direction only; never proof of implementation"));
    assert(def.systemPrompt.includes("`status: accepted` is an authoritative current rule"));
    assert(def.systemPrompt.includes("Approved/current Work Records are authoritative retrospective outcomes"));
    assert(def.systemPrompt.includes("Cite project-relative artifact paths"));
    assert(def.systemPrompt.includes("Session Transcripts and local workflow metrics are excluded"));

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
    const def = await loadAgentDef(AGENTS.FRONTEND_ENGINEER, REPO_ROOT);

    assertEquals(def.tools.includes("task_completed"), true);
    assertEquals(def.tools.includes("pair_checkpoint"), false);
});

Deno.test("Router and Recorder do not expose delegate_agent by default", async () => {
    const [router, recorder] = await Promise.all([
        loadAgentDef(AGENTS.ROUTER, REPO_ROOT),
        loadAgentDef("recorder", REPO_ROOT),
    ]);

    assertEquals(router.tools.includes("delegate_agent"), false);
    assertEquals(recorder.tools.includes("delegate_agent"), false);
});

Deno.test("bundled Agent definitions omit the removed router handoff tool", async () => {
    const removedToolName = ["return", "to", "router"].join("_");
    const agentNames = [
        AGENTS.OPERATOR,
        AGENTS.GUIDE,
        AGENTS.IDEATOR,
        AGENTS.PLANNER,
        AGENTS.ARCHITECT,
        AGENTS.ENGINEER,
        AGENTS.FRONTEND_ENGINEER,
        "tester",
        AGENTS.ROUTER,
    ];

    for (const agentName of agentNames) {
        const def = await loadAgentDef(agentName, REPO_ROOT);
        assertEquals(def.tools.includes(removedToolName), false, `${agentName} must not expose removed handoff tool`);
        assertEquals(
            resolveEffectiveSessionToolNames(def.tools, undefined, []).includes(removedToolName),
            false,
            `${agentName} effective tools must not expose removed handoff tool`,
        );
    }
});

Deno.test("all user-facing bundled Agents receive set_session_name", async () => {
    const agentNames = [
        AGENTS.OPERATOR,
        AGENTS.GUIDE,
        AGENTS.IDEATOR,
        AGENTS.PLANNER,
        AGENTS.ARCHITECT,
        AGENTS.ENGINEER,
        AGENTS.FRONTEND_ENGINEER,
        AGENTS.ROUTER,
        AGENTS.RECORDER,
    ];

    for (const agentName of agentNames) {
        const def = await loadAgentDef(agentName, REPO_ROOT);
        assert(def.tools.includes("set_session_name"), `${agentName} should include set_session_name`);
    }
});

Deno.test("set_session_name survives a narrowed runtime tool list", async () => {
    const def = await loadAgentDef(AGENTS.GUIDE, REPO_ROOT);

    const resolved = resolveEffectiveSessionToolNames(def.tools, ["read"], []);

    assertEquals(resolved.includes("read"), true);
    assertEquals(resolved.includes("set_session_name"), true);
});

Deno.test("isolated Subagent definitions do not receive set_session_name", async () => {
    const subagents = [
        SUBAGENTS.REVIEWER,
        SUBAGENTS.DELEGATED,
        SUBAGENTS.INIT,
        SUBAGENTS.SLICER,
        SUBAGENTS.MANUAL_QA,
        SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER,
    ];

    for (const subagent of subagents) {
        const def = await loadSubAgentDefinition(subagent);
        assertEquals(def.tools.includes("set_session_name"), false, `${subagent} must not include set_session_name`);
    }
});

Deno.test("resolveSessionToolNames blocks runtime toolNames from re-enabling removed non-protected tools", () => {
    const agentTools = ["read", "memory", "triage_report"];
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

Deno.test("resolveEffectiveSessionToolNames does not special-case removed tool names", () => {
    const agentTools = ["read", "memory"];

    assertEquals(
        resolveEffectiveSessionToolNames(agentTools, undefined, []),
        ["read", "memory"],
    );
});

Deno.test("resolveEffectiveSessionToolNames normalizes legacy multi replace tool name", () => {
    assertEquals(
        resolveEffectiveSessionToolNames(["read", "edit", "multi_replace_file_content"], undefined, []),
        ["read", "edit", "multi_file_edit"],
    );
});

Deno.test("buildAgentSession auto-wires Guide docs-only tools when requested", async () => {
    await withProcessGlobalTestLock(async () => {
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
            await removeTempDir(tempHome);
        }
    });
});

Deno.test("buildAgentSession wires task_completed with an event-only HostedSession", async () => {
    await withProcessGlobalTestLock(async () => {
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
            await writeVisionModelConfig(tempHome);

            const hostedSession = new HostedSession({ id: "task-completed-policy", cwd: tempHome });
            hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });

            const built = await buildAgentSession({
                hostedSession,
                agentName: "operator",
                modelOverride: "test/model",
                debugLogPath,
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
            await removeTempDir(tempHome);
            await Deno.remove(debugLogPath);
        }
    });
});

Deno.test("buildAgentSession auto-wires set_session_name for user-facing Agents", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalHome = Deno.env.get("HOME");
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-set-session-name-wiring-" });
        /** @type {import('@earendil-works/pi-coding-agent').AgentSession | undefined} */
        let session;
        try {
            Deno.env.set("HOME", tempHome);
            __resetSettingsForTests();
            await writeVisionModelConfig(tempHome);
            const sessionManager = SessionManager.inMemory(tempHome);
            const hostedSession = new HostedSession({
                id: "set-session-name-policy",
                cwd: tempHome,
                sessionManager: /** @type {never} */ (sessionManager),
            });

            const built = await buildAgentSession({
                hostedSession,
                agentName: AGENTS.GUIDE,
                modelOverride: "test/text",
                toolNames: ["read"],
            });
            session = built.session;

            assertEquals(built.tools.includes("set_session_name"), true);
            const tool = built.finalCustomTools.find((candidate) => candidate.name === "set_session_name");
            assert(tool, "expected set_session_name to be auto-wired");
            const result = await /** @type {any} */ (tool.execute)("tool-call-1", { name: "guide session" });
            assertEquals(result.details, { name: "guide session" });
            assertEquals(sessionManager.getSessionName(), "guide session");
        } finally {
            session?.dispose();
            __resetSettingsForTests();
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            __resetSettingsForTests();
            await removeTempDir(tempHome);
        }
    });
});

Deno.test("buildAgentSession wires review_complete and file tools into the Semantic Reviewer subagent", async () => {
    // Regression: the Semantic Reviewer's session once started with only
    // `review_diff` + `see_image` — no read/grep/find/ls and no
    // `review_complete` — so every `review_complete` call failed with "Tool
    // review_complete not found" and Workflow Validation stalled mid-round.
    // The canonical tool ceiling lives in the subagent definition registry and
    // must reach the session's effective tools and auto-wired custom tools.
    await withProcessGlobalTestLock(async () => {
        const originalHome = Deno.env.get("HOME");
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-reviewer-tools-" });
        /** @type {import('@earendil-works/pi-coding-agent').AgentSession | undefined} */
        let session;

        try {
            Deno.env.set("HOME", tempHome);
            __resetSettingsForTests();
            await writeVisionModelConfig(tempHome);

            const hostedSession = new HostedSession({ id: "reviewer-tools-policy", cwd: REPO_ROOT });
            const built = await buildAgentSession({
                hostedSession,
                agentName: AGENTS.REVIEWER,
                modelOverride: "test/text",
                subAgentDefinition: {
                    id: SUBAGENTS.REVIEWER,
                    options: { reviewerMode: "discovery" },
                },
                toolNames: [...REVIEWER_SUBAGENT_TOOLS],
                customTools: [createReviewDiffTool({ full: "diff" })],
                includeEditFallback: false,
            });
            session = built.session;

            for (const toolName of ["read", "grep", "find", "ls", "review_diff", "review_complete"]) {
                assert(built.tools.includes(toolName), `expected ${toolName} in effective reviewer tools`);
            }
            const reviewComplete = built.finalCustomTools.find((tool) => tool.name === "review_complete");
            assert(reviewComplete, "expected review_complete to be auto-wired into the reviewer session");
            assertEquals(typeof reviewComplete.execute, "function");
        } finally {
            session?.dispose();
            __resetSettingsForTests();
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            __resetSettingsForTests();
            await removeTempDir(tempHome);
        }
    });
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
                        { id: "model", input: ["text"] },
                        { id: "text", input: ["text"] },
                        { id: "vision", input: ["text", "image"] },
                    ],
                },
            },
        }),
    );
}

Deno.test("Engineer model fallback is one regular system message per Agent", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalHome = Deno.env.get("HOME");
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-agent-model-fallback-" });
        /** @type {import('@earendil-works/pi-coding-agent').AgentSession[]} */
        const sessions = [];
        /** @type {import('../session-runtime-events.js').SessionRuntimeEvent[]} */
        const events = [];
        try {
            Deno.env.set("HOME", tempHome);
            await writeVisionModelConfig(tempHome);
            await Deno.writeTextFile(
                join(tempHome, ".wld", "settings.json"),
                `${JSON.stringify({ agents: { engineer: { model: "test/model" } } }, null, 4)}\n`,
            );
            __resetSettingsForTests();
            const eventSink = {
                /** @param {import('../session-runtime-events.js').SessionRuntimeEvent} event */
                emit(event) {
                    events.push(event);
                },
            };
            const hostedSession = new HostedSession({
                id: "agent-model-fallback",
                cwd: tempHome,
                eventSink,
            });

            for (let index = 0; index < 2; index++) {
                const built = await buildAgentSession({
                    hostedSession,
                    agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
                    subAgentDefinition: { id: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER },
                });
                sessions.push(built.session);
            }

            const notices = events.filter((event) => event.type === "system_status");
            assertEquals(notices.length, 1);
            assertEquals(notices[0].header, "RunWield");
            assertEquals(notices[0].level, "info");
            assertEquals(notices[0].message, "The repair Engineer is using the Engineer model: test/model.");
        } finally {
            for (const session of sessions) session.dispose();
            __resetSettingsForTests();
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            await removeTempDir(tempHome);
        }
    });
});

Deno.test("buildAgentSession applies invocation thinking override before settings and agent defaults", async () => {
    await withProcessGlobalTestLock(async () => {
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
                subAgentDefinition: { id: "delegated" },
            });

            assertEquals(built.resolvedThinkingLevel, "high");
            assertEquals(hostedSession.getThinkingLevel(), "high");
            built.session.dispose();
        } finally {
            __resetSettingsForTests();
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            __resetSettingsForTests();
            await removeTempDir(tempHome);
        }
    });
});

Deno.test("buildAgentSession disables developer role for Kimi code models", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalHome = Deno.env.get("HOME");
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-kimi-compat-" });
        try {
            Deno.env.set("HOME", tempHome);
            __resetSettingsForTests();
            await Deno.mkdir(join(tempHome, ".wld"), { recursive: true });
            await Deno.writeTextFile(
                join(tempHome, ".wld", "models.json"),
                JSON.stringify({
                    providers: {
                        "kimi-code": {
                            baseUrl: "https://api.kimi.com/coding/v1",
                            api: "openai-completions",
                            apiKey: "test-key",
                            models: [
                                {
                                    id: "k3-256k",
                                    reasoning: true,
                                    input: ["text"],
                                    compat: { supportsTemperature: false },
                                },
                            ],
                        },
                    },
                }),
            );

            const built = await buildAgentSession({
                cwd: tempHome,
                agentName: "operator",
                modelOverride: "kimi-code/k3-256k",
            });

            assertEquals(built.resolvedModel.compat?.supportsDeveloperRole, false);
            assertEquals(built.resolvedModel.compat?.supportsTemperature, false);
            built.session.dispose();
        } finally {
            __resetSettingsForTests();
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            __resetSettingsForTests();
            await removeTempDir(tempHome);
        }
    });
});

Deno.test("buildAgentSession auto-wires delegate_agent only when retained by effective Agent policy", async () => {
    await withProcessGlobalTestLock(async () => {
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
            });
            sessions.push(enabled.session);
            assert(enabled.finalCustomTools.some((tool) => tool.name === "delegate_agent"));

            const disabled = await buildAgentSession({
                hostedSession,
                cwd: tempHome,
                agentName: AGENTS.ROUTER,
                modelOverride: "test/vision",
            });
            sessions.push(disabled.session);
            assertEquals(disabled.finalCustomTools.some((tool) => tool.name === "delegate_agent"), false);
        } finally {
            for (const session of sessions) session.dispose();
            __resetSettingsForTests();
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            __resetSettingsForTests();
            await removeTempDir(tempHome);
        }
    });
});

Deno.test("buildAgentSession injects see_image only for text-only model with vision fallback", async () => {
    await withProcessGlobalTestLock(async () => {
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
            });
            sessions.push(visionBuilt.session);
            assertEquals(visionBuilt.tools.includes("see_image"), false);
            assertEquals(Boolean(visionBuilt.finalCustomTools.find((tool) => tool.name === "see_image")), false);
        } finally {
            for (const session of sessions) session.dispose();
            __resetSettingsForTests();
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            await removeTempDir(tempHome);
        }
    });
});

Deno.test("buildAgentSession omits see_image for text-only model without fallback", async () => {
    await withProcessGlobalTestLock(async () => {
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
            });
            session = built.session;
            assertEquals(built.tools.includes("see_image"), false);
        } finally {
            session?.dispose();
            __resetSettingsForTests();
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            await removeTempDir(tempHome);
        }
    });
});

Deno.test("buildAgentSession fails clearly for invalid vision fallback", async () => {
    await withProcessGlobalTestLock(async () => {
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
                    }),
                Error,
                "Invalid visionFallback.model",
            );
        } finally {
            __resetSettingsForTests();
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            await removeTempDir(tempHome);
        }
    });
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
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-planner-override-" });
    const localAgentsDir = join(projectRoot, ".wld", "agents");
    const plannerOverridePath = join(localAgentsDir, "planner.md");
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
        const planner = await loadAgentDef(AGENTS.PLANNER, projectRoot);
        assert(planner.tools.includes("work_record_search"));
        assert(planner.tools.includes("work_record_read"));
        const guide = await loadAgentDef(AGENTS.GUIDE, REPO_ROOT);
        const recorder = await loadAgentDef(AGENTS.RECORDER, REPO_ROOT);
        const ideator = await loadAgentDef(AGENTS.IDEATOR, REPO_ROOT);
        const architect = await loadAgentDef(AGENTS.ARCHITECT, REPO_ROOT);
        for (const def of [guide, recorder, ideator, architect]) {
            assert(def.tools.includes("work_record_search"));
            assert(def.tools.includes("work_record_read"));
        }
        const engineer = await loadAgentDef(AGENTS.ENGINEER, REPO_ROOT);
        assertEquals(engineer.tools.includes("work_record_search"), false);
        assertEquals(engineer.tools.includes("work_record_read"), false);
    } finally {
        await removeTempDir(projectRoot);
    }
});

Deno.test("buildAgentSession auto-wires Work Record tools with role access modes", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalHome = Deno.env.get("HOME");
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-work-record-tool-wiring-" });
        /** @type {import('@earendil-works/pi-coding-agent').AgentSession[]} */
        const sessions = [];
        try {
            Deno.env.set("HOME", tempHome);
            __resetSettingsForTests();
            await writeVisionModelConfig(tempHome);
            await Deno.mkdir(join(tempHome, ".wld", "agents"), { recursive: true });
            await Deno.writeTextFile(
                join(tempHome, ".wld", "agents", "custom-agent.md"),
                [
                    "---",
                    "name: Custom Agent",
                    "tools:",
                    "  - work_record_search",
                    "  - work_record_read",
                    "---",
                    "Fixture prompt.",
                ].join("\n"),
            );

            /** @param {string} agentName */
            const build = async (agentName) => {
                const built = await buildAgentSession({
                    cwd: tempHome,
                    agentName,
                    modelOverride: "test/model",
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
            const customRead = /** @type {any} */ (customBuilt.finalCustomTools.find((tool) =>
                tool.name === "work_record_read"
            ));
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
            await removeTempDir(tempHome);
        }
    });
});
