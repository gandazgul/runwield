import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENTS } from "../../constants.js";
import { runModelsCommand } from "../../cmd/models/index.ts";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { assertModelExecutionBackendSupported } from "../models/model-execution.ts";
import { getModelRegistry } from "../models/model-registry.ts";
import { getSettingsManager } from "../settings.js";
import {
    inspectAgyCliMcpSetup,
    installAgyCliMcpSetup,
    resolveInstalledWldExecutable,
} from "./backends/agy-cli/mcp-setup.ts";
import { SessionHost } from "./session-host.js";
import { createSessionRuntime, SessionRuntime } from "./session-runtime.js";

const FIXTURE_MODEL = "runtime-command-fixture/fixture-model";
const AGY_FLASH = "agy-cli/gemini-3.8-flash";

async function installAgyModelSelectionFixture(homeDir: string): Promise<string> {
    const binDir = join(homeDir, "agy-bin");
    await Deno.mkdir(binDir, { recursive: true });
    // MCP setup inspects this binary header; the model-selection fixture never executes wld.
    await Deno.writeFile(join(binDir, "wld"), new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00]));
    await Deno.chmod(join(binDir, "wld"), 0o755);
    const agySource = String.raw`
function readArg(args: string[], flag: string): string {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] || "" : "";
}
function joinPath(...parts: string[]): string {
    return parts.map((part, index) => {
        const trimmed = index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, "");
        return trimmed;
    }).filter(Boolean).join("/");
}
const prompt = readArg(Deno.args, "-p");
const outputFormat = readArg(Deno.args, "--output-format");
if (prompt === "/agents" && outputFormat === "json") {
    const agentsRoot = joinPath(Deno.env.get("HOME") || "", ".gemini", "config", "agents");
    const agents: Array<{ name: string }> = [];
    try {
        for await (const entry of Deno.readDir(agentsRoot)) {
            if (!entry.isDirectory) continue;
            try {
                const definition = await Deno.readTextFile(joinPath(agentsRoot, entry.name, "agent.md"));
                if (definition.includes("\nname: " + entry.name + "\n") || definition.startsWith("---\nname: " + entry.name + "\n")) {
                    agents.push({ name: entry.name });
                }
            } catch {
                // Ignore malformed agent directories.
            }
        }
    } catch {
        // No agents directory yet.
    }
    console.log(JSON.stringify({ agents }));
    Deno.exit(0);
}
Deno.exit(0);
`;
    const agyPath = join(binDir, "agy-fixture.ts");
    await Deno.writeTextFile(agyPath, agySource);
    await Deno.writeTextFile(join(binDir, "agy"), `#!/bin/sh\nexec deno run -A ${JSON.stringify(agyPath)} "$@"\n`);
    await Deno.chmod(join(binDir, "agy"), 0o755);
    return binDir;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await Deno.stat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

Deno.test("approved Agy CLI models are registered and accepted by typed execution backend dispatch", () => {
    for (const modelId of ["gemini-3.8-flash", "gemini-3.1-pro"]) {
        const model = getModelRegistry().find("agy-cli", modelId);
        assert(model);
        assertEquals(model.id, modelId);
        assertModelExecutionBackendSupported(model);
    }
    assertEquals(getModelRegistry().find("agy-cli", "fixture-model"), undefined);
});

Deno.test("unsupported Agy CLI selection is rejected before approval, agy launch, or global files", async () => {
    await withRuntimeCommandFixture("runwield-agy-cli-unsupported-", async ({ homeDir, projectRoot }) => {
        const messages: Array<{ text: string; isError: boolean }> = [];
        const runtime = createSessionRuntime();
        const agyLaunchLog = join(homeDir, "agy-launched.log");
        const previousPath = Deno.env.get("PATH") || "";
        try {
            const binDir = await installAgyModelSelectionFixture(homeDir);
            await Deno.writeTextFile(
                join(binDir, "agy"),
                `#!/bin/sh\necho launched >> ${JSON.stringify(agyLaunchLog)}\nexit 2\n`,
            );
            await Deno.chmod(join(binDir, "agy"), 0o755);
            Deno.env.set("PATH", `${binDir}:${previousPath}`);
            const { sessionId } = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });

            await runModelsCommand(["agy-cli/fixture-model"], {
                uiAPI: {
                    appendSystemMessage: (message, isError = false) => messages.push({ text: message, isError }),
                    promptSelect: () => Promise.resolve(null),
                },
                sessionId,
                sessionRuntime: runtime,
            });

            assertEquals(messages.length, 1);
            assertEquals(messages[0].isError, true);
            assertStringIncludes(messages[0].text, "Unsupported Antigravity CLI model");
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, { model: "", provider: "" });
            assertEquals(await pathExists(agyLaunchLog), false);
            assertEquals(await pathExists(join(homeDir, ".gemini")), false);
        } finally {
            Deno.env.set("PATH", previousPath);
            runtime.closeAllSessions();
        }
    }, { providerState: "none" });
});

