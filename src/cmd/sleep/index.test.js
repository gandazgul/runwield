import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exportMnemosyneCollection, runSleepCommand, SLEEP_PROMPT } from "./index.js";

Deno.test("runSleepCommand help path", async () => {
    let helped = "";

    await runSleepCommand(["--help"], {
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: true }),
            printCommandHelp: (/** @type {string} */ name) => {
                helped = name;
            },
        }),
    });

    assertEquals(helped, "sleep");
});

Deno.test("runSleepCommand standalone starts an interactive Engineer sleep session", async () => {
    /** @type {unknown[]} */
    let invocation = [];

    await runSleepCommand([], {
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false }),
            startInteractiveSession: (
                /** @type {string | null} */ initialRequest,
                /** @type {unknown} */ onMessage,
                /** @type {object} */ options,
            ) => {
                invocation = [initialRequest, onMessage, options];
                return Promise.resolve();
            },
        }),
    });

    assertEquals(invocation, ["/sleep", null, { initialAgentName: "engineer" }]);
});

Deno.test("exportMnemosyneCollection creates and verifies an explicit no-embeddings backup", async () => {
    const tempDir = await Deno.makeTempDir();
    const outputPath = join(tempDir, "nested", "backup.jsonl");
    let command = "";
    /** @type {string[]} */
    let args = [];

    try {
        await exportMnemosyneCollection("project", outputPath, {
            commandOutput: async (nextCommand, nextArgs) => {
                command = nextCommand;
                args = nextArgs;
                await Deno.writeTextFile(outputPath, '{"type":"mnemosyne-export"}\n');
                return {
                    success: true,
                    code: 0,
                    stdout: new Uint8Array(),
                    stderr: new Uint8Array(),
                };
            },
        });

        assertEquals(command, "mnemosyne");
        assertEquals(args, [
            "export",
            "--name",
            "project",
            "--no-embeddings",
            "--output",
            outputPath,
        ]);
        assert((await Deno.stat(outputPath)).isFile);
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("exportMnemosyneCollection surfaces a nonzero export without checking output", async () => {
    let statCalled = false;

    await assertRejects(
        () =>
            exportMnemosyneCollection("project", "/tmp/backup.jsonl", {
                mkdir: () => Promise.resolve(),
                commandOutput: () =>
                    Promise.resolve({
                        success: false,
                        code: 7,
                        stdout: new Uint8Array(),
                        stderr: new TextEncoder().encode("export refused"),
                    }),
                stat: () => {
                    statCalled = true;
                    return Promise.reject(new Error("should not stat"));
                },
            }),
        Error,
        "export refused",
    );
    assertEquals(statCalled, false);
});

Deno.test("exportMnemosyneCollection rejects success without an output file", async () => {
    const tempDir = await Deno.makeTempDir();
    const outputPath = join(tempDir, "missing.jsonl");

    try {
        await assertRejects(
            () =>
                exportMnemosyneCollection("project", outputPath, {
                    commandOutput: () =>
                        Promise.resolve({
                            success: true,
                            code: 0,
                            stdout: new Uint8Array(),
                            stderr: new Uint8Array(),
                        }),
                }),
            Error,
            "did not create the backup",
        );
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("runSleepCommand backs up before activating persistent Engineer root", async () => {
    const events = /** @type {string[]} */ ([]);
    const messages = /** @type {string[]} */ ([]);
    const sessionManager = { getSessionId: () => "session-123" };
    const hostedSession = /** @type {any} */ ({
        cwd: "/projects/example",
        getRootSessionManager: () => sessionManager,
    });
    const handler = () => Promise.resolve();
    let rootRequest = "";
    let backupPath = "";

    await runSleepCommand([], {
        hostedSession,
        sessionManager: /** @type {any} */ (sessionManager),
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ message) => {
                messages.push(message);
                events.push("notify");
            },
        }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false }),
            ensureMnemosyneBinary: () => {
                events.push("preflight");
                return Promise.resolve();
            },
            getRunWieldSessionMemoryBackupDir: (
                /** @type {string} */ _cwd,
                /** @type {string} */ sessionId,
            ) => `/tmp/sessions/${sessionId}_memory-backups`,
            now: () => new Date("2026-07-10T12:34:56.789Z"),
            randomUUID: () => "backup-id",
            exportMnemosyneCollection: (
                /** @type {string} */ collectionName,
                /** @type {string} */ outputPath,
            ) => {
                events.push("export");
                assertEquals(collectionName, "example");
                backupPath = outputPath;
                return Promise.resolve();
            },
            createAgentHandler: (
                /** @type {string} */ agentName,
                /** @type {{ hostedSession: unknown }} */ deps,
            ) => {
                events.push("handler");
                assertEquals(agentName, "engineer");
                assertEquals(deps.hostedSession, hostedSession);
                return handler;
            },
            setActiveAgent: (
                /** @type {unknown} */ target,
                /** @type {string} */ agentName,
                /** @type {unknown} */ nextHandler,
            ) => {
                events.push("activate");
                assertEquals(target, hostedSession);
                assertEquals(agentName, "engineer");
                assertEquals(nextHandler, handler);
            },
            applyPendingRootSwap: (/** @type {unknown} */ target) => {
                events.push("swap");
                assertEquals(target, hostedSession);
                return Promise.resolve();
            },
            runRootTurn: (/** @type {any} */ opts) => {
                events.push("root-turn");
                assertEquals(opts.hostedSession, hostedSession);
                assertEquals(opts.agentName, "engineer");
                rootRequest = opts.userRequest;
                return Promise.resolve([]);
            },
        }),
    });

    assertEquals(events, ["preflight", "export", "notify", "handler", "activate", "swap", "root-turn"]);
    assertEquals(
        backupPath,
        "/tmp/sessions/session-123_memory-backups/example.sleep-backup-2026-07-10T12-34-56-789Z-backup-id.jsonl",
    );
    assertEquals(messages, [`[RunWield] Memory backup created before sleep mode: ${backupPath}`]);
    assertStringIncludes(rootRequest, SLEEP_PROMPT);
    assertStringIncludes(rootRequest, `Immutable pre-maintenance backup: ${backupPath}`);
    assertStringIncludes(rootRequest, "Session artifact directory: /tmp/sessions/session-123_memory-backups");
});

