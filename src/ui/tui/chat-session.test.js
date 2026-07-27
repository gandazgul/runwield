import { assertEquals, assertRejects } from "@std/assert";
import {
    __setSettingsManagerForPersistenceTests,
    buildFooterContextStat,
    buildFooterLine1Parts,
    buildFooterLocationText,
    buildFooterWorkflowLabelParts,
    getActiveModel,
    getFooterWorkflowLabelText,
    persistThinkingLevel,
    renderClipboardImageHintLines,
    renderFooterWorkflowLabelParts,
    renderUpdateNoticeLine,
    runScopedSubmitHandoffLoop,
    setActiveModel,
    shouldReplaySessionHistory,
    shouldShowFooterThinkingLevel,
} from "./chat-session.js";
import { resolveTemplateModel } from "../../shared/models/model-validation.js";

Deno.test("chat session layout keeps transcript, validation panel, spinner, prompts, accessories, and editor in order", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const orderedMarkers = [
        "container.addChild(messageList)",
        "container.addChild(validationPanelContainer)",
        "container.addChild(runningTasksComponent)",
        "container.addChild(activeInteractionContainer)",
        "container.addChild(inputAccessoryContainer)",
        "container.addChild(editor)",
    ];
    const indexes = orderedMarkers.map((marker) => source.indexOf(marker));

    assertEquals(indexes.every((index) => index >= 0), true);
    assertEquals(indexes, [...indexes].sort((a, b) => a - b));
});

Deno.test("streaming submissions execute safe one-shot slash commands before steering", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const streamingBranchIndex = source.indexOf("if (isProcessingSubmission) {");
    const immediateSlashIndex = source.indexOf(
        "isImmediateBuiltinSlashCommandWhileStreaming(userRequest)",
        streamingBranchIndex,
    );
    const executeSlashIndex = source.indexOf("executeUserRequest(userRequest, images)", immediateSlashIndex);
    const blockedSlashIndex = source.indexOf('userRequest.startsWith("/")', executeSlashIndex);
    const blockedSlashMessageIndex = source.indexOf(
        "That slash command can only run after streaming has stopped.",
        blockedSlashIndex,
    );
    const steerIndex = source.indexOf(
        "sessionRuntime.steerSession(sessionId, userRequest, images)",
        streamingBranchIndex,
    );

    assertEquals(streamingBranchIndex >= 0, true);
    assertEquals(immediateSlashIndex > streamingBranchIndex, true);
    assertEquals(executeSlashIndex > immediateSlashIndex, true);
    assertEquals(blockedSlashIndex > executeSlashIndex, true);
    assertEquals(blockedSlashMessageIndex > blockedSlashIndex, true);
    assertEquals(steerIndex > blockedSlashMessageIndex, true);
});

Deno.test("managed session sync can read processing state before startup awaits", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const processingStateIndex = source.indexOf("let isProcessingSubmission = false;");
    const syncControllerIndex = source.indexOf("const managedSyncController = createManagedSessionSyncController({");
    const modelWelcomeIndex = source.indexOf("const modelWelcomeResult = await maybeShowModelWelcome({");

    assertEquals(processingStateIndex >= 0, true);
    assertEquals(syncControllerIndex >= 0, true);
    assertEquals(modelWelcomeIndex >= 0, true);
    assertEquals(processingStateIndex < syncControllerIndex, true);
    assertEquals(syncControllerIndex < modelWelcomeIndex, true);
});

Deno.test("new TUI Sessions do not opt into managed activation implicitly", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const createSessionIndex = source.indexOf("const createdSession = await sessionRuntime.createInteractiveSession({");
    const managedActivationOptionIndex = source.indexOf("enableManagedActivation:", createSessionIndex);
    const deferOptionIndex = source.indexOf("deferManagedActivationUntilAgentReady:", createSessionIndex);
    const modelWelcomeIndex = source.indexOf("const modelWelcomeResult = await maybeShowModelWelcome({");
    const switchAgentIndex = source.indexOf("await sessionRuntime.switchAgent(sessionId, {");

    assertEquals(createSessionIndex >= 0, true);
    assertEquals(managedActivationOptionIndex === -1 || managedActivationOptionIndex > switchAgentIndex, true);
    assertEquals(deferOptionIndex === -1 || deferOptionIndex > switchAgentIndex, true);
    assertEquals(modelWelcomeIndex < switchAgentIndex, true);
});

