import { assertEquals, assertRejects } from "@std/assert";
import {
    __setSettingsManagerForPersistenceTests,
    buildFooterLine1Parts,
    buildFooterWorkflowLabelParts,
    getActiveModel,
    getFooterWorkflowLabelText,
    persistThinkingLevel,
    renderClipboardImageHintLines,
    renderFooterWorkflowLabelParts,
    runScopedSubmitHandoffLoop,
    setActiveModel,
    shouldReplaySessionHistory,
    shouldShowFooterThinkingLevel,
} from "./chat-session.js";
import { resolveTemplateModel } from "../../shared/models/model-validation.js";

Deno.test("footer thinking level is hidden until a model is configured", () => {
    assertEquals(shouldShowFooterThinkingLevel("", "medium"), false);
    assertEquals(shouldShowFooterThinkingLevel("test/model", "off"), false);
    assertEquals(shouldShowFooterThinkingLevel("test/model", "medium"), true);
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
        ["<dim>Image in clipboard · ctrl+v to paste</dim>"],
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
        promptSession: (sessionId, options) => {
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