Deno.test("runSleepCommand leaves the current Agent untouched when backup fails", async () => {
    let activated = false;
    let rootTurnRan = false;
    const messages = /** @type {string[]} */ ([]);
    const sessionManager = { getSessionId: () => "session-123" };

    await assertRejects(
        () =>
            runSleepCommand([], {
                hostedSession: /** @type {any} */ ({
                    cwd: "/projects/example",
                    getRootSessionManager: () => sessionManager,
                }),
                sessionManager: /** @type {any} */ (sessionManager),
                uiAPI: /** @type {any} */ ({
                    appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
                }),
                __testDeps: /** @type {any} */ ({
                    parseArgs: () => ({ help: false }),
                    ensureMnemosyneBinary: () => Promise.resolve(),
                    getRunWieldSessionMemoryBackupDir: () => "/tmp/session_memory-backups",
                    exportMnemosyneCollection: () => Promise.reject(new Error("export failed")),
                    setActiveAgent: () => {
                        activated = true;
                    },
                    runRootTurn: () => {
                        rootTurnRan = true;
                        return Promise.resolve([]);
                    },
                }),
            }),
        Error,
        "export failed",
    );

    assertEquals(activated, false);
    assertEquals(rootTurnRan, false);
    assertEquals(messages, []);
});

Deno.test("inlined sleep prompt stays synchronized with prompt.md", async () => {
    const promptFile = await Deno.readTextFile(new URL("./prompt.md", import.meta.url));
    assertEquals(SLEEP_PROMPT, promptFile);
});