Deno.test("startup update notice placeholder sits directly under the title line", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const titleIndex = source.indexOf("container.addChild(new Text(titleLine, 0, 0));");
    const updateNoticeIndex = source.indexOf("container.addChild(updateNoticeText);", titleIndex);
    const helpIndex = source.indexOf("container.addChild(helpText);", updateNoticeIndex);

    assertEquals(titleIndex >= 0, true);
    assertEquals(updateNoticeIndex > titleIndex, true);
    assertEquals(helpIndex > updateNoticeIndex, true);
});

Deno.test("startup update refresh is not awaited before model welcome", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const refreshIndex = source.indexOf("void refreshUpdateCheckCache({ currentVersion: VERSION }).then");
    const awaitedRefreshIndex = source.indexOf("await refreshUpdateCheckCache");
    const modelWelcomeIndex = source.indexOf("const modelWelcomeResult = await maybeShowModelWelcome({");

    assertEquals(refreshIndex >= 0, true);
    assertEquals(awaitedRefreshIndex, -1);
    assertEquals(modelWelcomeIndex > refreshIndex, true);
});

Deno.test("startup update refresh runs only when no fresh cache is available", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const cacheReadIndex = source.indexOf(
        "const cachedUpdateAvailability = getCachedUpdateAvailabilitySync({ currentVersion: VERSION });",
    );
    const cachedBranchIndex = source.indexOf("if (cachedUpdateAvailability) {", cacheReadIndex);
    const refreshElseIndex = source.indexOf(
        "} else {\n            void refreshUpdateCheckCache({ currentVersion: VERSION }).then",
        cachedBranchIndex,
    );

    assertEquals(cacheReadIndex >= 0, true);
    assertEquals(cachedBranchIndex > cacheReadIndex, true);
    assertEquals(refreshElseIndex > cachedBranchIndex, true);
});

Deno.test("update notice renderer colors only the version", () => {
    const themeImpl = {
        fg: (/** @type {string} */ token, /** @type {string} */ text) => `<${token}>${text}</${token}>`,
    };
    assertEquals(
        renderUpdateNoticeLine("v9.8.7", themeImpl),
        "New version available: <routingQuickFix>v9.8.7</routingQuickFix>. Run `wld update` to install it",
    );
});

Deno.test("startup boot banner renders before managed agent activation can block it", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const bootBannerIndex = source.indexOf("await renderBootBanner({");
    const modelWelcomeIndex = source.indexOf("const modelWelcomeResult = await maybeShowModelWelcome({");
    const switchAgentIndex = source.indexOf("await sessionRuntime.switchAgent(sessionId, {");

    assertEquals(bootBannerIndex >= 0, true);
    assertEquals(modelWelcomeIndex >= 0, true);
    assertEquals(switchAgentIndex >= 0, true);
    assertEquals(bootBannerIndex < modelWelcomeIndex, true);
    assertEquals(bootBannerIndex < switchAgentIndex, true);
});

Deno.test("empty-directory hint is suppressed while first-run model setup is still required", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const modelWelcomeIndex = source.indexOf("const modelWelcomeResult = await maybeShowModelWelcome({");
    const emptyDirectoryHintIndex = source.indexOf("EMPTY_PROJECT_DIRECTORY_WELCOME_BODY", modelWelcomeIndex);
    const emptyDirectoryConditionStart = source.lastIndexOf("if (", emptyDirectoryHintIndex);
    const emptyDirectoryConditionEnd = source.indexOf(") {", emptyDirectoryConditionStart);
    const emptyDirectoryCondition = source.slice(emptyDirectoryConditionStart, emptyDirectoryConditionEnd);

    assertEquals(modelWelcomeIndex >= 0, true);
    assertEquals(emptyDirectoryHintIndex > modelWelcomeIndex, true);
    assertEquals(emptyDirectoryCondition.includes("!modelWelcomeResult.noModel"), true);
});

