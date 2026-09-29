import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { createSessionRuntime, type SessionRuntime } from "../../shared/session/session-runtime.ts";
import { createGenerationGuard } from "./generation-guard.js";
import { drainWorkflowMetrics, getWorkflowMetricsFilePath } from "../../shared/workflow/metrics.js";
import { setCustomSetting } from "../../shared/settings.js";
import {
    handleSlashCommand,
    isImmediateBuiltinSlashCommandWhileStreaming,
    type SkillMeta,
    type SlashContext,
} from "./slash-dispatch.ts";

interface SlashFixture {
    context(userRequest: string): SlashContext;
    messages: string[];
    runtime: SessionRuntime;
    sessionId: string;
    submittedRequests: string[];
}

interface SlashFixtureOptions {
    promptTemplate?: boolean;
    initPromptTemplate?: boolean;
    skill?: boolean;
    selectedAgent?: string;
}

async function writeCatalogFixtures(projectRoot: string, options: SlashFixtureOptions): Promise<void> {
    if (options.promptTemplate) {
        const promptDir = join(projectRoot, ".wld", "prompts");
        await Deno.mkdir(promptDir, { recursive: true });
        await Deno.writeTextFile(
            join(promptDir, "review.md"),
            ["---", 'description: "Review fixture"', "---", "Review the fixture carefully."].join("\n"),
        );
    }
    if (options.initPromptTemplate) {
        const promptDir = join(projectRoot, ".wld", "prompts");
        await Deno.mkdir(promptDir, { recursive: true });
        await Deno.writeTextFile(
            join(promptDir, "init.md"),
            ["---", 'description: "Init fixture"', "---", "Initialize from the fixture."].join("\n"),
        );
    }
    if (options.skill) {
        const skillDir = join(projectRoot, ".wld", "skills", "diagnose-fixture");
        await Deno.mkdir(skillDir, { recursive: true });
        await Deno.writeTextFile(
            join(skillDir, "SKILL.md"),
            [
                "---",
                'name: "diagnose-fixture"',
                'description: "Diagnose the fixture"',
                "---",
                "Inspect the fixture evidence before answering.",
            ].join("\n"),
        );
    }
}

async function withSlashFixture(
    options: SlashFixtureOptions,
    run: (fixture: SlashFixture, projectRoot: string) => Promise<void>,
): Promise<void> {
    await withRuntimeCommandFixture(
        "runwield-slash-dispatch-",
        async ({ projectRoot, setModelResponse }) => {
            await writeCatalogFixtures(projectRoot, options);
            setModelResponse("Fixture turn complete.");
            const runtime = createSessionRuntime();
            const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            await runtime.renameSession(created.sessionId, "Slash fixture");
            const messages: string[] = [];
            const submittedRequests: string[] = [];
            runtime.subscribeSessionEvents(created.sessionId, (event) => {
                if (event.type === RuntimeEventTypes.USER_MESSAGE) submittedRequests.push(event.text);
            });

            const templates = await runtime.listSessionPromptTemplates(created.sessionId);
            const promptTemplateByName = new Map(templates.map((template) => [template.name, template]));
            const skills = (await runtime.listSessionSkills(created.sessionId)).map((skill): SkillMeta => ({
                name: skill.name,
                description: skill.description,
                path: skill.path,
                source: skill.source,
                disableModelInvocation: skill.disableModelInvocation,
            }));
            const uiAPI: SlashContext["uiAPI"] = {
                abortActivePrompt: () => {},
                appendSystemMessage: (message) => messages.push(message),
                appendAgentMessageStart: () => ({ appendText: () => {} }),
                requestRender: () => {},
                promptSelect: () => Promise.resolve(options.selectedAgent ?? null),
                promptText: () => Promise.resolve(null),
                showModelSelector: () => {},
            };
            const editor: SlashContext["editor"] = {
                disableSubmit: false,
                setText: () => {},
                setAutocompleteProvider: () => {},
                handleInput: () => {},
            };
            const tui: SlashContext["tui"] = {
                requestRender: () => {},
                setFocus: () => {},
            };
            const context = (userRequest: string): SlashContext => ({
                userRequest,
                savedImages: [],
                sessionId: created.sessionId,
                sessionRuntime: runtime,
                uiAPI,
                editor,
                tui,
                sessionStartedAt: new Date().toISOString(),
                originalHandleInput: () => {},
                initCommandAvailable: true,
                promptTemplateByName,
                skills,
                chatPromptAgentName: "operator",
                resolveTemplateModel: () => ({ ok: false }),
                dispatchExpandedUserRequest: async (text, images) => {
                    await runtime.promptUserTurn(created.sessionId, {
                        initialRequest: text,
                        initialImages: images,
                    });
                },
                generationGuard: createGenerationGuard(),
            });

            try {
                await run({ context, messages, runtime, sessionId: created.sessionId, submittedRequests }, projectRoot);
            } finally {
                runtime.closeAllSessions();
            }
        },
    );
}

