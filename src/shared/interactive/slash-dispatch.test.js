import { assertEquals } from "@std/assert";
import { handleSlashCommand } from "./slash-dispatch.js";

/**
 * @param {Partial<any>} [overrides]
 * @returns {any}
 */
function makeContext(overrides = {}) {
    const records = {
        systemMessages: /** @type {string[]} */ ([]),
        userMessages: /** @type {string[]} */ ([]),
        images: /** @type {Array<{ base64: string, mimeType: string }>} */ ([]),
        bumps: 0,
        currentChecks: /** @type {number[]} */ ([]),
        cancels: /** @type {Array<(() => void) | null>} */ ([]),
        swaps: 0,
        activeAgents: /** @type {any[]} */ ([]),
        runs: /** @type {any[]} */ ([]),
        expandedTemplates: /** @type {any[]} */ ([]),
        expandedSkills: /** @type {any[]} */ ([]),
        aborted: 0,
    };
    const ctx = {
        userRequest: "",
        savedImages: [{ base64: "img", mimeType: "image/png" }],
        uiAPI: {
            appendSystemMessage: (/** @type {string} */ message) => records.systemMessages.push(message),
            appendUserMessage: (/** @type {string} */ message) => records.userMessages.push(message),
            appendImage: (/** @type {string} */ base64, /** @type {string} */ mimeType) => {
                records.images.push({ base64, mimeType });
            },
        },
        editor: { id: "editor" },
        tui: { id: "tui" },
        sessionStartedAt: "2026-06-15T00:00:00.000Z",
        originalHandleInput: () => {},
        builtinNames: new Set(["known"]),
        promptTemplateByName: new Map(),
        skills: [],
        chatPromptAgentName: "operator",
        resolveTemplateModel: () => ({ ok: true, provider: "test", id: "model" }),
        setActiveAgent: (
            /** @type {string} */ agentName,
            /** @type {unknown} */ handler,
            /** @type {unknown} */ uiAPI,
            /** @type {string | undefined} */ model,
        ) => {
            records.activeAgents.push({ agentName, handler, uiAPI, model });
        },
        applyPendingRootSwap: () => {
            records.swaps++;
            return Promise.resolve();
        },
        generationGuard: {
            bump: () => {
                records.bumps++;
                return 42;
            },
            isCurrent: (/** @type {number} */ generation) => {
                records.currentChecks.push(generation);
                return true;
            },
        },
        registerOperationCancel: (/** @type {(() => void) | null} */ cancel) => records.cancels.push(cancel),
        __deps: {
            abortActiveSession: () => {
                records.aborted++;
                return true;
            },
            commandRegistry: {},
            getSlashCommandDefinition: () => undefined,
            expandPromptTemplate: (
                /** @type {string} */ path,
                /** @type {string | undefined} */ additionalInstructions,
            ) => {
                records.expandedTemplates.push({ path, additionalInstructions });
                return Promise.resolve(`expanded:${path}:${additionalInstructions || ""}`);
            },
            expandSkillCommand: (
                /** @type {string} */ name,
                /** @type {string | undefined} */ additionalInstructions,
            ) => {
                records.expandedSkills.push({ name, additionalInstructions });
                return Promise.resolve(`skill:${name}:${additionalInstructions || ""}`);
            },
            runAgentSession: (/** @type {unknown} */ opts) => {
                records.runs.push(opts);
                return Promise.resolve([]);
            },
            createAgentHandler: (/** @type {string} */ agentName) => () => Promise.resolve(agentName),
            getRootSessionManager: () => ({ id: "session" }),
        },
        records,
    };
    return Object.assign(ctx, overrides);
}

Deno.test("handleSlashCommand ignores non-slash input", async () => {
    const ctx = makeContext({ userRequest: "hello" });

    assertEquals(await handleSlashCommand(ctx), false);
    assertEquals(ctx.records.bumps, 0);
});

Deno.test("handleSlashCommand reports unknown slash commands", async () => {
    const ctx = makeContext({ userRequest: "/wat" });

    assertEquals(await handleSlashCommand(ctx), true);

    assertEquals(ctx.records.bumps, 1);
    assertEquals(ctx.records.systemMessages, ["Unknown command: /wat"]);
});

Deno.test("handleSlashCommand dispatches built-in commands and restores cancellation state", async () => {
    const ctx = makeContext({ userRequest: "/known alpha beta" });
    ctx.__deps.getSlashCommandDefinition = (/** @type {string} */ name) => name === "known" ? { name } : undefined;
    ctx.__deps.commandRegistry = {
        known: {
            execute: (/** @type {string[]} */ args, /** @type {any} */ deps) => {
                ctx.records.commandArgs = args;
                ctx.records.commandDeps = deps;
            },
        },
    };

    assertEquals(await handleSlashCommand(ctx), true);
    ctx.records.cancels[0]?.();

    assertEquals(ctx.records.commandArgs, ["alpha", "beta"]);
    assertEquals(ctx.records.commandDeps.uiAPI, ctx.uiAPI);
    assertEquals(ctx.records.commandDeps.editor, ctx.editor);
    assertEquals(ctx.records.commandDeps.tui, ctx.tui);
    assertEquals(ctx.records.commandDeps.sessionManager, { id: "session" });
    assertEquals(ctx.records.cancels.length, 2);
    assertEquals(ctx.records.cancels[1], null);
    assertEquals(ctx.records.aborted, 1);
    assertEquals(ctx.records.swaps, 1);
});