Deno.test("pasted images remain pending when managed startup is dormant", async () => {
    const source = await Deno.readTextFile(new URL("./chat-session.js", import.meta.url));
    const pasteHandlerIndex = source.indexOf("async function handleImagePaste(image)");
    const persistIndex = source.indexOf("sessionRuntime.persistSessionImage(sessionId, image)", pasteHandlerIndex);
    const dormantFallbackIndex = source.indexOf('message.includes("no active session is available")', persistIndex);
    const preflightIndex = source.indexOf(
        "const preflight = await preflightCurrentImages([attachment]);",
        persistIndex,
    );
    const returnIndex = source.indexOf("return attachment;", preflightIndex);

    assertEquals(pasteHandlerIndex >= 0, true);
    assertEquals(persistIndex > pasteHandlerIndex, true);
    assertEquals(dormantFallbackIndex > persistIndex, true);
    assertEquals(preflightIndex > dormantFallbackIndex, true);
    assertEquals(returnIndex > preflightIndex, true);
});

Deno.test("footer thinking level is hidden until a model is configured", () => {
    assertEquals(shouldShowFooterThinkingLevel("", "medium"), false);
    assertEquals(shouldShowFooterThinkingLevel("test/model", "off"), false);
    assertEquals(shouldShowFooterThinkingLevel("test/model", "medium"), true);
});

Deno.test("footer context stat shows percentage, total capacity, and auto-compaction", () => {
    assertEquals(
        buildFooterContextStat({ contextWindow: 1_000_000, percent: 48.65 }, true),
        { text: "48.6%/1.0M (Auto-compact)", token: "dim" },
    );
    assertEquals(
        buildFooterContextStat({ contextWindow: 128_000, percent: 75 }, false),
        { text: "75.0%/128k", token: "warning" },
    );
    assertEquals(
        buildFooterContextStat({ contextWindow: 200_000, percent: 95 }, true),
        { text: "95.0%/200k (Auto-compact)", token: "error" },
    );
    assertEquals(
        buildFooterContextStat({ contextWindow: 128_000, percent: null }, true),
        { text: "?/128k (Auto-compact)", token: "dim" },
    );
    assertEquals(buildFooterContextStat(null, true), null);
});

Deno.test("startup replays history only when continuing a persisted session", () => {
    assertEquals(shouldReplaySessionHistory("new"), false);
    assertEquals(shouldReplaySessionHistory(undefined), false);
    assertEquals(shouldReplaySessionHistory("continue"), true);
});

Deno.test("footer workflow label formats eligible routing context and theme tokens", () => {
    const parts = buildFooterWorkflowLabelParts(
        { displayName: "Planner", agentName: "planner" },
        { routingIntent: "FEATURE", complexity: "MEDIUM", planName: "my-awesome-plan" },
        80,
    );
    assertEquals(getFooterWorkflowLabelText(parts), "Planner - Medium Feature - my-awesome-plan");
    assertEquals(parts.map((part) => part.token), [
        "accent",
        "dim",
        "complexityMedium",
        "dim",
        "routingFeature",
        "dim",
        "dim",
    ]);
});

Deno.test("footer workflow label maps intent wording and hides ineligible agents", () => {
    assertEquals(
        getFooterWorkflowLabelText(buildFooterWorkflowLabelParts(
            { displayName: "Engineer", agentName: "engineer" },
            { routingIntent: "QUICK_FIX", complexity: "LOW" },
            80,
        )),
        "Engineer - Low Quick Fix",
    );
    assertEquals(
        getFooterWorkflowLabelText(buildFooterWorkflowLabelParts(
            { displayName: "Operator", agentName: "operator" },
            { routingIntent: "FEATURE", complexity: "MEDIUM", planName: "p" },
            80,
        )),
        "Operator",
    );
});

