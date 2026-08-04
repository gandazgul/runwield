import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
    registerScriptedOAuthProvider,
    SCRIPTED_OAUTH_MODEL,
    SCRIPTED_OAUTH_PROVIDER_ID,
    SCRIPTED_OAUTH_PROVIDER_NAME,
    withRuntimeCommandFixture,
} from "../../cmd/testing/runtime-command-fixture.ts";
import { getSettingsManager } from "../../shared/settings.js";
import {
    detectModelAvailability,
    getConfiguredModelAvailability,
    getSelectedDefaultModelAvailability,
} from "./model-welcome.ts";
import { createInteractiveCompositionHarness } from "./testing/interactive-composition-fixture.ts";

const WELCOME_TITLE = "Welcome to RunWield";
const MODEL_SELECTOR_MARKER = "Only showing models from configured providers";
const REDIRECT_URL = "https://fixture.example/callback";
const SCRIPTED_PROVIDER_FILTER = "Aardvark";

interface RegistryValueModel {
    id: string;
    provider: string;
}

/** @returns {{ getAvailable: () => RegistryValueModel[], find: (provider: string, id: string) => RegistryValueModel | undefined }} */
function registryValue(available: RegistryValueModel[]) {
    return {
        getAvailable: () => available,
        find: (provider: string, id: string) =>
            available.find((model) => model.id === id && (!provider || model.provider === provider)),
    };
}

/** Drive the onboarding completion path through the scripted OAuth provider. */
async function completeOnboardingWithScriptedProvider(
    harness: Awaited<ReturnType<typeof createInteractiveCompositionHarness>>,
): Promise<void> {
    await harness.type("\r"); // welcome prompt: "Use a subscription login"
    await harness.waitForScreen("Select provider to configure:");
    await harness.type(`${SCRIPTED_PROVIDER_FILTER}\r`);
    await harness.waitForScreen("Paste the redirect URL");
    await harness.type(`${REDIRECT_URL}\r`);
    await harness.waitForScreen(`Logged in to ${SCRIPTED_OAUTH_PROVIDER_NAME}.`);
    await harness.waitForScreen(MODEL_SELECTOR_MARKER);
    await harness.type(`${SCRIPTED_OAUTH_MODEL}\r`);
}

Deno.test("detectModelAvailability treats at least one available model as usable", () => {
    assertEquals(detectModelAvailability(registryValue([])), { available: false, error: null });
    assertEquals(
        detectModelAvailability(registryValue([{ id: "model", provider: "fixture" }])),
        { available: true, error: null },
    );
});

Deno.test("detectModelAvailability captures registry errors as no model", () => {
    const result = detectModelAvailability({
        getAvailable: () => {
            throw new Error("broken registry");
        },
    });
    assertEquals(result, { available: false, error: "broken registry" });
});

Deno.test("a malformed models.json in the fixture HOME degrades to no configured models without throwing", async () => {
    await withRuntimeCommandFixture("model-welcome-malformed-", async ({ homeDir, projectRoot }) => {
        await Deno.writeTextFile(join(homeDir, ".wld", "models.json"), "{ not valid json !!!");
        const availability = getConfiguredModelAvailability();
        assertEquals(availability.available, false);
        const selected = getSelectedDefaultModelAvailability(projectRoot);
        assertEquals(selected.available, false);
        assertEquals(selected.error, "No default model is selected.");
    }, { providerState: "none" });
});

Deno.test("a usable selected fixture model bypasses onboarding and activates the real root Session", async () => {
    await withRuntimeCommandFixture("model-welcome-bypass-", async () => {
        const harness = await createInteractiveCompositionHarness({});
        try {
            const composition = await harness.waitForComposition(30_000);
            const screen = harness.terminal.getScreenText();
            assert(!screen.includes(WELCOME_TITLE), "a usable selected model must bypass the welcome prompt");
            const snapshot = composition.runtime.getSessionSnapshot(composition.sessionId);
            assertEquals(snapshot?.activeAgent, "router");
            assertEquals(snapshot?.busy, false);
        } finally {
            await harness.dispose();
        }
    });
});