Deno.test("handleSlashCommand reports built-in command errors only for current generation", async () => {
    const ctx = makeContext({ userRequest: "/known" });
    ctx.__deps.getSlashCommandDefinition = () => ({ name: "known" });
    ctx.__deps.commandRegistry = {
        known: {
            execute: () => {
                throw new Error("boom");
            },
        },
    };

    assertEquals(await handleSlashCommand(ctx), true);
    assertEquals(ctx.records.systemMessages, ["Error: boom"]);

    const stale = makeContext({ userRequest: "/known" });
    stale.generationGuard.isCurrent = () => false;
    stale.__deps.getSlashCommandDefinition = () => ({ name: "known" });
    stale.__deps.commandRegistry = ctx.__deps.commandRegistry;
    assertEquals(await handleSlashCommand(stale), true);
    assertEquals(stale.records.systemMessages, []);
});

Deno.test("handleSlashCommand dispatches prompt templates with images and optional model", async () => {
    const ctx = makeContext({ userRequest: "/review make it sharp" });
    ctx.promptTemplateByName.set("review", {
        name: "review",
        path: "/tmp/review.md",
        model: "test/model",
    });

    assertEquals(await handleSlashCommand(ctx), true);

    assertEquals(ctx.records.expandedTemplates, [{
        path: "/tmp/review.md",
        additionalInstructions: "make it sharp",
    }]);
    assertEquals(ctx.records.userMessages, ["/review make it sharp"]);
    assertEquals(ctx.records.images, [{ base64: "img", mimeType: "image/png" }]);
    assertEquals(ctx.records.activeAgents[0].agentName, "operator");
    assertEquals(ctx.records.activeAgents[0].model, "test/model");
    assertEquals(ctx.records.runs[0].agentName, "operator");
    assertEquals(ctx.records.runs[0].modelOverride, "test/model");
    assertEquals(ctx.records.runs[0].userRequest, "expanded:/tmp/review.md:make it sharp");
});

Deno.test("handleSlashCommand rejects invalid template model before expanding", async () => {
    const ctx = makeContext({ userRequest: "/review" });
    ctx.promptTemplateByName.set("review", { name: "review", path: "/tmp/review.md", model: "bad/model" });
    ctx.resolveTemplateModel = () => ({ ok: false });

    assertEquals(await handleSlashCommand(ctx), true);

    assertEquals(ctx.records.systemMessages, ["Invalid template model. Use /model to switch."]);
    assertEquals(ctx.records.expandedTemplates, []);
    assertEquals(ctx.records.runs, []);
});

Deno.test("handleSlashCommand uses template fallback text when path is missing", async () => {
    const ctx = makeContext({ userRequest: "/tiny extra" });
    ctx.promptTemplateByName.set("tiny", { name: "tiny" });

    assertEquals(await handleSlashCommand(ctx), true);

    assertEquals(ctx.records.runs[0].userRequest, "/tiny extra");
});

Deno.test("handleSlashCommand reports template expansion and run errors", async () => {
    const expandError = makeContext({ userRequest: "/review" });
    expandError.promptTemplateByName.set("review", { name: "review", path: "/tmp/review.md" });
    expandError.__deps.expandPromptTemplate = () => Promise.reject(new Error("cannot read"));

    assertEquals(await handleSlashCommand(expandError), true);
    assertEquals(expandError.records.systemMessages, ["Error expanding template: cannot read"]);

    const runError = makeContext({ userRequest: "/review" });
    runError.promptTemplateByName.set("review", { name: "review", path: "/tmp/review.md" });
    runError.__deps.runAgentSession = () => Promise.reject(new Error("model failed"));

    assertEquals(await handleSlashCommand(runError), true);
    assertEquals(runError.records.systemMessages, ["Error: model failed"]);
});

Deno.test("handleSlashCommand dispatches skills and reports skill errors", async () => {
    const ctx = makeContext({ userRequest: "/skill:diagnose flaky test" });
    ctx.skills = [{ name: "diagnose", description: "Debug", path: "SKILL.md", source: "bundled" }];

    assertEquals(await handleSlashCommand(ctx), true);

    assertEquals(ctx.records.expandedSkills, [{
        name: "diagnose",
        additionalInstructions: "flaky test",
    }]);
    assertEquals(ctx.records.userMessages, ["/skill:diagnose flaky test"]);
    assertEquals(ctx.records.images, [{ base64: "img", mimeType: "image/png" }]);
    assertEquals(ctx.records.runs[0].userRequest, "skill:diagnose:flaky test");

    const errorCtx = makeContext({ userRequest: "/skill:diagnose" });
    errorCtx.skills = ctx.skills;
    errorCtx.__deps.expandSkillCommand = () => Promise.reject(new Error("missing skill"));

    assertEquals(await handleSlashCommand(errorCtx), true);
    assertEquals(errorCtx.records.systemMessages, ["Error: missing skill"]);
});
