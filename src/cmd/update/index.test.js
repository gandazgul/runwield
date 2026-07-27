import { assertEquals } from "@std/assert";
import { runUpdateCommand } from "./index.js";

/**
 * @param {unknown} data
 * @param {number} [status]
 */
function makeJsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), { status });
}

/**
 * @param {string} text
 * @param {number} [status]
 */
function makeTextResponse(text, status = 200) {
    return new Response(text, { status });
}

Deno.test("update exits successfully when current version is already latest", async () => {
    /** @type {string[]} */
    const logs = [];
    await runUpdateCommand([], {
        __testDeps: {
            currentVersion: "v1.2.3",
            fetch: () => Promise.resolve(makeJsonResponse({ tag_name: "v1.2.3" })),
            log: (message) => logs.push(message),
            exit: (code) => {
                throw new Error(`unexpected exit ${code}`);
            },
        },
    });
    assertEquals(logs, ["RunWield is already up to date (v1.2.3)."]);
});

Deno.test("update downloads tag-pinned installer and passes derived install dir", async () => {
    /** @type {string[]} */
    const urls = [];
    /** @type {Array<{ command: string, options: unknown }>} */
    const commands = [];
    /** @type {Array<{ path: string, data: string }>} */
    const writes = [];
    /** @type {Array<{ path: string, options: unknown }>} */
    const removed = [];
    await runUpdateCommand([], {
        __testDeps: {
            currentVersion: "v1.0.0",
            fetch: (url) => {
                urls.push(String(url));
                if (String(url).includes("api.github.com")) {
                    return Promise.resolve(makeJsonResponse({ tag_name: "v2.0.0" }));
                }
                return Promise.resolve(makeTextResponse("#!/usr/bin/env bash\n"));
            },
            execPath: () => "/opt/runwield/bin/wld",
            makeTempDir: () => Promise.resolve("/tmp/runwield-update-test"),
            writeTextFile: (path, data) => {
                writes.push({ path, data });
                return Promise.resolve();
            },
            command: (command, options) => {
                commands.push({ command, options });
                return { output: () => Promise.resolve({ code: 0 }) };
            },
            remove: (path, options) => {
                removed.push({ path, options });
                return Promise.resolve();
            },
            env: { PATH: "/bin" },
        },
    });

    assertEquals(urls, [
        "https://api.github.com/repos/gandazgul/runwield/releases/latest",
        "https://raw.githubusercontent.com/gandazgul/runwield/v2.0.0/install.sh",
    ]);
    assertEquals(writes, [{ path: "/tmp/runwield-update-test/install.sh", data: "#!/usr/bin/env bash\n" }]);
    assertEquals(commands, [{
        command: "bash",
        options: {
            args: ["/tmp/runwield-update-test/install.sh", "v2.0.0"],
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
            env: { PATH: "/bin", WLD_INSTALL_DIR: "/opt/runwield/bin" },
        },
    }]);
    assertEquals(removed, [{ path: "/tmp/runwield-update-test", options: { recursive: true } }]);
});

Deno.test("update preserves user supplied WLD_INSTALL_DIR", async () => {
    /** @type {Record<string, string> | null} */
    let commandEnv = null;
    await runUpdateCommand([], {
        __testDeps: {
            currentVersion: "v1.0.0",
            fetch: (url) =>
                String(url).includes("api.github.com")
                    ? Promise.resolve(makeJsonResponse({ tag_name: "v2.0.0" }))
                    : Promise.resolve(makeTextResponse("install")),
            execPath: () => "/opt/runwield/bin/wld",
            makeTempDir: () => Promise.resolve("/tmp/runwield-update-test"),
            writeTextFile: () => Promise.resolve(),
            command: (_command, options) => {
                commandEnv = options.env;
                return { output: () => Promise.resolve({ code: 0 }) };
            },
            remove: () => Promise.resolve(),
            env: { WLD_INSTALL_DIR: "/custom/bin" },
        },
    });
    assertEquals(commandEnv, { WLD_INSTALL_DIR: "/custom/bin" });
});

Deno.test("source-run mode prints installer-default note", async () => {
    /** @type {string[]} */
    const logs = [];
    await runUpdateCommand([], {
        __testDeps: {
            currentVersion: "v1.0.0",
            fetch: (url) =>
                String(url).includes("api.github.com")
                    ? Promise.resolve(makeJsonResponse({ tag_name: "v2.0.0" }))
                    : Promise.resolve(makeTextResponse("install")),
            execPath: () => "/Users/me/.deno/bin/deno",
            makeTempDir: () => Promise.resolve("/tmp/runwield-update-test"),
            writeTextFile: () => Promise.resolve(),
            command: () => ({ output: () => Promise.resolve({ code: 0 }) }),
            remove: () => Promise.resolve(),
            env: {},
            log: (message) => logs.push(message),
        },
    });
    assertEquals(logs, [
        "RunWield appears to be running from source; installer default location will be used unless WLD_INSTALL_DIR is set.",
    ]);
});

Deno.test("update rejects unexpected arguments with usage", async () => {
    /** @type {string[]} */
    const errors = [];
    let exitCode = 0;
    await runUpdateCommand(["extra"], {
        __testDeps: {
            error: (message) => errors.push(message),
            exit: (code) => {
                exitCode = code;
            },
        },
    });
    assertEquals(errors, ["Usage: wld update\n       wld upgrade"]);
    assertEquals(exitCode, 1);
});

Deno.test("update propagates installer failure exit code", async () => {
    let exitCode = 0;
    await runUpdateCommand([], {
        __testDeps: {
            currentVersion: "v1.0.0",
            fetch: (url) =>
                String(url).includes("api.github.com")
                    ? Promise.resolve(makeJsonResponse({ tag_name: "v2.0.0" }))
                    : Promise.resolve(makeTextResponse("install")),
            execPath: () => "/opt/runwield/bin/wld",
            makeTempDir: () => Promise.resolve("/tmp/runwield-update-test"),
            writeTextFile: () => Promise.resolve(),
            command: () => ({ output: () => Promise.resolve({ code: 7 }) }),
            remove: () => Promise.resolve(),
            env: {},
            exit: (code) => {
                exitCode = code;
            },
        },
    });
    assertEquals(exitCode, 7);
});

Deno.test("update reports fetch failure with exit code 1", async () => {
    /** @type {string[]} */
    const errors = [];
    let exitCode = 0;
    await runUpdateCommand([], {
        __testDeps: {
            fetch: () => Promise.resolve(makeJsonResponse({}, 500)),
            error: (message) => errors.push(message),
            exit: (code) => {
                exitCode = code;
            },
        },
    });
    assertEquals(errors, ["RunWield update failed: GitHub latest release request failed: 500"]);
    assertEquals(exitCode, 1);
});
