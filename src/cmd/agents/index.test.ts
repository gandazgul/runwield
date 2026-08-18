import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Container, Editor, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
import { getEditorTheme } from "../../ui/theme/theme.js";
import { createUiApi } from "../../ui/tui/api.js";
import { SpinnerBlock } from "../../ui/tui/blocks.js";
import { VirtualTerminal } from "../../ui/tui/testing/virtual-terminal.js";
import { runAgentsCommand } from "./index.ts";
import type { InteractiveSessionPort } from "../../ui/tui/interactive-session-port.ts";

const decoder = new TextDecoder();
const FIXTURE_AGENT = "fixture-agent";
/** A real selectable Agent, used to close a chooser that must not list the hidden ones. */
const FIXTURE_AGENT_FALLBACK = "guide";
const UNEXPECTED_SESSION_PORT: InteractiveSessionPort = {
    startInteractiveSession: () => Promise.reject(new Error("Unexpected interactive session in agent command test")),
};

class CompatibleVirtualTerminal extends VirtualTerminal {
    override drainInput(): Promise<void> {
        return Promise.resolve();
    }

    override moveBy(lines: number, columns?: number): void {
        super.moveBy(lines, columns ?? 0);
    }

    override setProgress(active: boolean | number | null): void {
        super.setProgress(typeof active === "boolean" ? (active ? 1 : null) : active);
    }
}

interface AgentTuiHarness {
    editor: Editor;
    terminal: CompatibleVirtualTerminal;
    tui: TUI;
    uiAPI: import("../../ui/tui/types.js").UiAPI;
}

async function writeFixtureAgent(projectRoot: string): Promise<void> {
    const agentDir = join(projectRoot, ".wld", "agents");
    await Deno.mkdir(agentDir, { recursive: true });
    await Deno.writeTextFile(
        join(agentDir, `${FIXTURE_AGENT}.md`),
        [
            "---",
            "name: Fixture Agent",
            "description: Exercises fixture agent discovery",
            "tools: []",
            "---",
            "You are the fixture Agent.",
            "",
        ].join("\n"),
    );
}

function makeTuiHarness(): AgentTuiHarness {
    const terminal = new CompatibleVirtualTerminal({ columns: 110, rows: 35 });
    const tui = new TuiMainScreen(terminal);
    const root = new Container();
    const messages = new Container();
    const interactions = new Container();
    const editor = new Editor(tui, getEditorTheme());
    root.addChild(messages);
    root.addChild(interactions);
    root.addChild(editor);
    tui.addChild(root);
    const uiAPI = createUiApi(tui, messages, new SpinnerBlock(), undefined, undefined, interactions);
    tui.start();
    tui.setFocus(editor);
    return { editor, terminal, tui, uiAPI };
}

async function captureLogs(run: () => void | Promise<void>): Promise<string[]> {
    const logs: string[] = [];
    const original = console.log;
    console.log = (message = "") => logs.push(String(message));
    try {
        await run();
    } finally {
        console.log = original;
    }
    return logs;
}

async function runUnknownAgentChild(): Promise<Deno.CommandOutput> {
    const fixtureRoot = await Deno.makeTempDir({ prefix: "runwield-agent-unknown-" });
    const homeDir = join(fixtureRoot, "home");
    const projectRoot = join(fixtureRoot, "project");
    await Promise.all([
        Deno.mkdir(homeDir, { recursive: true }),
        Deno.mkdir(projectRoot, { recursive: true }),
    ]);
    const moduleUrl = import.meta.resolve("./index.ts");
    const configPath = fromFileUrl(new URL("../../../deno.json", import.meta.url));
    const source = `import { runAgentsCommand } from ${JSON.stringify(moduleUrl)};\n` +
        `await runAgentsCommand(["not-a-real-agent"], { sessionPort: { startInteractiveSession: () => Promise.reject(new Error("unexpected session")) } });\n`;
    try {
        return await new Deno.Command(Deno.execPath(), {
            args: ["eval", "--config", configPath, source],
            cwd: projectRoot,
            env: {
                HOME: homeDir,
                WLD_TEST_SANDBOX_HOME: homeDir,
            },
            stdout: "piped",
            stderr: "piped",
        }).output();
    } finally {
        await Deno.remove(fixtureRoot, { recursive: true }).catch(() => {});
    }
}

Deno.test("agent help uses the real command registry", async () => {
    await withRuntimeCommandFixture("agent-help-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        const logs = await captureLogs(() => runAgentsCommand(["help"], { sessionPort: UNEXPECTED_SESSION_PORT }));
        assertStringIncludes(logs.join("\n"), "Usage (agent):");
        assertStringIncludes(logs.join("\n"), "Talk directly to an agent");
    });
});

Deno.test("agent CLI lists definitions discovered from the fixture project", async () => {
    await withRuntimeCommandFixture("agent-list-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        await writeFixtureAgent(projectRoot);
        const logs = await captureLogs(() => runAgentsCommand([], { sessionPort: UNEXPECTED_SESSION_PORT }));
        assertStringIncludes(logs.join("\n"), "Available agents:");
        assertStringIncludes(logs.join("\n"), "fixture-agent");
        assertStringIncludes(logs.join("\n"), "Exercises fixture agent discovery");
    });
});

