import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { getModelRegistry } from "../../shared/models/model-registry.ts";
import { SessionRuntime } from "../../shared/session/session-runtime.js";
import { getLoginProviderOptions, runLoginCommand, runLogoutCommand, runStatusCommand } from "./index.ts";

type AuthUiPort = Pick<
    import("../../ui/tui/types.js").UiAPI,
    "abortActivePrompt" | "appendSystemMessage" | "promptSelect" | "promptText" | "showModelSelector"
>;
type TextPromptOptions = NonNullable<Parameters<AuthUiPort["promptText"]>[1]>;

interface AuthFile {
    [providerId: string]: { type: "api_key"; key: string };
}

interface AuthUiHarness {
    messages: string[];
    selections: Array<string | null>;
    textInputs: Array<string | null>;
    textPrompts: Array<{ title: string; options: TextPromptOptions | undefined }>;
    modelSelectorCalls: number;
    uiAPI: AuthUiPort;
}

const FIXTURE_PROVIDER = "runtime-command-fixture";

function createUiHarness(): AuthUiHarness {
    const harness: AuthUiHarness = {
        messages: [],
        selections: [],
        textInputs: [],
        textPrompts: [],
        modelSelectorCalls: 0,
        uiAPI: {
            appendSystemMessage: (message) => harness.messages.push(message),
            promptSelect: () => Promise.resolve(harness.selections.shift() ?? null),
            promptText: (title, options) => {
                harness.textPrompts.push({ title, options });
                return Promise.resolve(harness.textInputs.shift() ?? null);
            },
            showModelSelector: () => {
                harness.modelSelectorCalls += 1;
            },
            abortActivePrompt: () => {},
        },
    };
    return harness;
}

async function readFixtureAuthFile(homeDir: string): Promise<AuthFile> {
    return JSON.parse(await Deno.readTextFile(join(homeDir, ".wld", "auth.json")));
}

Deno.test("auth commands exercise the real model registry in one isolated fixture home", async (test) => {
    await withRuntimeCommandFixture("auth-command-", async ({ homeDir, projectRoot }) => {
        const registry = getModelRegistry();
        await registry.getRuntime();

        await test.step("provider choices come from the hydrated registry without starting OAuth", () => {
            const apiKeyProviders = getLoginProviderOptions(registry, "api_key");
            const oauthProviders = getLoginProviderOptions(registry, "oauth");

            assertEquals(apiKeyProviders.find((provider) => provider.id === FIXTURE_PROVIDER), {
                id: FIXTURE_PROVIDER,
                name: "Runtime Command Fixture Provider",
                authType: "api_key",
            });
            assert(oauthProviders.some((provider) => provider.id === "openai-codex"));
            assert(oauthProviders.every((provider) => provider.authType === "oauth"));
        });

        await test.step("API-key login persists through the real credential store and status machinery", async () => {
            const ui = createUiHarness();
            ui.textInputs.push(" fixture-secret ");

            await runLoginCommand(["api-key", FIXTURE_PROVIDER], {
                uiAPI: ui.uiAPI,
                skipPostLoginSetup: true,
            });

            assertEquals(await readFixtureAuthFile(homeDir), {
                [FIXTURE_PROVIDER]: { type: "api_key", key: "fixture-secret" },
            });
            assertEquals(ui.textPrompts, [{
                title: "Enter API key for Runtime Command Fixture Provider:",
                options: { allowEmpty: false, persistResult: false },
            }]);
            assertEquals(ui.messages.at(-1), "Logged in to Runtime Command Fixture Provider.");

            const statusUi = createUiHarness();
            await runStatusCommand([], { uiAPI: statusUi.uiAPI });
            assertStringIncludes(statusUi.messages[0], "Available models:");
            assertStringIncludes(
                statusUi.messages[0],
                "Runtime Command Fixture Provider (runtime-command-fixture): API key stored",
            );
        });

        await test.step("misleading Claude CLI credentials stay out of API auth status and logout choices", async () => {
            await Deno.writeTextFile(
                join(homeDir, ".wld", "auth.json"),
                JSON.stringify({
                    [FIXTURE_PROVIDER]: { type: "api_key", key: "fixture-secret" },
                    "claude-cli": { type: "api_key", key: "fake" },
                }),
            );

            const statusUi = createUiHarness();
            await runStatusCommand([], { uiAPI: statusUi.uiAPI });
            assert(!statusUi.messages[0].includes("Claude CLI"));
            assert(!statusUi.messages[0].includes("claude-cli"));

            const logoutUi = createUiHarness();
            logoutUi.selections.push("claude-cli");
            await runLogoutCommand([], { uiAPI: logoutUi.uiAPI });
            assertEquals(logoutUi.messages, []);
            assertEquals(await readFixtureAuthFile(homeDir), {
                [FIXTURE_PROVIDER]: { type: "api_key", key: "fixture-secret" },
                "claude-cli": { type: "api_key", key: "fake" },
            });

            await Deno.writeTextFile(
                join(homeDir, ".wld", "auth.json"),
                JSON.stringify({ [FIXTURE_PROVIDER]: { type: "api_key", key: "fixture-secret" } }),
            );
        });

        await test.step("post-login setup switches a real Runtime session back to Router", async () => {
            const runtime = new SessionRuntime();
            const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "engineer" });
            const ui = createUiHarness();
            ui.textInputs.push("replacement-secret");
            try {
                await runLoginCommand([FIXTURE_PROVIDER], {
                    uiAPI: ui.uiAPI,
                    sessionId,
                    sessionRuntime: runtime,
                });

                assertEquals(ui.modelSelectorCalls, 1);
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "router");
                assertEquals((await readFixtureAuthFile(homeDir))[FIXTURE_PROVIDER], {
                    type: "api_key",
                    key: "replacement-secret",
                });
            } finally {
                runtime.closeSession(sessionId);
            }
        });

        await test.step("logout removes the fixture credential through the real registry", async () => {
            const ui = createUiHarness();
            await runLogoutCommand([FIXTURE_PROVIDER], { uiAPI: ui.uiAPI });

            assertEquals(await readFixtureAuthFile(homeDir), {});
            assertEquals(ui.messages, ["Logged out of Runtime Command Fixture Provider."]);

            const statusUi = createUiHarness();
            await runStatusCommand([], { uiAPI: statusUi.uiAPI });
            assert(
                !statusUi.messages[0].includes(
                    "Runtime Command Fixture Provider (runtime-command-fixture): API key stored",
                ),
            );
        });

        await test.step("cancelled API-key input leaves the real credential store unchanged", async () => {
            const ui = createUiHarness();
            await runLoginCommand(["api-key", FIXTURE_PROVIDER], {
                uiAPI: ui.uiAPI,
                skipPostLoginSetup: true,
            });

            assertEquals(await readFixtureAuthFile(homeDir), {});
            assertEquals(ui.messages, []);
        });
    });
});