Deno.test("clipboard image hint renders above input only until an image is pasted", () => {
    const themeImpl = {
        fg: (/** @type {string} */ token, /** @type {string} */ text) => `<${token}>${text}</${token}>`,
    };
    assertEquals(
        renderClipboardImageHintLines(true, 0, 80, themeImpl),
        [`${" ".repeat(44)}<dim>Image in clipboard · ctrl+v to paste</dim>`],
    );
    assertEquals(renderClipboardImageHintLines(false, 0, 80, themeImpl), []);
    assertEquals(renderClipboardImageHintLines(true, 1, 80, themeImpl), []);
});

Deno.test("footer label truncation preserves the left side", () => {
    const line = buildFooterLine1Parts(
        { displayName: "Planner", agentName: "planner" },
        { routingIntent: "FEATURE", complexity: "MEDIUM", planName: "very-long-plan-name" },
        "~/project (main)",
        41,
    );
    assertEquals(line.left, "~/project (main)");
    assertEquals(getFooterWorkflowLabelText(line.rightParts), "Planner - Medium Feature");
});

Deno.test("footer location follows active worktree execution context", () => {
    const text = buildFooterLocationText({
        cwd: "/repo",
        activeExecutionWorkflow: {
            executionCwd: "/repo-runwield-demo",
            worktreeBranch: "runwield/worktree/demo",
        },
    }, {
        home: "/repo",
        resolveBranch: () => "main",
    });

    assertEquals(text, "/repo-runwield-demo (runwield/worktree/demo)");
});

Deno.test("footer location shortens RunWield-managed worktree paths", () => {
    const text = buildFooterLocationText({
        cwd: "/Users/gandazgul/Documents/web/runwield",
        activeExecutionWorkflow: {
            executionCwd:
                "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-frontend-framework-design-skill-51003995",
            worktreeBranch: "runwield/worktree/frontend-framework-design-skill-51003995",
        },
    }, {
        home: "/Users/gandazgul",
        resolveBranch: () => "main",
    });

    assertEquals(
        text,
        "runwield/runwield-runwield-frontend-framework-design-skill-51003995 (runwield/worktree/frontend-framework-design-skill-51003995)",
    );
});

Deno.test("footer location resolves branch from the displayed cwd when not in an execution worktree", () => {
    const calls = /** @type {string[]} */ ([]);
    const text = buildFooterLocationText({
        cwd: "/home/user/repo",
        activeExecutionWorkflow: null,
    }, {
        home: "/home/user",
        resolveBranch: (cwd) => {
            calls.push(cwd);
            return "feature/local";
        },
    });

    assertEquals(text, "~/repo (feature/local)");
    assertEquals(calls, ["/home/user/repo"]);
});

Deno.test("footer workflow renderer applies provided theme tokens", () => {
    const rendered = renderFooterWorkflowLabelParts(
        buildFooterWorkflowLabelParts(
            { displayName: "Engineer", agentName: "engineer" },
            { routingIntent: "QUICK_FIX", complexity: "LOW" },
            80,
        ),
        { fg: (token, text) => `<${token}>${text}</${token}>` },
    );
    assertEquals(
        rendered,
        "<accent>Engineer</accent><dim> - </dim><complexityLow>Low</complexityLow><dim> </dim><routingQuickFix>Quick Fix</routingQuickFix>",
    );
});

Deno.test("resolveTemplateModel validates provider/id lookup and auth", () => {
    const registry = {
        find: (/** @type {string} */ provider, /** @type {string} */ id) =>
            provider === "test" && id === "model" ? { provider, id } : null,
        hasConfiguredAuth: (/** @type {unknown} */ model) => Boolean(model),
    };
    assertEquals(resolveTemplateModel("not-strict", registry), { ok: false });
    assertEquals(resolveTemplateModel("test/missing", registry), { ok: false });
    assertEquals(resolveTemplateModel("test/model", registry), { ok: true, provider: "test", id: "model" });
});

