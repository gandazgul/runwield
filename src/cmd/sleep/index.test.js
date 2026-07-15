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
                /** @type {object} */ options,
            ) => {
                invocation = [initialRequest, options];
                return Promise.resolve();
            },
        }),
    });

    assertEquals(invocation, ["/sleep", { initialAgentName: "engineer" }]);
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
    let rootRequest = "";
    let backupPath = "";

    await runSleepCommand([], {
        sessionId: "sleep-runtime",
        sessionRuntime: /** @type {any} */ ({
            getSessionSnapshot: () => ({ cwd: "/projects/example", sessionManagerId: "session-123" }),
            getSessionMemoryBackupDir: () => "/tmp/sessions/session-123_memory-backups",
            /** @param {string} _id @param {{ agentName: string }} options */
            switchAgent: (_id, options) => {
                events.push("activate");
                assertEquals(options.agentName, "engineer");
                return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
            },
            /** @param {string} _id @param {{ initialRequest: string }} options */
            promptSession: (_id, options) => {
                events.push("root-turn");
                rootRequest = options.initialRequest;
                return Promise.resolve({ ok: true });
            },
        }),
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
        }),
    });

    assertEquals(events, ["preflight", "export", "notify", "activate", "root-turn"]);
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
    await assertRejects(
        () =>
            runSleepCommand([], {
                sessionId: "sleep-runtime",
                sessionRuntime: /** @type {any} */ ({
                    getSessionSnapshot: () => ({ cwd: "/projects/example", sessionManagerId: "session-123" }),
                    getSessionMemoryBackupDir: () => "/tmp/session_memory-backups",
                    switchAgent: () => {
                        activated = true;
                    },
                    promptSession: () => {
                        rootTurnRan = true;
                        return Promise.resolve({ ok: true });
                    },
                }),
                uiAPI: /** @type {any} */ ({
                    appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
                }),
                __testDeps: /** @type {any} */ ({
                    parseArgs: () => ({ help: false }),
                    ensureMnemosyneBinary: () => Promise.resolve(),
                    exportMnemosyneCollection: () => Promise.reject(new Error("export failed")),
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
