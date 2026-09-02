import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { TuiMainScreen } from "@earendil-works/pi-tui";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { getModelRegistry } from "../../shared/models/model-registry.ts";
import { getSettingsManager } from "../../shared/settings.js";
import { initTUIWithPair, stopTUI } from "./tui.ts";
import { runTerminalAuthSetup } from "./terminal-auth-setup.ts";
import { VirtualTerminal } from "./testing/virtual-terminal.js";

async function pathExists(path: string): Promise<boolean> {
    try {
        await Deno.stat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

async function waitForScreen(terminal: VirtualTerminal, text: string, timeoutMs = 10_000): Promise<string> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const screen = terminal.getScreenText();
        if (screen.includes(text)) return screen;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const screen = terminal.getScreenText();
    throw new Error(`Timed out waiting for ${text}. Screen:\n${screen}`);
}

function installVirtualTui(): VirtualTerminal {
    stopTUI();
    const terminal = new VirtualTerminal({ columns: 120, rows: 40 });
    initTUIWithPair({ terminal, tui: new TuiMainScreen(terminal) });
    return terminal;
}

Deno.test("terminal auth setup saves credentials and a default model without creating a Session", async () => {
    await withRuntimeCommandFixture("terminal-auth-api-key-", async ({ homeDir }) => {
        const registry = getModelRegistry();
        await registry.logoutProvider("runtime-command-fixture");
        const settings = getSettingsManager(Deno.cwd());
        await settings.setDefaultModel("");
        await settings.setDefaultProvider("");
        const terminal = installVirtualTui();
        try {
            const setup = runTerminalAuthSetup(["api-key", "runtime-command-fixture"]);
            await waitForScreen(terminal, "Enter API key for Runtime Command Fixture Provider:");
            terminal.typeText("terminal-auth-secret");
            terminal.pressEnter();
            await waitForScreen(terminal, "Only showing models from configured providers");
            terminal.pressEnter();
            const result = await setup;

            assertEquals(result.status, "ready");
            assertEquals(await registry.getStoredCredentialType("runtime-command-fixture"), "api_key");
            assertEquals(settings.getDefaultProvider(), "runtime-command-fixture");
            assertEquals(settings.getDefaultModel(), "fixture-model");
            assertEquals(await pathExists(join(homeDir, ".wld", "sessions")), false);
            assertEquals(await pathExists(join(homeDir, ".wld", "projects")), false);
        } finally {
            stopTUI();
        }
    }, { providerState: "provider-no-model" });
});

Deno.test("terminal auth setup exits nonzero state when model selection is canceled", async () => {
    await withRuntimeCommandFixture("terminal-auth-cancel-model-", async () => {
        const registry = getModelRegistry();
        await registry.logoutProvider("runtime-command-fixture");
        const settings = getSettingsManager(Deno.cwd());
        await settings.setDefaultModel("");
        await settings.setDefaultProvider("");
        const terminal = installVirtualTui();
        try {
            const setup = runTerminalAuthSetup(["api-key", "runtime-command-fixture"]);
            await waitForScreen(terminal, "Enter API key for Runtime Command Fixture Provider:");
            terminal.typeText("terminal-auth-secret");
            terminal.pressEnter();
            await waitForScreen(terminal, "Only showing models from configured providers");
            terminal.pressEscape();
            const result = await setup;

            assertEquals(result.status, "failed");
            assertStringIncludes(result.message, "No default model");
            assertEquals(await registry.getStoredCredentialType("runtime-command-fixture"), "api_key");
            assertEquals(settings.getDefaultModel(), "");
        } finally {
            stopTUI();
        }
    }, { providerState: "provider-no-model" });
});

Deno.test("terminal auth setup does not import the normal chat Session composition", async () => {
    const source = await Deno.readTextFile("src/ui/tui/terminal-auth-setup.ts");
    assert(!source.includes("chat-session"));
    assert(!source.includes("createInteractiveSession"));
    assert(!source.includes("SessionRuntime"));
});