Deno.test("TUI picker cancellation and unavailable init persist truthful command lifecycles", async () => {
    await withSlashFixture({}, async ({ context }, projectRoot) => {
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        assertEquals(await handleSlashCommand(context("/agent")), true);
        const unavailable = context("/init");
        unavailable.initCommandAvailable = false;
        assertEquals(await handleSlashCommand(unavailable), true);
        await drainWorkflowMetrics();
        const rows = (await Deno.readTextFile(getWorkflowMetricsFilePath(projectRoot))).trim().split("\n")
            .map((line) => JSON.parse(line)).filter((row) => row.category === "command");
        assertEquals(rows.map((row) => [row.command, row.event, row.phase, row.outcome]), [
            ["agent", "command_started", "opened", undefined],
            ["agent", "command_finished", "finish", "canceled"],
            ["init", "command_started", "start", undefined],
            ["init", "command_finished", "rejected", "rejected"],
        ]);
        assertEquals(rows[0].commandId, rows[1].commandId);
        assertEquals(rows[2].commandId, rows[3].commandId);
    });
});

Deno.test("TUI picker selection records failure after dispatch when Agent cannot switch", async () => {
    await withSlashFixture({ selectedAgent: "not-an-agent" }, async ({ context }, projectRoot) => {
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        assertEquals(await handleSlashCommand(context("/agent")), true);
        await drainWorkflowMetrics();
        const rows = (await Deno.readTextFile(getWorkflowMetricsFilePath(projectRoot))).trim().split("\n")
            .map((line) => JSON.parse(line)).filter((row) => row.category === "command");
        assertEquals(rows.map((row) => [row.event, row.phase, row.outcome]), [
            ["command_started", "opened", undefined],
            ["command_dispatched", "dispatched", undefined],
            ["command_finished", "finish", "failed"],
        ]);
        assertEquals(new Set(rows.map((row) => row.commandId)).size, 1);
    });
});

Deno.test("TUI caught export write error settles the built-in as failed", async () => {
    await withSlashFixture({}, async ({ context }, projectRoot) => {
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        await handleSlashCommand(context("/export /nonexistent-runwield-directory/session.jsonl"));
        const rows = (await Deno.readTextFile(getWorkflowMetricsFilePath(projectRoot))).trim().split("\n")
            .map((line) => JSON.parse(line));
        assertEquals(rows.find((row) => row.event === "command_finished")?.outcome, "failed");
    });
});

Deno.test("isImmediateBuiltinSlashCommandWhileStreaming recognizes safe one-shot built-ins only", () => {
    assertEquals(isImmediateBuiltinSlashCommandWhileStreaming("/name Project Session"), true);
    assertEquals(isImmediateBuiltinSlashCommandWhileStreaming("/context"), true);
    assertEquals(isImmediateBuiltinSlashCommandWhileStreaming("/help"), true);
    assertEquals(isImmediateBuiltinSlashCommandWhileStreaming("/plan-review"), true);
    assertEquals(isImmediateBuiltinSlashCommandWhileStreaming("/quit"), true);
    assertEquals(isImmediateBuiltinSlashCommandWhileStreaming("/model"), false);
    assertEquals(isImmediateBuiltinSlashCommandWhileStreaming("/agent router"), false);
    assertEquals(isImmediateBuiltinSlashCommandWhileStreaming("hello"), false);
});

Deno.test("handleSlashCommand distinguishes regular input and unknown commands through the real registry", async () => {
    await withSlashFixture({}, async ({ context, messages }) => {
        assertEquals(await handleSlashCommand(context("hello")), false);
        assertEquals(await handleSlashCommand(context("/not-a-runwield-command")), true);
        assertEquals(messages, ["Unknown command: /not-a-runwield-command"]);
    });
});

Deno.test("handleSlashCommand runs onboarding only through the active TUI flow", async () => {
    await withSlashFixture({}, async ({ context, submittedRequests }) => {
        const slashContext = context("/onboard");
        let calls = 0;
        slashContext.beginOnboarding = () => {
            calls += 1;
            return Promise.resolve();
        };

        assertEquals(await handleSlashCommand(slashContext), true);
        assertEquals(calls, 1);
        assertEquals(submittedRequests, []);
    });
});