Deno.test("declined Agy MCP setup keeps the approved selected model without launching agy", async () => {
    await withRuntimeCommandFixture("runwield-agy-cli-setup-decline-", async ({ homeDir, projectRoot }) => {
        let runtime: SessionRuntime | null = null;
        const agyLaunchLog = join(homeDir, "agy-launched.log");
        const previousPath = Deno.env.get("PATH") || "";
        try {
            const binDir = await installAgyModelSelectionFixture(homeDir);
            await Deno.writeTextFile(
                join(binDir, "agy"),
                `#!/bin/sh\necho launched >> ${JSON.stringify(agyLaunchLog)}\nexit 2\n`,
            );
            await Deno.chmod(join(binDir, "agy"), 0o755);
            Deno.env.set("PATH", `${binDir}:${previousPath}`);
            assertEquals(await resolveInstalledWldExecutable(), await Deno.realPath(join(binDir, "wld")));

            const sessionHost = new SessionHost();
            const hostedSession = sessionHost.createSession({ cwd: projectRoot });
            hostedSession.setActiveModelState("fixture-model", "runtime-command-fixture", true);
            hostedSession.setRootAgentName(AGENTS.GUIDE);
            runtime = new SessionRuntime({
                sessionHost,
                sessionStore: null,
                ownerProcessKind: "test",
                ownerInstanceId: "agy-setup-decline-test",
            });
            let interactionCount = 0;
            hostedSession.setInteractionAdapter({
                requestInteraction: () => {
                    interactionCount += 1;
                    return { outcome: "accepted", value: "decline" };
                },
                supportsInteraction: () => true,
            });

            const activeRuntime = runtime;
            await assertRejects(
                () => activeRuntime.reconfigureSessionModel(hostedSession.id, "gemini-3.8-flash", "agy-cli"),
                Error,
                "not approved",
            );
            assertEquals(interactionCount, 1);
            assertEquals(runtime.getSessionSnapshot(hostedSession.id)?.activeModel, {
                model: "gemini-3.8-flash",
                provider: "agy-cli",
            });
            assertEquals(await pathExists(agyLaunchLog), false);
        } finally {
            Deno.env.set("PATH", previousPath);
            runtime?.closeAllSessions();
        }
    });
});

Deno.test("fresh Agy CLI model selection offers first-time MCP setup before the first turn", async () => {
    await withRuntimeCommandFixture("runwield-agy-cli-first-select-", async ({ homeDir, projectRoot }) => {
        const runtime = createSessionRuntime();
        const messages: string[] = [];
        const previousPath = Deno.env.get("PATH") || "";
        try {
            const binDir = await installAgyModelSelectionFixture(homeDir);
            Deno.env.set("PATH", `${binDir}:${previousPath}`);
            const { sessionId } = await runtime.createInteractiveSession({
                cwd: projectRoot,
                mode: "new",
                deferManagedActivationUntilAgentReady: true,
            });
            let interactionCount = 0;
            runtime.setInteractionAdapter(sessionId, {
                requestInteraction: () => {
                    interactionCount += 1;
                    return { outcome: "accepted", value: "approve" };
                },
                supportsInteraction: () => true,
            });

            await runModelsCommand([AGY_FLASH], {
                uiAPI: {
                    appendSystemMessage: (message) => messages.push(message),
                    promptSelect: () => Promise.resolve(null),
                },
                sessionId,
                sessionRuntime: runtime,
            });

            assertEquals(interactionCount, 1);
            assertEquals((await inspectAgyCliMcpSetup()).ok, true);
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, {
                model: "gemini-3.8-flash",
                provider: "agy-cli",
            });
            assertStringIncludes(messages.at(-1) || "", `Switched model to ${AGY_FLASH}`);
        } finally {
            Deno.env.set("PATH", previousPath);
            runtime.closeAllSessions();
        }
    });
});

Deno.test("explicit approved Agy CLI selection persists and updates the active runtime Session model", async () => {
    await withRuntimeCommandFixture("runwield-agy-cli-selection-", async ({ homeDir, projectRoot }) => {
        const runtime = createSessionRuntime();
        const messages: string[] = [];
        const previousPath = Deno.env.get("PATH") || "";
        try {
            const binDir = await installAgyModelSelectionFixture(homeDir);
            Deno.env.set("PATH", `${binDir}:${previousPath}`);
            assertEquals(await resolveInstalledWldExecutable(), await Deno.realPath(join(binDir, "wld")));
            await installAgyCliMcpSetup();
            const { sessionId } = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            await runModelsCommand([FIXTURE_MODEL], {
                uiAPI: {
                    appendSystemMessage: (message) => messages.push(message),
                    promptSelect: () => Promise.resolve(null),
                },
                sessionId,
                sessionRuntime: runtime,
            });
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, {
                model: "fixture-model",
                provider: "runtime-command-fixture",
            });
            const firstTurn = await runtime.promptUserTurn(sessionId, { initialRequest: "Prime the fixture model" });
            assertEquals(firstTurn.ok, true);
            assertEquals((await runtime.switchAgent(sessionId, { agentName: AGENTS.GUIDE })).ok, true);
            messages.length = 0;

            await runModelsCommand([AGY_FLASH], {
                uiAPI: {
                    appendSystemMessage: (message) => messages.push(message),
                    promptSelect: () => Promise.resolve(null),
                },
                sessionId,
                sessionRuntime: runtime,
            });

            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, {
                model: "gemini-3.8-flash",
                provider: "agy-cli",
            });
            assertEquals(getSettingsManager(projectRoot).getDefaultProvider(), "agy-cli");
            assertEquals(getSettingsManager(projectRoot).getDefaultModel(), "gemini-3.8-flash");
            assertStringIncludes(messages.at(-1) || "", `Switched model to ${AGY_FLASH}`);
        } finally {
            Deno.env.set("PATH", previousPath);
            runtime.closeAllSessions();
        }
    });
});