Deno.test("no providers opens the real welcome prompt and never the model selector", async () => {
    await withRuntimeCommandFixture("model-welcome-no-providers-", async () => {
        const harness = await createInteractiveCompositionHarness({});
        try {
            const screen = await harness.waitForScreen(WELCOME_TITLE);
            assert(screen.includes("Use a subscription login"));
            assert(!screen.includes(MODEL_SELECTOR_MARKER), "no-provider startup must not open the model selector");
            const provider = registerScriptedOAuthProvider();
            provider.setOutcome({ kind: "success" });
            await completeOnboardingWithScriptedProvider(harness);
            await harness.waitForComposition(30_000);
        } finally {
            await harness.dispose();
        }
    }, { providerState: "none" });
});

Deno.test("a configured provider without a selected model opens the real model selector", async () => {
    await withRuntimeCommandFixture("model-welcome-provider-no-model-", async () => {
        const harness = await createInteractiveCompositionHarness({});
        try {
            const screen = await harness.waitForScreen(MODEL_SELECTOR_MARKER);
            assert(!screen.includes(WELCOME_TITLE), "configured-provider startup must skip login onboarding");
            // Cancel the selector so the composition resolves and the test can end.
            await harness.pressKey("escape");
            await harness.waitForScreen("No model was selected");
            await harness.waitForComposition(20_000);
        } finally {
            await harness.dispose();
        }
    }, { providerState: "provider-no-model" });
});

Deno.test("cancelled model selection activates no root Session", async () => {
    await withRuntimeCommandFixture("model-welcome-selector-cancel-", async () => {
        const harness = await createInteractiveCompositionHarness({});
        try {
            await harness.waitForScreen(MODEL_SELECTOR_MARKER);
            await harness.pressKey("escape");
            const screen = await harness.waitForScreen("No model was selected");
            assert(screen.includes("Run /model to choose a default model"));
            const composition = await harness.waitForComposition(20_000);
            const snapshot = composition.runtime.getSessionSnapshot(composition.sessionId);
            assert(snapshot?.activeAgent !== "router", "cancelled model selection must not build the root Session");
            assertEquals(snapshot?.busy, false);
        } finally {
            await harness.dispose();
        }
    }, { providerState: "provider-no-model" });
});

Deno.test("subscription login through the scripted OAuth fixture runs the real /login then /model order and activates the root Session", async () => {
    await withRuntimeCommandFixture("model-welcome-subscription-", async ({ homeDir, projectRoot }) => {
        const harness = await createInteractiveCompositionHarness({});
        try {
            await harness.waitForScreen(WELCOME_TITLE);
            const provider = registerScriptedOAuthProvider();
            provider.setOutcome({ kind: "success" });
            await harness.type("\r"); // welcome prompt: "Use a subscription login"
            await harness.waitForScreen("Select provider to configure:");
            await harness.type(`${SCRIPTED_PROVIDER_FILTER}\r`);
            await harness.waitForScreen("Paste the redirect URL");
            await harness.type(`${REDIRECT_URL}\r`);

            // The real /login runs first: its success message must appear on the
            // combined screen before the /model model selector.
            await harness.waitForScreen(`Logged in to ${SCRIPTED_OAUTH_PROVIDER_NAME}.`);
            const combined = await harness.waitForScreen(MODEL_SELECTOR_MARKER);
            assert(
                combined.indexOf(`Logged in to ${SCRIPTED_OAUTH_PROVIDER_NAME}.`) <
                    combined.indexOf(MODEL_SELECTOR_MARKER),
                "login must complete before model selection opens",
            );
            await harness.type(`${SCRIPTED_OAUTH_MODEL}\r`);

            const composition = await harness.waitForComposition(30_000);
            const snapshot = composition.runtime.getSessionSnapshot(composition.sessionId);
            assertEquals(snapshot?.activeAgent, "router");
            assertEquals(snapshot?.activeModel.model, SCRIPTED_OAUTH_MODEL);
            assertEquals(snapshot?.busy, false);

            const authFile = JSON.parse(await Deno.readTextFile(join(homeDir, ".wld", "auth.json"))) as Record<
                string,
                { type?: string }
            >;
            assertEquals(authFile[SCRIPTED_OAUTH_PROVIDER_ID]?.type, "oauth");
            assertEquals(getSettingsManager(projectRoot).getDefaultModel(), SCRIPTED_OAUTH_MODEL);
            assertEquals(getSettingsManager(projectRoot).getDefaultProvider(), SCRIPTED_OAUTH_PROVIDER_ID);
        } finally {
            await harness.dispose();
        }
    }, { providerState: "none" });
});

