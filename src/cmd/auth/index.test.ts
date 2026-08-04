import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { createInteractiveCompositionHarness } from "../../ui/tui/testing/interactive-composition-fixture.ts";

const FIXTURE_PROVIDER = "runtime-command-fixture";
const FIXTURE_PROVIDER_DISPLAY = "Runtime Command Fixture Provider";
const API_KEY_PROMPT = "Enter API key for Runtime Command Fixture Provider:";
const MODEL_SELECTOR_MARKER = "Only showing models from configured providers";

interface AuthFile {
    [providerId: string]: { type: "api_key"; key: string };
}

async function readFixtureAuthFile(homeDir: string): Promise<AuthFile> {
    return JSON.parse(await Deno.readTextFile(join(homeDir, ".wld", "auth.json"))) as AuthFile;
}

/**
 * All auth flows are typed as slash commands through the composed real TUI:
 * real slash dispatch, real prompt components, real registry and credential
 * store. No test here builds a hand-made UI bag or calls the command functions
 * directly.
 */
Deno.test("auth commands exercise the real model registry through composed slash dispatch", async (test) => {
    await withRuntimeCommandFixture("auth-command-", async ({ homeDir }) => {
        const harness = await createInteractiveCompositionHarness({
            initialAgentName: "guide",
            terminalRows: 40,
        });
        try {
            const composition = await harness.waitForComposition(30_000);
            assertEquals(composition.runtime.getSessionSnapshot(composition.sessionId)?.activeAgent, "guide");

            await test.step("provider choices come from the hydrated registry without starting OAuth", async () => {
                await harness.type("/login subscription\r");
                const providerScreen = await harness.waitForScreen("Select provider to configure:");
                assert(providerScreen.includes("OpenAI Codex"), "OAuth provider list must come from the registry");
                assertStringIncludes(providerScreen, "subscription");
                await harness.pressKey("escape"); // back to authentication-method choice
                await harness.waitForScreen("Select authentication method:");
                await harness.pressKey("escape"); // cancel login entirely; no OAuth started
                await harness.waitForIdle(3_000);
            });

            await test.step("API-key login persists through the real credential store and status machinery", async () => {
                await harness.type(`/login api-key ${FIXTURE_PROVIDER}\r`);
                await harness.waitForScreen(API_KEY_PROMPT);
                await harness.type(" fixture-secret \r");
                await harness.waitForScreen(`Logged in to ${FIXTURE_PROVIDER_DISPLAY}.`);
                assertEquals(await readFixtureAuthFile(homeDir), {
                    [FIXTURE_PROVIDER]: { type: "api_key", key: "fixture-secret" },
                });
                // Post-login setup shows the model selector; cancel it to settle.
                await harness.waitForScreen(MODEL_SELECTOR_MARKER);
                await harness.pressKey("escape");
                await harness.waitForIdle(5_000);

                await harness.type("/status\r");
                const statusScreen = await harness.waitForScreen("Available models:");
                assertStringIncludes(statusScreen, "Available models:");
                assertStringIncludes(
                    statusScreen,
                    `${FIXTURE_PROVIDER_DISPLAY} (${FIXTURE_PROVIDER}): API key stored`,
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
                await harness.type("/status\r");
                const statusScreen = await harness.waitForScreen("Available models:");
                assert(!statusScreen.includes("Claude CLI"), "Claude CLI must not appear in API auth status");
                assert(!statusScreen.includes("claude-cli"), "Claude CLI must not appear in API auth status");

                await harness.type(`/logout claude-cli\r`);
                const logoutScreen = await harness.waitForScreen("Select provider to logout:");
                assert(!logoutScreen.includes("claude-cli"), "Claude CLI must not appear in logout choices");
                await harness.pressKey("escape");
                await harness.waitForIdle(3_000);
                assertEquals(await readFixtureAuthFile(homeDir), {
                    [FIXTURE_PROVIDER]: { type: "api_key", key: "fixture-secret" },
                    "claude-cli": { type: "api_key", key: "fake" },
                });
                // Restore the fixture-only credential state for the remaining steps.
                await Deno.writeTextFile(
                    join(homeDir, ".wld", "auth.json"),
                    JSON.stringify({ [FIXTURE_PROVIDER]: { type: "api_key", key: "fixture-secret" } }),
                );
            });

            await test.step("post-login setup shows the model selector and switches a real Runtime Session back to Router", async () => {
                await harness.type(`/login api-key ${FIXTURE_PROVIDER}\r`);
                await harness.waitForScreen(API_KEY_PROMPT);
                await harness.type("replacement-secret\r");
                await harness.waitForScreen(`Logged in to ${FIXTURE_PROVIDER_DISPLAY}.`);
                await harness.waitForScreen(MODEL_SELECTOR_MARKER);
                await harness.pressKey("escape");
                const runtime = composition.runtime;
                const sessionId = composition.sessionId;
                for (let attempt = 0; attempt < 200; attempt += 1) {
                    if (runtime.getSessionSnapshot(sessionId)?.activeAgent === "router") break;
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "router");
                assertEquals((await readFixtureAuthFile(homeDir))[FIXTURE_PROVIDER], {
                    type: "api_key",
                    key: "replacement-secret",
                });
                await harness.waitForIdle(5_000);
            });

            await test.step("logout removes the fixture credential through the real registry", async () => {
                await harness.type(`/logout ${FIXTURE_PROVIDER}\r`);
                await harness.waitForScreen(`Logged out of ${FIXTURE_PROVIDER_DISPLAY}.`);
                assertEquals(await readFixtureAuthFile(homeDir), {});

                await harness.type("/status\r");
                const statusScreen = await harness.waitForScreen("key in models.json");
                assertStringIncludes(
                    statusScreen,
                    `${FIXTURE_PROVIDER_DISPLAY} (${FIXTURE_PROVIDER}): key in models.json`,
                    "status must reflect the removed stored credential",
                );
            });

            await test.step("cancelled API-key input leaves the real credential store unchanged", async () => {
                await harness.type(`/login api-key ${FIXTURE_PROVIDER}\r`);
                await harness.waitForScreen(API_KEY_PROMPT);
                await harness.pressKey("escape");
                await harness.waitForIdle(3_000);
                assertEquals(await readFixtureAuthFile(homeDir), {});
            });
        } finally {
            await harness.dispose();
        }
    });
});