Deno.test("agent CLI starts the external session for a discovered fixture definition", async () => {
    await withRuntimeCommandFixture("agent-start-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        await writeFixtureAgent(projectRoot);
        let receivedRequest: string | null = null;
        let initialAgentName: string | undefined;

        await runAgentsCommand([FIXTURE_AGENT, "inspect", "the", "fixture"], {
            sessionPort: {
                startInteractiveSession: (request, options) => {
                    receivedRequest = request;
                    initialAgentName = options.initialAgentName;
                    return Promise.resolve();
                },
            },
        });

        assertEquals(receivedRequest, "inspect the fixture");
        assertEquals(initialAgentName, FIXTURE_AGENT);
    });
});

Deno.test("unknown agent exits an isolated CLI process with status one", async () => {
    const result = await runUnknownAgentChild();
    assertEquals(result.code, 1);
    assertStringIncludes(decoder.decode(result.stderr), 'Unknown agent: "not-a-real-agent"');
    assertStringIncludes(decoder.decode(result.stdout), "Available agents:");
});

Deno.test("agent chooser switches the real Runtime session to a fixture definition", async () => {
    await withRuntimeCommandFixture("agent-tui-switch-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        await writeFixtureAgent(projectRoot);
        const runtime = createSessionRuntime();
        const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "router" });
        await runtime.renameSession(sessionId, "Fixture session");
        const harness = makeTuiHarness();
        try {
            const command = runAgentsCommand([], {
                uiAPI: harness.uiAPI,
                editor: harness.editor,
                tui: harness.tui,
                sessionId,
                sessionRuntime: runtime,
                sessionPort: UNEXPECTED_SESSION_PORT,
            });

            for (let attempt = 0; attempt < 100; attempt++) {
                await harness.terminal.flush();
                if (harness.terminal.getScreenText().includes("Switch agent:")) break;
                await new Promise((resolve) => setTimeout(resolve, 1));
            }
            assertStringIncludes(harness.terminal.getScreenText(), "Switch agent:");
            harness.terminal.typeText(FIXTURE_AGENT);
            harness.terminal.pressEnter();
            await command;

            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, FIXTURE_AGENT);
            assertEquals(harness.editor.focused, true);
        } finally {
            harness.tui.stop();
            runtime.closeSession(sessionId);
        }
    });
});

Deno.test("the agent CLI listing hides workflow-only Plan executors", async () => {
    await withRuntimeCommandFixture("agent-list-workflow-only-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        const listing = (await captureLogs(() => runAgentsCommand([], { sessionPort: UNEXPECTED_SESSION_PORT })))
            .join("\n");

        assertStringIncludes(listing, "engineer");
        assertEquals(listing.includes("plan-engineer"), false);
        assertEquals(listing.includes("frontend-engineer"), false);
    });
});

Deno.test("naming a workflow-only Agent explains what activates it instead of switching", async () => {
    await withRuntimeCommandFixture("agent-workflow-only-cli-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        for (const agentName of ["plan-engineer", "frontend-engineer"]) {
            const logs = (await captureLogs(() =>
                runAgentsCommand([agentName, "do", "the", "work"], { sessionPort: UNEXPECTED_SESSION_PORT })
            )).join("\n");

            // An unexpected session port would have thrown, so no switch happened.
            assertStringIncludes(logs, "activated by RunWield when an approved Plan executes");
            assertEquals(logs.includes("Unknown agent"), false);
        }
    });
});

Deno.test("naming a workflow-only Agent in the TUI leaves the active Agent unchanged", async () => {
    await withRuntimeCommandFixture("agent-workflow-only-tui-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        const runtime = createSessionRuntime();
        const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "router" });
        const harness = makeTuiHarness();
        try {
            const systemMessages: string[] = [];
            const uiAPI = {
                ...harness.uiAPI,
                appendSystemMessage: (message: string) => systemMessages.push(message),
            };

            await runAgentsCommand(["plan-engineer"], {
                uiAPI,
                editor: harness.editor,
                tui: harness.tui,
                sessionId,
                sessionRuntime: runtime,
                sessionPort: UNEXPECTED_SESSION_PORT,
            });

            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "router");
            assertStringIncludes(systemMessages.join("\n"), "activated by RunWield when an approved Plan executes");
            assertEquals(systemMessages.join("\n").includes("not found"), false);
        } finally {
            harness.tui.stop();
            runtime.closeSession(sessionId);
        }
    });
});

Deno.test("the agent chooser never offers a workflow-only Agent to pick", async () => {
    await withRuntimeCommandFixture("agent-chooser-hides-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        const runtime = createSessionRuntime();
        const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "router" });
        const harness = makeTuiHarness();
        try {
            const command = runAgentsCommand([], {
                uiAPI: harness.uiAPI,
                editor: harness.editor,
                tui: harness.tui,
                sessionId,
                sessionRuntime: runtime,
                sessionPort: UNEXPECTED_SESSION_PORT,
            });

            for (let attempt = 0; attempt < 100; attempt++) {
                await harness.terminal.flush();
                if (harness.terminal.getScreenText().includes("Switch agent:")) break;
                await new Promise((resolve) => setTimeout(resolve, 1));
            }
            const chooserText = harness.terminal.getScreenText();
            harness.terminal.typeText(FIXTURE_AGENT_FALLBACK);
            harness.terminal.pressEnter();
            await command;

            assertEquals(chooserText.includes("plan-engineer"), false);
            assertEquals(chooserText.includes("frontend-engineer"), false);
            assertStringIncludes(chooserText, "engineer");
        } finally {
            harness.tui.stop();
            runtime.closeSession(sessionId);
        }
    });
});