Deno.test("login failure renders a user-visible error and activates no root Session", async () => {
    await withRuntimeCommandFixture("model-welcome-login-failure-", async () => {
        const harness = await createInteractiveCompositionHarness({});
        try {
            await harness.waitForScreen(WELCOME_TITLE);
            const provider = registerScriptedOAuthProvider();
            provider.setOutcome({ kind: "failure", error: "boom" });
            await harness.type("\r");
            await harness.waitForScreen("Select provider to configure:");
            await harness.type(`${SCRIPTED_PROVIDER_FILTER}\r`);
            const errorScreen = await harness.waitForScreen("Failed to login to Aardvark Fixture OAuth: boom");
            assertStringIncludes(errorScreen, "Failed to login to");
            assert(
                harness.runtime.getSessionSnapshot(harness.sessionId)?.activeAgent !== "router",
                "login failure must not activate the root Session",
            );
            // The welcome prompt re-appears instead of dropping to chat.
            await harness.waitForScreen(WELCOME_TITLE);

            provider.setOutcome({ kind: "success" });
            await completeOnboardingWithScriptedProvider(harness);
            await harness.waitForComposition(30_000);
        } finally {
            await harness.dispose();
        }
    }, { providerState: "none" });
});

Deno.test("cancelled login re-prompts instead of returning to chat", async () => {
    await withRuntimeCommandFixture("model-welcome-login-cancel-", async () => {
        const harness = await createInteractiveCompositionHarness({});
        try {
            await harness.waitForScreen(WELCOME_TITLE);
            const provider = registerScriptedOAuthProvider();
            provider.setOutcome({ kind: "cancel" });
            await harness.type("\r"); // "Use a subscription login"
            await harness.waitForScreen("Select provider to configure:");
            await harness.pressKey("escape"); // back to authentication-method choice
            await harness.waitForScreen("Select authentication method:");
            await harness.pressKey("escape"); // cancel login entirely
            const rePrompted = await harness.waitForScreen(WELCOME_TITLE);
            assert(rePrompted.includes("Use a subscription login"), "login cancellation must re-prompt the welcome");
            assert(
                harness.runtime.getSessionSnapshot(harness.sessionId)?.activeAgent !== "router",
                "cancelled login must not activate the root Session",
            );

            provider.setOutcome({ kind: "success" });
            await completeOnboardingWithScriptedProvider(harness);
            await harness.waitForComposition(30_000);
        } finally {
            await harness.dispose();
        }
    }, { providerState: "none" });
});

Deno.test("failed root activation returns focus to the editor with recovery guidance", async () => {
    await withRuntimeCommandFixture("model-welcome-fail-root-", async () => {
        const harness = await createInteractiveCompositionHarness({ initialAgentName: "no-such-agent" });
        try {
            await harness.waitForScreen(WELCOME_TITLE);
            const provider = registerScriptedOAuthProvider();
            provider.setOutcome({ kind: "success" });
            await completeOnboardingWithScriptedProvider(harness);
            const screen = await harness.waitForScreen("Failed to initialize root agent after model setup");
            assertStringIncludes(screen, "Run /model to choose another model");
            const composition = await harness.waitForComposition(30_000);
            const snapshot = composition.runtime.getSessionSnapshot(composition.sessionId);
            assert(snapshot?.activeAgent !== "router", "failed root activation must not build the root Session");
            assertEquals(snapshot?.busy, false);
        } finally {
            await harness.dispose();
        }
    }, { providerState: "none" });
});
