import { assertEquals, assertStringIncludes } from "@std/assert";
import { parseWorkspaceServeArgs, runWorkspaceServeCommand } from "./serve.js";
import { runWorkspacePairCommand } from "./pair.js";

function captureConsole() {
    /** @type {string[]} */
    const logs = [];
    /** @type {string[]} */
    const errors = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logs.push(args.join(" "));
    console.error = (...args) => errors.push(args.join(" "));
    return {
        logs,
        errors,
        restore: () => {
            console.log = originalLog;
            console.error = originalError;
        },
    };
}

Deno.test("workspace serve parser defaults to loopback and rejects unsafe non-loopback", () => {
    assertEquals(parseWorkspaceServeArgs([]), {
        host: "127.0.0.1",
        port: 8787,
        publicOrigin: "http://127.0.0.1:8787",
        trustTlsTerminator: false,
        noOpen: false,
        help: false,
    });
    const safe = parseWorkspaceServeArgs([
        "--bind",
        "0.0.0.0",
        "--trust-tls-terminator",
        "--public-origin",
        "https://runwield.example.test",
    ]);
    assertEquals(safe.host, "0.0.0.0");
    assertEquals(safe.publicOrigin, "https://runwield.example.test");
    let message = "";
    try {
        parseWorkspaceServeArgs(["--bind", "0.0.0.0"]);
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }
    assertStringIncludes(message, "Non-loopback owner Workspace bind requires");
});

Deno.test("workspace serve starts owner mode without opening browser when requested", async () => {
    /** @type {any} */
    let launched = null;
    const store = { path: "/tmp/owner.sqlite3", close: () => {} };
    await runWorkspaceServeCommand(["--no-open"], {
        __testDeps: {
            store,
            installShutdownHandlers: () => () => {},
            startWorkspaceServer: (/** @type {any} */ options) => {
                launched = options;
                return { addr: { port: 8787 } };
            },
            openBrowser: () => {
                throw new Error("should not open");
            },
        },
    });
    assertEquals(launched?.mode, "owner");
    assertEquals(launched?.publicOrigin, "http://127.0.0.1:8787");
});

Deno.test("workspace serve preserves explicit public-origin port for TLS terminators", async () => {
    const capture = captureConsole();
    /** @type {string[]} */
    const opened = [];
    try {
        await runWorkspaceServeCommand([
            "--bind",
            "0.0.0.0",
            "--port",
            "8799",
            "--trust-tls-terminator",
            "--public-origin",
            "https://runwield.example.test:443",
        ], {
            __testDeps: {
                store: { path: "/tmp/owner.sqlite3", close: () => {} },
                installShutdownHandlers: () => () => {},
                startWorkspaceServer: () => ({ addr: { port: 8799 } }),
                openBrowser: (/** @type {string} */ url) => opened.push(url),
            },
        });
        assertStringIncludes(capture.logs.join("\n"), "https://runwield.example.test");
        assertEquals(capture.logs.join("\n").includes(":8799"), false);
        assertEquals(opened, ["https://runwield.example.test"]);
    } finally {
        capture.restore();
    }
});

Deno.test("workspace pair approves through store and prints safe output", async () => {
    const capture = captureConsole();
    try {
        await runWorkspacePairCommand(["ab-c123"], {
            __testDeps: {
                store: {
                    approvePairingRequest: (/** @type {string} */ code) => ({
                        deviceLabel: `Device ${code}`,
                        expiresAt: "2026-01-01T00:05:00.000Z",
                    }),
                    close: () => {},
                },
            },
        });
        assertStringIncludes(capture.logs.join("\n"), "Approved Workspace pairing request");
        assertStringIncludes(capture.logs.join("\n"), "ABC123");
    } finally {
        capture.restore();
    }
});
