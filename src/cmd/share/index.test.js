import { assertEquals, assertRejects } from "@std/assert";
import { runShareCommand } from "./index.js";

Deno.test("runShareCommand requires ui and reports missing session", async () => {
    await assertRejects(
        () => runShareCommand([], {}),
        Error,
        "UI API is required",
    );

    /** @type {Array<{ msg: string, error?: boolean }>} */
    const messages = [];
    await runShareCommand(
        [],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: (
                    /** @type {string} */ msg,
                    /** @type {boolean | undefined} */ error,
                ) => messages.push({ msg, error }),
            },
        }),
    );

    assertEquals(messages, [{ msg: "Error: No active session found.", error: true }]);
});

Deno.test("runShareCommand checks gh, exports, uploads, and cleans up", async () => {
    /** @type {Array<{ cmd: string, args: string[] }>} */
    const calls = [];
    /** @type {string[]} */
    const exported = [];
    /** @type {string[]} */
    const removed = [];
    /** @type {string[]} */
    const messages = [];
    const sessionRuntime = {
        getSessionSnapshot: () => ({ sessionManagerId: "abc" }),
        exportSession: (/** @type {string} */ sessionId, /** @type {string} */ outPath) => {
            exported.push(`${sessionId}:${outPath}`);
            return Promise.resolve();
        },
    };

    await runShareCommand(
        [],
        /** @type {any} */ ({
            sessionId: "runtime-share",
            sessionRuntime,
            uiAPI: {
                appendSystemMessage: (/** @type {string} */ msg) => messages.push(msg),
            },
            __testDeps: {
                runCmd: (
                    /** @type {string} */ cmd,
                    /** @type {string[]} */ args,
                ) => {
                    calls.push({ cmd, args });
                    if (args[0] === "gist") {
                        return Promise.resolve({ success: true, stdout: "https://gist.example/1\n", stderr: "" });
                    }
                    return Promise.resolve({ success: true, stdout: "ok", stderr: "" });
                },
                tmpDir: () => "/tmp/runwield-share",
                remove: (/** @type {string} */ path) => {
                    removed.push(path);
                    return Promise.resolve();
                },
                theme: {
                    fg: (
                        /** @type {string} */ _slot,
                        /** @type {string} */ text,
                    ) => text,
                },
            },
        }),
    );

    assertEquals(calls, [
        { cmd: "gh", args: ["--version"] },
        { cmd: "gh", args: ["auth", "status"] },
        { cmd: "gh", args: ["gist", "create", "--public=false", "/tmp/runwield-share/runwield-session-abc.html"] },
    ]);
    assertEquals(exported, ["runtime-share:/tmp/runwield-share/runwield-session-abc.html"]);
    assertEquals(removed, ["/tmp/runwield-share/runwield-session-abc.html"]);
    assertEquals(messages, ["Session shared successfully!\nhttps://gist.example/1"]);
});

Deno.test("runShareCommand reports gh and gist failures", async () => {
    /** @type {Array<{ msg: string, error?: boolean }>} */
    const messages = [];
    const uiAPI = {
        appendSystemMessage: (/** @type {string} */ msg, /** @type {boolean | undefined} */ error) =>
            messages.push({ msg, error }),
    };

    await runShareCommand(
        [],
        /** @type {any} */ ({
            sessionId: "runtime-share",
            sessionRuntime: {
                getSessionSnapshot: () => ({ sessionManagerId: "abc" }),
                exportSession: () => Promise.resolve(),
            },
            uiAPI,
            __testDeps: {
                runCmd: () => Promise.resolve({ success: false, stdout: "", stderr: "missing" }),
            },
        }),
    );

    await runShareCommand(
        [],
        /** @type {any} */ ({
            sessionId: "runtime-share",
            sessionRuntime: {
                getSessionSnapshot: () => ({ sessionManagerId: "abc" }),
                exportSession: () => Promise.resolve(),
            },
            uiAPI,
            __testDeps: {
                runCmd: (
                    /** @type {string} */ _cmd,
                    /** @type {string[]} */ args,
                ) => {
                    if (args[0] === "gist") {
                        return Promise.resolve({ success: false, stdout: "", stderr: "gist bad" });
                    }
                    return Promise.resolve({ success: true, stdout: "ok", stderr: "" });
                },
                tmpDir: () => "/tmp",
                now: () => 7,
            },
        }),
    );

    assertEquals(messages, [
        { msg: "Error: GitHub CLI ('gh') is not installed. Please install it first.", error: true },
        { msg: "Unexpected error while sharing session: gh gist create failed: gist bad", error: true },
    ]);
});