Deno.test("setActiveModel delegates reconfiguration to SessionRuntime and persists selection", async () => {
    const calls = /** @type {any[]} */ ([]);
    const runtime = /** @type {any} */ ({
        getSessionSnapshot: () => ({ cwd: Deno.cwd(), activeModel: { model: "old", provider: "test" } }),
        /** @param {string} sessionId @param {string} model @param {string} provider */
        reconfigureSessionModel: (sessionId, model, provider) => {
            calls.push({ sessionId, model, provider });
            return Promise.resolve({ ok: true });
        },
    });
    const persisted = /** @type {string[]} */ ([]);
    try {
        __setSettingsManagerForPersistenceTests(() => /** @type {any} */ ({
            setDefaultModel: (/** @type {string} */ model) => {
                persisted.push(`model:${model}`);
                return Promise.resolve();
            },
            setDefaultProvider: (/** @type {string} */ provider) => {
                persisted.push(`provider:${provider}`);
                return Promise.resolve();
            },
        }));
        await setActiveModel(runtime, "runtime-id", "model-a", "provider-a");
    } finally {
        __setSettingsManagerForPersistenceTests(null);
    }
    assertEquals(calls, [{ sessionId: "runtime-id", model: "model-a", provider: "provider-a" }]);
    assertEquals(persisted, ["model:model-a", "provider:provider-a"]);
});

Deno.test("setActiveModel propagates Runtime reconfiguration failure", async () => {
    const runtime = /** @type {any} */ ({
        getSessionSnapshot: () => ({ cwd: Deno.cwd(), activeModel: { model: "old", provider: "test" } }),
        reconfigureSessionModel: () => Promise.reject(new Error("No API key")),
    });
    await assertRejects(() => setActiveModel(runtime, "runtime-id", "model", "test"), Error, "No API key");
});

Deno.test("getActiveModel reads only the Runtime snapshot", () => {
    const runtime = /** @type {any} */ ({
        getSessionSnapshot: () => ({ activeModel: { model: "model-a", provider: "provider-a" } }),
    });
    assertEquals(getActiveModel(runtime, "runtime-id"), "model-a");
});

Deno.test("persistThinkingLevel stores the selected level", async () => {
    const persisted = /** @type {string[]} */ ([]);
    try {
        __setSettingsManagerForPersistenceTests(() => /** @type {any} */ ({
            setDefaultThinkingLevel: (/** @type {string} */ level) => {
                persisted.push(level);
                return Promise.resolve();
            },
        }));
        await persistThinkingLevel("high");
    } finally {
        __setSettingsManagerForPersistenceTests(null);
    }
    assertEquals(persisted, ["high"]);
});

Deno.test("submit handoff loop invokes one Runtime prompt by opaque id", async () => {
    const calls = /** @type {any[]} */ ([]);
    /** @type {((event: any) => void) | null} */
    let listener = null;
    const runtime = /** @type {any} */ ({
        setInteractionAdapter: () => ({ ok: true }),
        /** @param {string} _id @param {(event: any) => void} next */
        subscribeSessionEvents: (_id, next) => {
            listener = next;
            return () => {
                listener = null;
            };
        },
        getSessionSnapshot: () => ({ queuedMessages: [] }),
        /** @param {string} sessionId @param {any} options */
        promptUserTurn: (sessionId, options) => {
            calls.push({ sessionId, options, subscribed: Boolean(listener) });
            return Promise.resolve({ ok: true });
        },
    });
    await runScopedSubmitHandoffLoop({
        runtime,
        sessionId: "runtime-id",
        uiAPI: /** @type {any} */ ({
            requestRender: () => {},
            promptSelect: () => Promise.resolve(null),
            promptText: () => Promise.resolve(null),
        }),
        initialRequest: "first request",
        initialImages: [],
    });
    assertEquals(calls, [{
        sessionId: "runtime-id",
        options: { initialRequest: "first request", initialImages: [] },
        subscribed: true,
    }]);
    assertEquals(listener, null);
});
