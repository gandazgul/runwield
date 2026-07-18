import { assertEquals } from "@std/assert";
import { __setClipboardDepsForTest, hasClipboardImage, readClipboardImage } from "./clipboard.js";

const enc = new TextEncoder();

/**
 * @param {Array<{ success: boolean, stdout?: string } | Error>} outputs
 * @param {string[]} removed
 */
function installClipboardDeps(outputs, removed = []) {
    /** @type {Array<{ command: string, args: string[] }>} */
    const calls = [];

    class FakeCommand {
        /** @param {string} command @param {{ args?: string[] }} opts */
        constructor(command, opts) {
            this.command = command;
            this.args = opts.args || [];
            calls.push({ command, args: this.args });
        }

        output() {
            const next = outputs.shift();
            if (next instanceof Error) throw next;
            if (!next) throw new Error("missing fake output");
            return Promise.resolve({
                success: next.success,
                stdout: enc.encode(next.stdout || ""),
                stderr: enc.encode(""),
            });
        }
    }

    __setClipboardDepsForTest(
        /** @type {any} */ ({
            os: "darwin",
            Command: FakeCommand,
            makeTempFile: () => Promise.resolve("/tmp/runwield-clip.png"),
            remove: (/** @type {string} */ path) => {
                removed.push(path);
                return Promise.resolve();
            },
        }),
    );

    return {
        calls,
        restore: () => __setClipboardDepsForTest(),
    };
}

Deno.test("hasClipboardImage returns false outside macOS", async () => {
    __setClipboardDepsForTest(/** @type {any} */ ({ os: "linux" }));
    try {
        assertEquals(await hasClipboardImage(), false);
    } finally {
        __setClipboardDepsForTest();
    }
});

Deno.test("hasClipboardImage reports whether macOS clipboard contains a png", async () => {
    const imageDeps = installClipboardDeps([{ success: true, stdout: "image\n" }]);
    try {
        assertEquals(await hasClipboardImage(), true);
        assertEquals(imageDeps.calls.map((call) => call.command), ["osascript"]);
    } finally {
        imageDeps.restore();
    }

    const emptyDeps = installClipboardDeps([{ success: true, stdout: "none\n" }]);
    try {
        assertEquals(await hasClipboardImage(), false);
    } finally {
        emptyDeps.restore();
    }
});

Deno.test("readClipboardImage returns null outside macOS", async () => {
    __setClipboardDepsForTest(/** @type {any} */ ({ os: "linux" }));
    try {
        assertEquals(await readClipboardImage(), null);
    } finally {
        __setClipboardDepsForTest();
    }
});

Deno.test("readClipboardImage returns null when clipboard does not contain an image", async () => {
    const deps = installClipboardDeps([{ success: true, stdout: "none\n" }]);
    try {
        assertEquals(await readClipboardImage(), null);
        assertEquals(deps.calls.map((call) => call.command), ["osascript"]);
    } finally {
        deps.restore();
    }
});

Deno.test("readClipboardImage extracts and base64 encodes clipboard png", async () => {
    /** @type {string[]} */
    const removed = [];
    const deps = installClipboardDeps([
        { success: true, stdout: "image\n" },
        { success: true, stdout: "" },
        { success: true, stdout: "YWJj\nZA==\n" },
    ], removed);
    try {
        assertEquals(await readClipboardImage(), {
            base64: "YWJjZA==",
            mimeType: "image/png",
        });
        assertEquals(deps.calls.map((call) => call.command), ["osascript", "osascript", "base64"]);
        assertEquals(removed, ["/tmp/runwield-clip.png"]);
    } finally {
        deps.restore();
    }
});

Deno.test("readClipboardImage cleans up when extraction or base64 fails", async () => {
    /** @type {string[]} */
    const removed = [];
    const extractFail = installClipboardDeps([
        { success: true, stdout: "image\n" },
        { success: false, stdout: "" },
    ], removed);
    try {
        assertEquals(await readClipboardImage(), null);
    } finally {
        extractFail.restore();
    }

    const base64Fail = installClipboardDeps([
        { success: true, stdout: "image\n" },
        { success: true, stdout: "" },
        new Error("base64 unavailable"),
    ], removed);
    try {
        assertEquals(await readClipboardImage(), null);
        assertEquals(removed, ["/tmp/runwield-clip.png", "/tmp/runwield-clip.png"]);
    } finally {
        base64Fail.restore();
    }
});