Deno.test("handleSlashCommand executes built-in help through the real command registry", async () => {
    await withSlashFixture({}, async ({ context, messages }) => {
        assertEquals(await handleSlashCommand(context("/help model")), true);
        assertEquals(messages.length, 1);
        assertStringIncludes(messages[0], "Usage (model):");
    });
});

Deno.test("handleSlashCommand keeps disabled built-ins reserved instead of dispatching same-named prompt templates", async () => {
    await withSlashFixture({}, async ({ context, messages, submittedRequests }) => {
        const slashContext = context("/mcp agy-cli");
        slashContext.promptTemplateByName.set("mcp", {
            name: "mcp",
            path: join("prompts", "mcp.md"),
        });

        assertEquals(await handleSlashCommand(slashContext), true);
        assertEquals(messages, ["Command /mcp is not available in this surface."]);
        assertEquals(submittedRequests, []);
    });
});

Deno.test("handleSlashCommand keeps hidden init reserved instead of dispatching a same-named prompt template", async () => {
    await withSlashFixture({ initPromptTemplate: true }, async ({ context, messages, submittedRequests }) => {
        const slashContext = context("/init use fixture state");
        slashContext.initCommandAvailable = false;

        assertEquals(await handleSlashCommand(slashContext), true);
        assertEquals(messages, [
            "The /init command is unavailable because RunWield is already initialized for this project.",
        ]);
        assertEquals(submittedRequests, []);
    });
});

Deno.test("handleSlashCommand shows expanded prompt template text from the Core runtime", async () => {
    await withSlashFixture({ promptTemplate: true }, async ({ context, submittedRequests }, projectRoot) => {
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        assertEquals(await handleSlashCommand(context("/review focus on tests")), true);
        assertEquals(submittedRequests, ["Review the fixture carefully.\n\nfocus on tests"]);
        await drainWorkflowMetrics();
        const rows = (await Deno.readTextFile(getWorkflowMetricsFilePath(projectRoot))).trim().split("\n")
            .map((line) => JSON.parse(line)).filter((row) => row.category === "command" && row.command === "review");
        assertEquals(rows.map((row) => row.event), ["command_started", "command_finished"]);
        assertEquals(new Set(rows.map((row) => row.commandId)).size, 1);
        assertEquals(rows[0].sourceSurface, "tui");
        assertEquals(JSON.stringify(rows).includes("focus on tests"), false);
    });
});

Deno.test("handleSlashCommand does not read prompt-template files in the TUI", async () => {
    await withSlashFixture({}, async ({ context, messages, submittedRequests }) => {
        const slashContext = context("/missing-template");
        slashContext.promptTemplateByName.set("missing-template", {
            name: "missing-template",
            path: join("missing", "template.md"),
        });

        assertEquals(await handleSlashCommand(slashContext), true);
        assertEquals(messages, []);
        assertEquals(submittedRequests, ["/missing-template"]);
    });
});

Deno.test("handleSlashCommand submits skill slash text through the active runtime", async () => {
    await withSlashFixture({ skill: true }, async ({ context, runtime, sessionId, submittedRequests }, projectRoot) => {
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        await runtime.switchAgent(sessionId, { agentName: "operator" });

        assertEquals(await handleSlashCommand(context("/skill:diagnose-fixture inspect the failure")), true);
        assertEquals(submittedRequests, ["/skill:diagnose-fixture inspect the failure"]);
        await drainWorkflowMetrics();
        const rows = (await Deno.readTextFile(getWorkflowMetricsFilePath(projectRoot))).trim().split("\n")
            .map((line) => JSON.parse(line)).filter((row) =>
                row.category === "command" && row.command === "diagnose-fixture"
            );
        assertEquals(rows.map((row) => row.event), ["command_started", "command_finished"]);
        assertEquals(new Set(rows.map((row) => row.commandId)).size, 1);
        assertEquals(JSON.stringify(rows).includes("inspect the failure"), false);
    });
});

Deno.test("handleSlashCommand does not read skill files in the TUI", async () => {
    await withSlashFixture({ skill: true }, async ({ context, messages, submittedRequests }, projectRoot) => {
        await Deno.remove(join(projectRoot, ".wld", "skills", "diagnose-fixture"), { recursive: true });

        assertEquals(await handleSlashCommand(context("/skill:diagnose-fixture")), true);
        assertEquals(messages, []);
        assertEquals(submittedRequests, ["/skill:diagnose-fixture"]);
    });
});
