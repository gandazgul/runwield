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
        swaps: 0,
        swapHostedSessions: /** @type {unknown[]} */ ([]),
        activeAgents: /** @type {any[]} */ ([]),
        runs: /** @type {any[]} */ ([]),
        expandedDispatches: /** @type {any[]} */ ([]),
        expandedTemplates: /** @type {any[]} */ ([]),
        expandedSkills: /** @type {any[]} */ ([]),
        canceledSessionIds: /** @type {string[]} */ ([]),
        createdHandlers: /** @type {Array<{ agentName: string, deps: unknown }>} */ ([]),
    };
    const sessionId = "runtime-session-1";
    const sessionRuntime = {
        getSessionSnapshot: (/** @type {string} */ id) => ({ id, cwd: Deno.cwd(), name: "named session" }),
        cancelSession: (/** @type {string} */ id) => records.canceledSessionIds.push(id),
        switchAgent: (/** @type {string} */ id, /** @type {{ agentName: string }} */ options) => {
            records.activeAgents.push({ sessionId: id, agentName: options.agentName });
            return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
        },
    };
    const ctx = {
        userRequest: "",
        savedImages: [{ base64: "img", mimeType: "image/png" }],
        sessionId,
        sessionRuntime,
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
        dispatchExpandedUserRequest: (
            /** @type {string} */ text,
            /** @type {Array<{ base64: string, mimeType: string }>} */ images,
        ) => {
            records.expandedDispatches.push({ text, images });
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
        __deps: {
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
            createAgentHandler: (/** @type {string} */ agentName, /** @type {unknown} */ deps) => {
                records.createdHandlers.push({ agentName, deps });
                return `handler:${agentName}`;
            },
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

Deno.test("handleSlashCommand dispatches built-in commands through the Runtime context", async () => {
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
    assertEquals(ctx.records.commandArgs, ["alpha", "beta"]);
    assertEquals(ctx.records.commandDeps.uiAPI, ctx.uiAPI);
    assertEquals(ctx.records.commandDeps.editor, ctx.editor);
    assertEquals(ctx.records.commandDeps.tui, ctx.tui);
    assertEquals(ctx.records.commandDeps.sessionId, ctx.sessionId);
    assertEquals(ctx.records.commandDeps.sessionRuntime, ctx.sessionRuntime);
    assertEquals(ctx.records.canceledSessionIds, []);
    assertEquals(ctx.records.swaps, 0);
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

Deno.test("handleSlashCommand switches prompt templates to Operator before expanded root input", async () => {
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
    assertEquals(ctx.records.expandedDispatches, [{
        text: "expanded:/tmp/review.md:make it sharp",
        images: [{ base64: "img", mimeType: "image/png" }],
    }]);
    assertEquals(ctx.records.userMessages, []);
    assertEquals(ctx.records.images, []);
    assertEquals(ctx.records.activeAgents, [{ sessionId: ctx.sessionId, agentName: "operator" }]);
    assertEquals(ctx.records.createdHandlers, []);
    assertEquals(ctx.records.swaps, 0);
    assertEquals(ctx.records.swapHostedSessions, []);
    assertEquals(ctx.records.runs, []);
});

Deno.test("handleSlashCommand ignores template model metadata during macro expansion", async () => {
    const ctx = makeContext({ userRequest: "/review" });
    ctx.promptTemplateByName.set("review", { name: "review", path: "/tmp/review.md", model: "bad/model" });
    ctx.resolveTemplateModel = () => ({ ok: false });

    assertEquals(await handleSlashCommand(ctx), true);

    assertEquals(ctx.records.systemMessages, []);
    assertEquals(ctx.records.expandedTemplates, [{
        path: "/tmp/review.md",
        additionalInstructions: undefined,
    }]);
    assertEquals(ctx.records.expandedDispatches, [{
        text: "expanded:/tmp/review.md:",
        images: [{ base64: "img", mimeType: "image/png" }],
    }]);
    assertEquals(ctx.records.runs, []);
});

Deno.test("handleSlashCommand rejects prompt templates without a source path", async () => {
    const ctx = makeContext({ userRequest: "/tiny extra" });
    ctx.promptTemplateByName.set("tiny", { name: "tiny" });

    assertEquals(await handleSlashCommand(ctx), true);

    assertEquals(ctx.records.expandedDispatches, []);
    assertEquals(ctx.records.systemMessages, ['Error expanding template: Prompt template "tiny" has no source path.']);
});

Deno.test("handleSlashCommand reports template expansion and dispatch errors", async () => {
    const expandError = makeContext({ userRequest: "/review" });
    expandError.promptTemplateByName.set("review", { name: "review", path: "/tmp/review.md" });
    expandError.__deps.expandPromptTemplate = () => Promise.reject(new Error("cannot read"));

    assertEquals(await handleSlashCommand(expandError), true);
    assertEquals(expandError.records.systemMessages, ["Error expanding template: cannot read"]);

    const runError = makeContext({ userRequest: "/review" });
    runError.promptTemplateByName.set("review", { name: "review", path: "/tmp/review.md" });
    runError.dispatchExpandedUserRequest = () => Promise.reject(new Error("model failed"));

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
    assertEquals(ctx.records.expandedDispatches, [{
        text: "skill:diagnose:flaky test",
        images: [{ base64: "img", mimeType: "image/png" }],
    }]);
    assertEquals(ctx.records.userMessages, []);
    assertEquals(ctx.records.images, []);
    assertEquals(ctx.records.activeAgents, []);
    assertEquals(ctx.records.swaps, 0);
    assertEquals(ctx.records.runs, []);

    const errorCtx = makeContext({ userRequest: "/skill:diagnose" });
    errorCtx.skills = ctx.skills;
    errorCtx.__deps.expandSkillCommand = () => Promise.reject(new Error("missing skill"));

    assertEquals(await handleSlashCommand(errorCtx), true);
    assertEquals(errorCtx.records.systemMessages, ["Error: missing skill"]);
});
